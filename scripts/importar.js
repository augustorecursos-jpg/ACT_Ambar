// Carga inicial pela linha de comando (alternativa à tela "Importar" da área do RH).
//   node scripts/importar.js --planilha Resumo.xlsx --pdf "Cuiabá=ACT Cuiabá.pdf" --pdf "Amazonas=ACT AM.pdf"
// Os dados ficam em DATA_DIR (padrão ./data), fora do repositório.
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('../public/vendor/xlsx.full.min.js');
const Planilha = require('../lib/planilha');
const acervo = require('../lib/acervo');
const { db } = require('../db');

async function main() {
  const args = process.argv.slice(2);
  const valoresDe = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
  const [planilha] = valoresDe('--planilha');
  if (planilha) {
    const lido = Planilha.ler(XLSX, fs.readFileSync(planilha));
    lido.avisos.forEach(a => console.warn('[aviso]', a));
    console.log('Planilha:', acervo.importarResumo(lido, 'importação inicial'));
  }
  for (const par of valoresDe('--pdf')) {
    const i = par.indexOf('=');
    const nomeUsina = par.slice(0, i), arquivo = par.slice(i + 1);
    const usina = db.prepare('SELECT * FROM usinas').all().find(u => acervo.chave(u.nome) === acervo.chave(nomeUsina));
    if (!usina) { console.error(`[erro] Usina "${nomeUsina}" não encontrada.`); process.exitCode = 1; continue; }
    const tipo = /aditivo/i.test(path.basename(arquivo)) ? 'Aditivo' : 'ACT';
    const vig = path.basename(arquivo).match(/(20\d{2})\s*[-–]\s*(20\d{2})/);
    const id = await acervo.salvarDocumento(fs.readFileSync(arquivo), {
      usina_id: usina.id, tipo, titulo: `${tipo === 'ACT' ? 'Acordo Coletivo' : 'Termo Aditivo'} ${vig ? `${vig[1]}-${vig[2]}` : ''}`.trim(),
      vigencia: vig ? `${vig[1]}-${vig[2]}` : '', nome_original: path.basename(arquivo),
    }, 'importação inicial');
    const n = db.prepare('SELECT COUNT(*) AS n FROM doc_clausulas WHERE documento_id = ?').get(id).n;
    console.log(`PDF ${usina.nome}: documento ${id}, ${n} cláusulas indexadas`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
