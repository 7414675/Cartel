// ── Service Worker Registration ─────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// ── Install Banner ───────────────────────────────────────
(function () {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

  const DISMISSED_KEY = 'pwa-dismissed-v2';
  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

  // Detect iOS including newer iPads that report as Macintosh
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const style = `
    #pwa-banner {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99998;
      background: #7c2d12; color: white;
      padding: 0.85rem 1rem;
      display: flex; align-items: center; gap: 0.75rem;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 0.88rem; direction: rtl;
      box-shadow: 0 -2px 12px rgba(0,0,0,0.25);
      animation: bannerIn 0.35s ease;
    }
    @keyframes bannerIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
    #pwa-banner img { width: 40px; height: 40px; border-radius: 9px; flex-shrink: 0; }
    #pwa-banner .pwa-text { flex: 1; }
    #pwa-banner .pwa-text strong { display: block; font-size: 0.95rem; }
    #pwa-banner .pwa-text span { opacity: 0.85; }
    #pwa-banner .pwa-actions { display: flex; flex-direction: column; gap: 0.35rem; flex-shrink: 0; }
    #pwa-banner .pwa-install {
      background: white; color: #7c2d12; border: none; border-radius: 6px;
      padding: 0.35rem 0.85rem; font-weight: 700; font-size: 0.82rem; cursor: pointer;
    }
    #pwa-banner .pwa-dismiss {
      background: none; border: none; color: rgba(255,255,255,0.7);
      font-size: 0.78rem; cursor: pointer; text-align: center;
    }
    #pwa-banner .pwa-ios-hint {
      font-size: 0.82rem; opacity: 0.9; margin-top: 0.2rem;
      display: flex; align-items: center; gap: 0.3rem;
    }
  `;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, Date.now());
    const b = document.getElementById('pwa-banner');
    if (b) b.remove();
  }

  function showBanner(deferredPrompt) {
    const el = document.createElement('div');
    el.id = 'pwa-banner';

    const iosHint = isIOS
      ? `<div class="pwa-ios-hint">לחץ על 📤 ואז "הוסף למסך הבית"</div>`
      : '';

    const actionBtn = (!isIOS && deferredPrompt)
      ? `<button class="pwa-install" id="pwa-install-btn">הוסף לאפליקציה</button>`
      : '';

    el.innerHTML = `
      <img src="/icon.svg" alt="CarTel" />
      <div class="pwa-text">
        <strong>CarTel</strong>
        <span>שמור אותנו על המסך שלך לגישה מהירה</span>
        ${iosHint}
      </div>
      <div class="pwa-actions">
        ${actionBtn}
        <button class="pwa-dismiss" id="pwa-dismiss-btn">לא עכשיו</button>
      </div>
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = style;
    document.head.appendChild(styleEl);
    document.body.appendChild(el);

    document.getElementById('pwa-dismiss-btn').addEventListener('click', dismiss);

    const installBtn = document.getElementById('pwa-install-btn');
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
    setTimeout(() => showBanner(deferredPrompt), 3000);
  });

  // iOS — show banner after delay (no beforeinstallprompt on iOS)
  if (isIOS) {
    setTimeout(() => showBanner(null), 3000);
  }
})();
