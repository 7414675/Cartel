(async () => {
  try {
    const r = await fetch('/api/admin-check');
    if (!r.ok) return;
    const d = await r.json();
    if (!d.isAdmin) return;
  } catch {
    return;
  }

  const style = document.createElement('style');
  style.textContent = [
    '.admin-float-bar{position:fixed;bottom:0;left:0;right:0;height:52px;',
    'background:#7c2d12;z-index:9999;display:flex;align-items:center;',
    'justify-content:center;gap:.25rem;padding:0 1rem;direction:rtl;}',
    '.admin-float-bar a{color:rgba(255,255,255,.75);text-decoration:none;',
    'padding:.4rem .85rem;border-radius:6px;font-size:.85rem;font-weight:600;',
    'font-family:"Segoe UI",Arial,sans-serif;transition:background .15s,color .15s;',
    'display:flex;align-items:center;gap:.35rem;white-space:nowrap;}',
    '.admin-float-bar a:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.admin-float-bar a.active{background:rgba(255,255,255,.2);color:#fff;}',
  ].join('');
  document.head.appendChild(style);
  document.body.style.paddingBottom = '60px';

  const p = window.location.pathname;
  const isHome     = p === '/' || (p.endsWith('/index.html') && !p.includes('/admin/'));
  const isRegister = p.endsWith('/register.html');
  const isAdmin    = p === '/admin' || p === '/admin/' || p.startsWith('/admin/index');

  const bar = document.createElement('nav');
  bar.className = 'admin-float-bar';

  function link(href, label, active) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (active) a.className = 'active';
    return a;
  }

  bar.appendChild(link('/',              '\uD83C\uDFE0 \u05E9\u05DC\u05D7 \u05D4\u05D5\u05D3\u05E2\u05D4', isHome));
  bar.appendChild(link('/register.html', '\uD83D\uDCDD \u05D4\u05E8\u05E9\u05DE\u05D4',                     isRegister));
  bar.appendChild(link('/admin',         '\u2699\uFE0F \u05E0\u05D9\u05D4\u05D5\u05DC',                     isAdmin));

  document.body.appendChild(bar);
})();
