// Administração: usuários (só administradores), estrutura do resumo, importação da planilha, histórico,
// e os diálogos de usina e de PDF usados também na tela da usina.
/* global App, Planilha, XLSX, Clausulas, carregarPdfjs */
(function () {
  const vista = document.getElementById('vista');
  const modal = document.getElementById('modal');
  const modalConteudo = document.getElementById('modal-conteudo');
  const PAPEIS = {
    admin: ['Administrador', 'vê, edita, envia PDFs e gerencia usuários'],
    editor: ['Editor', 'vê, edita valores e envia PDFs'],
    leitor: ['Leitura', 'só consulta'],
  };
  const quando = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  function abrirModal(html, aoMontar) {
    modalConteudo.innerHTML = html;
    modal.showModal();
    modalConteudo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => modal.close()));
    aoMontar?.(modalConteudo);
  }

  function abas(atual) {
    const lista = [
      ...(App.ehAdmin() ? [['usuarios', 'Usuários']] : []),
      ['estrutura', 'Usinas e itens'], ['importar', 'Importar planilha'], ['lote', 'Enviar acordos em lote'], ['historico', 'Histórico'],
    ];
    return `<nav class="sub-abas">${lista.map(([id, nome]) => `<a href="#/admin/${id}" class="${id === atual ? 'ativa' : ''}">${nome}</a>`).join('')}</nav>`;
  }

  function tela(sub) {
    if (!App.podeEditar()) { location.hash = '#/panorama'; return; }
    sub = sub || (App.ehAdmin() ? 'usuarios' : 'estrutura');
    if (sub === 'usuarios' && !App.ehAdmin()) sub = 'estrutura';
    const titulos = { usuarios: 'Usuários do RH', estrutura: 'Usinas e itens do resumo', importar: 'Importar planilha de resumo', lote: 'Enviar acordos em lote', historico: 'Histórico de alterações' };
    vista.innerHTML = `<div class="pagina">${App.cabecalho(App.ehAdmin() ? 'ADMINISTRAÇÃO' : 'ESTRUTURA', titulos[sub] || '')}${abas(sub)}<div id="admin-corpo"></div></div>`;
    ({ usuarios: telaUsuarios, estrutura: telaEstrutura, importar: telaImportar, lote: telaLote, historico: telaHistorico }[sub] || telaEstrutura)();
  }

  // ---------- usuários ----------

  async function telaUsuarios() {
    const corpo = document.getElementById('admin-corpo');
    const lista = await api('/api/usuarios');
    corpo.innerHTML = `
      <div class="grade-admin">
        <section class="cartao">
          <div class="cartao-cab"><h2>Pessoas com acesso</h2><span class="fraco">${lista.filter(u => u.ativo).length} ativas</span></div>
          <div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Nome</th><th>Perfil</th><th>Último acesso</th><th></th></tr></thead>
            <tbody>${lista.map(u => `<tr class="${u.ativo ? '' : 'inativo'}">
              <td><strong>${esc(u.nome)}</strong><small>${esc(u.email)}${u.trocar_senha ? ' · <em>aguardando 1º acesso</em>' : ''}${u.ativo ? '' : ' · <em>desativado</em>'}</small></td>
              <td><select class="campo campo-sm" data-papel="${u.id}" ${u.id === App.E.usuario.id ? 'disabled title="Você não pode mudar o próprio perfil"' : ''}>
                ${Object.entries(PAPEIS).map(([k, [n]]) => `<option value="${k}" ${k === u.papel ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
              <td class="fraco">${quando(u.ultimo_acesso)}</td>
              <td class="acoes">
                <button class="btn btn-fantasma btn-sm" data-redefinir="${u.id}" data-nome="${esc(u.nome)}">Redefinir senha</button>
                ${u.id === App.E.usuario.id ? '' : `<button class="btn btn-fantasma btn-sm" data-ativo="${u.id}" data-valor="${u.ativo ? 0 : 1}">${u.ativo ? 'Desativar' : 'Reativar'}</button>`}
              </td></tr>`).join('')}</tbody></table></div>
        </section>
        <section class="cartao">
          <div class="cartao-cab"><h2>Novo usuário</h2></div>
          <form class="form-coluna" id="novo-usuario">
            <label class="rotulo">Nome <input class="campo" name="nome" required maxlength="120"></label>
            <label class="rotulo">E-mail <input class="campo" name="email" type="email" required maxlength="200"></label>
            <fieldset class="papeis"><legend>Perfil</legend>
              ${Object.entries(PAPEIS).map(([k, [n, d]]) => `<label><input type="radio" name="papel" value="${k}" ${k === 'editor' ? 'checked' : ''}><span><strong>${n}</strong><small>${d}</small></span></label>`).join('')}
            </fieldset>
            <button class="btn btn-laranja">Criar e gerar senha provisória</button>
            <p class="fraco">A pessoa entra com a senha provisória e cria a própria senha no primeiro acesso.</p>
          </form>
          <hr>
          <div class="cartao-cab"><h2>Cópia de segurança</h2></div>
          <p class="fraco">Baixa o banco completo (resumo, usuários e histórico). Os PDFs ficam na pasta de dados do servidor.</p>
          <a class="btn btn-claro btn-sm" href="/api/backup">⬇ Baixar backup do banco</a>
        </section>
      </div>`;

    corpo.querySelector('#novo-usuario').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const f = Object.fromEntries(new FormData(e.target));
        const r = await api('/api/usuarios', { method: 'POST', body: f });
        mostrarSenha(f.nome, f.email, r.senha_provisoria);
        telaUsuarios();
      } catch (err) { toast(err.message, 'erro'); }
    });
    corpo.querySelectorAll('[data-papel]').forEach(s => s.addEventListener('change', async () => {
      try { await api(`/api/usuarios/${s.dataset.papel}`, { method: 'PATCH', body: { papel: s.value } }); toast('Perfil atualizado ✓'); } catch (err) { toast(err.message, 'erro'); telaUsuarios(); }
    }));
    corpo.querySelectorAll('[data-ativo]').forEach(b => b.addEventListener('click', async () => {
      try { await api(`/api/usuarios/${b.dataset.ativo}`, { method: 'PATCH', body: { ativo: b.dataset.valor === '1' } }); telaUsuarios(); } catch (err) { toast(err.message, 'erro'); }
    }));
    corpo.querySelectorAll('[data-redefinir]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Gerar uma nova senha provisória para ${b.dataset.nome}? A senha atual deixa de funcionar.`)) return;
      try {
        const r = await api(`/api/usuarios/${b.dataset.redefinir}/redefinir-senha`, { method: 'POST' });
        const u = lista.find(x => x.id === Number(b.dataset.redefinir));
        mostrarSenha(u.nome, u.email, r.senha_provisoria);
        telaUsuarios();
      } catch (err) { toast(err.message, 'erro'); }
    }));
  }

  function mostrarSenha(nome, email, senha) {
    const texto = `Acesso ao painel de Acordos Coletivos\nEndereço: ${location.origin}\nE-mail: ${email}\nSenha provisória: ${senha}\nNo primeiro acesso você vai criar a sua senha.`;
    abrirModal(`<div class="modal-form">
      <h2>Senha provisória de ${esc(nome)}</h2>
      <p class="sub">Ela aparece só agora. Envie para a pessoa por um canal seguro; no primeiro acesso ela cria a própria senha.</p>
      <div class="senha-prov"><code>${esc(senha)}</code></div>
      <div class="modal-acoes"><button class="btn btn-claro" id="copiar">Copiar mensagem de acesso</button><button class="btn btn-laranja" data-fechar>Pronto</button></div>
    </div>`, (el) => el.querySelector('#copiar').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(texto); toast('Mensagem copiada ✓'); } catch { toast('Não foi possível copiar; selecione a senha manualmente.', 'erro'); }
    }));
  }

  // ---------- estrutura: usinas e itens ----------

  function telaEstrutura() {
    const corpo = document.getElementById('admin-corpo');
    const { E } = App;
    const cats = [...new Set([...App.ORDEM_CATEGORIAS, ...E.itens.map(i => i.categoria)])];
    corpo.innerHTML = `
      <div class="grade-admin grade-meio">
        <section class="cartao">
          <div class="cartao-cab"><h2>Usinas <small class="fraco">${E.usinas.length}</small></h2><button class="btn btn-marinho btn-sm" id="nova-usina">＋ Nova usina</button></div>
          <ol class="lista-ordem" id="lista-usinas">${E.usinas.map(u => `<li data-id="${u.id}">
            <span class="lo-mover"><button aria-label="Subir" data-mover="-1">↑</button><button aria-label="Descer" data-mover="1">↓</button></span>
            <span class="lo-nome"><strong>${esc(u.nome)}</strong><small>${esc(u.sindicato || '—')} · ${App.docsDe(u.id).length} PDF(s)</small></span>
            <button class="btn btn-fantasma btn-sm" data-editar-usina="${u.id}">Editar</button>
            ${App.ehAdmin() ? `<button class="btn btn-fantasma btn-sm perigo" data-remover-usina="${u.id}">Remover</button>` : ''}
          </li>`).join('')}</ol>
        </section>
        <section class="cartao">
          <div class="cartao-cab"><h2>Itens do resumo <small class="fraco">${E.itens.length}</small></h2><button class="btn btn-marinho btn-sm" id="novo-item">＋ Novo item</button></div>
          <p class="fraco">★ = aparece no cartão da usina no Panorama. A categoria agrupa as linhas no comparativo.</p>
          <ol class="lista-ordem" id="lista-itens">${E.itens.map(i => `<li data-id="${i.id}">
            <span class="lo-mover"><button aria-label="Subir" data-mover="-1">↑</button><button aria-label="Descer" data-mover="1">↓</button></span>
            <button class="estrela ${i.destaque ? 'on' : ''}" data-destaque="${i.id}" aria-pressed="${!!i.destaque}" title="Destaque no Panorama">★</button>
            <input class="campo campo-sm lo-input" data-nome-item="${i.id}" value="${esc(i.nome)}" aria-label="Nome do item">
            <select class="campo campo-sm" data-cat-item="${i.id}" aria-label="Categoria">${cats.map(c => `<option ${c === i.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            ${App.ehAdmin() ? `<button class="btn btn-fantasma btn-sm perigo" data-remover-item="${i.id}" aria-label="Remover">✕</button>` : ''}
          </li>`).join('')}</ol>
        </section>
      </div>`;

    corpo.querySelector('#nova-usina').addEventListener('click', () => editarUsina(null));
    corpo.querySelectorAll('[data-editar-usina]').forEach(b => b.addEventListener('click', () => editarUsina(App.usina(b.dataset.editarUsina))));
    corpo.querySelectorAll('[data-remover-usina]').forEach(b => b.addEventListener('click', async () => {
      const u = App.usina(b.dataset.removerUsina);
      if (!confirm(`Remover ${u.nome}? Os valores do resumo e os PDFs desta usina serão apagados.`)) return;
      await api(`/api/usinas/${u.id}`, { method: 'DELETE' }).catch(err => toast(err.message, 'erro'));
      await App.atualizar();
    }));
    const ligarOrdem = (lista, url) => lista.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mover]');
      if (!b) return;
      const li = b.closest('li');
      const irmao = b.dataset.mover === '-1' ? li.previousElementSibling : li.nextElementSibling;
      if (!irmao) return;
      b.dataset.mover === '-1' ? irmao.before(li) : irmao.after(li);
      await api(url, { method: 'POST', body: { ids: [...lista.children].map(x => Number(x.dataset.id)) } });
      await App.atualizar();
    });
    ligarOrdem(corpo.querySelector('#lista-usinas'), '/api/usinas/ordem');
    ligarOrdem(corpo.querySelector('#lista-itens'), '/api/itens/ordem');

    const salvarItem = async (id, campos) => {
      try { await api(`/api/itens/${id}`, { method: 'PATCH', body: campos }); await App.atualizar(); toast('Item atualizado ✓'); } catch (err) { toast(err.message, 'erro'); }
    };
    corpo.querySelectorAll('[data-nome-item]').forEach(inp => inp.addEventListener('change', () => salvarItem(inp.dataset.nomeItem, { nome: inp.value })));
    corpo.querySelectorAll('[data-cat-item]').forEach(s => s.addEventListener('change', () => salvarItem(s.dataset.catItem, { categoria: s.value })));
    corpo.querySelectorAll('[data-destaque]').forEach(b => b.addEventListener('click', () => salvarItem(b.dataset.destaque, { destaque: !b.classList.contains('on') })));
    corpo.querySelectorAll('[data-remover-item]').forEach(b => b.addEventListener('click', async () => {
      const it = App.item(b.dataset.removerItem);
      if (!confirm(`Remover o item “${it.nome}” de todas as usinas?`)) return;
      await api(`/api/itens/${it.id}`, { method: 'DELETE' }).catch(err => toast(err.message, 'erro'));
      await App.atualizar();
    }));
    corpo.querySelector('#novo-item').addEventListener('click', () => abrirModal(`<form class="modal-form" id="f-item">
      <h2>Novo item do resumo</h2>
      <label class="rotulo">Nome <input class="campo" name="nome" required maxlength="200" placeholder="Ex.: Auxílio Dependente"></label>
      <label class="rotulo">Categoria <input class="campo" name="categoria" list="cats" value="Auxílios" maxlength="80"></label>
      <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" name="destaque"> Mostrar no cartão da usina (Panorama)</label>
      <div class="modal-acoes"><button class="btn btn-claro" type="button" data-fechar>Cancelar</button><button class="btn btn-laranja">Criar item</button></div>
    </form>`, (el) => el.querySelector('#f-item').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api('/api/itens', { method: 'POST', body: { ...f, destaque: !!f.destaque } }); modal.close(); await App.atualizar(); } catch (err) { toast(err.message, 'erro'); }
    })));
  }

  function editarUsina(u) {
    const nova = !u;
    u = u || {};
    abrirModal(`<form class="modal-form" id="f-usina">
      <h2>${nova ? 'Nova usina' : `Editar ${esc(u.nome)}`}</h2>
      <label class="rotulo">Nome <input class="campo" name="nome" value="${esc(u.nome || '')}" required maxlength="120"></label>
      <label class="rotulo">Sindicato <input class="campo" name="sindicato" value="${esc(u.sindicato || '')}" maxlength="200"></label>
      <div class="duas">
        <label class="rotulo">Mês da data-base <select class="campo" name="data_base_mes"><option value="">—</option>
          ${App.MESES.map((m, i) => `<option value="${i + 1}" ${u.data_base_mes === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <span></span>
        <label class="rotulo">Início da vigência <input class="campo" type="date" name="vigencia_inicio" value="${esc(u.vigencia_inicio || '')}"></label>
        <label class="rotulo">Fim da vigência <input class="campo" type="date" name="vigencia_fim" value="${esc(u.vigencia_fim || '')}"></label>
      </div>
      <label class="rotulo">Observações <textarea class="campo" name="observacoes" rows="3" maxlength="5000">${esc(u.observacoes || '')}</textarea></label>
      <div class="modal-acoes"><button class="btn btn-claro" type="button" data-fechar>Cancelar</button><button class="btn btn-laranja">Salvar</button></div>
    </form>`, (el) => el.querySelector('#f-usina').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.vigencia_inicio && f.vigencia_fim && f.vigencia_fim < f.vigencia_inicio) return toast('O fim da vigência é anterior ao início.', 'erro');
      try {
        const r = await api(nova ? '/api/usinas' : `/api/usinas/${u.id}`, { method: nova ? 'POST' : 'PATCH', body: f });
        modal.close();
        toast('Usina salva ✓');
        if (nova) { await App.atualizar(); location.hash = `#/usina/${r.id}`; } else await App.atualizar();
      } catch (err) { toast(err.message, 'erro'); }
    }));
  }

  // ---------- PDFs ----------

  function enviarPdf(u) {
    const temAct = App.docsDe(u.id).some(d => d.tipo === 'ACT');
    abrirModal(`<form class="modal-form" id="f-pdf">
      <h2>Enviar PDF · ${esc(u.nome)}</h2>
      <label class="soltar" id="soltar"><input type="file" name="arquivo" accept="application/pdf,.pdf" required>
        <strong>Escolha o PDF</strong><span>ou arraste o arquivo para cá (até 40 MB)</span><em id="arquivo-nome"></em></label>
      <div class="duas">
        <label class="rotulo">Tipo <select class="campo" name="tipo">
          <option value="ACT" ${temAct ? '' : 'selected'}>Acordo Coletivo (ACT)</option>
          <option value="Aditivo" ${temAct ? 'selected' : ''}>Termo Aditivo</option>
          <option value="Outro">Outro documento</option></select></label>
        <label class="rotulo">Vigência <input class="campo" name="vigencia" placeholder="Ex.: 2026-2028" maxlength="40"></label>
      </div>
      <label class="rotulo">Título <input class="campo" name="titulo" placeholder="Ex.: Acordo Coletivo 2026-2028" maxlength="200"></label>
      <p class="fraco">Ao enviar, o texto do PDF é lido para a busca e para os atalhos das cláusulas citadas no resumo. PDFs digitalizados sem texto ficam disponíveis só para leitura.</p>
      <p class="msg" id="pdf-msg"></p>
      <div class="modal-acoes"><button class="btn btn-claro" type="button" data-fechar>Cancelar</button><button class="btn btn-laranja" id="pdf-enviar">Enviar</button></div>
    </form>`, (el) => {
      const form = el.querySelector('#f-pdf');
      const input = form.arquivo;
      const zona = el.querySelector('#soltar');
      const aoEscolher = () => {
        const f = input.files[0];
        el.querySelector('#arquivo-nome').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : '';
        const vig = f?.name.match(/(20\d{2})\s*[-–_]\s*(20\d{2})/);
        if (vig && !form.vigencia.value) form.vigencia.value = `${vig[1]}-${vig[2]}`;
        if (f && /aditivo/i.test(f.name)) form.tipo.value = 'Aditivo';
      };
      input.addEventListener('change', aoEscolher);
      ['dragover', 'dragenter'].forEach(ev => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
      ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove('sobre')));
      zona.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; aoEscolher(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.files[0]) return;
        const fd = new FormData(form);
        if (!fd.get('titulo')) fd.set('titulo', `${{ ACT: 'Acordo Coletivo', Aditivo: 'Termo Aditivo', Outro: 'Documento' }[fd.get('tipo')]} ${fd.get('vigencia') || ''}`.trim());
        const botao = el.querySelector('#pdf-enviar');
        botao.disabled = true;
        el.querySelector('#pdf-msg').textContent = 'Enviando e lendo o texto do PDF…';
        try {
          const r = await api(`/api/usinas/${u.id}/documentos`, { method: 'POST', body: fd });
          modal.close();
          toast(r.paginas_com_texto ? `PDF enviado ✓ ${r.paginas} páginas, ${r.clausulas} cláusulas identificadas` : 'PDF enviado, mas sem texto legível (digitalizado): busca e atalhos não vão funcionar.', r.paginas_com_texto ? '' : 'erro');
          await App.atualizar();
          location.hash = `#/usina/${u.id}?doc=${r.id}`;
        } catch (err) {
          el.querySelector('#pdf-msg').textContent = err.message;
          botao.disabled = false;
        }
      });
    });
  }

  function editarDocumento(d) {
    if (!d) return;
    abrirModal(`<form class="modal-form" id="f-doc">
      <h2>Documento</h2>
      <p class="sub">${esc(d.nome_original || '')} · ${d.paginas} págs. · enviado por ${esc(d.enviado_por || '—')} em ${quando(d.enviado_em)}</p>
      <label class="rotulo">Título <input class="campo" name="titulo" value="${esc(d.titulo)}" maxlength="200" required></label>
      <div class="duas">
        <label class="rotulo">Tipo <select class="campo" name="tipo">${['ACT', 'Aditivo', 'Outro'].map(t => `<option ${t === d.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="rotulo">Vigência <input class="campo" name="vigencia" value="${esc(d.vigencia || '')}" maxlength="40"></label>
      </div>
      <div class="modal-acoes"><button class="btn btn-perigo" type="button" id="doc-remover">Remover PDF</button><span class="esp"></span>
        <button class="btn btn-claro" type="button" data-fechar>Cancelar</button><button class="btn btn-laranja">Salvar</button></div>
    </form>`, (el) => {
      el.querySelector('#f-doc').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api(`/api/documentos/${d.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); modal.close(); await App.atualizar(); } catch (err) { toast(err.message, 'erro'); }
      });
      el.querySelector('#doc-remover').addEventListener('click', async () => {
        if (!confirm(`Remover o PDF “${d.titulo}”? O resumo da usina não é afetado.`)) return;
        try { await api(`/api/documentos/${d.id}`, { method: 'DELETE' }); modal.close(); await App.atualizar(); location.hash = `#/usina/${d.usina_id}`; } catch (err) { toast(err.message, 'erro'); }
      });
    });
  }

  // ---------- importação da planilha ----------

  function telaImportar() {
    const corpo = document.getElementById('admin-corpo');
    corpo.innerHTML = `<section class="cartao importar">
      <div class="passos">
        <div><b>1</b><span>Escolha a planilha (.xlsx) no formato do “Resumo ACT”: itens nas linhas, usinas nas colunas.</span></div>
        <div><b>2</b><span>Confira a prévia: usinas, itens e quantas anotações (comentários das células) foram lidas.</span></div>
        <div><b>3</b><span>Importe. Usinas e itens são reconhecidos pelo nome; os valores da planilha substituem os atuais (com histórico). Os PDFs não são alterados.</span></div>
      </div>
      <label class="soltar"><input type="file" id="arq-planilha" accept=".xlsx,.xls"><strong>Escolher planilha</strong><span>.xlsx</span><em id="planilha-nome"></em></label>
      <div id="previa"></div>
    </section>`;
    corpo.querySelector('#arq-planilha').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      corpo.querySelector('#planilha-nome').textContent = f.name;
      const previa = corpo.querySelector('#previa');
      try {
        const lido = Planilha.ler(XLSX, new Uint8Array(await f.arrayBuffer()));
        const comNota = lido.valores.filter(v => v.nota).length;
        const existentes = new Set(App.E.usinas.map(u => Clausulas.normalizar(u.nome)));
        previa.innerHTML = `<h3>Prévia</h3>
          <div class="kpis kpis-sm">
            <div class="kpi"><strong>${lido.usinas.length}</strong><span>usinas (${lido.usinas.filter(u => !existentes.has(Clausulas.normalizar(u.nome))).length} novas)</span></div>
            <div class="kpi"><strong>${lido.itens.length}</strong><span>itens</span></div>
            <div class="kpi"><strong>${lido.valores.length}</strong><span>valores</span></div>
            <div class="kpi"><strong>${comNota}</strong><span>anotações com cláusula/observação</span></div>
          </div>
          ${lido.avisos.length ? `<ul class="avisos">${lido.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <div class="tabela-rolagem"><table class="tabela tabela-previa"><thead><tr><th>Usina</th><th>Sindicato</th><th>Data-base</th><th>Vigência</th></tr></thead>
          <tbody>${lido.usinas.map(u => `<tr><td><strong>${esc(u.nome)}</strong><small>${esc(u.nome_planilha)}</small></td><td>${esc(u.sindicato)}</td>
            <td>${u.data_base_mes ? App.MESES[u.data_base_mes - 1] : '—'}</td><td>${u.vigencia_inicio ? `${App.fmtData(u.vigencia_inicio)} a ${App.fmtData(u.vigencia_fim)}` : esc(u.vigencia_texto || '—')}</td></tr>`).join('')}</tbody></table></div>
          <button class="btn btn-laranja" id="confirmar-import">Importar ${lido.valores.length} valores</button>`;
        previa.querySelector('#confirmar-import').addEventListener('click', async (ev) => {
          ev.target.disabled = true;
          try {
            const r = await api('/api/importar', { method: 'POST', body: lido });
            toast(`Importado ✓ ${r.usinas_novas} usinas novas, ${r.itens_novos} itens novos, ${r.valores_alterados} valores alterados`);
            await App.atualizar();
            location.hash = '#/comparativo';
          } catch (err) { toast(err.message, 'erro'); ev.target.disabled = false; }
        });
      } catch (err) {
        previa.innerHTML = `<p class="erro-tela">Não foi possível ler a planilha: ${esc(err.message)}</p>`;
      }
    });
  }


  // ---------- envio de vários PDFs de uma vez ----------

  const letras = (t) => Clausulas.normalizar(t).replace(/[^A-Z0-9]/g, '');
  /** Distância de edição (Levenshtein) — para nomes truncados como "Cuiab_" ou "Goi_nia". */
  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  /** Quão bem o nome da usina aparece no texto (0 = não aparece). Tolera 1 letra trocada/faltando (2 em nomes longos). */
  function pontuar(texto, nome) {
    const alvo = letras(nome).replace(/^AMBAR/, '');
    const base = letras(texto);
    if (alvo.length < 3) return 0;
    if (base.includes(alvo)) return 3;
    // Também tenta só a 1ª palavra do nome ("Sta Cruz/RJ" → "STA"? não: só palavras com 4+ letras).
    const partes = [alvo, ...Clausulas.normalizar(nome).split(/[^A-Z]+/).filter(p => p.length >= 5 && p !== 'AMBAR')];
    let melhor = 0;
    for (const p of partes) {
      const tol = p.length >= 8 ? 2 : 1;
      if (p.length < 5) continue;
      for (let L = p.length - tol; L <= p.length + tol; L++) {
        for (let i = 0; i + L <= base.length; i++) {
          if (distancia(base.slice(i, i + L), p) <= tol) { melhor = Math.max(melhor, p === alvo ? 2 : 1); break; }
        }
      }
    }
    return melhor;
  }
  function adivinharUsina(texto) {
    const notas = App.E.usinas.map(u => ({ u, n: Math.max(pontuar(texto, u.nome), u.nome_planilha ? pontuar(texto, u.nome_planilha) : 0) }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (!notas.length || (notas[1] && notas[1].n === notas[0].n)) return null; // nenhuma ou empate: a pessoa escolhe
    return notas[0].u.id;
  }
  async function textoInicial(arquivo) {
    try {
      const lib = await carregarPdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), isEvalSupported: false }).promise;
      let t = '';
      for (let n = 1; n <= Math.min(2, doc.numPages); n++) t += (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' ') + ' ';
      doc.destroy();
      return t;
    } catch { return ''; }
  }

  function telaLote() {
    const corpo = document.getElementById('admin-corpo');
    let linhas = [];
    corpo.innerHTML = `<section class="cartao importar">
      <div class="passos">
        <div><b>1</b><span>Selecione ou arraste todos os PDFs de uma vez (até 40 MB cada).</span></div>
        <div><b>2</b><span>A usina, o tipo e a vigência são sugeridos pelo nome do arquivo ou pela 1ª página do PDF. Confira e ajuste.</span></div>
        <div><b>3</b><span>Envie. Cada PDF é lido para a busca e para os atalhos das cláusulas; o andamento aparece em cada linha.</span></div>
      </div>
      <label class="soltar" id="soltar-lote"><input type="file" id="arq-lote" accept="application/pdf,.pdf" multiple>
        <strong>Escolher PDFs</strong><span>ou arraste os arquivos para cá</span></label>
      <div id="lote"></div>
    </section>`;
    const input = corpo.querySelector('#arq-lote');
    const zona = corpo.querySelector('#soltar-lote');
    ['dragover', 'dragenter'].forEach(ev => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove('sobre')));
    zona.addEventListener('drop', (e) => { e.preventDefault(); adicionar([...e.dataTransfer.files]); });
    input.addEventListener('change', () => { adicionar([...input.files]); input.value = ''; });

    async function adicionar(arquivos) {
      const pdfs = arquivos.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (pdfs.length < arquivos.length) toast(`${arquivos.length - pdfs.length} arquivo(s) ignorado(s): só PDF.`, 'erro');
      for (const f of pdfs) {
        if (linhas.some(l => l.arquivo.name === f.name && l.arquivo.size === f.size)) continue;
        const vig = f.name.match(/(20\d{2})\s*[-–_ ]\s*(20\d{2})/);
        const tipo = /aditivo/i.test(f.name) ? 'Aditivo' : 'ACT';
        linhas.push({ arquivo: f, usina: adivinharUsina(f.name), origem: 'nome', tipo, vigencia: vig ? `${vig[1]}-${vig[2]}` : '', estado: 'pronto' });
      }
      desenhar();
      // Sem pista no nome do arquivo: tenta pelo texto da 1ª página.
      for (const l of linhas.filter(x => !x.usina && x.origem === 'nome')) {
        l.origem = 'texto';
        l.usina = adivinharUsina(await textoInicial(l.arquivo));
        desenhar();
      }
    }

    function desenhar() {
      const alvo = corpo.querySelector('#lote');
      if (!linhas.length) { alvo.innerHTML = ''; return; }
      const enviando = linhas.some(l => l.estado === 'enviando');
      const prontos = linhas.filter(l => l.estado === 'pronto');
      const semUsina = prontos.filter(l => !l.usina).length;
      alvo.innerHTML = `<div class="tabela-rolagem"><table class="tabela tabela-lote">
        <thead><tr><th>Arquivo</th><th>Usina</th><th>Tipo</th><th>Vigência</th><th>Situação</th><th></th></tr></thead>
        <tbody>${linhas.map((l, i) => {
          const bloq = l.estado !== 'pronto' && l.estado !== 'erro';
          const jaTem = l.usina ? App.docsDe(l.usina).length : 0;
          return `<tr data-i="${i}" class="lote-${l.estado}">
          <td><strong>${esc(l.arquivo.name)}</strong><small>${(l.arquivo.size / 1048576).toFixed(1)} MB</small></td>
          <td><select class="campo campo-sm ${l.usina ? '' : 'falta'}" data-campo="usina" ${bloq ? 'disabled' : ''}>
            <option value="">— escolha —</option>${App.E.usinas.map(u => `<option value="${u.id}" ${u.id === l.usina ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>
            ${l.usina && l.estado === 'pronto' ? `<small>${l.origem === 'texto' ? 'sugerida pelo texto do PDF' : 'sugerida pelo nome do arquivo'}${jaTem ? ` · já tem ${jaTem} PDF` : ''}</small>` : ''}</td>
          <td><select class="campo campo-sm" data-campo="tipo" ${bloq ? 'disabled' : ''}>${['ACT', 'Aditivo', 'Outro'].map(t => `<option ${t === l.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td><input class="campo campo-sm" data-campo="vigencia" value="${esc(l.vigencia)}" placeholder="2026-2028" maxlength="40" ${bloq ? 'disabled' : ''}></td>
          <td class="lote-estado">${{ pronto: '<span class="fraco">pronto para enviar</span>', enviando: '<span class="girando"></span> lendo o PDF…',
            ok: `<span class="ok">✓ enviado</span><small>${l.res ? `${l.res.paginas} págs. · ${l.res.clausulas} cláusulas${l.res.paginas_com_texto ? '' : ' · sem texto (digitalizado)'}` : ''}</small>`,
            erro: `<span class="perigo">✕ ${esc(l.erro || 'erro')}</span>` }[l.estado]}</td>
          <td>${bloq ? '' : `<button class="btn btn-fantasma btn-sm" data-tirar="${i}" aria-label="Tirar da lista">✕</button>`}</td></tr>`;
        }).join('')}</tbody></table></div>
        <div class="lote-acoes">
          <span class="fraco">${linhas.length} arquivo(s)${semUsina ? ` · <b class="perigo">${semUsina} sem usina</b>` : ''}</span>
          ${linhas.some(l => l.estado === 'ok') && !enviando ? '<a class="btn btn-claro" href="#/panorama">Ver Panorama</a>' : ''}
          <button class="btn btn-laranja" id="enviar-lote" ${enviando || !prontos.length || semUsina ? 'disabled' : ''}>
            ${enviando ? 'Enviando…' : `Enviar ${prontos.length} PDF${prontos.length === 1 ? '' : 's'}`}</button>
        </div>`;
      alvo.querySelectorAll('[data-campo]').forEach(el => el.addEventListener('change', () => {
        const l = linhas[Number(el.closest('tr').dataset.i)];
        l[el.dataset.campo] = el.dataset.campo === 'usina' ? (Number(el.value) || null) : el.value;
        if (l.estado === 'erro') l.estado = 'pronto';
        desenhar();
      }));
      alvo.querySelectorAll('[data-tirar]').forEach(b => b.addEventListener('click', () => { linhas.splice(Number(b.dataset.tirar), 1); desenhar(); }));
      alvo.querySelector('#enviar-lote')?.addEventListener('click', enviarTodos);
    }

    async function enviarTodos() {
      // Um por vez: cada PDF tem o texto extraído no servidor.
      for (const l of linhas.filter(x => x.estado === 'pronto' && x.usina)) {
        l.estado = 'enviando';
        desenhar();
        const fd = new FormData();
        fd.append('arquivo', l.arquivo);
        fd.append('tipo', l.tipo);
        fd.append('vigencia', l.vigencia);
        fd.append('titulo', `${{ ACT: 'Acordo Coletivo', Aditivo: 'Termo Aditivo', Outro: 'Documento' }[l.tipo]} ${l.vigencia}`.trim());
        try {
          l.res = await api(`/api/usinas/${l.usina}/documentos`, { method: 'POST', body: fd });
          l.estado = 'ok';
        } catch (err) { l.estado = 'erro'; l.erro = err.message; }
        desenhar();
      }
      await App.carregarDados();
      desenhar();
      const ok = linhas.filter(l => l.estado === 'ok').length, erros = linhas.filter(l => l.estado === 'erro').length;
      toast(erros ? `${ok} enviado(s), ${erros} com erro — veja a lista.` : `${ok} PDF(s) enviados ✓`, erros ? 'erro' : '');
    }
  }

  // ---------- histórico ----------

  async function telaHistorico() {
    const corpo = document.getElementById('admin-corpo');
    // As linhas célula a célula de uma importação ficam no histórico de cada valor (gaveta); aqui, só o resumo da importação.
    const lista = (await api('/api/alteracoes?limite=2000')).filter(h => !(h.acao === 'importação' && h.item_id)).slice(0, 500);
    const resumo = (h) => {
      if (h.item) return `<strong>${esc(h.usina || '')} · ${esc(h.item)}</strong> ${h.antes ? `<span class="de">${esc(h.antes.valor || '—')}</span> → ` : ''}<span class="para">${esc(h.depois?.valor || '—')}</span>${h.antes && h.antes.nota !== h.depois?.nota ? ' <em>(anotação)</em>' : ''}`;
      return `${h.usina ? `<strong>${esc(h.usina)}</strong> · ` : ''}${esc(h.descricao || '')}`;
    };
    corpo.innerHTML = `<section class="cartao"><div class="tabela-rolagem"><table class="tabela tabela-hist">
      <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
      <tbody>${lista.length ? lista.map(h => `<tr><td class="fraco">${quando(h.em)}</td><td>${esc(h.usuario || '')}</td><td><span class="acao">${esc(h.acao)}</span></td><td>${resumo(h)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="fraco">Nada registrado ainda.</td></tr>'}</tbody></table></div>
      ${lista.length >= 500 ? '<p class="fraco">Mostrando as 500 alterações mais recentes.</p>' : ''}</section>`;
  }

  window.Admin = { tela, editarUsina, enviarPdf, editarDocumento };
}());
