// Painel de Acordos Coletivos · Âmbar Energia
// Navegação por hash: #/panorama · #/comparativo · #/usina/<id>?doc=&pag=&cl=&q= · #/busca?q= · #/admin/<aba>
/* global Clausulas, Visualizador, Admin, XLSX */

const E = { dados: null, usuario: null, usinas: [], itens: [], docs: [], valores: new Map(), viz: null, rotaAtual: null };
const vista = document.getElementById('vista');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ORDEM_CATEGORIAS = ['Remuneração', 'Auxílios', 'Saúde, seguro e previdência', 'Jornada', 'Estabilidades', 'Outros'];

// ---------- preferências locais (só conveniência; tudo funciona sem elas) ----------
const pref = {
  ler(chave, padrao) { try { const v = localStorage.getItem(`act.${chave}`); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(chave, valor) { try { localStorage.setItem(`act.${chave}`, JSON.stringify(valor)); } catch { /* sem armazenamento */ } },
};

// ---------- dados ----------

async function carregarDados() {
  const d = await api('/api/painel');
  E.dados = d;
  E.usuario = d.usuario;
  E.hoje = d.hoje;
  E.usinas = d.usinas;
  E.itens = d.itens;
  E.docs = d.documentos;
  E.valores = new Map(d.valores.map(v => [`${v.usina_id}:${v.item_id}`, v]));
}
const usina = (id) => E.usinas.find(u => u.id === Number(id));
const item = (id) => E.itens.find(i => i.id === Number(id));
const valorDe = (u, i) => E.valores.get(`${u}:${i}`) || { valor: '', nota: '' };
const docsDe = (u) => E.docs.filter(d => d.usina_id === Number(u));
const podeEditar = () => ['admin', 'editor'].includes(E.usuario?.papel);
const ehAdmin = () => E.usuario?.papel === 'admin';

function categorias(itens = E.itens) {
  const nomes = [...new Set(itens.map(i => i.categoria))];
  nomes.sort((a, b) => (ORDEM_CATEGORIAS.indexOf(a) + 1 || 99) - (ORDEM_CATEGORIAS.indexOf(b) + 1 || 99));
  return nomes.map(nome => ({ nome, itens: itens.filter(i => i.categoria === nome) }));
}

const vazio = (v) => ['', '-', '–', 'N/S', 'NS', 'N/A'].includes(String(v ?? '').trim().toUpperCase());

/** "R$ 1.790,27" → {n: 1790.27, un: 'R$'}; "4,39%" → {n: 4.39, un: '%'} */
function numero(valor) {
  const t = String(valor ?? '').trim();
  let m = t.match(/^R\$\s?([\d.]+(?:,\d+)?)$/);
  if (m) return { n: Number(m[1].replace(/\./g, '').replace(',', '.')), un: 'R$' };
  m = t.match(/^([\d.]*\d(?:,\d+)?)\s?%$/);
  if (m) return { n: Number(m[1].replace(/\./g, '').replace(',', '.')), un: '%' };
  return null;
}

// ---------- datas e vigência ----------

const dataLocal = (iso) => (iso ? new Date(`${iso}T12:00:00`) : null);
const fmtData = (iso) => (iso ? dataLocal(iso).toLocaleDateString('pt-BR') : '—');
const fmtMesAno = (d) => `${MESES_CURTOS[d.getMonth()]}/${d.getFullYear()}`;
const dias = (a, b) => Math.round((b - a) / 864e5);

function situacao(u) {
  const hoje = dataLocal(E.hoje);
  if (!u.vigencia_fim) return { cls: 'sem', rotulo: 'Vigência não informada', curto: 'Sem vigência' };
  const fim = dataLocal(u.vigencia_fim);
  const d = dias(hoje, fim);
  if (d < 0) return { cls: 'vencido', rotulo: `Vencido há ${-d} dia${d === -1 ? '' : 's'}`, curto: 'Vencido', dias: d };
  if (d <= 180) return { cls: 'atencao', rotulo: `Vence em ${d} dia${d === 1 ? '' : 's'}`, curto: 'Vence em breve', dias: d };
  return { cls: 'vigente', rotulo: `Vigente até ${fmtData(u.vigencia_fim)}`, curto: 'Vigente', dias: d };
}

function proximaDataBase(u) {
  if (!u.data_base_mes) return null;
  const hoje = dataLocal(E.hoje);
  let d = new Date(hoje.getFullYear(), u.data_base_mes - 1, 1, 12);
  if (d < hoje) d = new Date(hoje.getFullYear() + 1, u.data_base_mes - 1, 1, 12);
  return { data: d, dias: dias(hoje, d) };
}

// ---------- referências às cláusulas ----------

/** Liga as cláusulas citadas na anotação da planilha ao PDF da usina (documento e página). */
function resolverRefs(usinaId, nota) {
  const docs = docsDe(usinaId);
  return Clausulas.referencias(nota).map((r) => {
    const base = { ...r, rotulo: `${r.aditivo ? 'Aditivo · ' : ''}Cl. ${r.numero}ª`, extenso: `Cláusula ${Clausulas.porExtenso(r.numero)}` };
    const achar = (lista, filtro) => {
      for (const d of lista) {
        const c = d.clausulas.find(c => c.numero === r.numero && filtro(c));
        if (c) return { ...base, doc: d, pagina: c.pagina, titulo: c.titulo };
      }
      return null;
    };
    if (r.aditivo) {
      return achar(docs.filter(d => d.tipo === 'Aditivo'), () => true)
        || achar(docs, c => c.secao > 0)
        || { ...base, pendente: 'Termo aditivo ainda não enviado' };
    }
    const acts = docs.filter(d => d.tipo === 'ACT');
    const lista = acts.length ? acts : docs;
    return achar(lista, c => c.secao === 0)
      || (lista.length ? { ...base, doc: lista[0], pagina: null, pendente: 'Cláusula não localizada automaticamente no PDF' }
        : { ...base, pendente: 'PDF do acordo ainda não enviado' });
  });
}

function chipRef(ref, usinaId, { completo = false } = {}) {
  const texto = completo ? `${ref.aditivo ? 'Aditivo · ' : ''}${ref.extenso}${ref.titulo ? ` — ${ref.titulo}` : ''}` : ref.rotulo;
  if (!ref.doc) return `<span class="chip-ref pendente" title="${esc(ref.pendente)}">${esc(texto)}<small>${completo ? ` · ${esc(ref.pendente)}` : ''}</small></span>`;
  const href = `#/usina/${usinaId}?doc=${ref.doc.id}${ref.pagina ? `&pag=${ref.pagina}&cl=${ref.numero}` : ''}`;
  const dica = ref.pagina ? `${ref.extenso}${ref.titulo ? ` — ${ref.titulo}` : ''} · ${ref.doc.titulo}, pág. ${ref.pagina}` : ref.pendente;
  return `<a class="chip-ref${ref.pagina ? '' : ' incerto'}" href="${href}" title="${esc(dica)}">${esc(texto)}${ref.pagina ? `<small>pág. ${ref.pagina}</small>` : ''}</a>`;
}

// ---------- cabeçalho: abas, usuário, busca rápida ----------

function marcarAba(aba) {
  document.querySelectorAll('.abas a').forEach(a => a.classList.toggle('ativa', a.dataset.aba === aba));
}

function montarUsuario() {
  const u = E.usuario;
  document.getElementById('avatar').textContent = u.nome.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('usuario-nome').textContent = u.nome;
  document.getElementById('usuario-email').textContent = u.email;
  document.getElementById('usuario-papel').textContent = { admin: 'Administrador', editor: 'Editor', leitor: 'Leitura' }[u.papel];
  document.getElementById('aba-admin').hidden = !ehAdmin() && !podeEditar();
  document.getElementById('aba-admin').textContent = ehAdmin() ? 'Administração' : 'Estrutura';
}

const botaoUsuario = document.getElementById('usuario-botao');
const menuUsuario = document.getElementById('usuario-menu');
botaoUsuario.addEventListener('click', () => {
  menuUsuario.hidden = !menuUsuario.hidden;
  botaoUsuario.setAttribute('aria-expanded', String(!menuUsuario.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.usuario')) { menuUsuario.hidden = true; botaoUsuario.setAttribute('aria-expanded', 'false'); }
  if (!e.target.closest('.busca-global')) listaBusca.hidden = true;
});
document.getElementById('menu-sair').addEventListener('click', async () => {
  await api('/api/sair', { method: 'POST' }).catch(() => {});
  location.replace('./');
});
document.getElementById('menu-senha').addEventListener('click', () => { menuUsuario.hidden = true; abrirTrocaSenha(false); });

// Troca de senha (obrigatória no primeiro acesso)
const modalSenha = document.getElementById('modal-senha');
function abrirTrocaSenha(obrigatoria) {
  const form = document.getElementById('form-senha');
  form.reset();
  document.getElementById('senha-msg').textContent = '';
  modalSenha.querySelector('h2').textContent = obrigatoria ? 'Crie sua senha' : 'Trocar minha senha';
  document.getElementById('senha-sub').textContent = obrigatoria
    ? 'Este é seu primeiro acesso. Troque a senha provisória por uma senha pessoal com pelo menos 8 caracteres.'
    : 'A nova senha precisa ter pelo menos 8 caracteres.';
  document.getElementById('senha-atual-dica').hidden = !obrigatoria;
  document.getElementById('senha-cancelar').hidden = obrigatoria;
  modalSenha.dataset.obrigatoria = obrigatoria ? '1' : '';
  modalSenha.showModal();
}
modalSenha.addEventListener('cancel', (e) => { if (modalSenha.dataset.obrigatoria) e.preventDefault(); });
document.getElementById('senha-cancelar').addEventListener('click', () => modalSenha.close());
document.getElementById('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = document.getElementById('senha-msg');
  if (f.nova !== f.nova2) { msg.textContent = 'As duas senhas novas não são iguais.'; return; }
  try {
    E.usuario = await api('/api/eu/senha', { method: 'POST', body: { atual: f.atual, nova: f.nova } });
    const eraObrigatoria = modalSenha.dataset.obrigatoria;
    modalSenha.dataset.obrigatoria = '';
    modalSenha.close();
    toast('Senha atualizada ✓');
    if (eraObrigatoria) iniciar();
  } catch (err) { msg.textContent = err.message; }
});

// Busca rápida (Ctrl+K): usinas, itens e atalho para a busca no texto dos acordos
const campoBusca = document.getElementById('busca-global-campo');
const listaBusca = document.getElementById('busca-global-lista');
let opcoesBusca = [], selBusca = 0;
function sugerir() {
  const q = Clausulas.normalizar(campoBusca.value.trim());
  if (!q) { listaBusca.hidden = true; return; }
  const bate = (t) => Clausulas.normalizar(t).includes(q);
  opcoesBusca = [
    ...E.usinas.filter(u => bate(u.nome) || bate(u.sindicato || '')).slice(0, 5)
      .map(u => ({ tipo: 'Usina', titulo: u.nome, sub: u.sindicato || '', href: `#/usina/${u.id}` })),
    ...E.itens.filter(i => bate(i.nome)).slice(0, 6)
      .map(i => ({ tipo: 'Item', titulo: i.nome, sub: i.categoria, href: `#/comparativo?item=${i.id}` })),
  ];
  if (q.length >= 3) opcoesBusca.push({ tipo: 'Texto', titulo: `Buscar “${campoBusca.value.trim()}” nos acordos`, sub: 'Procura em todos os PDFs', href: `#/busca?q=${encodeURIComponent(campoBusca.value.trim())}` });
  selBusca = 0;
  listaBusca.innerHTML = opcoesBusca.length ? opcoesBusca.map((o, i) => `
    <a href="${o.href}" role="option" class="${i === 0 ? 'sel' : ''}" aria-selected="${i === 0}">
      <span class="tag tag-${o.tipo.toLowerCase()}">${o.tipo}</span><span><strong>${esc(o.titulo)}</strong><small>${esc(o.sub)}</small></span></a>`).join('')
    : '<p class="vazio-lista">Nada encontrado. Digite 3 letras para buscar no texto dos acordos.</p>';
  listaBusca.hidden = false;
}
campoBusca.addEventListener('input', sugerir);
campoBusca.addEventListener('focus', () => campoBusca.value && sugerir());
campoBusca.addEventListener('keydown', (e) => {
  const links = [...listaBusca.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selBusca = (selBusca + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % Math.max(links.length, 1);
    links.forEach((a, i) => { a.classList.toggle('sel', i === selBusca); a.setAttribute('aria-selected', String(i === selBusca)); });
  } else if (e.key === 'Enter' && links[selBusca]) {
    e.preventDefault();
    location.hash = links[selBusca].getAttribute('href');
    fecharBusca();
  } else if (e.key === 'Escape') fecharBusca();
});
listaBusca.addEventListener('click', (e) => { if (e.target.closest('a')) fecharBusca(); });
function fecharBusca() { listaBusca.hidden = true; campoBusca.value = ''; campoBusca.blur(); }
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); campoBusca.focus(); campoBusca.select(); }
  if (e.key === 'Escape' && gaveta.classList.contains('aberta')) fecharGaveta();
});

