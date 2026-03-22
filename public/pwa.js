// ── Service Worker Registration ─────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// ── Install Bar ──────────────────────────────────────────
(function () {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

  const DISMISSED_KEY = 'pwa-dismissed-v3';
  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (dismissed && Date.now() - parseInt(dismissed) < 30 * 24 * 60 * 60 * 1000) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const style = `
    #pwa-bar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
      background: #ea580c; color: white;
      padding: 0.7rem 1rem;
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 0.88rem; direction: rtl;
      box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
    }
    #pwa-bar .pwa-bar-content {
      display: flex; align-items: center; gap: 0.6rem; flex: 1;
    }
    #pwa-bar .pwa-bar-icon {
      font-size: 1.4rem; flex-shrink: 0;
    }
    #pwa-bar .pwa-bar-text {
      font-size: 0.85rem; line-height: 1.3;
    }
    #pwa-bar .pwa-bar-text strong {
      display: block; font-size: 0.9rem;
    }
    #pwa-bar .pwa-bar-btn {
      background: white; color: #ea580c; border: none; border-radius: 7px;
      padding: 0.4rem 0.9rem; font-weight: 700; font-size: 0.85rem;
      cursor: pointer; flex-shrink: 0; font-family: inherit;
      display: flex; align-items: center; gap: 0.3rem;
    }
    #pwa-bar .pwa-bar-close {
      background: none; border: none; color: rgba(255,255,255,0.7);
      font-size: 1.1rem; cursor: pointer; padding: 0 0.25rem; line-height: 1;
      flex-shrink: 0;
    }
  `;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, Date.now());
    const b = document.getElementById('pwa-bar');
    if (b) b.remove();
    document.body.style.paddingBottom = '';
  }

  function showBar(deferredPrompt) {
    const el = document.createElement('div');
    el.id = 'pwa-bar';

    if (isIOS) {
      el.innerHTML = `
        <div class="pwa-bar-content">
          <span class="pwa-bar-icon"></span>
          <div class="pwa-bar-text">
            <strong>הוסף למסך הבית</strong>
            <span>לחץ על <strong>📤</strong> ואז "הוסף למסך הבית"</span>
          </div>
        </div>
        <button class="pwa-bar-close" id="pwa-bar-close">✕</button>
      `;
    } else {
      el.innerHTML = `
        <div class="pwa-bar-content">
          <span class="pwa-bar-icon">🤖</span>
          <div class="pwa-bar-text">
            <strong>התקן את CarTel</strong>
            <span>גישה מהירה מהמסך הראשי</span>
          </div>
        </div>
        <button class="pwa-bar-btn" id="pwa-bar-install">התקן ↓</button>
        <button class="pwa-bar-close" id="pwa-bar-close">✕</button>
      `;
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = style;
    document.head.appendChild(styleEl);
    document.body.appendChild(el);
    document.body.style.paddingBottom = '60px';

    document.getElementById('pwa-bar-close').addEventListener('click', dismiss);

    const installBtn = document.getElementById('pwa-bar-install');
    if (installBtn && deferredPrompt) {
      installBtn.addEventListener('click', async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') dismiss();
      });
    }
  }

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    showBar(deferredPrompt);
  });

  if (isIOS) {
    showBar(null);
  }
})();
