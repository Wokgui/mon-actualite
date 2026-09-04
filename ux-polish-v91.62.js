(() => {
  'use strict';

  const RELEASE = '91.67';
  let scheduled = false;
  document.documentElement.dataset.uxPolishV9162 = RELEASE;

  function ensureBottomNavAssets() {
    if (!document.querySelector('link[data-bottom-nav-v9167]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'bottom-nav-v91.67.css?v=91.67';
      link.dataset.bottomNavV9167 = '1';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-bottom-nav-v9167]')) {
      const script = document.createElement('script');
      script.src = 'bottom-nav-v91.67.js?v=91.67';
      script.dataset.bottomNavV9167 = '1';
      document.head.appendChild(script);
    }
  }

  function neutralizeFloatingResets() {
    document.querySelectorAll('#app .global-reset-v9154, #app .top-reset-icon-v9138').forEach(button => {
      if (button.closest('.bottom-nav')) return;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      button.setAttribute('tabindex', '-1');
      button.removeAttribute('data-reset-read');
      button.style.setProperty('display', 'none', 'important');
      button.style.setProperty('visibility', 'hidden', 'important');
      button.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function decorateSettingsState() {
    const sheet = document.querySelector('#app .personalization-sheet');
    document.body.classList.toggle('settings-open-v9162', Boolean(sheet));
    if (!sheet) return;
    const close = sheet.querySelector('.personalize-close');
    if (close) {
      close.hidden = true;
      close.setAttribute('aria-hidden', 'true');
      close.setAttribute('tabindex', '-1');
    }
  }

  function decorate() {
    scheduled = false;
    neutralizeFloatingResets();
    decorateSettingsState();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  function start() {
    ensureBottomNavAssets();
    schedule();
    const app = document.querySelector('#app');
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
    document.addEventListener('news:stable-render', schedule);
    window.addEventListener('pageshow', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
