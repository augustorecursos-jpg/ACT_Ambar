// Leitura da planilha de resumo dos ACTs (formato "RESUMO ACTs": itens nas linhas, usinas nas colunas,
// comentários das células com a cláusula de origem). Roda no navegador (área do RH → Importar planilha)
// e no Node (scripts/importar.js). Recebe a biblioteca SheetJS como parâmetro.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Planilha = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  /** Comentários encadeados chegam com acentos quebrados (UTF-8 lido como Latin-1): "CLÃ\x81USULA" → "CLÁUSULA". */
  function corrigirAcentos(t) {
    if (!/[ÃÂ][\x80-\xBF]/.test(t)) return t;
    try {
      const bytes = Uint8Array.from(t, c => c.charCodeAt(0));
      if (bytes.some(b => b > 255)) return t;
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { return t; }
  }

  /** Tira o aviso padrão do Excel ("[Comentário encadeado] Sua versão do Excel...") e deixa só o texto. */
  function limparComentario(t) {
    let s = corrigirAcentos(String(t ?? '')).replace(/\r/g, '');
    const i = s.search(/Coment[áa]rio:\s*\n?/);
    if (/\[Coment[áa]rio encadeado\]/.test(s) && i !== -1) s = s.slice(i).replace(/^Coment[áa]rio:\s*/, '');
    return s.split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim();
  }

  const fmtNum = (v, casas) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

  function tipoNumero(cell) {
    const z = String(cell.z || '');
    if (z.includes('%')) return 'pct';
    if (/R\$|0\.00/.test(z)) return 'moeda';
    return 'num';
  }

  function formatarNumero(cell, tipo) {
    const v = cell.v;
    if (tipo === 'pct') {
      const casas = (String(cell.z).match(/0\.(0+)%/) || [, ''])[1].length;
      return `${fmtNum(v * 100, casas)}%`;
    }
    if (tipo === 'moeda') return `R$ ${fmtNum(v, 2)}`;
    return Number.isInteger(v) ? String(v) : fmtNum(v, String(v).split('.')[1].length > 2 ? 2 : String(v).split('.')[1].length);
  }

  /** "AMBAR STA CRUZ/RJ" → "Sta Cruz/RJ"; "CUIABÁ" → "Cuiabá". */
  function nomeUsina(bruto) {
    const sem = String(bruto).replace(/^\s*[AÂ]MBAR\s+/i, '').trim();
    const manter = new Set(['RJ', 'UEGA', 'SP', 'MG', 'RS', 'SC', 'PR', 'MT', 'MS', 'AM', 'GO', 'UTE', 'PCH']);
    return sem.toLowerCase().replace(/[\p{L}]+/gu, (p) => manter.has(p.toUpperCase()) ? p.toUpperCase()
      : (['de', 'da', 'do', 'das', 'dos', 'e'].includes(p) ? p : p[0].toUpperCase() + p.slice(1)));
  }

  const CATEGORIAS = [
    ['Remuneração', /PISO|REAJUSTE|PLR|PPR|PARTICIPACAO NOS|HORA EXTRA|ADICIONAL|GRATIFICA|ABONO(?! APOSENT)/],
    ['Estabilidades', /ESTABILIDADE|GARANTIA DE EMPREGO/],
    ['Jornada', /JORNADA|TURNO|BANCO|ESCALA|LICENCA|FOLGA|FERIAS/],
    ['Saúde, seguro e previdência', /SAUDE|SEGURO|PREVIDENCIA|ACIDENTE|DOENCA|APOSENTADORIA|MEDICAMENT|OCULOS|ODONTO/],
    ['Auxílios', /AUXILIO|VA - VR|ALIMENTA|REFEICAO|CRECHE|FUNERAL|TRANSPORTE|COMBUSTIVEL|EDUCACAO|MATRIMONIO|NASCITURO|PCD|REEMBOLSO/],
  ];
  function categoria(item) {
    const n = norm(item);
    for (const [nome, re] of CATEGORIAS) if (re.test(n)) return nome;
    return 'Outros';
  }

  /** Converte "2025-2027" + mês da data-base em datas de início e fim da vigência. */
  function vigenciaPorAnos(texto, mes) {
    const datas = String(texto ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2})\/(\d{2})\/(\d{4})/);
    if (datas) return { inicio: `${datas[3]}-${datas[2]}-${datas[1]}`, fim: `${datas[6]}-${datas[5]}-${datas[4]}` };
    const anos = String(texto ?? '').match(/(20\d{2})\D+(20\d{2})/);
    if (!anos || !mes) return { inicio: null, fim: null };
    const inicio = `${anos[1]}-${String(mes).padStart(2, '0')}-01`;
    const fimData = new Date(Date.UTC(Number(anos[2]), mes - 1, 0)); // último dia do mês anterior à data-base
    return { inicio, fim: fimData.toISOString().slice(0, 10) };
  }

  /**
   * Lê o arquivo e devolve { usinas, itens, valores, avisos }.
   * usinas: [{ nome, nome_planilha, sindicato, data_base_mes, vigencia_texto, vigencia_inicio, vigencia_fim }]
   * itens: [{ nome, categoria, destaque }] · valores: [{ usina, item, valor, nota }] (usina/item = nome)
   */
  function ler(XLSX, dados) {
    const wb = XLSX.read(dados, { cellNF: true, type: dados instanceof ArrayBuffer || ArrayBuffer.isView(dados) ? 'array' : 'buffer' });
    const ws = wb.Sheets[wb.SheetNames.find(n => /ACT|RESUMO/i.test(n)) || wb.SheetNames[0]];
    if (!ws || !ws['!ref']) throw new Error('A planilha está vazia.');
    const faixa = XLSX.utils.decode_range(ws['!ref']);
    const cel = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
    const avisos = [];

    // Cabeçalho: primeira linha com nomes nas colunas B em diante.
    let linhaCab = faixa.s.r;
    while (linhaCab <= faixa.e.r && !cel(linhaCab, faixa.s.c + 1)) linhaCab++;
    const colunas = [];
    for (let c = faixa.s.c + 1; c <= faixa.e.c; c++) {
      const v = cel(linhaCab, c)?.v;
      if (v != null && String(v).trim()) colunas.push({ c, nome_planilha: String(v).trim(), nome: nomeUsina(v) });
    }
    if (!colunas.length) throw new Error('Não encontrei as usinas no cabeçalho (primeira linha, a partir da coluna B).');

    const usinas = colunas.map(u => ({ nome: u.nome, nome_planilha: u.nome_planilha, sindicato: '', data_base_mes: null, vigencia_texto: '' }));
    const itens = [];
    const valores = [];

    for (let r = linhaCab + 1; r <= faixa.e.r; r++) {
      const rotulo = cel(r, faixa.s.c)?.v;
      if (rotulo == null || !String(rotulo).trim()) continue;
      const nomeItem = String(rotulo).replace(/\s+/g, ' ').trim();
      const n = norm(nomeItem);
      const celulas = colunas.map(u => cel(r, u.c));
      const texto = (cell) => cell == null || cell.v == null ? '' : String(cell.v).trim();

      if (/^SINDICATO/.test(n)) { celulas.forEach((cell, i) => { usinas[i].sindicato = texto(cell); }); continue; }
      if (/DATA.?BASE/.test(n)) {
        celulas.forEach((cell, i) => {
          const m = MESES.indexOf(norm(texto(cell)));
          usinas[i].data_base_mes = m === -1 ? null : m + 1;
          if (m === -1 && texto(cell)) avisos.push(`Mês da data-base não reconhecido em ${usinas[i].nome}: "${texto(cell)}".`);
        });
        continue;
      }
      if (/^VALIDADE|^VIGENCIA/.test(n)) { celulas.forEach((cell, i) => { usinas[i].vigencia_texto = texto(cell); }); continue; }

      // Tipo predominante dos números da linha (para formatar como R$ os valores sem formato definido).
      const tipos = celulas.filter(c => c?.t === 'n').map(tipoNumero);
      const maioriaMoeda = tipos.filter(t => t === 'moeda').length > tipos.length / 2;
      const nomeLimpo = nomeItem.replace(/[òó]culos/i, 'Óculos').replace(/Salárial/i, 'Salarial');
      itens.push({
        nome: nomeLimpo,
        categoria: categoria(nomeItem),
        destaque: /REAJUSTE|^PLR|VA - VR|^PISO/.test(n) ? 1 : 0,
      });
      celulas.forEach((cell, i) => {
        let valor = '';
        if (cell?.t === 'n') {
          let tipo = tipoNumero(cell);
          // "#,##0.00" sem R$ só é dinheiro se a linha for de valores em dinheiro (evita "R$ 44,00" na jornada).
          if (tipo === 'moeda' && !/R\$/.test(String(cell.z)) && !maioriaMoeda) tipo = 'num';
          if (tipo === 'num' && maioriaMoeda && !Number.isInteger(cell.v)) tipo = 'moeda';
          if (tipo === 'num' && /#,##0\.00/.test(String(cell.z)) && cell.v >= 100) tipo = 'moeda'; // ex.: PLR em valor
          valor = formatarNumero(cell, tipo);
        } else valor = texto(cell).replace(/\s{2,}/g, ' ');
        const nota = (cell?.c || []).map(c => limparComentario(c.t)).filter(Boolean).join('\n\n');
        if (valor || nota) valores.push({ usina: usinas[i].nome, item: nomeLimpo, valor, nota });
      });
    }

    for (const u of usinas) Object.assign(u, (({ inicio, fim }) => ({ vigencia_inicio: inicio, vigencia_fim: fim }))(vigenciaPorAnos(u.vigencia_texto, u.data_base_mes)));
    return { usinas, itens, valores, avisos };
  }

  return { ler, limparComentario, corrigirAcentos, nomeUsina, categoria, vigenciaPorAnos, MESES };
}));
