// Painel de Acordos Coletivos · Âmbar Energia (RH)
// API (login de usuários do RH, resumo por usina, PDFs dos acordos, busca, administração) + arquivos estáticos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR, PDF_DIR, transacao } = require('./db');
const acervo = require('./lib/acervo');
const Clausulas = require('./lib/clausulas');

const PORT = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const PAPEIS = ['admin', 'editor', 'leitor'];
const SENHA_MIN = 8;

// ---------- sessão ----------

const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(SECRET_FILE, 'utf8');
})();

function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${corpo}.${crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url')}`;
}
function verificar(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
const HORAS_SESSAO = 10;
function abrirSessao(res, u) {
  const token = assinar({ uid: u.id, v: u.versao_sessao, exp: Date.now() + HORAS_SESSAO * 3600e3 });
  res.cookie('sess_act', token, { httpOnly: true, sameSite: 'lax', secure: PRODUCAO, maxAge: HORAS_SESSAO * 3600e3 });
}

// ---------- senhas ----------

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}
function conferirSenha(senha, guardado) {
  const [alg, sal, h] = String(guardado).split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const calc = crypto.scryptSync(String(senha), Buffer.from(sal, 'base64'), esperado.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(calc, esperado);
}
/** Senha provisória legível (sem 0/O, 1/l): ex. "Kp7m-W3xq-Tb9a". */
function senhaProvisoria() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  const s = Array.from(bytes, b => abc[b % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

// Administrador a partir das variáveis de ambiente (ADMIN_EMAIL / ADMIN_SENHA):
// - banco sem usuários, ou nenhum usuário com esse e-mail: cria o administrador;
// - ADMIN_REDEFINIR=sim: redefine a senha desse administrador para ADMIN_SENHA (recuperação de acesso).
//   Depois de entrar, remova ADMIN_REDEFINIR no Render para a senha não voltar a cada reinício.
{
  const email = (process.env.ADMIN_EMAIL || (PRODUCAO ? '' : 'admin@ambar.local')).trim().toLowerCase();
  // trim: o campo de valor do Render é uma caixa de texto e pode guardar espaço ou quebra de linha no fim.
  const senha = (process.env.ADMIN_SENHA || process.env.ADMIN_PASSWORD || (PRODUCAO ? '' : 'ambar-act')).trim();
  const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (!total && (!email || !senha)) {
    console.error('[erro] Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA para criar o administrador inicial.');
    process.exit(1);
  }
  if (email && senha) {
    const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!existente) {
      db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha) VALUES ('Administrador', ?, ?, 'admin', 0)")
        .run(email, hashSenha(senha));
      console.log(`[info] Administrador criado a partir de ADMIN_EMAIL: ${email}`);
    } else if (/^(sim|1|true)$/i.test(String(process.env.ADMIN_REDEFINIR || '').trim())) {
      db.prepare("UPDATE usuarios SET senha_hash = ?, papel = 'admin', ativo = 1, trocar_senha = 0, versao_sessao = versao_sessao + 1 WHERE id = ?")
        .run(hashSenha(senha), existente.id);
      console.warn(`[aviso] ADMIN_REDEFINIR: senha de ${email} redefinida para o valor de ADMIN_SENHA. Remova ADMIN_REDEFINIR depois de entrar.`);
    }
  }
  console.log(`[info] Usuários cadastrados: ${db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n} · administradores ativos: ${db.prepare("SELECT group_concat(email, ', ') AS e FROM usuarios WHERE papel = 'admin' AND ativo = 1").get().e || 'nenhum'}`);
  if (!PRODUCAO && !process.env.ADMIN_SENHA && !process.env.ADMIN_PASSWORD) console.warn('[aviso] Senha padrão de desenvolvimento "ambar-act". Não use em produção.');
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "worker-src 'self' blob:",
      "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ].join('; '),
  });
  next();
});

const erro = (res, status, msg, extra = {}) => res.status(status).json({ erro: msg, ...extra });
const nomeUsuario = (req) => req.usuario?.nome || 'sistema';

