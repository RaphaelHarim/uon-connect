'use strict';
const params = new URLSearchParams(location.search);
const input = document.getElementById('url');
const err = document.getElementById('err');
const go = document.getElementById('go');
input.value = params.get('atual') || '';
err.textContent = params.get('erro') || '';
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  go.disabled = true;
  go.textContent = 'Verificando…';
  err.textContent = '';
  const r = await window.uonSetup.setServer(input.value);
  if (!r.ok) {
    err.textContent = r.message;
    go.disabled = false;
    go.textContent = 'Continuar';
  }
});