// ---------- roteamento ----------

function rotaAtual() {
  const [caminho, busca = ''] = location.hash.replace(/^#/, '').split('?');
  const partes = caminho.split('/').filter(Boolean);
  return { tela: partes[0] || 'panorama', id: partes[1], q: Object.fromEntries(new URLSearchParams(busca)) };
}

async function rotear() {
  const r = rotaAtual();
  const anterior = E.rotaAtual;
  E.rotaAtual = r;
  marcarAba(r.tela);
  if (r.tela !== 'usina' && E.viz) { E.viz.destruir(); E.viz = null; }
  fecharGaveta();
  const modal = document.getElementById('modal');
  if (modal.open) modal.close();
  // Na mesma usina, só troca o documento/página (sem redesenhar a tela).
  if (r.tela === 'usina' && anterior?.tela === 'usina' && anterior.id === r.id && E.viz && r.id) {
    return irParaDocumento(r.q);
  }
  window.scrollTo(0, 0);
  try {
    if (r.tela === 'panorama') telaPanorama();
    else if (r.tela === 'comparativo') telaComparativo(r.q);
    else if (r.tela === 'usina') telaUsina(r.id, r.q);
    else if (r.tela === 'busca') telaBusca(r.q);
    else if (r.tela === 'admin') Admin.tela(r.id, r.q);
    else location.hash = '#/panorama';
  } catch (err) {
    console.error(err);
    vista.innerHTML = `<div class="pagina"><p class="erro-tela">Algo deu errado ao abrir esta tela: ${esc(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', rotear);

/** Recarrega os dados do servidor e redesenha a tela atual. */
async function atualizar() {
  await carregarDados();
  E.rotaAtual = null;
  if (E.viz) { E.viz.destruir(); E.viz = null; }
  await rotear();
}

function cabecalho(sobre, titulo, sub = '', acoes = '') {
  return `<div class="cab-tela"><div><span class="sobre">${sobre}</span><h1>${titulo}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${acoes ? `<div class="cab-acoes">${acoes}</div>` : ''}</div>`;
}

// ---------- Panorama ----------

function telaPanorama() {
  const sit = E.usinas.map(u => ({ u, s: situacao(u) }));
  const comPdf = new Set(E.docs.map(d => d.usina_id));
  const vencendo = sit.filter(x => x.s.cls === 'atencao').length;
  const vencidos = sit.filter(x => x.s.cls === 'vencido').length;
  const proximas = E.usinas.map(u => ({ u, p: proximaDataBase(u) })).filter(x => x.p && x.p.dias <= 90);

  vista.innerHTML = `<div class="pagina">
    ${cabecalho('PANORAMA', 'Acordos coletivos por usina',
      `${E.usinas.length} usinas · ${E.itens.length} itens no resumo · atualizado em ${new Date(`${E.hoje}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`)}
    ${E.usinas.length ? '' : vazioInicial()}
    <section class="kpis">
      ${kpi(E.usinas.length, 'usinas com resumo')}
      ${kpi(`${comPdf.size}<small>/${E.usinas.length}</small>`, 'com o PDF do acordo', comPdf.size < E.usinas.length ? 'atencao' : '')}
      ${kpi(vencendo, 'vencem em até 6 meses', vencendo ? 'atencao' : '')}
      ${kpi(vencidos, vencidos === 1 ? 'acordo vencido' : 'acordos vencidos', vencidos ? 'vencido' : '')}
      ${kpi(proximas.length, 'datas-base nos próximos 90 dias', proximas.length ? 'atencao' : '')}
    </section>
    ${E.usinas.length ? linhaDoTempo() : ''}
    <section class="cartoes-usina">${sit.map(({ u, s }) => cartaoUsina(u, s)).join('')}</section>
  </div>`;
}

function vazioInicial() {
  return `<div class="vazio-inicial"><h2>Comece importando a planilha de resumo</h2>
    <p>A planilha “Resumo ACT” (itens nas linhas, usinas nas colunas e a cláusula de origem nos comentários das células) cria as usinas e o comparativo de uma vez.</p>
    ${podeEditar() ? '<a class="btn btn-laranja" href="#/admin/importar">Importar planilha</a>' : '<p>Peça a um editor para importar a planilha.</p>'}</div>`;
}

const kpi = (valor, rotulo, cls = '') => `<div class="kpi ${cls}"><strong>${valor}</strong><span>${rotulo}</span></div>`;

function linhaDoTempo() {
  const hoje = dataLocal(E.hoje);
  const anos = E.usinas.flatMap(u => [u.vigencia_inicio, u.vigencia_fim]).filter(Boolean).map(d => Number(d.slice(0, 4)));
  const a0 = Math.min(hoje.getFullYear(), ...anos), a1 = Math.max(hoje.getFullYear() + 1, ...anos);
  const meses = (a1 - a0 + 1) * 12;
  const pos = (d) => (((d.getFullYear() - a0) * 12 + d.getMonth() + (d.getDate() - 1) / 31) / meses) * 100;
  const anosHtml = Array.from({ length: a1 - a0 + 1 }, (_, i) => `<span style="left:${(i * 12 / meses) * 100}%;width:${(12 / meses) * 100}%">${a0 + i}</span>`).join('');
  const linhas = E.usinas.map((u) => {
    const s = situacao(u);
    const ini = dataLocal(u.vigencia_inicio), fim = dataLocal(u.vigencia_fim);
    const barra = ini && fim ? `<a class="tl-barra ${s.cls}" href="#/usina/${u.id}" style="left:${pos(ini)}%;width:${Math.max(0.8, pos(fim) - pos(ini) + 100 / meses / 31)}%"
        title="${esc(u.nome)} · ${fmtData(u.vigencia_inicio)} a ${fmtData(u.vigencia_fim)} · ${s.rotulo}"><span>${fmtMesAno(ini)} – ${fmtMesAno(fim)}</span></a>` : '';
    const marcos = u.data_base_mes ? Array.from({ length: a1 - a0 + 1 }, (_, i) => {
      const d = new Date(a0 + i, u.data_base_mes - 1, 1, 12);
      return `<i class="tl-db${d < hoje ? ' passada' : ''}" style="left:${pos(d)}%" title="Data-base ${MESES[u.data_base_mes - 1]}/${a0 + i}"></i>`;
    }).join('') : '';
    return `<div class="tl-linha"><a class="tl-nome" href="#/usina/${u.id}">${esc(u.nome)}<small>${esc(u.sindicato || '')}</small></a>
      <div class="tl-trilho">${barra}${marcos}</div></div>`;
  }).join('');
  return `<section class="cartao linha-tempo">
    <div class="cartao-cab"><h2>Linha do tempo das vigências</h2>
      <div class="legenda"><span class="lg vigente">Vigente</span><span class="lg atencao">Vence em até 6 meses</span><span class="lg vencido">Vencido</span><span class="lg db">Data-base</span></div></div>
    <div class="tl" style="--hoje:${pos(hoje)}%">
      <div class="tl-linha tl-anos"><span></span><div class="tl-trilho">${anosHtml}</div></div>
      ${linhas}
      <div class="tl-hoje-wrap"><span></span><div class="tl-trilho"><i class="tl-hoje"><b>hoje</b></i></div></div>
    </div></section>`;
}

function cartaoUsina(u, s) {
  const docs = docsDe(u.id);
  const db = proximaDataBase(u);
  const destaques = E.itens.filter(i => i.destaque).slice(0, 4);
  return `<a class="cartao-usina" href="#/usina/${u.id}">
    <div class="cu-topo"><h3>${esc(u.nome)}</h3><span class="selo ${s.cls}">${s.curto}</span></div>
    <p class="cu-sind">${esc(u.sindicato || 'Sindicato não informado')}</p>
    <dl class="cu-datas">
      <div><dt>Vigência</dt><dd>${u.vigencia_inicio ? `${fmtMesAno(dataLocal(u.vigencia_inicio))} – ${fmtMesAno(dataLocal(u.vigencia_fim))}` : '—'}</dd></div>
      <div><dt>Data-base</dt><dd>${u.data_base_mes ? MESES[u.data_base_mes - 1] : '—'}${db && db.dias <= 90 ? ` <b class="em-breve">em ${db.dias} d</b>` : ''}</dd></div>
    </dl>
    <dl class="cu-destaques">${destaques.map(i => {
      const v = valorDe(u.id, i.id).valor;
      return `<div><dt>${esc(rotuloCurto(i.nome))}</dt><dd class="${vazio(v) ? 'vazio' : ''}">${esc(v || '—')}</dd></div>`;
    }).join('')}</dl>
    <div class="cu-rodape">${docs.length ? `<span class="doc-ok">${docs.length} PDF${docs.length > 1 ? 's' : ''} · ${docs.map(d => d.tipo).join(', ')}</span>` : '<span class="doc-falta">PDF do acordo não enviado</span>'}<span class="seta">→</span></div>
  </a>`;
}

const rotuloCurto = (nome) => nome.replace(/\s*[-–(].*$/, '').replace(/^%\s*/, '').trim() || nome;

// ---------- Comparativo ----------

function telaComparativo(q = {}) {
  const ocultas = new Set(pref.ler('colunasOcultas', []));
  const usinas = E.usinas.filter(u => !ocultas.has(u.id));
  const fechadas = new Set(pref.ler('gruposFechados', []));
  const filtro = q.item ? '' : pref.ler('filtroItens', '');
  const opc = { diferencas: pref.ler('soDiferencas', false), notas: pref.ler('mostrarNotas', false) };

  vista.innerHTML = `<div class="pagina pagina-larga">
    ${cabecalho('COMPARATIVO', 'Benefícios lado a lado', 'Clique em um valor para ver a cláusula de origem, o histórico e, se tiver permissão, editar.',
      `<button class="btn btn-claro btn-sm" id="exportar">⬇ Exportar Excel</button>`)}
    <div class="barra-ferramentas">
      <input class="campo campo-filtro" id="filtro-itens" type="search" placeholder="Filtrar itens (ex.: creche, PLR)" value="${esc(filtro)}">
      <label class="alternar"><input type="checkbox" id="so-dif" ${opc.diferencas ? 'checked' : ''}><span></span>Só onde há diferença</label>
      <label class="alternar"><input type="checkbox" id="ver-notas" ${opc.notas ? 'checked' : ''}><span></span>Mostrar anotações</label>
      <div class="colunas-escolha" role="group" aria-label="Usinas visíveis">
        ${E.usinas.map(u => `<button class="pilula ${ocultas.has(u.id) ? '' : 'on'}" data-col="${u.id}" aria-pressed="${!ocultas.has(u.id)}">${esc(u.nome)}</button>`).join('')}
      </div>
    </div>
    <div class="tabela-rolagem" id="tabela-rolagem">
      <table class="matriz ${opc.notas ? 'com-notas' : ''}">
        <thead><tr><th class="col-item">Item</th>${usinas.map(u => {
          const s = situacao(u);
          return `<th><a href="#/usina/${u.id}">${esc(u.nome)}</a><small><i class="ponto ${s.cls}" title="${esc(s.rotulo)}"></i>${esc(u.sindicato || '')}</small></th>`;
        }).join('')}</tr></thead>
        <tbody>${categorias().map(cat => `
          <tr class="grupo ${fechadas.has(cat.nome) ? 'fechado' : ''}" data-grupo="${esc(cat.nome)}"><th colspan="${usinas.length + 1}">
            <button class="grupo-botao" aria-expanded="${!fechadas.has(cat.nome)}"><span class="seta-g">▾</span>${esc(cat.nome)} <small>${cat.itens.length}</small></button></th></tr>
          ${cat.itens.map(i => linhaMatriz(i, usinas, cat.nome, fechadas.has(cat.nome))).join('')}`).join('')}
        </tbody>
      </table>
    </div>
    <p class="nota-rodape"><span class="tri"></span> canto laranja: a célula tem anotação (cláusula de origem ou observação) · barras: comparação entre os valores em R$ ou % da linha.</p>
  </div>`;

  const aplicarFiltros = () => {
    const t = Clausulas.normalizar(document.getElementById('filtro-itens').value.trim());
    const soDif = document.getElementById('so-dif').checked;
    vista.querySelectorAll('tr.linha').forEach((tr) => {
      const ok = (!t || Clausulas.normalizar(tr.dataset.nome).includes(t)) && (!soDif || tr.dataset.igual !== '1');
      tr.classList.toggle('filtrada', !ok);
    });
    vista.querySelectorAll('tr.grupo').forEach((g) => {
      const linhas = vista.querySelectorAll(`tr.linha[data-grupo="${CSS.escape(g.dataset.grupo)}"]:not(.filtrada)`);
      g.classList.toggle('filtrada', !linhas.length);
    });
  };
  document.getElementById('filtro-itens').addEventListener('input', (e) => { pref.gravar('filtroItens', e.target.value); aplicarFiltros(); });
  document.getElementById('so-dif').addEventListener('change', (e) => { pref.gravar('soDiferencas', e.target.checked); aplicarFiltros(); });
  document.getElementById('ver-notas').addEventListener('change', (e) => {
    pref.gravar('mostrarNotas', e.target.checked);
    vista.querySelector('.matriz').classList.toggle('com-notas', e.target.checked);
  });
  vista.querySelectorAll('[data-col]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.col);
    ocultas.has(id) ? ocultas.delete(id) : ocultas.add(id);
    if (ocultas.size === E.usinas.length) { ocultas.delete(id); return toast('Deixe pelo menos uma usina visível.'); }
    pref.gravar('colunasOcultas', [...ocultas]);
    telaComparativo();
  }));
  vista.querySelectorAll('.grupo-botao').forEach(b => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    const fechar = !tr.classList.contains('fechado');
    tr.classList.toggle('fechado', fechar);
    b.setAttribute('aria-expanded', String(!fechar));
    vista.querySelectorAll(`tr.linha[data-grupo="${CSS.escape(tr.dataset.grupo)}"]`).forEach(l => l.classList.toggle('recolhida', fechar));
    fechar ? fechadas.add(tr.dataset.grupo) : fechadas.delete(tr.dataset.grupo);
    pref.gravar('gruposFechados', [...fechadas]);
  }));
  vista.querySelector('tbody').addEventListener('click', (e) => {
    const td = e.target.closest('td[data-u]');
    if (td && !e.target.closest('a')) abrirGaveta(Number(td.dataset.u), Number(td.dataset.i));
  });
  vista.querySelector('tbody').addEventListener('keydown', (e) => {
    const td = e.target.closest('td[data-u]');
    if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirGaveta(Number(td.dataset.u), Number(td.dataset.i)); }
  });
  document.getElementById('exportar').addEventListener('click', exportarExcel);
  aplicarFiltros();
  if (q.item) {
    const tr = vista.querySelector(`tr.linha[data-item="${Number(q.item)}"]`);
    if (tr) {
      tr.classList.remove('recolhida');
      tr.scrollIntoView({ block: 'center' });
      tr.classList.add('piscar');
    }
  }
}