function exigirLogin(req, res, next) {
  const s = verificar(lerCookie(req, 'sess_act'));
  const u = s && db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(s.uid);
  if (!u || u.versao_sessao !== s.v) return erro(res, 401, 'Sua sessão expirou. Entre novamente.');
  req.usuario = u;
  if (u.trocar_senha && !['/api/eu', '/api/eu/senha', '/api/sair'].includes(req.baseUrl + req.path)) {
    return erro(res, 403, 'Crie sua senha pessoal para continuar.', { trocar_senha: true });
  }
  next();
}
const exigirPapel = (...papeis) => (req, res, next) =>
  papeis.includes(req.usuario.papel) ? next() : erro(res, 403, 'Seu perfil não tem permissão para esta ação.');
const podeEditar = exigirPapel('admin', 'editor');
const soAdmin = exigirPapel('admin');

const publicoUsuario = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, trocar_senha: !!u.trocar_senha });

// ----- login -----

const falhas = new Map(); // ip → { n, ate }
app.post('/api/entrar', (req, res) => {
  const ip = req.ip;
  const f = falhas.get(ip);
  if (f && f.n >= 8 && f.ate > Date.now()) return erro(res, 429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !u.ativo || !conferirSenha(senha, u.senha_hash)) {
    // Motivo só no log do servidor (nunca a senha), para diagnosticar acessos negados.
    console.warn(`[login] negado para ${email || '(vazio)'}: ${!u ? 'e-mail não cadastrado' : !u.ativo ? 'usuário desativado' : 'senha incorreta'}`);
    const atual = f && f.ate > Date.now() ? f : { n: 0 };
    falhas.set(ip, { n: atual.n + 1, ate: Date.now() + 15 * 60e3 });
    return erro(res, 401, 'E-mail ou senha incorretos.');
  }
  falhas.delete(ip);
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(u.id);
  abrirSessao(res, u);
  res.json(publicoUsuario(u));
});

app.post('/api/sair', (req, res) => {
  res.clearCookie('sess_act');
  res.json({ ok: true });
});

app.use('/api', exigirLogin);

app.get('/api/eu', (req, res) => res.json(publicoUsuario(req.usuario)));

app.post('/api/eu/senha', (req, res) => {
  const { atual, nova } = req.body || {};
  if (!conferirSenha(String(atual || ''), req.usuario.senha_hash)) return erro(res, 400, 'A senha atual não confere.');
  if (String(nova || '').length < SENHA_MIN) return erro(res, 400, `A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
  if (nova === atual) return erro(res, 400, 'A nova senha precisa ser diferente da atual.');
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, versao_sessao = versao_sessao + 1 WHERE id = ?')
    .run(hashSenha(String(nova)), req.usuario.id);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  abrirSessao(res, u);
  res.json(publicoUsuario(u));
});

// ----- painel (tudo o que as telas precisam, de uma vez: o volume é pequeno) -----

app.get('/api/painel', (req, res) => {
  const documentos = db.prepare(`SELECT id, usina_id, titulo, tipo, vigencia, nome_original, tamanho, paginas, enviado_por, enviado_em
    FROM documentos ORDER BY CASE tipo WHEN 'ACT' THEN 0 WHEN 'Aditivo' THEN 1 ELSE 2 END, enviado_em DESC`).all();
  const clausulas = db.prepare('SELECT documento_id, numero, secao, titulo, pagina FROM doc_clausulas ORDER BY documento_id, secao, numero').all();
  const porDoc = new Map(documentos.map(d => [d.id, (d.clausulas = [], d)]));
  for (const c of clausulas) porDoc.get(c.documento_id)?.clausulas.push({ numero: c.numero, secao: c.secao, titulo: c.titulo, pagina: c.pagina });
  res.json({
    hoje: new Date().toISOString().slice(0, 10),
    usuario: publicoUsuario(req.usuario),
    usinas: db.prepare('SELECT * FROM usinas ORDER BY ordem, nome').all(),
    itens: db.prepare('SELECT * FROM itens ORDER BY ordem, id').all(),
    valores: db.prepare('SELECT usina_id, item_id, valor, nota, atualizado_em, atualizado_por FROM valores').all(),
    documentos,
  });
});

// ----- valores -----

app.put('/api/valores/:usina/:item', podeEditar, (req, res) => {
  const usina = db.prepare('SELECT id FROM usinas WHERE id = ?').get(Number(req.params.usina));
  const item = db.prepare('SELECT id FROM itens WHERE id = ?').get(Number(req.params.item));
  if (!usina || !item) return erro(res, 404, 'Usina ou item não encontrado.');
  const valor = String(req.body?.valor ?? '').slice(0, 500);
  const nota = String(req.body?.nota ?? '').slice(0, 5000);
  acervo.gravarValor(usina.id, item.id, valor, nota, nomeUsuario(req));
  res.json(db.prepare('SELECT usina_id, item_id, valor, nota, atualizado_em, atualizado_por FROM valores WHERE usina_id = ? AND item_id = ?').get(usina.id, item.id)
    || { usina_id: usina.id, item_id: item.id, valor: '', nota: '' });
});

app.get('/api/alteracoes', (req, res) => {
  const cond = [], args = [];
  if (req.query.usina_id) { cond.push('a.usina_id = ?'); args.push(Number(req.query.usina_id)); }
  if (req.query.item_id) { cond.push('a.item_id = ?'); args.push(Number(req.query.item_id)); }
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  res.json(db.prepare(`SELECT a.*, u.nome AS usina, i.nome AS item FROM alteracoes a
    LEFT JOIN usinas u ON u.id = a.usina_id LEFT JOIN itens i ON i.id = a.item_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...args, limite)
    .map(a => ({ ...a, antes: a.antes && JSON.parse(a.antes), depois: a.depois && JSON.parse(a.depois) })));
});

