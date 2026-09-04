(() => {
  'use strict';

  const RELEASE = '91.75';
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
    if (essential && !essential.classList.contains('active')) essential.click();
  }

  function dispatchViewDirect(view) {
    const app = document.querySelector('#app');
    if (!app || (view !== 'home' && view !== 'brief')) return false;

    // Use a short-lived delegated button inside #app instead of re-clicking the
    // visible bottom-nav node. The personalization sheet is frequently rebuilt
    // between pointerdown and click on Android, which made that visible node
    // disappear and lose the navigation event.
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.hidden = true;
    proxy.tabIndex = -1;
    proxy.dataset.view = view;
    app.appendChild(proxy);
    try { proxy.click(); }
    finally { proxy.remove(); }

    if (view === 'brief') openEssentialBrief();
    return true;
  }

  // In Personnaliser/Réglages, navigate on pointerdown through the stable
  // delegated proxy. This is synchronous and survives a sheet re-render.
  document.addEventListener('pointerdown', event => {
    if (!document.querySelector('#app .personalization-sheet')) return;
    const button = event.target.closest?.('.golden-bottom-nav-v9169__side[data-view="home"], .golden-bottom-nav-v9169__side[data-view="brief"]');
    if (!button) return;
    const wanted = button.dataset.view;
    if (wanted !== 'home' && wanted !== 'brief') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchViewDirect(wanted);
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
