// Extração do texto dos PDFs (pdf.js no Node), página a página, para a busca e o índice de cláusulas.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let _pdfjs;
async function pdfjs() {
  if (!_pdfjs) {
    const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
    _pdfjs = await import(pathToFileURL(path.join(base, 'legacy/build/pdf.mjs')).href);
  }
  return _pdfjs;
}

/** Junta os trechos de texto da página respeitando as quebras de linha (hasEOL) do PDF. */
function textoDaPagina(itens) {
  let out = '';
  for (const it of itens) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

/** Retorna o texto de cada página: ['texto pág. 1', 'texto pág. 2', ...]. */
async function extrairPaginas(buffer) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0,
  }).promise;
  try {
    const paginas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      paginas.push(textoDaPagina((await pagina.getTextContent()).items));
      pagina.cleanup();
    }
    return paginas;
  } finally {
    await doc.destroy();
  }
}

module.exports = { extrairPaginas, textoDaPagina };