// ----- usinas -----

function camposUsina(b) {
  const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  const mes = Number(b.data_base_mes);
  return {
    nome: String(b.nome || '').trim().slice(0, 120),
    sindicato: String(b.sindicato || '').trim().slice(0, 200) || null,
    data_base_mes: mes >= 1 && mes <= 12 ? mes : null,
    vigencia_inicio: data(b.vigencia_inicio),
    vigencia_fim: data(b.vigencia_fim),
    observacoes: String(b.observacoes || '').trim().slice(0, 5000) || null,
  };
}

app.post('/api/usinas', podeEditar, (req, res) => {
  const c = camposUsina(req.body || {});
  if (!c.nome) return erro(res, 400, 'Informe o nome da usina.');
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM usinas').get().o;
  const r = db.prepare(`INSERT INTO usinas (nome, nome_planilha, sindicato, data_base_mes, vigencia_inicio, vigencia_fim, observacoes, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(c.nome, c.nome, c.sindicato, c.data_base_mes, c.vigencia_inicio, c.vigencia_fim, c.observacoes, ordem);
  acervo.registrar(nomeUsuario(req), 'usina criada', { usina_id: Number(r.lastInsertRowid), descricao: c.nome });
  res.json({ id: Number(r.lastInsertRowid) });
});

app.patch('/api/usinas/:id', podeEditar, (req, res) => {
  const antes = db.prepare('SELECT * FROM usinas WHERE id = ?').get(Number(req.params.id));
  if (!antes) return erro(res, 404, 'Usina não encontrada.');
  const c = camposUsina({ ...antes, ...req.body });
  if (!c.nome) return erro(res, 400, 'Informe o nome da usina.');
  db.prepare(`UPDATE usinas SET nome = ?, sindicato = ?, data_base_mes = ?, vigencia_inicio = ?, vigencia_fim = ?, observacoes = ? WHERE id = ?`)
    .run(c.nome, c.sindicato, c.data_base_mes, c.vigencia_inicio, c.vigencia_fim, c.observacoes, antes.id);
  const { nome, sindicato, data_base_mes, vigencia_inicio, vigencia_fim, observacoes } = antes;
  acervo.registrar(nomeUsuario(req), 'usina editada', { usina_id: antes.id, descricao: c.nome,
    antes: { nome, sindicato, data_base_mes, vigencia_inicio, vigencia_fim, observacoes }, depois: c });
  res.json({ ok: true });
});

app.delete('/api/usinas/:id', soAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usinas WHERE id = ?').get(Number(req.params.id));
  if (!u) return erro(res, 404, 'Usina não encontrada.');
  const docs = db.prepare('SELECT id FROM documentos WHERE usina_id = ?').all(u.id);
  for (const d of docs) acervo.removerDocumento(d.id, nomeUsuario(req));
  db.prepare('DELETE FROM usinas WHERE id = ?').run(u.id);
  acervo.registrar(nomeUsuario(req), 'usina removida', { descricao: u.nome });
  res.json({ ok: true });
});

function reordenar(tabela, ids) {
  const upd = db.prepare(`UPDATE ${tabela} SET ordem = ? WHERE id = ?`);
  transacao(() => ids.forEach((id, i) => upd.run(i + 1, Number(id))));
}
app.post('/api/usinas/ordem', podeEditar, (req, res) => {
  reordenar('usinas', Array.isArray(req.body?.ids) ? req.body.ids : []);
  res.json({ ok: true });
});

// ----- itens (linhas do resumo) -----

app.post('/api/itens', podeEditar, (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 200);
  if (!nome) return erro(res, 400, 'Informe o nome do item.');
  const categoria = String(req.body?.categoria || 'Outros').trim().slice(0, 80) || 'Outros';
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM itens').get().o;
  const r = db.prepare('INSERT INTO itens (nome, categoria, destaque, ordem) VALUES (?, ?, ?, ?)').run(nome, categoria, req.body?.destaque ? 1 : 0, ordem);
  acervo.registrar(nomeUsuario(req), 'item criado', { item_id: Number(r.lastInsertRowid), descricao: `${nome} (${categoria})` });
  res.json({ id: Number(r.lastInsertRowid) });
});

app.patch('/api/itens/:id', podeEditar, (req, res) => {
  const it = db.prepare('SELECT * FROM itens WHERE id = ?').get(Number(req.params.id));
  if (!it) return erro(res, 404, 'Item não encontrado.');
  const nome = String(req.body?.nome ?? it.nome).trim().slice(0, 200);
  const categoria = String(req.body?.categoria ?? it.categoria).trim().slice(0, 80) || 'Outros';
  const destaque = req.body?.destaque === undefined ? it.destaque : (req.body.destaque ? 1 : 0);
  if (!nome) return erro(res, 400, 'Informe o nome do item.');
  db.prepare('UPDATE itens SET nome = ?, categoria = ?, destaque = ? WHERE id = ?').run(nome, categoria, destaque, it.id);
  acervo.registrar(nomeUsuario(req), 'item editado', { item_id: it.id, descricao: nome,
    antes: { nome: it.nome, categoria: it.categoria, destaque: it.destaque }, depois: { nome, categoria, destaque } });
  res.json({ ok: true });
});

app.delete('/api/itens/:id', soAdmin, (req, res) => {
  const it = db.prepare('SELECT * FROM itens WHERE id = ?').get(Number(req.params.id));
  if (!it) return erro(res, 404, 'Item não encontrado.');
  db.prepare('DELETE FROM itens WHERE id = ?').run(it.id);
  acervo.registrar(nomeUsuario(req), 'item removido', { descricao: it.nome });
  res.json({ ok: true });
});

app.post('/api/itens/ordem', podeEditar, (req, res) => {
  reordenar('itens', Array.isArray(req.body?.ids) ? req.body.ids : []);
  res.json({ ok: true });
});

// ----- importação da planilha (lida no navegador por lib/planilha.js) -----

app.post('/api/importar', podeEditar, (req, res) => {
  const { usinas, itens, valores } = req.body || {};
  if (![usinas, itens, valores].every(Array.isArray) || !usinas.length) return erro(res, 400, 'Planilha sem dados para importar.');
  res.json(acervo.importarResumo({ usinas, itens, valores }, nomeUsuario(req)));
});

// ----- documentos (PDFs dos acordos) -----

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.pdf$/i.test(file.originalname) || file.mimetype === 'application/pdf'),
});

app.post('/api/usinas/:id/documentos', podeEditar, upload.single('arquivo'), async (req, res) => {
  const usina = db.prepare('SELECT id FROM usinas WHERE id = ?').get(Number(req.params.id));
  if (!usina) return erro(res, 404, 'Usina não encontrada.');
  if (!req.file) return erro(res, 400, 'Selecione o arquivo PDF do acordo.');
  const tipo = ['ACT', 'Aditivo', 'Outro'].includes(req.body.tipo) ? req.body.tipo : 'ACT';
  const nomeOriginal = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const titulo = String(req.body.titulo || '').trim().slice(0, 200) || nomeOriginal.replace(/\.pdf$/i, '');
  try {
    const id = await acervo.salvarDocumento(req.file.buffer, {
      usina_id: usina.id, titulo, tipo, vigencia: String(req.body.vigencia || '').trim().slice(0, 40), nome_original: nomeOriginal,
    }, nomeUsuario(req));
    const doc = db.prepare('SELECT id, paginas FROM documentos WHERE id = ?').get(id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM doc_clausulas WHERE documento_id = ?').get(id).n;
    const comTexto = db.prepare("SELECT COUNT(*) AS n FROM doc_paginas WHERE documento_id = ? AND length(trim(texto)) > 30").get(id).n;
    res.json({ id, paginas: doc.paginas, clausulas: n, paginas_com_texto: comTexto });
  } catch (err) {
    erro(res, err.status || 500, err.status ? err.message : 'Não foi possível ler este PDF.');
    if (!err.status) console.error(err);
  }
});

app.patch('/api/documentos/:id', podeEditar, (req, res) => {
  const d = db.prepare('SELECT * FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return erro(res, 404, 'Documento não encontrado.');
  const titulo = String(req.body?.titulo ?? d.titulo).trim().slice(0, 200) || d.titulo;
  const tipo = ['ACT', 'Aditivo', 'Outro'].includes(req.body?.tipo) ? req.body.tipo : d.tipo;
  const vigencia = String(req.body?.vigencia ?? d.vigencia ?? '').trim().slice(0, 40) || null;
  db.prepare('UPDATE documentos SET titulo = ?, tipo = ?, vigencia = ? WHERE id = ?').run(titulo, tipo, vigencia, d.id);
  acervo.registrar(nomeUsuario(req), 'documento editado', { usina_id: d.usina_id, descricao: `${tipo}: ${titulo}` });
  res.json({ ok: true });
});

app.delete('/api/documentos/:id', podeEditar, (req, res) => {
  if (!acervo.removerDocumento(Number(req.params.id), nomeUsuario(req))) return erro(res, 404, 'Documento não encontrado.');
  res.json({ ok: true });
});

app.get('/api/documentos/:id/arquivo', (req, res) => {
  const d = db.prepare('SELECT * FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return erro(res, 404, 'Documento não encontrado.');
  const nome = (d.nome_original || `${d.titulo}.pdf`).replace(/["\r\n]/g, '');
  res.set({
    'Content-Type': 'application/pdf',
    'Cache-Control': 'private, max-age=300',
    'Content-Disposition': `${req.query.baixar ? 'attachment' : 'inline'}; filename="${nome.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
  });
  res.sendFile(path.join(PDF_DIR, d.arquivo));
});

