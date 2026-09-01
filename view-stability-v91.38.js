(() => {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  let allowUntil = Date.now() + 4500;
  let restoringUntil = 0;

  const allowRender = (ms = 4200) => { allowUntil = Math.max(allowUntil, Date.now() + ms); };
  const isAllowed = () => Date.now() <= allowUntil;
  const isRestoring = () => Date.now() <= restoringUntil;
  const startRestore = () => { restoringUntil = Date.now() + 80; };

  function elementNodes(nodes) {
    return [...nodes].filter(node => node?.nodeType === Node.ELEMENT_NODE);
  }

  function findNode(nodes, selector) {
    for (const node of elementNodes(nodes)) {
      if (node.matches?.(selector)) return node;
      const found = node.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  }

  function viewFrom(nodes) {
    const nav = findNode(nodes, '.bottom-nav');
    return nav?.querySelector?.('.nav-item.active[data-view]')?.dataset?.view || '';
  }

  function liveView() {
    return app.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset?.view || '';
  }

  function restoreNodes(target, nodes) {
    const keep = elementNodes(nodes);
    if (!keep.length) return false;
    startRestore();
    target.replaceChildren(...keep);
    return true;
  }

  // Any explicit navigation or control action is allowed to redraw the view.
  // Background refreshes have no pointer/keyboard event and are therefore kept
  // off the visible DOM until the user changes view, preventing image reloads
  // and full-feed flashes while reading.
  document.addEventListener('pointerdown', event => {
    if (event.target.closest?.(
      '[data-view],[data-back],[data-brief-mode],[data-brief-category],' +
      '[data-home-more],[data-saved-filter],[data-refresh],[data-feedback],' +
      '[data-topic-feedback],[data-direct-topic-add],[data-direct-topic-remove],' +
      '[data-general-category],[data-interest],[data-brief-essential],[data-brief-watch],' +
      '[data-dismiss-sheet],[data-close-sheet],[data-open-settings]'
    )) allowRender();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') allowRender(2600);
  }, true);

  const observer = new MutationObserver(records => {
    if (isRestoring() || isAllowed()) return;

    // 1. app.js performs app.innerHTML = ... after every background sync.
    // If the user is still looking at the same Home/Brief view, restore the
    // already-painted page before the browser gets a chance to display the
    // replacement. State/cache still update, so the next navigation uses fresh
    // data without disturbing the current reading position.
    const appRecords = records.filter(record => record.target === app);
    if (appRecords.length) {
      const removed = appRecords.flatMap(record => [...record.removedNodes]);
      const added = appRecords.flatMap(record => [...record.addedNodes]);
      const oldView = viewFrom(removed);
      const newView = viewFrom(added);
      if (oldView && oldView === newView && (oldView === 'home' || oldView === 'brief')) {
        const oldPage = findNode(removed, '.page');
        const newPage = findNode(added, '.page');
        const oldNav = findNode(removed, '.bottom-nav');
        const newNav = findNode(added, '.bottom-nav');
        if (oldPage && newPage?.isConnected) {
          startRestore();
          newPage.replaceWith(oldPage);
          if (oldNav && newNav?.isConnected) newNav.replaceWith(oldNav);
          return;
        }
      }
    }

    const view = liveView();
    if (view !== 'home' && view !== 'brief') return;

    // 2. feedly-runtime rebuilds the Home feed with innerHTML when the cache
    // changes. Its new signature is kept, but the old painted nodes are put
    // back before paint. This prevents all thumbnails from reloading at once.
    if (view === 'home') {
      for (const record of records) {
        const target = record.target;
        if (!(target instanceof Element) || !target.matches('.page .feed')) continue;
        const removed = elementNodes(record.removedNodes);
        const added = elementNodes(record.addedNodes);
        const oldCards = removed.filter(node => node.matches?.('.article-card[data-article]')).length;
        const newCards = added.filter(node => node.matches?.('.article-card[data-article]')).length;
        if (oldCards >= 3 && newCards >= 3) {
          restoreNodes(target, removed);
          return;
        }
      }
    }

    if (view === 'brief') {
      // 3. Preserve Mes veilles when its grouped-by-day markup is refreshed in
      // the background. The dataset signature written by the renderer remains
      // current, so it will not immediately try the same redraw again.
      for (const record of records) {
        const target = record.target;
        if (!(target instanceof Element) || !target.matches('.runtime-brief-content')) continue;
        const removed = elementNodes(record.removedNodes);
        const added = elementNodes(record.addedNodes);
        if (removed.length && added.length) {
          restoreNodes(target, removed);
          return;
        }
      }

      // 4. Preserve the already-visible Essential Brief when feedly-runtime
      // rebuilds its tabs/content because unrelated background articles changed.
      const byPage = new Map();
      for (const record of records) {
        const target = record.target;
        if (!(target instanceof Element) || !target.matches('.page')) continue;
        if (!byPage.has(target)) byPage.set(target, { removed: [], added: [] });
        byPage.get(target).removed.push(...elementNodes(record.removedNodes));
        byPage.get(target).added.push(...elementNodes(record.addedNodes));
      }
      for (const [page, change] of byPage) {
        const oldTabs = findNode(change.removed, '.brief-mode-tabs');
        const oldContent = findNode(change.removed, '.runtime-brief-content');
        const newTabs = findNode(change.added, '.brief-mode-tabs');
        const newContent = findNode(change.added, '.runtime-brief-content');
        if (oldTabs && oldContent && newTabs?.isConnected && newContent?.isConnected) {
          startRestore();
          newTabs.replaceWith(oldTabs);
          newContent.replaceWith(oldContent);
          return;
        }
      }
    }
  });

  observer.observe(app, { childList: true, subtree: true });

  // Expose a small hook so explicit future actions can opt into a redraw.
  window.NewsViewStabilityV9138 = Object.freeze({ allowRender });
})();
