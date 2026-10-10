(() => {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  let safeLoading = false;

  function activeView() {
    return app.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function activeBriefMode() {
    return app.querySelector('.brief-mode-tab.active[data-brief-mode]')?.dataset.briefMode || '';
  }

  function isAlreadyActive(control) {
    const view = control?.dataset?.view || '';
    if (view) return view === activeView();
    const mode = control?.dataset?.briefMode || '';
    return Boolean(mode && activeView() === 'brief' && mode === activeBriefMode());
  }

  function firstVisibleAnchor() {
    const cards = [...app.querySelectorAll('.page .feed > .article-card[data-article]')];
    const item = cards
      .map(card => ({ card, rect: card.getBoundingClientRect() }))
      .filter(x => x.rect.bottom > 72)
      .sort((a, b) => Math.abs(a.rect.top - 72) - Math.abs(b.rect.top - 72))[0];
    return item ? {
      id: String(item.card.dataset.article || ''),
      top: item.rect.top,
      scrollY: window.scrollY
    } : { id: '', top: 0, scrollY: window.scrollY };
  }

  function restoreAnchor(anchor) {
    if (!anchor) return;
    if (anchor.id) {
      const card = app.querySelector(`.article-card[data-article="${CSS.escape(anchor.id)}"]`);
      if (card) {
        const delta = card.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
        return;
      }
    }
    if (Number.isFinite(anchor.scrollY)) window.scrollTo(0, anchor.scrollY);
  }

  function neutralizeClone(clone) {
    clone.removeAttribute('id');
    clone.dataset.safeLoadClone = '1';
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.querySelectorAll('[data-article],[data-view],[data-brief-mode],[data-home-more],[data-watch-all-toggle],[data-watch-edit-open]').forEach(node => {
      node.removeAttribute('data-article');
      node.removeAttribute('data-view');
      node.removeAttribute('data-brief-mode');
      node.removeAttribute('data-home-more');
      node.removeAttribute('data-watch-all-toggle');
      node.removeAttribute('data-watch-edit-open');
    });
  }

  function snapshotViewport() {
    const overlay = document.createElement('div');
    overlay.className = 'safe-load-overlay-v91388';
    const clone = app.cloneNode(true);
    neutralizeClone(clone);
    clone.classList.add('safe-load-clone-v91388');
    clone.style.top = `${-window.scrollY}px`;
    overlay.appendChild(clone);
    document.body.appendChild(overlay);
    return overlay;
  }

  function safeReplayLoadMore(button) {
    if (safeLoading || !button?.isConnected) return;
    safeLoading = true;

    const anchor = firstVisibleAnchor();
    const beforeCount = app.querySelectorAll('.page .feed > .article-card[data-article]').length;
    const overlay = snapshotViewport();

    button.dataset.safeLoadReplayV91388 = '1';
    requestAnimationFrame(() => {
      try { button.click(); } catch {}
      setTimeout(() => { try { delete button.dataset.safeLoadReplayV91388; } catch {} }, 0);
    });

    [0, 40, 90, 160, 280, 480].forEach(ms => setTimeout(() => restoreAnchor(anchor), ms));

    const started = performance.now();
    let stableFrames = 0;
    function settle() {
      const nowCount = app.querySelectorAll('.page .feed > .article-card[data-article]').length;
      const grew = nowCount > beforeCount || !button.isConnected;
      if (grew) stableFrames += 1;
      else stableFrames = 0;
      if (stableFrames >= 2 || performance.now() - started > 900) {
        restoreAnchor(anchor);
        overlay.remove();
        safeLoading = false;
        return;
      }
      requestAnimationFrame(settle);
    }
    requestAnimationFrame(settle);
  }

  // A gesture that begins over the already-active bottom tab must remain a
  // scroll gesture. Do not let later compatibility scripts start a transition.
  window.addEventListener('pointerdown', event => {
    const control = event.target.closest?.('[data-view],[data-brief-mode]');
    if (control && isAlreadyActive(control)) event.stopImmediatePropagation();
  }, true);

  // Pressing the already active tab must be a no-op. This prevents a complete
  // Home/Brief render and an unwanted jump back to the top.
  window.addEventListener('click', event => {
    const control = event.target.closest?.('[data-view],[data-brief-mode]');
    if (control && isAlreadyActive(control)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const more = event.target.closest?.('[data-home-more]');
    if (!more || event.isTrusted || more.dataset.safeLoadReplayV91388 === '1') return;

    // feedly-continuous triggers this programmatically near the end of the
    // viewport. Replace the raw full rerender by an anchored, covered rerender.
    event.preventDefault();
    event.stopImmediatePropagation();
    safeReplayLoadMore(more);
  }, true);

  const style = document.createElement('style');
  style.textContent = `
    .safe-load-overlay-v91388{position:fixed;z-index:10080;inset:0;overflow:hidden;background:#fbfaff;pointer-events:none}
    .safe-load-clone-v91388{position:absolute!important;left:0;right:0;width:100%;min-height:100vh}
  `;
  document.head.appendChild(style);
})();