// ----- busca no texto dos acordos -----

app.get('/api/busca', (req, res) => {
  const termo = String(req.query.q || '').trim();
  if (termo.length < 3) return res.json({ termo, resultados: [], total: 0 });
  const filtroUsina = req.query.usina_id ? Number(req.query.usina_id) : null;
  const paginas = db.prepare(`SELECT p.documento_id, p.n, p.texto, d.usina_id, d.titulo, d.tipo FROM doc_paginas p
    JOIN documentos d ON d.id = p.documento_id ${filtroUsina ? 'WHERE d.usina_id = ?' : ''} ORDER BY d.usina_id, d.id, p.n`)
    .all(...(filtroUsina ? [filtroUsina] : []));
  const resultados = [];
  let total = 0;
  for (const p of paginas) {
    const oc = Clausulas.ocorrencias(p.texto, termo);
    if (!oc.length) continue;
    total += oc.length;
    // Cláusula em que o trecho está: último título antes da ocorrência (na página ou nas anteriores).
    const titulosPag = Clausulas.titulos(p.texto);
    const trechos = oc.slice(0, 3).map(([ini, fim]) => {
      const a = Math.max(0, ini - 90), b = Math.min(p.texto.length, fim + 110);
      const t = titulosPag.filter(x => x.inicio <= ini).pop();
      return {
        antes: (a > 0 ? '…' : '') + p.texto.slice(a, ini).replace(/\s+/g, ' '),
        achado: p.texto.slice(ini, fim),
        depois: p.texto.slice(fim, b).replace(/\s+/g, ' ') + (b < p.texto.length ? '…' : ''),
        clausula: t ? t.numero : null,
      };
    });
    resultados.push({ documento_id: p.documento_id, usina_id: p.usina_id, titulo: p.titulo, tipo: p.tipo, pagina: p.n, ocorrencias: oc.length, trechos });
    if (resultados.length >= 300) break;
  }
  res.json({ termo, resultados, total });
});