function linhaMatriz(i, usinas, grupo, recolhida) {
  const vals = usinas.map(u => valorDe(u.id, i.id));
  const nums = vals.map(v => numero(v.valor));
  const unidade = nums.find(Boolean)?.un;
  const comparavel = nums.filter(n => n && n.un === unidade).length >= 3;
  const max = comparavel ? Math.max(...nums.filter(n => n && n.un === unidade).map(n => n.n)) : 0;
  const igual = new Set(vals.map(v => Clausulas.normalizar(v.valor).replace(/\s+/g, ''))).size <= 1;
  return `<tr class="linha ${recolhida ? 'recolhida' : ''}" data-grupo="${esc(grupo)}" data-nome="${esc(i.nome)}" data-item="${i.id}" data-igual="${igual ? 1 : 0}">
    <th class="col-item" scope="row">${esc(i.nome)}</th>
    ${usinas.map((u, k) => {
      const v = vals[k], n = nums[k];
      const barra = comparavel && n && n.un === unidade && max > 0
        ? `<span class="barra-n${n.n === max ? ' max' : ''}" style="--p:${(n.n / max) * 100}%"></span>` : '';
      return `<td data-u="${u.id}" data-i="${i.id}" tabindex="0" class="${vazio(v.valor) ? 'vazio' : ''} ${v.nota ? 'tem-nota' : ''}"
        ${v.nota ? `title="${esc(v.nota.slice(0, 300))}"` : ''}><span class="v">${esc(v.valor || '—')}</span>${barra}
        ${v.nota ? `<span class="nota-inline">${esc(v.nota.length > 140 ? v.nota.slice(0, 140) + '…' : v.nota)}</span>` : ''}</td>`;
    }).join('')}</tr>`;
}

