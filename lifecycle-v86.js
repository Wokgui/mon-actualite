(() => {
  'use strict';

  const KEY = 'news-lifecycle-anchor-v86';
  let hiddenAt = 0;
  let restoring = false;

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  }

  function write(value) {
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch {}
  }

  function currentView() {
    return document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function topAnchor() {
    const cards = [...document.querySelectorAll('.article-card[data-article]:not([hidden])')];
    const candidate = cards
      .map(card => ({ card, rect: card.getBoundingClientRect() }))
      .filter(item => item.rect.bottom > 0)
      .sort((a, b) => Math.abs(a.rect.top) - Math.abs(b.rect.top))[0];
    if (!candidate) return { id: '', offset: 0 };
    return { id: String(candidate.card.dataset.article || ''), offset: candidate.rect.top };
  }

  function savePosition() {
    const anchor = topAnchor();
    write({ view: currentView(), scrollY: window.scrollY, anchorId: anchor.id, anchorOffset: anchor.offset, at: Date.now() });
  }

  function repairTransientUi() {
    if (!document.querySelector('.quick-summary-backdrop')) document.body.classList.remove('quick-summary-open');
    document.documentElement.classList.remove('nav-switching-v79');
  }

  function restorePosition(reason = '') {
    if (restoring) return;
    const saved = read();
    if (!saved || Date.now() - Number(saved.at || 0) > 6 * 60 * 60 * 1000) return;
    if (saved.view && currentView() && saved.view !== currentView()) return;
    restoring = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      repairTransientUi();
      const card = saved.anchorId ? document.querySelector(`.article-card[data-article="${CSS.escape(String(saved.anchorId))}"]`) : null;
      if (card) {
        const delta = card.getBoundingClientRect().top - Number(saved.anchorOffset || 0);
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
      } else if (Number.isFinite(Number(saved.scrollY))) {
        window.scrollTo({ top: Number(saved.scrollY), behavior: 'instant' });
      }
      document.documentElement.dataset.lifecycleResumeV86 = reason || 'resume';
      setTimeout(() => { restoring = false; }, 120);
    }));
  }

  window.addEventListener('pagehide', savePosition);
  window.addEventListener('pageshow', event => {
    if (event.persisted) setTimeout(() => restorePosition('bfcache'), 30);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      savePosition();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (away > 1500) setTimeout(() => restorePosition('visibility'), 60);
    else repairTransientUi();
  });

  document.addEventListener('freeze', savePosition);
  document.addEventListener('resume', () => setTimeout(() => restorePosition('resume'), 50));
  window.addEventListener('beforeunload', savePosition);
})();