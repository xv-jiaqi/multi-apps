/* CH-305: runs before first paint. Key cardhub:theme = system | light | dark. */
(function () {
  var d = document.documentElement,
    k = 'cardhub:theme',
    m = window.matchMedia('(prefers-color-scheme: dark)');
  function pref() {
    try {
      var v = localStorage.getItem(k);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }
  function apply() {
    var p = pref(),
      dark = p === 'dark' || (p === 'system' && m.matches);
    d.classList.toggle('dark', dark);
    d.style.colorScheme = dark ? 'dark' : 'light';
    var t = document.querySelector('meta[name="theme-color"]');
    if (t) t.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
  }
  apply();
  m.addEventListener('change', function () {
    if (pref() === 'system') apply();
  });
  window.__cardhubApplyTheme = apply;
})();
