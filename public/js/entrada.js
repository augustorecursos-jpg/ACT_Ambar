// Tela de entrada: se já houver sessão, vai direto ao painel.
api('/api/eu').then(() => location.replace('app.html')).catch(() => {});

const form = document.getElementById('form-entrar');
const msg = document.getElementById('msg');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const dados = Object.fromEntries(new FormData(form));
  if (!dados.email || !dados.senha) { msg.textContent = 'Informe e-mail e senha.'; return; }
  const botao = form.querySelector('button');
  botao.disabled = true;
  try {
    await api('/api/entrar', { method: 'POST', body: dados });
    location.replace('app.html');
  } catch (err) {
    msg.textContent = err.message;
    botao.disabled = false;
  }
});
