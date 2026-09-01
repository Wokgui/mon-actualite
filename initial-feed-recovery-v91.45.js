(() => {
  'use strict';

  const RELEASE = '91.45';
  const CACHE_KEY = 'news-live-cache';
  const SESSION_KEY = 'news-first-feed-recovery-v9145';
  let timer = null;

  document.documentElement.dataset.initialFeedRecovery = RELEASE;

  function cachedArticleCount() {
    try {
      const payload = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return Array.isArray(payload?.articles) ? payload.articles.length : 0;
    } catch {
      return 0;
    }
  }

  function hasRenderedArticle() {
    return Boolean(document.querySelector('[data-stable-home-feed] [data-article], .article-card[data-article]'));
  }

  function isWaitingScreen() {
    const feed = document.querySelector('[data-stable-home-feed]');
    if (!feed) return false;
    return /Actualisation en cours|nouveaux articles apparaîtront ici/i.test(feed.textContent || '');
  }

  function check() {
    if (hasRenderedArticle()) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    if (!isWaitingScreen() || cachedArticleCount() < 1) return;
    if (sessionStorage.getItem(SESSION_KEY) === '1') return;

    sessionStorage.setItem(SESSION_KEY, '1');
    // app.js persists the fresh payload before refreshing the DOM. If the
    // historical incremental renderer misses the initial empty state, one
    // reload starts directly from that fresh cache and renders the cards.
    setTimeout(() => location.reload(), 120);
  }

  function start() {
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    timer = setInterval(check, 600);
    setTimeout(() => clearInterval(timer), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
