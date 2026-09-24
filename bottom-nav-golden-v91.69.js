(() => {
  'use strict';

  const RELEASE = '91.82';
  let scheduled = false;
  document.documentElement.dataset.goldenBottomNavV9169 = RELEASE;

  const homeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';
  const briefIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>';
  const gearIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.3"/><path d="M19.2 14.8a1.6 1.6 0 0 0 .32 1.76l.08.08-2.96 2.96-.08-.08a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.96 1.47V21h-3.72v-.33a1.6 1.6 0 0 0-.96-1.47 1.6 1.6 0 0 0-1.76.32l-.08.08-2.96-2.96.08-.08a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-.96H3v-3.72h.33a1.6 1.6 0 0 0 1.47-.96 1.6 1.6 0 0 0-.32-1.76l-.08-.08 2.96-2.96.08.08a1.6 1.6 0 0 0 1.76.32 1.6 1.6 0 0 0 .96-1.47V3h3.72v.33a1.6 1.6 0 0 0 .96 1.47 1.6 1.6 0 0 0 1.76-.32l.08-.08 2.96 2.96-.08.08a1.6 1.6 0 0 0-.32 1.76 1.6 1.6 0 0 0 1.47.96H21v3.72h-.33a1.6 1.6 0 0 0-1.47.96Z"/></svg>';

  function pageState() {
    const sheet = Boolean(document.querySelector('#app .personalization-sheet'));
    const quick = Boolean(document.querySelector('.quick-summary-backdrop'));
    const nativeDetail = Boolean(document.querySelector('#app .detail-page'));
    const detail = quick || nativeDetail;
    const home = Boolean(document.querySelector('#app [data-stable-home-feed]'));
    const brief = Boolean(document.querySelector('#app [data-stable-brief-content], #app .brief-mode-tabs'));
    const watches = Boolean(document.querySelector('#app [data-brief-mode="watches"].active'));
    return { sheet, detail, home, brief, watches };
  }

  function neutralizeFloatingControls() {
    document.querySelectorAll('#app .global-reset-v9154, #app .top-reset-icon-v9138').forEach(button => {
      if (button.closest('.golden-bottom-nav-v9169')) return;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      button.setAttribute('tabindex', '-1');
      button.removeAttribute('data-reset-read');
      button.style.setProperty('display', 'none', 'important');
      button.style.setProperty('visibility', 'hidden', 'important');
      button.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function updateSettingsState(sheet) {
    document.body.classList.toggle('settings-open-v9169', sheet);
    document.body.classList.remove('settings-open-v9162');
    const close = document.querySelector('#app .personalization-sheet .personalize-close');
    if (!close) return;
    close.hidden = true;
    close.setAttribute('aria-hidden', 'true');
    close.setAttribute('tabindex', '-1');
    close.style.setProperty('display', 'none', 'important');
  }

  function centerMarkup() {
    return `<div class="golden-bottom-nav-v9169__center">
      <button type="button" class="golden-bottom-nav-v9169__gear" data-view="sheet" aria-label="Personnaliser et réglages" title="Réglages">${gearIcon}</button>
    </div>`;
  }

  function findNav() {
    return document.querySelector('#app .bottom-nav, #app .golden-bottom-nav-v9169');
  }

  function rebuild() {
    scheduled = false;
    neutralizeFloatingControls();

    const s = pageState();
    updateSettingsState(s.sheet);
    document.body.classList.toggle('article-open-v9171', s.detail);

    const nav = findNav();
    if (!nav) return;

    const centerVisible = (s.home || s.brief) && !s.sheet && !s.detail;
    const signature = `${s.home ? 'h' : ''}${s.brief ? 'b' : ''}${s.watches ? 'w' : ''}${s.sheet ? 's' : ''}${s.detail ? 'd' : ''}${centerVisible ? 'c' : 'x'}`;

    if (nav.classList.contains('golden-bottom-nav-v9169') && nav.dataset.goldenSignature === signature && nav.dataset.goldenRelease === RELEASE) return;

    nav.className = `golden-bottom-nav-v9169${centerVisible ? '' : ' golden-bottom-nav-v9169--simple'}`;
    nav.dataset.goldenSignature = signature;
    nav.dataset.goldenRelease = RELEASE;
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.innerHTML = `
      <button type="button" class="golden-bottom-nav-v9169__side golden-bottom-nav-v9169__home ${s.home && !s.detail ? 'active' : ''}" data-view="home" aria-label="Accueil">${homeIcon}<span>Accueil</span></button>
      ${centerVisible ? centerMarkup() : ''}
      <button type="button" class="golden-bottom-nav-v9169__side golden-bottom-nav-v9169__brief ${s.brief && !s.detail && !s.watches ? 'active' : ''}" data-view="brief" aria-label="Brief">${briefIcon}<span>Brief</span></button>`;
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
