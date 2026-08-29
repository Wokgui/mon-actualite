(() => {
  'use strict';

  const SEEN_KEY = 'news-seen-v77';
  const CACHE_KEY = 'news-live-cache';
  const READING_ANCHOR_KEY = 'news-reading-anchor-v85';
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

  function readAnchor() {
    try { return JSON.parse(sessionStorage.getItem(READING_ANCHOR_KEY) || 'null'); }
    catch { return null; }
  }

  function writeAnchor(value) {
    try {
      if (value) sessionStorage.setItem(READING_ANCHOR_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(READING_ANCHOR_KEY);
    } catch {}
  }

  function seenIds() { return new Set(Object.keys(readJson(SEEN_KEY, {}))); }

  function annotateSemanticOrigin(article = {}) {
    const copy = { ...article };
    if (!copy.semanticOriginalCategoryV87) copy.semanticOriginalCategoryV87 = String(copy.category || '').trim();
    return copy;
  }

  function applySeenToArticles(articles) {
    if (!Array.isArray(articles)) return articles;
    const seen = seenIds();
    return articles.map(article => {
      const copy = annotateSemanticOrigin(article || {});
      if (!seen.has(String(copy?.id || ''))) return copy;
      return { ...copy, score: -1000000, seenHidden: true, essential: false, essentialRank: 0 };
    });
  }

  function applySeenToStoredCache() {
    const cache = readJson(CACHE_KEY, null);
    if (!cache || !Array.isArray(cache.articles)) return;
    cache.articles = applySeenToArticles(cache.articles);
    cache.stats = { ...(cache.stats || {}), semanticOriginV87: true };
    writeJson(CACHE_KEY, cache);
  }

  function transformedResponse(response, payload) {
    if (payload && Array.isArray(payload.articles)) {
      payload.articles = applySeenToArticles(payload.articles);
      payload.stats = { ...(payload.stats || {}), semanticOriginV87: true };
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
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

  function isHomeView() { return Boolean(document.querySelector('.nav-item.active[data-view="home"]')); }
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

  function removeWithStablePosition(card, id, anchor) {
    const next = card.nextElementSibling?.matches?.('.article-card[data-article]') ? card.nextElementSibling : null;
    const previous = card.previousElementSibling?.matches?.('.article-card[data-article]') ? card.previousElementSibling : null;
    const reference = next || previous;
    const before = reference?.getBoundingClientRect().top;
    card.remove();
    if (anchor?.id === id && reference && Number.isFinite(before)) {
      const after = reference.getBoundingClientRect().top;
      const delta = after - before;
      if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      writeAnchor(null);
    }
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
    const anchor = readAnchor();
    const modalOpen = Boolean(document.querySelector('.quick-summary-backdrop'));

    for (const card of [...feed.querySelectorAll(':scope > .article-card[data-article]')]) {
      const id = String(card.dataset.article || '');
      const article = map.get(id);
      const shouldHide = !savedOnly && (currentSeen.has(id) || openedThisSession.has(id));
      if (shouldHide) {
        if (modalOpen && anchor?.id === id) continue;
        removeWithStablePosition(card, id, anchor);
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
    if (event.target.closest?.('.save-btn, .category-link, [data-save], [data-why-v85], [data-why-panel-v85]')) return;
    const id = String(card.dataset.article || '');
    if (!id) return;
    const next = card.nextElementSibling?.matches?.('.article-card[data-article]') ? String(card.nextElementSibling.dataset.article || '') : '';
    writeAnchor({ id, nextId: next, cardTop: card.getBoundingClientRect().top, scrollY: window.scrollY, openedAt: Date.now() });
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