// ----- usuários (somente administradores) -----

app.get('/api/usuarios', soAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, nome, email, papel, ativo, trocar_senha, ultimo_acesso, criado_em FROM usuarios ORDER BY ativo DESC, nome').all());
});

app.post('/api/usuarios', soAdmin, (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 120);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200);
  const papel = PAPEIS.includes(req.body?.papel) ? req.body.papel : 'leitor';
  if (!nome) return erro(res, 400, 'Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro(res, 400, 'Informe um e-mail válido.');
  if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) return erro(res, 400, 'Já existe um usuário com este e-mail.');
  const senha = senhaProvisoria();
  const r = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha) VALUES (?, ?, ?, ?, 1)').run(nome, email, hashSenha(senha), papel);
  acervo.registrar(nomeUsuario(req), 'usuário criado', { descricao: `${nome} <${email}> · ${papel}` });
  res.json({ id: Number(r.lastInsertRowid), senha_provisoria: senha });
});

const outrosAdminsAtivos = (id) => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND id <> ?").get(id).n;

app.patch('/api/usuarios/:id', soAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(req.params.id));
  if (!u) return erro(res, 404, 'Usuário não encontrado.');
  const nome = String(req.body?.nome ?? u.nome).trim().slice(0, 120) || u.nome;
  const papel = PAPEIS.includes(req.body?.papel) ? req.body.papel : u.papel;
  const ativo = req.body?.ativo === undefined ? u.ativo : (req.body.ativo ? 1 : 0);
  if (u.papel === 'admin' && (papel !== 'admin' || !ativo) && !outrosAdminsAtivos(u.id)) {
    return erro(res, 400, 'É preciso manter pelo menos um administrador ativo.');
  }
  db.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ?, versao_sessao = versao_sessao + ? WHERE id = ?')
    .run(nome, papel, ativo, ativo !== u.ativo || papel !== u.papel ? 1 : 0, u.id);
  acervo.registrar(nomeUsuario(req), 'usuário editado', { descricao: `${nome} <${u.email}> · ${papel}${ativo ? '' : ' · desativado'}` });
  res.json({ ok: true });
});

