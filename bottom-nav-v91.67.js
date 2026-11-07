(() => {
  'use strict';

  const RELEASE = '91.67';
  let scheduled = false;
  document.documentElement.dataset.bottomNavV9167 = RELEASE;

  const homeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';
  const briefIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';
  const gearIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>';

  function pageState() {
    const sheet = Boolean(document.querySelector('#app .personalization-sheet'));
    const detail = Boolean(document.querySelector('#app .detail-page, #app .quick-summary-backdrop'));
    const home = Boolean(document.querySelector('#app [data-stable-home-feed]'));
    const brief = Boolean(document.querySelector('#app [data-stable-brief-content], #app .brief-mode-tabs'));
    return { sheet, detail, home, brief };
  }

  function centerMarkup() {
    return `<div class="bottom-nav-final__center">
      <svg class="bottom-nav-final__cradle" viewBox="0 0 116 112" aria-hidden="true" focusable="false">
        <g fill="#f1eef8">
          <rect x="36" y="48" width="44" height="62" rx="15"/>
          <path d="M12 43 C26 42 39 48 49 59 C54 64 57 69 59 75 L47 82 C42 70 32 61 20 57 C15 55 12 50 12 43 Z"/>
          <path d="M104 43 C90 42 77 48 67 59 C62 64 59 69 57 75 L69 82 C74 70 84 61 96 57 C101 55 104 50 104 43 Z"/>
        </g>
      </svg>
      <button type="button" class="bottom-nav-final__reset" data-reset-read aria-label="Réinitialiser les articles parcourus" title="Réinitialiser"><span class="bottom-nav-final__reset-glyph" aria-hidden="true">↻</span></button>
      <button type="button" class="bottom-nav-final__gear" data-view="sheet" aria-label="Personnaliser et réglages" title="Réglages">${gearIcon}</button>
    </div>`;
  }

  function rebuild() {
    scheduled = false;
    const nav = document.querySelector('#app .bottom-nav');
    if (!nav) return;

    const state = pageState();
    const centerVisible = (state.home || state.brief) && !state.sheet && !state.detail;
    const signature = `${state.home ? 'h' : ''}${state.brief ? 'b' : ''}${state.sheet ? 's' : ''}${state.detail ? 'd' : ''}${centerVisible ? 'c' : 'x'}`;
    if (nav.classList.contains('bottom-nav-final') && nav.dataset.finalNavSignature === signature && nav.dataset.bottomNavRelease === RELEASE) return;

    nav.className = `bottom-nav bottom-nav-final${centerVisible ? '' : ' bottom-nav-final--simple'}`;
    nav.dataset.finalNavSignature = signature;
    nav.dataset.bottomNavRelease = RELEASE;
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.innerHTML = `
      <svg class="bottom-nav-final__shape" viewBox="0 0 1000 106" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="18" width="998" height="86" rx="43" fill="rgba(255,255,255,.985)" stroke="rgba(224,219,238,.86)" stroke-width="2"/></svg>
      <button type="button" class="nav-item bottom-nav-final__side bottom-nav-final__home ${state.home ? 'active' : ''}" data-view="home" aria-label="Accueil">${homeIcon}<span>Accueil</span></button>
      ${centerVisible ? centerMarkup() : ''}
      <button type="button" class="nav-item bottom-nav-final__side bottom-nav-final__brief ${state.brief ? 'active' : ''}" data-view="brief" aria-label="Brief">${briefIcon}<span>Brief</span></button>`;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(rebuild);
  }

  function start() {
    schedule();
    const app = document.querySelector('#app');
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('news:stable-render', schedule);
    window.addEventListener('pageshow', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
