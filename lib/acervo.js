// Regras de gravação do acervo (resumo e PDFs), usadas pela API e pelo script de importação.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, PDF_DIR, transacao } = require('../db');
const { extrairPaginas } = require('./pdf');
const Clausulas = require('./clausulas');

const chave = (t) => Clausulas.normalizar(String(t ?? '')).replace(/[^A-Z0-9]/g, '');

function registrar(usuario, acao, { usina_id = null, item_id = null, descricao = '', antes = null, depois = null } = {}) {
  db.prepare('INSERT INTO alteracoes (usuario, acao, usina_id, item_id, descricao, antes, depois) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(usuario, acao, usina_id, item_id, descricao,
      antes == null ? null : JSON.stringify(antes), depois == null ? null : JSON.stringify(depois));
}

/** Grava o valor de uma célula (usina × item), registrando o histórico quando muda. */
function gravarValor(usina_id, item_id, valor, nota, usuario, acao = 'valor') {
  const atual = db.prepare('SELECT valor, nota FROM valores WHERE usina_id = ? AND item_id = ?').get(usina_id, item_id);
  valor = String(valor ?? '').trim();
  nota = String(nota ?? '').trim();
  if (atual && atual.valor === valor && atual.nota === nota) return false;
  if (!atual && !valor && !nota) return false;
  db.prepare(`INSERT INTO valores (usina_id, item_id, valor, nota, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT (usina_id, item_id) DO UPDATE SET valor = excluded.valor, nota = excluded.nota,
      atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`).run(usina_id, item_id, valor, nota, usuario);
  registrar(usuario, acao, { usina_id, item_id, antes: atual ? { valor: atual.valor, nota: atual.nota } : null, depois: { valor, nota } });
  return true;
}

/**
 * Importa o resultado de lib/planilha.js. Usinas e itens são reconhecidos pelo nome (sem acento/pontuação);
 * os que não existem são criados. Os valores da planilha substituem os atuais; os PDFs não são alterados.
 */
function importarResumo({ usinas = [], itens = [], valores = [] }, usuario) {
  return transacao(() => {
    const res = { usinas_novas: 0, itens_novos: 0, valores_alterados: 0 };
    const mapaUsina = new Map();
    const existentes = db.prepare('SELECT * FROM usinas').all();
    let ordemU = db.prepare('SELECT COALESCE(MAX(ordem), 0) AS m FROM usinas').get().m;
    for (const u of usinas) {
      const achada = existentes.find(e => [e.nome, e.nome_planilha].some(n => n && (chave(n) === chave(u.nome) || chave(n) === chave(u.nome_planilha))));
      const campos = {
        sindicato: u.sindicato || null, data_base_mes: u.data_base_mes || null,
        vigencia_inicio: u.vigencia_inicio || null, vigencia_fim: u.vigencia_fim || null,
      };
      if (achada) {
        db.prepare(`UPDATE usinas SET nome_planilha = ?, sindicato = COALESCE(?, sindicato), data_base_mes = COALESCE(?, data_base_mes),
          vigencia_inicio = COALESCE(?, vigencia_inicio), vigencia_fim = COALESCE(?, vigencia_fim) WHERE id = ?`)
          .run(u.nome_planilha || achada.nome_planilha, campos.sindicato, campos.data_base_mes, campos.vigencia_inicio, campos.vigencia_fim, achada.id);
        mapaUsina.set(u.nome, achada.id);
      } else {
        const r = db.prepare(`INSERT INTO usinas (nome, nome_planilha, sindicato, data_base_mes, vigencia_inicio, vigencia_fim, ordem)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(u.nome, u.nome_planilha || u.nome, campos.sindicato, campos.data_base_mes,
          campos.vigencia_inicio, campos.vigencia_fim, ++ordemU);
        mapaUsina.set(u.nome, Number(r.lastInsertRowid));
        res.usinas_novas++;
      }
    }

    const mapaItem = new Map();
    const itensExistentes = db.prepare('SELECT * FROM itens').all();
    let ordemI = db.prepare('SELECT COALESCE(MAX(ordem), 0) AS m FROM itens').get().m;
    for (const it of itens) {
      const achado = itensExistentes.find(e => chave(e.nome) === chave(it.nome));
      if (achado) mapaItem.set(it.nome, achado.id);
      else {
        const r = db.prepare('INSERT INTO itens (nome, categoria, destaque, ordem) VALUES (?, ?, ?, ?)')
          .run(it.nome, it.categoria || 'Outros', it.destaque ? 1 : 0, ++ordemI);
        mapaItem.set(it.nome, Number(r.lastInsertRowid));
        res.itens_novos++;
      }
    }

    for (const v of valores) {
      const u = mapaUsina.get(v.usina), i = mapaItem.get(v.item);
      if (u && i && gravarValor(u, i, v.valor, v.nota, usuario, 'importação')) res.valores_alterados++;
    }
    registrar(usuario, 'importação', { descricao: `Planilha importada: ${usinas.length} usinas, ${itens.length} itens, ${res.valores_alterados} valores alterados.` });
    return res;
  });
}

/** Salva o PDF, extrai o texto de cada página e indexa os títulos das cláusulas. */
async function salvarDocumento(buffer, { usina_id, titulo, tipo = 'ACT', vigencia = '', nome_original = '' }, usuario) {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('O arquivo enviado não é um PDF.'), { status: 400 });
  const paginas = await extrairPaginas(buffer);
  const arquivo = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(PDF_DIR, arquivo), buffer);
  try {
    return transacao(() => {
      const r = db.prepare(`INSERT INTO documentos (usina_id, titulo, tipo, vigencia, arquivo, nome_original, tamanho, paginas, enviado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(usina_id, titulo, tipo, vigencia || null, arquivo, nome_original, buffer.length, paginas.length, usuario);
      const id = Number(r.lastInsertRowid);
      indexarDocumento(id, paginas);
      registrar(usuario, 'documento enviado', { usina_id, descricao: `${tipo}: ${titulo} (${paginas.length} págs.)` });
      return id;
    });
  } catch (err) {
    fs.rmSync(path.join(PDF_DIR, arquivo), { force: true });
    throw err;
  }
}

function indexarDocumento(id, paginas) {
  db.prepare('DELETE FROM doc_paginas WHERE documento_id = ?').run(id);
  db.prepare('DELETE FROM doc_clausulas WHERE documento_id = ?').run(id);
  const insPag = db.prepare('INSERT INTO doc_paginas (documento_id, n, texto) VALUES (?, ?, ?)');
  paginas.forEach((t, i) => insPag.run(id, i + 1, t));
  const insCl = db.prepare('INSERT OR IGNORE INTO doc_clausulas (documento_id, numero, secao, titulo, pagina) VALUES (?, ?, ?, ?, ?)');
  for (const c of Clausulas.indexar(paginas)) insCl.run(id, c.numero, c.secao, c.titulo, c.pagina);
}

function removerDocumento(id, usuario) {
  const doc = db.prepare('SELECT * FROM documentos WHERE id = ?').get(id);
  if (!doc) return false;
  db.prepare('DELETE FROM documentos WHERE id = ?').run(id);
  fs.rmSync(path.join(PDF_DIR, doc.arquivo), { force: true });
  registrar(usuario, 'documento removido', { usina_id: doc.usina_id, descricao: `${doc.tipo}: ${doc.titulo}` });
  return true;
}

module.exports = { registrar, gravarValor, importarResumo, salvarDocumento, removerDocumento, chave };
