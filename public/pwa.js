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
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #ea580c; color: white;
      padding: 0.7rem 1rem;
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 0.88rem; direction: rtl;
      box-shadow: 0 2px 12px rgba(0,0,0,0.2);
      -webkit-tap-highlight-color: rgba(0,0,0,0);
    }
    #pwa-bar .pwa-bar-content {
      display: flex; align-items: center; gap: 0.6rem; flex: 1;
    }
    #pwa-bar .pwa-bar-icon {
      font-size: 1.4rem; flex-shrink: 0;
    }
    #pwa-bar .pwa-bar-text {
      font-size: 0.82rem; line-height: 1.4;
    }
    #pwa-bar .pwa-bar-text strong {
      display: block; font-size: 0.9rem;
    }
    #pwa-bar .pwa-bar-text span {
      display: block;
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
    document.body.style.paddingTop = '';
  }

  function showBar(deferredPrompt) {
    const el = document.createElement('div');
    el.id = 'pwa-bar';

    if (isIOS) {
      el.innerHTML = `
        <div class="pwa-bar-content">
          <span class="pwa-bar-icon">
            <svg width="24" height="24" viewBox="0 0 814 1000" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269-317.3 71 0 130.5 46.4 174.9 46.4 42.7 0 109.2-49 192.5-49 31 0 108.2 2.6 168.1 80.6zm-196.6-81.5c31.7-37.5 54.2-89.7 54.2-141.9 0-7.1-.6-14.3-1.9-20.1-51.6 1.9-112.3 34.4-149.3 75.6-28.5 32.4-55.1 84.7-55.1 137.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 46.4 0 102.5-31.1 136.6-70.5z"/></svg>
          </span>
          <div class="pwa-bar-text">
            <strong>iOS — שמור אפליקציה</strong>
            <span>1. לחץ על כפתור השיתוף <strong>📤</strong> בתחתית Safari</span>
            <span>2. בחר <strong>"הוסף למסך הבית"</strong></span>
          </div>
        </div>
        <button class="pwa-bar-close" id="pwa-bar-close">✕</button>
      `;
    } else {
      el.innerHTML = `
        <div class="pwa-bar-content">
          <span class="pwa-bar-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.523 15.341c-.32 0-.633-.014-.94-.04l-1.538 2.785a8.834 8.834 0 01-3.045 0L10.46 15.3a9.05 9.05 0 01-3.893-2.07l-3.124.593A8.948 8.948 0 013 12c0-.618.064-1.22.185-1.8l2.857-1.564a9.05 9.05 0 010-5.271L3.185 1.8A8.948 8.948 0 013 0h18a8.948 8.948 0 01-.185 1.8L17.957 3.365a9.05 9.05 0 010 5.271l2.857 1.563c.121.58.186 1.182.186 1.801 0 .618-.065 1.22-.186 1.8l-3.124-.593a9.05 9.05 0 01-3.167 1.134zM12 7a5 5 0 100 10A5 5 0 0012 7z"/></svg>
          </span>
          <div class="pwa-bar-text">
            <strong>Android — התקן את CarTel</strong>
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
    document.body.insertBefore(el, document.body.firstChild);
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop || 0) + 56) + 'px';

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
