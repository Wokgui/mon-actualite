(() => {
  'use strict';

  const GREY_KEY = 'news-grey-after-scroll-v9138-v1';
  const greyIds = new Set();
  const observed = new WeakSet();
  let queued = false;
  let lastScrollY = window.scrollY;
  let lastDirectionDown = false;

  function readGrey() {
    try {
      const raw = JSON.parse(localStorage.getItem(GREY_KEY) || '[]');
      if (Array.isArray(raw)) raw.forEach(id => greyIds.add(String(id)));
    } catch {}
  }

  function persistGrey() {
    try { localStorage.setItem(GREY_KEY, JSON.stringify([...greyIds].slice(-1200))); } catch {}
  }

  function homeActive() {
    return Boolean(document.querySelector('.bottom-nav .nav-item.active[data-view="home"]'));
  }

  function homeCards() {
    return [...document.querySelectorAll('.page .feed > .article-card[data-article]')];
  }

  const visibilityObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= .55) entry.target.dataset.greyEligibleV9138 = '1';
    }
  }, { threshold: [0, .25, .55, .8] });

  function bindCards() {
    for (const card of homeCards()) {
      if (observed.has(card)) continue;
      observed.add(card);
      visibilityObserver.observe(card);
    }
  }

  function syncGreyClasses() {
    if (!homeActive()) return;
    for (const card of homeCards()) {
      const id = String(card.dataset.article || '');
      card.classList.toggle('read-passed-v9138', Boolean(id && greyIds.has(id)));
    }
  }

  function greyCardsPassedUpward() {
    if (!homeActive() || !lastDirectionDown || document.querySelector('.quick-summary-backdrop')) return;
    const threshold = Math.min(72, Math.max(24, window.innerHeight * .06));
    let changed = false;
    for (const card of homeCards()) {
      if (card.dataset.greyEligibleV9138 !== '1') continue;
      const rect = card.getBoundingClientRect();
      if (rect.bottom > threshold || rect.top >= 0) continue;
      const id = String(card.dataset.article || '');
      if (!id || greyIds.has(id)) continue;
      greyIds.add(id);
      card.classList.add('read-passed-v9138');
      changed = true;
    }
    if (changed) persistGrey();
  }

  function ensureResetButton() {
    let button = document.querySelector('[data-grey-reset-v9138]');
    if (!homeActive()) {
      if (button) button.hidden = true;
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'grey-reset-v9138';
      button.dataset.greyResetV9138 = '1';
      button.textContent = 'Réinitialiser';
      button.setAttribute('aria-label', 'Dégriser tous les articles');
      document.body.appendChild(button);
    }
    button.hidden = false;
  }

  function resetGrey() {
    greyIds.clear();
    persistGrey();
    for (const card of homeCards()) {
      card.classList.remove('read-passed-v9138');
      delete card.dataset.greyEligibleV9138;
    }
    // A reset defines a new reading pass: articles already above the viewport
    // must not become grey again until they have been seen on screen once more.
    lastDirectionDown = false;
    lastScrollY = window.scrollY;
  }

  function refresh() {
    queued = false;
    bindCards();
    greyCardsPassedUpward();
    syncGreyClasses();
    ensureResetButton();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(refresh);
  }

  readGrey();

  const style = document.createElement('style');
  style.id = 'read-grey-reset-v9138-style';
  style.textContent = `
    .grey-reset-v9138{
      position:fixed;
      z-index:10020;
      top:max(7px, env(safe-area-inset-top));
      left:50%;
      transform:translateX(-50%);
      min-height:30px;
      padding:6px 13px;
      border:1px solid rgba(99,82,181,.16);
      border-radius:999px;
      background:rgba(250,249,253,.94);
      color:#6758b7;
      box-shadow:0 2px 10px rgba(45,36,70,.08);
      backdrop-filter:blur(8px);
      font:800 10.5px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      white-space:nowrap;
    }
    .grey-reset-v9138:active{transform:translateX(-50%) scale(.97)}
  `;
  document.head.appendChild(style);

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-grey-reset-v9138]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    resetGrey();
  }, true);

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > lastScrollY + 1) lastDirectionDown = true;
    else if (y < lastScrollY - 1) lastDirectionDown = false;
    lastScrollY = y;
    schedule();
  }, { passive: true });

  const app = document.getElementById('app');
  if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  // The older compatibility script can still add its grey class from the old
  // seen-history key. Strip that class unless this new scroll-only state owns it.
  if (app) new MutationObserver(schedule).observe(app, { attributes: true, subtree: true, attributeFilter: ['class'] });

  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  setTimeout(schedule, 0);
  setTimeout(schedule, 300);
})();
