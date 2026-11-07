(() => {
  'use strict';

  const RELEASE = '91.61';
  let scheduled = false;
  document.documentElement.dataset.uxPolishV9161 = RELEASE;

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

  function decorate() {
    scheduled = false;
    neutralizeFloatingResets();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  function start() {
    schedule();
    const app = document.querySelector('#app');
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
    document.addEventListener('news:stable-render', schedule);
    window.addEventListener('pageshow', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
