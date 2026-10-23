// Applies the saved theme before the first paint (external file: the CSP forbids inline scripts).
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('uon-theme') || 'system';
  } catch {
    pref = 'system';
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
