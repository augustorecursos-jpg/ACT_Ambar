const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/clausulas');
const nums = (t) => C.referencias(t).map(r => (r.aditivo ? 'A' : '') + r.numero);

test('referências da planilha', () => {
  assert.deepStrictEqual(nums('CLÁUSULA TERCEIRA e ADITIVO CLÁUSULA SEGUNDA'), ['3', 'A2']);
  assert.deepStrictEqual(nums('Cláusula Décima Quinta e (Aditivo) Clausula Quarta'), ['15', 'A4']);
  assert.deepStrictEqual(nums('CLÁUSULA DÉCIMA NONA - ADITIVO ACORDO: CLÁUSULA SEXTA'), ['19', 'A6']);
  assert.deepStrictEqual(nums('CLÁUSULA 1ª – DO REAJUSTE SALARIAL'), ['1']);
  assert.deepStrictEqual(nums('CLÁUSULA9 - AUXÍLIO CRECHE E EDUCACIONAL'), ['9']);
  assert.deepStrictEqual(nums('CLÁUSULA DÉCIMA TERC3RA'), ['13']);
  assert.deepStrictEqual(nums('CLÁUSULA DÉCIMA NOVA'), ['19']);
  assert.deepStrictEqual(nums('CLÁUSULA VIGÉSSIMA QUARTA'), ['24']);
  assert.deepStrictEqual(nums('CI,ÁUSULA QUINTA'), ['5']);
  assert.deepStrictEqual(nums('CLÂUSULA SEXTA'), ['6']);
  assert.deepStrictEqual(nums('CLÁUSULA QUADRAGÉSIMA SÉTIMA  - Não consta valor'), ['47']);
  assert.deepStrictEqual(nums('CLÁUSULA DÉCIMA TERCEIRA;  CLÁUSULA DÉCIMA QUINTA e CLÁUSULA DÉCIMA SEXTA'), ['13', '15', '16']);
  assert.deepStrictEqual(nums('CLÁUSULA VIGÉSIMA SEGURO DE VIDA'), ['20']);
  assert.deepStrictEqual(nums('CLÁUSULA 20ª – REMUNERAÇÃO VARIÁVEL'), ['20']);
  assert.deepStrictEqual(nums('Não consta no ACT mas foi pago 2,4 Salários'), []);
});

test('títulos e índice', () => {
  const pag1 = 'ACORDO\nCLÁUSULA PRIMEIRA - VIGÊNCIA E DATA-BASE\ntexto conforme cláusula quarta\nCLÁUSULA SEGUNDA . ABRA.\\GÊNCIA\n';
  const pag2 = 'CLÁUSULA TRIGÉSSIMA PRIMEIRA - X\nCLÁUSULA QUADRÁGÉSSIMA NONA - Y\nCLÁUSULA QUINQUAGÉSIMA PRIMERA – Z';
  const idx = C.indexar([pag1, pag2]);
  assert.deepStrictEqual(idx.map(c => `${c.numero}@${c.pagina}`), ['1@1', '2@1', '31@2', '49@2', '51@2']);
  assert.strictEqual(idx[0].titulo, 'VIGÊNCIA E DATA-BASE');
  const reinicio = C.indexar(['CLÁUSULA PRIMEIRA\nCLÁUSULA QUINTA\nCLÁUSULA SEXTA', 'TERMO ADITIVO\nCLÁUSULA PRIMEIRA\nCLÁUSULA SEGUNDA']);
  assert.deepStrictEqual(reinicio.map(c => `${c.secao}:${c.numero}`), ['0:1', '0:5', '0:6', '1:1', '1:2']);
});

test('normalização preserva posições', () => {
  const t = 'Cláusula Décima — Seção';
  assert.strictEqual(C.normalizar(t).length, t.length);
  assert.deepStrictEqual(C.ocorrencias('Auxílio creche e AUXILIO', 'auxilio'), [[0, 7], [17, 24]]);
  assert.strictEqual(C.porExtenso(47), 'Quadragésima Sétima');
});

test('planilha: vigência por anos ou por datas', () => {
  const P = require('../lib/planilha');
  assert.deepStrictEqual(P.vigenciaPorAnos('2025-2027', 5), { inicio: '2025-05-01', fim: '2027-04-30' });
  assert.deepStrictEqual(P.vigenciaPorAnos('2025-2026', 11), { inicio: '2025-11-01', fim: '2026-10-31' });
  assert.deepStrictEqual(P.vigenciaPorAnos('01/05/2025 a 30/04/2027', 5), { inicio: '2025-05-01', fim: '2027-04-30' });
  assert.strictEqual(P.limparComentario('[Comentário encadeado]\n\nSua versão do Excel...\n\nComentário:\n    CLÁUSULA SEXTA '), 'CLÁUSULA SEXTA');
  assert.strictEqual(P.corrigirAcentos('CLÃ\x81USULA DÃ\x89CIMA'), 'CLÁUSULA DÉCIMA');
  assert.strictEqual(P.nomeUsina('AMBAR STA CRUZ/RJ'), 'Sta Cruz/RJ');
});
