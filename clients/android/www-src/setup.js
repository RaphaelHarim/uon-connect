'use strict';
// Shown only when the APK was built without an address (clients/server.json empty).
const KEY = 'uon.serverUrl';
const saved = localStorage.getItem(KEY);
if (saved && !location.hash.includes('trocar')) location.replace(saved + '/');

const input = document.getElementById('url');
const err = document.getElementById('err');
const go = document.getElementById('go');
input.value = saved || '';

function normalize(text) {
  let t = text.trim();
  if (!/^[a-z]+:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && !u.username ? u.origin : null;
  } catch {
    return null;
  }
}

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const origin = normalize(input.value);
  if (!origin) {
    err.textContent = 'Endereço inválido. Use o endereço completo, com https://';
    return;
  }
  go.disabled = true;
  go.textContent = 'Verificando…';
  try {
    // Cross-origin (the server has no CORS), so this only proves the address answers over HTTPS.
    await fetch(origin + '/health/live', { mode: 'no-cors', cache: 'no-store' });
    localStorage.setItem(KEY, origin);
    location.replace(origin + '/');
  } catch {
    err.textContent = 'Não encontramos o UON CONNECT neste endereço. Confira com a administração.';
    go.disabled = false;
    go.textContent = 'Continuar';
  }
});