function exportarExcel() {
  if (typeof XLSX === 'undefined') return toast('Aguarde um instante e tente de novo.', 'erro');
  const ocultas = new Set(pref.ler('colunasOcultas', []));
  const usinas = E.usinas.filter(u => !ocultas.has(u.id));
  const linhas = [['BENEFÍCIOS ACT', ...usinas.map(u => u.nome)],
    ['SINDICATOS', ...usinas.map(u => u.sindicato || '')],
    ['MÊS DATA BASE', ...usinas.map(u => (u.data_base_mes ? MESES[u.data_base_mes - 1].toUpperCase() : ''))],
    ['VIGÊNCIA', ...usinas.map(u => (u.vigencia_inicio ? `${fmtData(u.vigencia_inicio)} a ${fmtData(u.vigencia_fim)}` : ''))]];
  const ordenados = categorias().flatMap(c => c.itens);
  ordenados.forEach(i => linhas.push([i.nome, ...usinas.map(u => valorDe(u.id, i.id).valor)]));
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ordenados.forEach((i, r) => usinas.forEach((u, c) => {
    const nota = valorDe(u.id, i.id).nota;
    if (!nota) return;
    const ref = XLSX.utils.encode_cell({ r: r + 4, c: c + 1 });
    ws[ref] = ws[ref] || { t: 's', v: '' };
    ws[ref].c = [{ a: 'RH', t: nota }];
    ws[ref].c.hidden = true;
  }));
  ws['!cols'] = [{ wch: 46 }, ...usinas.map(() => ({ wch: 22 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RESUMO ACTs');
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Resumo ACT - Âmbar - ${E.hoje}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Gaveta (detalhe de um valor) ----------

const gaveta = document.getElementById('gaveta');
const veu = document.getElementById('veu');
document.getElementById('gaveta-fechar').addEventListener('click', fecharGaveta);
veu.addEventListener('click', fecharGaveta);
function fecharGaveta() {
  gaveta.classList.remove('aberta');
  gaveta.setAttribute('aria-hidden', 'true');
  veu.hidden = true;
  vista.querySelectorAll('td.ativa, .ri.ativa').forEach(x => x.classList.remove('ativa'));
}

async function abrirGaveta(usinaId, itemId) {
  const u = usina(usinaId), i = item(itemId);
  if (!u || !i) return;
  const v = valorDe(u.id, i.id);
  const refs = resolverRefs(u.id, v.nota);
  vista.querySelectorAll('td.ativa, .ri.ativa').forEach(x => x.classList.remove('ativa'));
  vista.querySelectorAll(`td[data-u="${u.id}"][data-i="${i.id}"], .ri[data-i="${i.id}"]`).forEach(x => x.classList.add('ativa'));
  document.getElementById('gaveta-sobre').textContent = `${u.nome} · ${i.categoria}`;
  document.getElementById('gaveta-titulo').textContent = i.nome;
  const corpo = document.getElementById('gaveta-corpo');
  corpo.innerHTML = `
    <div class="gv-valor ${vazio(v.valor) ? 'vazio' : ''}">${esc(v.valor || 'Sem informação')}</div>
    <section class="gv-bloco">
      <h3>Origem no acordo</h3>
      ${refs.length ? `<div class="gv-refs">${refs.map(r => chipRef(r, u.id, { completo: true })).join('')}</div>` : '<p class="fraco">Nenhuma cláusula citada na anotação.</p>'}
      ${v.nota ? `<blockquote class="gv-nota">${esc(v.nota)}</blockquote>` : ''}
    </section>
    ${podeEditar() ? `<section class="gv-bloco">
      <h3>Editar</h3>
      <form class="gv-form" id="gv-form">
        <label class="rotulo">Valor <input class="campo" name="valor" value="${esc(v.valor)}" maxlength="500" placeholder="Ex.: R$ 1.200,00 · SIM · 6 meses · -"></label>
        <label class="rotulo">Anotação <small>cite a cláusula (ex.: “CLÁUSULA DÉCIMA NONA” ou “Cláusula 19ª”) para criar o atalho para o PDF</small>
          <textarea class="campo" name="nota" maxlength="5000" rows="4">${esc(v.nota)}</textarea></label>
        <div class="gv-form-acoes"><span class="fraco">${v.atualizado_por ? `Última alteração: ${esc(v.atualizado_por)}, ${new Date(v.atualizado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}` : ''}</span>
          <button class="btn btn-laranja btn-sm" type="submit">Salvar</button></div>
      </form></section>` : ''}
    <section class="gv-bloco">
      <h3>Nas outras usinas</h3>
      <ul class="gv-outras">${E.usinas.map(o => {
        const ov = valorDe(o.id, i.id).valor;
        return `<li class="${o.id === u.id ? 'atual' : ''}"><button data-outra="${o.id}"><span>${esc(o.nome)}</span><b class="${vazio(ov) ? 'vazio' : ''}">${esc(ov || '—')}</b></button></li>`;
      }).join('')}</ul>
    </section>
    <section class="gv-bloco"><h3>Histórico</h3><ol class="gv-hist" id="gv-hist"><li class="fraco">Carregando…</li></ol></section>`;
  gaveta.classList.add('aberta');
  gaveta.setAttribute('aria-hidden', 'false');
  veu.hidden = window.innerWidth > 1100;
  corpo.scrollTop = 0;
  corpo.querySelectorAll('[data-outra]').forEach(b => b.addEventListener('click', () => abrirGaveta(Number(b.dataset.outra), i.id)));
  corpo.querySelectorAll('.chip-ref').forEach(a => a.addEventListener('click', () => fecharGaveta()));
  corpo.querySelector('#gv-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const novo = await api(`/api/valores/${u.id}/${i.id}`, { method: 'PUT', body: f });
      E.valores.set(`${u.id}:${i.id}`, novo);
      toast('Valor salvo ✓');
      redesenharCelula(u.id, i.id);
      abrirGaveta(u.id, i.id);
    } catch (err) { toast(err.message, 'erro'); }
  });
  try {
    const hist = await api(`/api/alteracoes?usina_id=${u.id}&item_id=${i.id}&limite=30`);
    const ol = document.getElementById('gv-hist');
    if (!ol) return;
    ol.innerHTML = hist.length ? hist.map(h => `<li><span class="quando">${new Date(h.em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(h.usuario || '')}${h.acao === 'importação' ? ' (planilha)' : ''}</span>
      ${h.antes ? `<span class="de">${esc(h.antes.valor || '—')}</span> → ` : ''}<span class="para">${esc(h.depois?.valor || '—')}</span>
      ${h.antes && h.antes.nota !== h.depois?.nota ? '<em>anotação alterada</em>' : ''}</li>`).join('') : '<li class="fraco">Sem alterações registradas.</li>';
  } catch { /* histórico é complementar */ }
}

/** Atualiza uma célula/linha na tela atual após salvar, sem perder a rolagem. */
function redesenharCelula(usinaId, itemId) {
  const r = E.rotaAtual;
  if (r?.tela === 'comparativo') {
    const tr = vista.querySelector(`tr.linha[data-item="${itemId}"]`);
    if (!tr) return;
    const ocultas = new Set(pref.ler('colunasOcultas', []));
    const tmp = document.createElement('tbody');
    tmp.innerHTML = linhaMatriz(item(itemId), E.usinas.filter(u => !ocultas.has(u.id)), tr.dataset.grupo, false);
    tr.replaceWith(tmp.firstElementChild);
  } else if (r?.tela === 'usina') {
    const li = vista.querySelector(`.ri[data-i="${itemId}"]`);
    if (li) li.outerHTML = itemResumo(usina(usinaId), item(itemId));
  }
}

// ---------- Usina ----------

function telaUsina(id, q = {}) {
  if (!E.usinas.length) { vista.innerHTML = `<div class="pagina">${vazioInicial()}</div>`; return; }
  const u = usina(id) || usina(pref.ler('ultimaUsina', 0)) || E.usinas[0];
  if (!id || !usina(id)) { location.replace(`#/usina/${u.id}`); return; }
  pref.gravar('ultimaUsina', u.id);
  const s = situacao(u);
  const db = proximaDataBase(u);
  const docs = docsDe(u.id);

  vista.innerHTML = `<div class="pagina pagina-larga pagina-usina">
    <nav class="fichario" aria-label="Usinas">${E.usinas.map(x => `<a href="#/usina/${x.id}" class="${x.id === u.id ? 'ativa' : ''}"><i class="ponto ${situacao(x).cls}"></i>${esc(x.nome)}</a>`).join('')}</nav>
    <header class="ficha">
      <div class="ficha-id">
        <span class="sobre">USINA</span>
        <h1>${esc(u.nome)}</h1>
        <p>${esc(u.sindicato || 'Sindicato não informado')}</p>
      </div>
      <dl class="ficha-dados">
        <div><dt>Vigência</dt><dd>${u.vigencia_inicio ? `${fmtData(u.vigencia_inicio)} a ${fmtData(u.vigencia_fim)}` : '—'}</dd></div>
        <div><dt>Data-base</dt><dd>${u.data_base_mes ? MESES[u.data_base_mes - 1] : '—'}${db ? `<small>próxima em ${fmtMesAno(db.data)} · ${db.dias} dias</small>` : ''}</dd></div>
        <div><dt>Situação</dt><dd><span class="selo ${s.cls}">${s.rotulo}</span></dd></div>
      </dl>
      ${podeEditar() ? `<div class="ficha-acoes"><button class="btn btn-claro btn-sm" id="editar-usina">Editar dados</button><button class="btn btn-marinho btn-sm" id="enviar-pdf">＋ Enviar PDF</button></div>` : ''}
      ${u.observacoes ? `<p class="ficha-obs">${esc(u.observacoes)}</p>` : ''}
    </header>
    <div class="usina-corpo">
      <section class="resumo" aria-label="Resumo do acordo">
        <div class="resumo-cab"><h2>Resumo</h2><input class="campo campo-filtro" id="filtro-resumo" type="search" placeholder="Filtrar"></div>
        <div class="resumo-lista">${categorias().map(c => `<div class="rg" data-grupo="${esc(c.nome)}"><h3>${esc(c.nome)}</h3>
          <ul>${c.itens.map(i => itemResumo(u, i)).join('')}</ul></div>`).join('')}</div>
      </section>
      <section class="documento" aria-label="Documento do acordo">${painelDocumento(u, docs)}</section>
    </div>
  </div>`;

  document.getElementById('filtro-resumo').addEventListener('input', (e) => {
    const t = Clausulas.normalizar(e.target.value.trim());
    vista.querySelectorAll('.ri').forEach(li => li.hidden = !!t && !Clausulas.normalizar(li.dataset.busca).includes(t));
    vista.querySelectorAll('.rg').forEach(g => g.hidden = !g.querySelector('.ri:not([hidden])'));
  });
  vista.querySelector('.resumo-lista').addEventListener('click', (e) => {
    const li = e.target.closest('.ri');
    if (li && !e.target.closest('a')) abrirGaveta(u.id, Number(li.dataset.i));
  });
  vista.querySelector('.resumo-lista').addEventListener('keydown', (e) => {
    const li = e.target.closest('.ri');
    if (li && e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirGaveta(u.id, Number(li.dataset.i)); }
  });
  document.getElementById('editar-usina')?.addEventListener('click', () => Admin.editarUsina(u));
  document.getElementById('enviar-pdf')?.addEventListener('click', () => Admin.enviarPdf(u));
  document.getElementById('enviar-pdf-vazio')?.addEventListener('click', () => Admin.enviarPdf(u));
  if (docs.length) montarVisualizador(u, docs, q);
}

function itemResumo(u, i) {
  const v = valorDe(u.id, i.id);
  const refs = resolverRefs(u.id, v.nota);
  return `<li class="ri" data-i="${i.id}" tabindex="0" data-busca="${esc(`${i.nome} ${v.valor} ${v.nota}`)}">
    <span class="ri-nome">${esc(i.nome)}</span>
    <span class="ri-valor ${vazio(v.valor) ? 'vazio' : ''}">${esc(v.valor || '—')}</span>
    ${refs.length ? `<span class="ri-refs">${refs.map(r => chipRef(r, u.id)).join('')}</span>` : (v.nota ? '<span class="ri-refs"><span class="chip-ref obs">observação</span></span>' : '')}
  </li>`;
}

function painelDocumento(u, docs) {
  if (!docs.length) {
    return `<div class="doc-vazio">
      <svg viewBox="0 0 64 80" aria-hidden="true"><path d="M8 2h34l20 20v54a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="#fff" stroke="#c9d3dc" stroke-width="2"/><path d="M42 2v20h20" fill="none" stroke="#c9d3dc" stroke-width="2"/><path d="M16 38h32M16 46h32M16 54h22" stroke="#ec6b24" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>
      <h3>O PDF do acordo de ${esc(u.nome)} ainda não foi enviado</h3>
      <p>O resumo ao lado continua disponível. Quando o PDF for enviado, as cláusulas citadas viram atalhos diretos para o texto.</p>
      ${podeEditar() ? '<button class="btn btn-laranja" id="enviar-pdf-vazio">＋ Enviar o PDF do acordo</button>' : ''}
    </div>`;
  }
  return `<div class="doc-cab">
      <div class="doc-abas" role="tablist">${docs.map(d => `<button role="tab" data-doc="${d.id}" title="${esc(d.nome_original || '')}"><span class="tipo t-${d.tipo.toLowerCase()}">${d.tipo}</span>${esc(d.titulo)}</button>`).join('')}</div>
    </div>
    <div class="doc-ferramentas">
      <button class="btn btn-claro btn-sm" id="doc-sumario" aria-expanded="false">☰ Cláusulas</button>
      <form class="doc-busca" id="doc-busca"><input class="campo" type="search" name="q" placeholder="Buscar neste acordo" aria-label="Buscar neste acordo">
        <span class="doc-busca-res" id="doc-busca-res"></span>
        <button class="btn btn-fantasma btn-sm" type="button" id="doc-ant" aria-label="Resultado anterior">↑</button>
        <button class="btn btn-fantasma btn-sm" type="button" id="doc-prox" aria-label="Próximo resultado">↓</button></form>
      <span class="doc-pag" id="doc-pag"></span>
      <div class="doc-zoom"><button class="btn btn-fantasma btn-sm" id="zoom-menos" aria-label="Diminuir">−</button><button class="btn btn-fantasma btn-sm" id="zoom-mais" aria-label="Aumentar">＋</button></div>
      <a class="btn btn-fantasma btn-sm" id="doc-baixar" href="#" download title="Baixar o PDF">⬇</a>
      ${podeEditar() ? '<button class="btn btn-fantasma btn-sm" id="doc-editar" title="Editar ou remover este documento">⋯</button>' : ''}
    </div>
    <div class="doc-area">
      <aside class="sumario" id="sumario" hidden></aside>
      <div class="doc-viz" id="doc-viz"></div>
    </div>`;
}

let buscaDoc = { termo: '', paginas: [], i: -1 };

function montarVisualizador(u, docs, q) {
  E.viz = new Visualizador(document.getElementById('doc-viz'), {
    aoMudarPagina: (n, total) => { const el = document.getElementById('doc-pag'); if (el) el.textContent = `pág. ${n} de ${total}`; },
  });
  vista.querySelectorAll('.doc-abas [data-doc]').forEach(b => b.addEventListener('click', () => {
    location.hash = `#/usina/${u.id}?doc=${b.dataset.doc}`;
  }));
  document.getElementById('doc-sumario').addEventListener('click', (e) => {
    const s = document.getElementById('sumario');
    s.hidden = !s.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!s.hidden));
  });
  document.getElementById('zoom-menos').addEventListener('click', () => E.viz.definirZoom(E.viz.zoom - 0.15));
  document.getElementById('zoom-mais').addEventListener('click', () => E.viz.definirZoom(E.viz.zoom + 0.15));
  document.getElementById('doc-editar')?.addEventListener('click', () => Admin.editarDocumento(E.docs.find(d => d.id === E.docAtual)));
  const form = document.getElementById('doc-busca');
  form.addEventListener('submit', (e) => { e.preventDefault(); buscarNoDocumento(form.q.value.trim(), u.id); });
  form.q.addEventListener('search', () => { if (!form.q.value) buscarNoDocumento('', u.id); });
  document.getElementById('doc-prox').addEventListener('click', () => passoBusca(1));
  document.getElementById('doc-ant').addEventListener('click', () => passoBusca(-1));
  irParaDocumento(q);
}

async function irParaDocumento(q = {}) {
  const u = usina(E.rotaAtual.id);
  const docs = docsDe(u.id);
  if (!docs.length || !E.viz) return;
  const doc = docs.find(d => d.id === Number(q.doc)) || docs[0];
  E.docAtual = doc.id;
  vista.querySelectorAll('.doc-abas [data-doc]').forEach(b => {
    const on = Number(b.dataset.doc) === doc.id;
    b.classList.toggle('ativa', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.getElementById('doc-baixar').href = `/api/documentos/${doc.id}/arquivo?baixar=1`;
  montarSumario(u, doc);
  try {
    await E.viz.abrir(doc.id);
  } catch (err) {
    document.getElementById('doc-viz').innerHTML = `<p class="viz-aviso">${esc(err.message)}</p>`;
    return;
  }
  const form = document.getElementById('doc-busca');
  if (q.q) {
    form.q.value = q.q;
    await buscarNoDocumento(q.q, u.id, Number(q.pag) || null);
  } else if (buscaDoc.termo && buscaDoc.doc !== doc.id) {
    buscaDoc = { termo: '', paginas: [], i: -1 };
    form.q.value = '';
    document.getElementById('doc-busca-res').textContent = '';
    E.viz.definirTermo('');
  }
  if (q.pag) E.viz.irPara({ pagina: Number(q.pag), clausula: q.cl ? Number(q.cl) : null });
  vista.querySelectorAll('.sumario a').forEach(a => a.classList.toggle('ativa', q.cl && Number(a.dataset.cl) === Number(q.cl) && Number(a.dataset.pag) === Number(q.pag)));
}

function montarSumario(u, doc) {
  const s = document.getElementById('sumario');
  const secoes = [...new Set(doc.clausulas.map(c => c.secao))];
  s.innerHTML = `<h3>Cláusulas <small>${doc.clausulas.length} encontradas</small></h3>
    ${doc.clausulas.length ? secoes.map(sec => `${secoes.length > 1 ? `<h4>${sec === 0 ? 'Acordo' : `Parte ${sec + 1} (aditivo/anexo)`}</h4>` : ''}
      <ol>${doc.clausulas.filter(c => c.secao === sec).map(c => `<li><a href="#/usina/${u.id}?doc=${doc.id}&pag=${c.pagina}&cl=${c.numero}" data-cl="${c.numero}" data-pag="${c.pagina}">
        <b>${c.numero}ª</b><span>${esc(c.titulo || Clausulas.porExtenso(c.numero))}</span><small>p. ${c.pagina}</small></a></li>`).join('')}</ol>`).join('')
      : '<p class="fraco">Não foi possível identificar os títulos das cláusulas neste PDF (pode ser um documento digitalizado). Use a busca.</p>'}`;
}

async function buscarNoDocumento(termo, usinaId, paginaInicial = null) {
  const res = document.getElementById('doc-busca-res');
  E.viz.definirTermo(termo);
  if (termo.length < 3) {
    buscaDoc = { termo: '', paginas: [], i: -1 };
    res.textContent = termo ? 'mín. 3 letras' : '';
    return;
  }
  const r = await api(`/api/busca?q=${encodeURIComponent(termo)}&usina_id=${usinaId}`);
  const paginas = r.resultados.filter(x => x.documento_id === E.docAtual).map(x => x.pagina);
  buscaDoc = { termo, paginas, i: -1, doc: E.docAtual };
  if (!paginas.length) { res.textContent = 'nenhum resultado'; return; }
  buscaDoc.i = Math.max(0, paginaInicial ? paginas.indexOf(paginaInicial) : 0);
  mostrarPassoBusca();
}
function passoBusca(d) {
  if (!buscaDoc.paginas.length) return;
  buscaDoc.i = (buscaDoc.i + d + buscaDoc.paginas.length) % buscaDoc.paginas.length;
  mostrarPassoBusca();
}
function mostrarPassoBusca() {
  const p = buscaDoc.paginas[buscaDoc.i];
  document.getElementById('doc-busca-res').textContent = `pág. ${p} · ${buscaDoc.i + 1} de ${buscaDoc.paginas.length} págs.`;
  E.viz.irPara({ pagina: p });
}

// ---------- Busca nos acordos ----------

async function telaBusca(q = {}) {
  const termo = (q.q || '').trim();
  vista.innerHTML = `<div class="pagina">
    ${cabecalho('BUSCA', 'Busca no texto dos acordos', `${E.docs.length} PDF${E.docs.length === 1 ? '' : 's'} pesquisáveis de ${new Set(E.docs.map(d => d.usina_id)).size} usinas. A busca ignora acentos e maiúsculas.`)}
    <form class="busca-grande" id="busca-form">
      <input class="campo" name="q" type="search" value="${esc(termo)}" placeholder="Ex.: sobreaviso, auxílio creche, banco de horas" autofocus>
      <select class="campo" name="usina"><option value="">Todas as usinas</option>${E.usinas.filter(u => docsDe(u.id).length).map(u => `<option value="${u.id}" ${Number(q.usina) === u.id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>
      <button class="btn btn-laranja">Buscar</button>
    </form>
    <div id="busca-res">${termo ? '<p class="fraco">Buscando…</p>' : sugestoesBusca()}</div>
  </div>`;
  document.getElementById('busca-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    location.hash = `#/busca?q=${encodeURIComponent(f.q.trim())}${f.usina ? `&usina=${f.usina}` : ''}`;
  });
  if (!termo) return;
  const r = await api(`/api/busca?q=${encodeURIComponent(termo)}${q.usina ? `&usina_id=${q.usina}` : ''}`);
  const alvo = document.getElementById('busca-res');
  if (!alvo) return;
  if (!r.resultados.length) {
    alvo.innerHTML = `<p class="sem-resultado">Nenhum trecho com “${esc(termo)}”. Tente outra palavra ou só o começo dela (ex.: “sobreav”).</p>`;
    return;
  }
  const porUsina = new Map();
  for (const x of r.resultados) (porUsina.get(x.usina_id) || porUsina.set(x.usina_id, []).get(x.usina_id)).push(x);
  alvo.innerHTML = `<p class="busca-total"><strong>${r.total}</strong> ocorrência${r.total === 1 ? '' : 's'} em <strong>${porUsina.size}</strong> usina${porUsina.size === 1 ? '' : 's'}</p>
    ${[...porUsina.entries()].map(([uid, lista]) => `<section class="busca-usina">
      <h2><a href="#/usina/${uid}">${esc(usina(uid)?.nome || '')}</a><small>${lista.reduce((s, x) => s + x.ocorrencias, 0)} ocorrências</small></h2>
      ${lista.map(x => `<a class="busca-item" href="#/usina/${uid}?doc=${x.documento_id}&pag=${x.pagina}&q=${encodeURIComponent(termo)}">
        <span class="bi-onde"><span class="tipo t-${x.tipo.toLowerCase()}">${x.tipo}</span> pág. ${x.pagina}${x.trechos[0]?.clausula ? ` · Cl. ${x.trechos[0].clausula}ª` : ''}</span>
        ${x.trechos.map(t => `<span class="bi-trecho">${esc(t.antes)}<mark>${esc(t.achado)}</mark>${esc(t.depois)}</span>`).join('')}
      </a>`).join('')}</section>`).join('')}`;
}

function sugestoesBusca() {
  const sugestoes = ['sobreaviso', 'auxílio creche', 'banco de horas', 'adicional noturno', 'estabilidade', 'plano de saúde', 'PLR'];
  return `<div class="sugestoes"><span>Sugestões:</span>${sugestoes.map(s => `<a class="pilula" href="#/busca?q=${encodeURIComponent(s)}">${s}</a>`).join('')}</div>`;
}

// ---------- início ----------

async function iniciar() {
  try {
    await carregarDados();
  } catch (err) {
    if (err.status === 401) return location.replace('./');
    if (err.dados?.trocar_senha) {
      E.usuario = await api('/api/eu');
      montarUsuario();
      vista.innerHTML = '<div class="pagina"><p class="fraco">Crie sua senha para continuar.</p></div>';
      return abrirTrocaSenha(true);
    }
    vista.innerHTML = `<div class="pagina"><p class="erro-tela">${esc(err.message)}</p></div>`;
    return;
  }
  montarUsuario();
  rotear();
}

window.App = { E, atualizar, usina, item, valorDe, docsDe, podeEditar, ehAdmin, categorias, cabecalho, MESES, fmtData, situacao, pref, ORDEM_CATEGORIAS };
iniciar();
