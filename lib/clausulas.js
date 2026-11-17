// Leitura de referências a cláusulas ("CLÁUSULA DÉCIMA NONA", "Cláusula 1ª", "ADITIVO CLÁUSULA SEGUNDA")
// e localização dos títulos das cláusulas no texto dos PDFs.
// Usado no servidor (índice das cláusulas de cada PDF) e no navegador (realce no visualizador),
// por isso não depende de nada do Node.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Clausulas = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Maiúsculas sem acento, preservando o tamanho do texto (1 caractere vira 1 caractere),
   * para que as posições encontradas no texto normalizado valham no texto original.
   */
  function normalizar(texto) {
    let out = '';
    for (const c of String(texto ?? '')) {
      const base = c.normalize('NFD')[0].toUpperCase();
      out += base.length === 1 ? base : c;
    }
    return out;
  }

  // Ordem importa: prefixos mais longos/específicos primeiro (QUINQUAGÉSIMA antes de QUINTA, NONAGÉSIMA antes de NONA).
  const DEZENAS = [
    ['NONAG', 90], ['OCTOG', 80], ['OCTAG', 80], ['SEPTUAG', 70], ['SETUAG', 70], ['SEXAG', 60],
    ['QUINQUAG', 50], ['QUADRAG', 40], ['TRIGES', 30], ['TRIJES', 30], ['VIGES', 20], ['VIJES', 20], ['DECIM', 10],
  ];
  // Unidades: palavra inteira (com variações de digitação), para "VIGÉSIMA SEGURO DE VIDA" não virar 22.
  const UNIDADES = {
    PRIMEIRA: 1, PRIMERA: 1, PRIMEIRO: 1, UNICA: 1, SEGUNDA: 2, SEGUNDO: 2, TERCEIRA: 3, TERCEIRO: 3, TERCRA: 3,
    QUARTA: 4, QUARTO: 4, QUINTA: 5, QUINTO: 5, SEXTA: 6, SEXTO: 6, SETIMA: 7, SEPTIMA: 7, SETIMO: 7,
    OITAVA: 8, OITAVO: 8, NONA: 9, NONO: 9, NOVA: 9,
  };

  /** "TRIGÉSSIMA" → "TRIGESIMA", "TERC3RA" → "TERCRA" (erros comuns de digitação e de OCR). */
  function limparPalavra(p) {
    return normalizar(p).replace(/[^A-Z]/g, '').replace(/SS/g, 'S');
  }

  function valorDezena(p) {
    const w = limparPalavra(p);
    if (w.length < 6 || w.length > 14) return 0;
    for (const [prefixo, valor] of DEZENAS) if (w.startsWith(prefixo)) return valor;
    return 0;
  }
  const valorUnidade = (p) => UNIDADES[limparPalavra(p)] || 0;

  // "CLÁUSULA", também com OCR ruim: "CI,ÁUSULA", "CLÂUSULA", "CLAUSULA9".
  const RE_CLAUSULA = /C[LI1][^A-Z0-9\n]?AUSULA/g;

  /**
   * Lê o número da cláusula logo após a palavra "CLÁUSULA" (texto já normalizado), a partir de `pos`.
   * Aceita ordinais por extenso (até 99) e números ("1ª", "20ª", "9").
   * Retorna { numero, fim } ou null.
   */
  function lerNumero(norm, pos) {
    const resto = norm.slice(pos, pos + 60);
    const dig = resto.match(/^\s*(\d{1,3})\s*[ªºAO°]?(?![A-Z0-9])/);
    if (dig) return { numero: Number(dig[1]), fim: pos + dig[0].length };
    const re = /\s*([A-Z0-9]+)/y;
    let i = 0, numero = 0, fim = pos, temDezena = false;
    for (let n = 0; n < 2; n++) {
      re.lastIndex = i;
      const m = re.exec(resto);
      if (!m) break;
      const dez = !temDezena && numero === 0 ? valorDezena(m[1]) : 0;
      if (dez) { numero += dez; temDezena = true; i = re.lastIndex; fim = pos + i; continue; }
      const uni = valorUnidade(m[1]);
      if (uni) { numero += uni; i = re.lastIndex; fim = pos + i; }
      break;
    }
    return numero ? { numero, fim } : null;
  }

  /**
   * Referências a cláusulas dentro de uma anotação da planilha.
   * "CLÁUSULA TERCEIRA e ADITIVO CLÁUSULA SEGUNDA" → [{numero:3, aditivo:false}, {numero:2, aditivo:true}]
   */
  function referencias(nota) {
    const norm = normalizar(nota);
    const refs = [];
    let anterior = 0;
    RE_CLAUSULA.lastIndex = 0;
    let m;
    while ((m = RE_CLAUSULA.exec(norm))) {
      const lido = lerNumero(norm, m.index + m[0].length);
      if (!lido) continue;
      const aditivo = /ADITIVO/.test(norm.slice(anterior, m.index));
      if (!refs.some(r => r.numero === lido.numero && r.aditivo === aditivo)) {
        refs.push({ numero: lido.numero, aditivo, texto: String(nota).slice(m.index, lido.fim).trim() });
      }
      anterior = lido.fim;
      RE_CLAUSULA.lastIndex = lido.fim;
    }
    return refs;
  }

  /**
   * Títulos de cláusulas em um texto (uma página): só ocorrências no início da linha,
   * para não confundir com menções ("conforme a cláusula quarta").
   * Retorna [{ numero, titulo, inicio, fim }] com posições no texto original.
   */
  function titulos(texto) {
    const norm = normalizar(texto);
    const achados = [];
    RE_CLAUSULA.lastIndex = 0;
    let m;
    while ((m = RE_CLAUSULA.exec(norm))) {
      const antes = norm.slice(Math.max(0, m.index - 12), m.index);
      if (!/(^|\n)[\s\-–—•*"]*$/.test(antes) && m.index > 12) continue;
      const lido = lerNumero(norm, m.index + m[0].length);
      if (!lido) continue;
      const fimLinha = norm.indexOf('\n', lido.fim);
      const linha = texto.slice(lido.fim, fimLinha === -1 ? undefined : fimLinha);
      const titulo = linha.replace(/^[\s\-–—.:;,]+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
      achados.push({ numero: lido.numero, titulo, inicio: m.index, fim: fimLinha === -1 ? texto.length : fimLinha });
      RE_CLAUSULA.lastIndex = lido.fim;
    }
    return achados;
  }

  /**
   * Índice de cláusulas de um documento a partir do texto de cada página.
   * Quando a numeração recomeça (ex.: termo aditivo anexado ao final do PDF), as cláusulas seguintes
   * ficam numa nova "seção" (secao > 0), usada para as referências marcadas como ADITIVO.
   */
  function indexar(paginas) {
    const indice = [];
    const vistos = new Set();
    let secao = 0, ultimo = 0;
    paginas.forEach((texto, i) => {
      for (const t of titulos(texto)) {
        if (ultimo >= 5 && t.numero <= 2 && t.numero < ultimo) secao++;
        const chave = `${secao}:${t.numero}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        indice.push({ numero: t.numero, secao, titulo: t.titulo, pagina: i + 1 });
        ultimo = t.numero;
      }
    });
    return indice;
  }

  const NOMES = ['', 'Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava', 'Nona'];
  const NOMES_DEZ = ['', 'Décima', 'Vigésima', 'Trigésima', 'Quadragésima', 'Quinquagésima', 'Sexagésima', 'Septuagésima', 'Octogésima', 'Nonagésima'];
  /** 19 → "Décima Nona" */
  function porExtenso(n) {
    const d = Math.floor(n / 10), u = n % 10;
    return [NOMES_DEZ[d], NOMES[u]].filter(Boolean).join(' ') || String(n);
  }

  /** Posições [inicio, fim] de todas as ocorrências de um termo (sem diferenciar acento/maiúscula). */
  function ocorrencias(texto, termo) {
    const alvo = normalizar(termo).trim();
    if (alvo.length < 2) return [];
    const norm = normalizar(texto);
    const out = [];
    let i = norm.indexOf(alvo);
    while (i !== -1 && out.length < 500) {
      out.push([i, i + alvo.length]);
      i = norm.indexOf(alvo, i + alvo.length);
    }
    return out;
  }

  return { normalizar, referencias, titulos, indexar, porExtenso, ocorrencias };
}));
