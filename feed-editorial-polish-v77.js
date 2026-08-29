(() => {
  'use strict';

  const SEEN_KEY = 'news-seen-v77';
  const CACHE_KEY = 'news-live-cache';
  const upstreamFetch = window.fetch.bind(window);
  const openedThisSession = new Set();
  let scheduled = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function seenIds() {
    return new Set(Object.keys(readJson(SEEN_KEY, {})));
  }

  function applySeenToArticles(articles) {
    if (!Array.isArray(articles)) return articles;
    const seen = seenIds();
    return articles.map(article => {
      if (!seen.has(String(article?.id || ''))) return article;
      return {
        ...article,
        score: -1000000,
        seenHidden: true,
        essential: false,
        essentialRank: 0
      };
    });
  }

  function applySeenToStoredCache() {
    const cache = readJson(CACHE_KEY, null);
    if (!cache || !Array.isArray(cache.articles)) return;
    cache.articles = applySeenToArticles(cache.articles);
    writeJson(CACHE_KEY, cache);
  }

  function transformedResponse(response, payload) {
    if (payload && Array.isArray(payload.articles)) payload.articles = applySeenToArticles(payload.articles);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function seenAwareFetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return transformedResponse(response, payload);
      }
    } catch {}
    return response;
  };

  function isHomeView() {
    return Boolean(document.querySelector('.nav-item.active[data-view="home"]'));
  }

  function savedOnlyActive() {
    const button = document.querySelector('.saved-filter [data-saved-filter]');
    return /voir toute l.actualit/i.test(String(button?.textContent || ''));
  }

  function articleMap() {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    return new Map(articles.map(article => [String(article?.id || ''), article]));
  }

  function beautifyEssentialBanner(page) {
    const banner = page?.querySelector(':scope > .essential-banner-v77');
    if (!banner || banner.dataset.polishedV77 === '1') return;
    banner.dataset.polishedV77 = '1';
    banner.innerHTML = '<span>Essentiel</span><small>Les informations importantes à ne pas manquer</small>';
  }

  function beautifyEssentialCard(card) {
    if (!card?.classList.contains('essential-v77')) return;
    const top = card.querySelector('.card-top');
    if (!top || top.querySelector('.essential-badge-v77')) return;
    const badge = document.createElement('span');
    badge.className = 'essential-badge-v77';
    badge.textContent = 'À ne pas manquer';
    top.prepend(badge);
  }

  function cleanHomeFeed() {
    scheduled = false;
    if (!isHomeView()) return;
    const feed = document.querySelector('.page .feed');
    if (!feed) return;
    const page = feed.closest('.page');
    const savedOnly = savedOnlyActive();
    const map = articleMap();
    const currentSeen = seenIds();

    for (const card of [...feed.querySelectorAll(':scope > .article-card[data-article]')]) {
      const id = String(card.dataset.article || '');
      const article = map.get(id);

      if (!savedOnly && (currentSeen.has(id) || openedThisSession.has(id))) {
        card.remove();
        continue;
      }

      if (article?.essential || card.classList.contains('essential-v77')) beautifyEssentialCard(card);
    }

    beautifyEssentialBanner(page);
  }

  function scheduleClean() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(cleanHomeFeed);
  }

  document.addEventListener('click', event => {
    const card = event.target.closest?.('.article-card[data-article]');
    if (!card || !isHomeView()) return;
    if (event.target.closest?.('.save-btn, .category-link, [data-save]')) return;
    const id = String(card.dataset.article || '');
    if (!id) return;
    openedThisSession.add(id);
    setTimeout(scheduleClean, 120);
  }, true);

  applySeenToStoredCache();

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(scheduleClean).observe(root, { childList: true, subtree: true });
    scheduleClean();
  }, { once: true });

  window.addEventListener('focus', scheduleClean);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleClean(); });
})();
