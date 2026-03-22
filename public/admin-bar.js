(async () => {
  try {
    const r = await fetch('/api/me');
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
    '.admin-float-bar button.bar-btn{background:none;border:none;cursor:pointer;',
    'color:rgba(255,255,255,.75);padding:.4rem .85rem;border-radius:6px;font-size:.85rem;',
    'font-weight:600;font-family:"Segoe UI",Arial,sans-serif;transition:background .15s,color .15s;',
    'display:flex;align-items:center;gap:.35rem;white-space:nowrap;}',
    '.admin-float-bar button.bar-btn:hover{background:rgba(255,255,255,.12);color:#fff;}',
    '.admin-float-bar button.bar-btn.active{background:rgba(255,255,255,.2);color:#fff;}',
    // Mobile preview styles
    'body.mobile-preview{display:flex;justify-content:center;background:#374151 !important;}',
    'body.mobile-preview>*:not(.admin-float-bar):not(#mobile-preview-shell){display:none !important;}',
    '#mobile-preview-shell{width:390px;min-height:100vh;background:#fff;',
    'box-shadow:0 0 0 1px #6b7280,0 8px 40px rgba(0,0,0,.5);',
    'position:relative;overflow:hidden;flex-shrink:0;}',
    '#mobile-preview-shell iframe{width:390px;height:calc(100vh - 52px);border:none;display:block;}',
  ].join('');
  document.head.appendChild(style);
  document.body.style.paddingBottom = '60px';

  const p = window.location.pathname;
  const isHome     = p === '/' || (p.endsWith('/index.html') && !p.includes('/admin/'));
  const isRegister = p.endsWith('/register.html');
  const isAdmin    = p === '/admin' || p === '/admin/' || p.startsWith('/admin/index');

  // Inject dashboard icon into header nav
  const headerNav = document.querySelector('.header-nav');
  if (headerNav) {
    const adminLink = document.createElement('a');
    adminLink.href = '/admin';
    adminLink.className = 'header-icon';
    adminLink.title = 'לוח בקרה';
    adminLink.textContent = '📊';
    headerNav.insertBefore(adminLink, headerNav.firstChild);
  }

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

  // Mobile preview toggle
  const MOBILE_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
  const DESKTOP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

  const mobileBtn = document.createElement('button');
  mobileBtn.className = 'bar-btn';
  mobileBtn.title = 'תצוגה מקדימה למובייל';
  mobileBtn.innerHTML = MOBILE_SVG + ' \u05DE\u05D5\u05D1\u05D9\u05D9\u05DC'; // מובייל

  let mobileMode = false;
  let shell = null;

  mobileBtn.addEventListener('click', () => {
    mobileMode = !mobileMode;
    if (mobileMode) {
      mobileBtn.innerHTML = DESKTOP_SVG + ' \u05D3\u05E1\u05E7\u05D8\u05D5\u05E4'; // דסקטופ
      mobileBtn.classList.add('active');
      shell = document.createElement('div');
      shell.id = 'mobile-preview-shell';
      const iframe = document.createElement('iframe');
      iframe.src = window.location.href;
      shell.appendChild(iframe);
      document.body.classList.add('mobile-preview');
      document.body.appendChild(shell);
    } else {
      mobileBtn.innerHTML = MOBILE_SVG + ' \u05DE\u05D5\u05D1\u05D9\u05D9\u05DC';
      mobileBtn.classList.remove('active');
      document.body.classList.remove('mobile-preview');
      if (shell) { shell.remove(); shell = null; }
    }
  });

  bar.appendChild(mobileBtn);
  document.body.appendChild(bar);
})();