app.post('/api/usuarios/:id/redefinir-senha', soAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(req.params.id));
  if (!u) return erro(res, 404, 'Usuário não encontrado.');
  const senha = senhaProvisoria();
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, versao_sessao = versao_sessao + 1 WHERE id = ?').run(hashSenha(senha), u.id);
  acervo.registrar(nomeUsuario(req), 'senha redefinida', { descricao: `${u.nome} <${u.email}>` });
  res.json({ senha_provisoria: senha });
});

app.get('/api/backup', soAdmin, (req, res) => {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const data = new Date().toISOString().slice(0, 10);
  res.download(tmp, `act-ambar-${data}.db`, () => fs.rmSync(tmp, { force: true }));
});

app.use('/api', (req, res) => erro(res, 404, 'Rota não encontrada.'));

// ---------- estáticos ----------

app.get('/healthz', (req, res) => res.send('ok'));
// Módulos compartilhados com o navegador (leitura das cláusulas e da planilha).
for (const nome of ['clausulas', 'planilha']) {
  app.get(`/lib/${nome}.js`, (req, res) => res.type('js').sendFile(path.join(__dirname, 'lib', `${nome}.js`)));
}
app.use('/vendor/pdfjs', express.static(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return erro(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'PDF maior que 40 MB.' : err.message);
  console.error(err);
  erro(res, 500, 'Erro inesperado no servidor.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Painel de ACTs em http://localhost:${PORT}`));
}

module.exports = { app, hashSenha };
