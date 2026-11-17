// Visualizador de PDF dos acordos (pdf.js): páginas desenhadas sob demanda, com camada de texto
// para realçar o título de uma cláusula ou os termos buscados.
/* global Clausulas */
let _pdfjs;
async function carregarPdfjs() {
  if (!_pdfjs) {
    _pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    _pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return _pdfjs;
}

const _cachePdf = new Map(); // id → ArrayBuffer

class Visualizador {
  constructor(raiz, { aoMudarPagina } = {}) {
    this.raiz = raiz;
    this.aoMudarPagina = aoMudarPagina || (() => {});
    this.zoom = 1;
    raiz.classList.add('viz');
    raiz.innerHTML = '<div class="viz-paginas" tabindex="0" aria-label="Páginas do acordo"></div>';
    this.paginasEl = raiz.querySelector('.viz-paginas');
    this.largura = 0;
    this.resize = new ResizeObserver(() => {
      const w = this.paginasEl.clientWidth;
      if (this.doc && this.largura && Math.abs(w - this.largura) / this.largura > 0.08) this.redesenhar();
      this.largura = w;
    });
    this.resize.observe(this.paginasEl);
  }

  async abrir(id) {
    if (this.docId === id && this.doc) return;
    this.fechar();
    this.docId = id;
    this.paginasEl.innerHTML = '<p class="viz-aviso">Abrindo o acordo…</p>';
    const lib = await carregarPdfjs();
    if (!_cachePdf.has(id)) {
      const resp = await fetch(`/api/documentos/${id}/arquivo`, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).erro || 'Não foi possível abrir o PDF.');
      _cachePdf.set(id, await resp.arrayBuffer());
    }
    if (this.docId !== id) return;
    const doc = await lib.getDocument({ data: _cachePdf.get(id).slice(0), isEvalSupported: false }).promise;
    if (this.docId !== id) { doc.destroy(); return; }
    this.doc = doc;
    this.total = doc.numPages;
    const primeira = (await doc.getPage(1)).getViewport({ scale: 1 });
    this.paginasEl.innerHTML = Array.from({ length: this.total }, (_, i) => `
      <div class="viz-pagina" data-n="${i + 1}" style="aspect-ratio:${primeira.width} / ${primeira.height}">
        <span class="viz-num">${i + 1}</span></div>`).join('');
    this.aplicarZoom();
    this.observar();
    this.largura = this.paginasEl.clientWidth;
  }

  fechar() {
    this.obs?.disconnect();
    this.obsPagina?.disconnect();
    this.doc?.destroy();
    this.doc = null;
    this.docId = null;
    this.alvo = null;
    this.paginasEl.innerHTML = '';
  }

  destruir() {
    this.fechar();
    this.resize.disconnect();
  }

  definirZoom(z) {
    this.zoom = Math.min(2, Math.max(0.6, z));
    this.aplicarZoom();
    this.redesenhar();
  }

  aplicarZoom() { this.paginasEl.style.setProperty('--zoom', this.zoom); }

  redesenhar() {
    this.paginasEl.querySelectorAll('.viz-pagina').forEach((el) => {
      el.dataset.carregada = '';
      el.querySelectorAll('canvas, .textLayer').forEach(x => x.remove());
      el.classList.remove('pronta');
    });
    if (this.alvo) this.alvo.rolar = true;
    this.observar();
  }

  observar() {
    this.obs?.disconnect();
    this.obsPagina?.disconnect();
    this.obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting && !e.target.dataset.carregada) {
          e.target.dataset.carregada = '1';
          this.desenhar(e.target).catch(() => { e.target.dataset.carregada = ''; });
        }
      }
    }, { root: this.paginasEl, rootMargin: '900px 0px' });
    const visiveis = new Map();
    this.obsPagina = new IntersectionObserver((entradas) => {
      for (const e of entradas) visiveis.set(Number(e.target.dataset.n), e.intersectionRatio);
      const [n] = [...visiveis.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [1];
      this.paginaAtual = n;
      this.aoMudarPagina(n, this.total);
    }, { root: this.paginasEl, threshold: [0, 0.25, 0.5, 0.75, 1] });
    this.paginasEl.querySelectorAll('.viz-pagina').forEach(p => { this.obs.observe(p); this.obsPagina.observe(p); });
  }

  async desenhar(el) {
    const doc = this.doc;
    const lib = await carregarPdfjs();
    const pagina = await doc.getPage(Number(el.dataset.n));
    const base = pagina.getViewport({ scale: 1 });
    const escalaCss = el.clientWidth / base.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = pagina.getViewport({ scale: escalaCss * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (doc !== this.doc) return;

    const conteudo = await pagina.getTextContent();
    const camada = document.createElement('div');
    camada.className = 'textLayer';
    camada.style.setProperty('--scale-factor', escalaCss);
    const tl = new lib.TextLayer({ textContentSource: conteudo, container: camada, viewport: pagina.getViewport({ scale: escalaCss }) });
    await tl.render();
    if (doc !== this.doc) return;

    // Texto da página montado como no servidor (lib/pdf.js), com a posição de cada trecho → <span>.
    const itens = conteudo.items.filter(i => typeof i.str === 'string');
    let texto = '';
    const inicios = [];
    for (const it of itens) {
      inicios.push(texto.length);
      texto += it.str + (it.hasEOL ? '\n' : '');
    }
    el._texto = texto;
    el._inicios = inicios;
    el._tamanhos = itens.map(i => i.str.length);
    el._spans = tl.textDivs;
    el._marcados = [];

    el.querySelectorAll('canvas, .textLayer').forEach(x => x.remove());
    el.prepend(canvas, camada);
    el.classList.add('pronta');
    this.marcar(el);
  }

  /** Aplica os realces (cláusula-alvo e termo buscado) numa página já desenhada, envolvendo só os caracteres achados. */
  marcar(el) {
    if (!el._spans) return;
    const n = Number(el.dataset.n);
    const faixas = new Map(); // índice do trecho → [[ini, fim, classe]] (posições locais)
    const pintar = (a, b, cls) => {
      el._inicios.forEach((ini, i) => {
        const fim = ini + el._tamanhos[i];
        if (ini < b && fim > a && el._spans[i]) {
          (faixas.get(i) || faixas.set(i, []).get(i)).push([Math.max(a, ini) - ini, Math.min(b, fim) - ini, cls]);
        }
      });
    };
    if (this.alvo && this.alvo.pagina === n && this.alvo.clausula) {
      const t = Clausulas.titulos(el._texto).find(x => x.numero === this.alvo.clausula);
      if (t) pintar(t.inicio, t.fim, 'marca-clausula');
    }
    if (this.termo) for (const [a, b] of Clausulas.ocorrencias(el._texto, this.termo)) pintar(a, b, 'marca-termo');

    // Restaura os trechos marcados antes e aplica as novas marcas.
    (el._marcados || []).forEach((i) => { const s = el._spans[i]; if (s && s._orig !== undefined) s.textContent = s._orig; });
    el._marcados = [...faixas.keys()];
    let primeiro = null;
    for (const [i, lista] of faixas) {
      const span = el._spans[i];
      span._orig ??= span.textContent;
      const txt = span._orig;
      lista.sort((x, y) => x[0] - y[0]);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const [a, b, cls] of lista) {
        if (a < pos) continue;
        if (a > pos) frag.append(txt.slice(pos, a));
        const m = document.createElement('mark');
        m.className = cls;
        m.textContent = txt.slice(a, b);
        frag.append(m);
        primeiro ??= m;
        pos = b;
      }
      if (pos < txt.length) frag.append(txt.slice(pos));
      span.replaceChildren(frag);
    }
    if (this.alvo && this.alvo.pagina === n && this.alvo.rolar) {
      this.alvo.rolar = false;
      const alvoEl = primeiro || el;
      const topo = alvoEl.getBoundingClientRect().top - this.paginasEl.getBoundingClientRect().top + this.paginasEl.scrollTop;
      this.paginasEl.scrollTo({ top: Math.max(0, topo - (alvoEl === el ? 8 : 90)), behavior: 'smooth' });
    }
  }

  /** Vai para uma página; opcionalmente realça o título da cláusula `clausula` (número) e o termo `termo`. */
  irPara({ pagina = 1, clausula = null, termo } = {}) {
    if (!this.doc) return;
    pagina = Math.min(Math.max(1, pagina), this.total);
    if (termo !== undefined) this.termo = termo;
    this.alvo = { pagina, clausula, rolar: true };
    const el = this.paginasEl.querySelector(`.viz-pagina[data-n="${pagina}"]`);
    this.paginasEl.scrollTo({ top: el.offsetTop - 8 });
    this.paginasEl.querySelectorAll('.viz-pagina.pronta').forEach(p => this.marcar(p));
  }

  definirTermo(termo) {
    this.termo = termo || '';
    this.paginasEl.querySelectorAll('.viz-pagina.pronta').forEach(p => this.marcar(p));
  }
}
window.Visualizador = Visualizador;
