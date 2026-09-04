(() => {
  'use strict';

  const RELEASE = '91.74';
  let settingsDispatch = false;
  document.documentElement.dataset.articleNavigationV9173 = RELEASE;

  function closeQuickSummary() {
    document.querySelector('.quick-summary-backdrop')?.remove();
    document.body.classList.remove('quick-summary-open', 'article-open-v9171');
  }

  function isHomeUnderArticle() {
    return Boolean(document.querySelector('#app [data-stable-home-feed]'));
  }

  function isBriefUnderArticle() {
    return Boolean(document.querySelector('#app [data-stable-brief-content], #app .brief-mode-tabs'));
  }

  function isWatchMode() {
    return Boolean(document.querySelector('#app [data-brief-mode="watches"].active'));
  }

  function openEssentialBrief() {
    const essential = document.querySelector('#app [data-brief-mode="essential"]');
    if (essential) essential.click();
  }

  // In the settings sheet the DOM can be refreshed between touch-down and the
  // browser-generated click. Dispatch the navigation on pointer-down only in
  // this view, so Accueil/Brief reacts immediately and cannot lose the tap.
  document.addEventListener('pointerdown', event => {
    if (settingsDispatch || !document.querySelector('#app .personalization-sheet')) return;
    const button = event.target.closest?.('.golden-bottom-nav-v9169__side[data-view="home"], .golden-bottom-nav-v9169__side[data-view="brief"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    settingsDispatch = true;
    try { button.click(); }
    finally { settingsDispatch = false; }
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.golden-bottom-nav-v9169__side[data-view], .bottom-nav [data-view]');
    if (!button) return;

    const wanted = button.dataset.view;
    if (wanted !== 'home' && wanted !== 'brief') return;

    const quick = document.querySelector('.quick-summary-backdrop');
    if (quick) {
      const homeUnder = isHomeUnderArticle();
      const briefUnder = isBriefUnderArticle();
      const watchUnder = isWatchMode();

      closeQuickSummary();

      if (wanted === 'home' && (homeUnder || briefUnder)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (wanted === 'brief' && briefUnder) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (watchUnder) openEssentialBrief();
        return;
      }

      return;
    }

    const detail = document.querySelector('#app .detail-page');
    if (detail && wanted === 'home') {
      const back = document.querySelector('#app [data-back]');
      if (back) {
        event.preventDefault();
        event.stopImmediatePropagation();
        back.click();
      }
      return;
    }

    if (wanted === 'brief' && isBriefUnderArticle() && isWatchMode()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openEssentialBrief();
    }
  }, true);
})();
