(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const MAX_AGE_HOURS = 40;
  const MAX_ESSENTIAL = 6;
  const BASE_ESSENTIAL_THRESHOLD = 42;
  const upstreamFetch = window.fetch.bind(window);
  let decorateScheduled = false;

  const CATEGORY_IMPORTANCE = {
    International: 28, Politique: 25, 'Économie': 21, 'Santé': 20,
    'Société': 17, Europe: 16, Environnement: 16, Science: 15,
    'Éducation': 10, Culture: 8, 'Énergie': 10, Automobile: 8,
    Tech: 8, IA: 8, Smartphones: 6, VR: 6
  };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function ageHours(article = {}) {
    const parsed = Date.parse(article.publishedAt || '');
    if (!Number.isFinite(parsed)) return 24;
    return Math.max(0, (Date.now() - parsed) / 3600000);
  }

  function noveltyDelta(article = {}) {
    switch (article.noveltyStateV78) {
      case 'development': return 18;
      case 'new': return 8;
      case 'minor-update': return 4;
      case 'repeat': return -30;
      default: return 0;
    }
  }

  function sourceCount(article = {}) {
    return new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])]
      .map(normalize).filter(Boolean)).size || 1;
  }

  function rankScore(article = {}) {
    const originalCategory = clean(article.semanticOriginalCategoryV78 || article.category || '');
    const semanticCategory = clean(article.category || '');
    const oldPriority = Number(CATEGORY_IMPORTANCE[originalCategory] || 6);
    const newPriority = Number(CATEGORY_IMPORTANCE[semanticCategory] || 6);
    const categoryCorrection = newPriority - oldPriority;
    const corroboration = Math.min(10, Math.max(0, sourceCount(article) - 1) * 3);
    return Number(article.editorialImportance || 0) + categoryCorrection + noveltyDelta(article) + corroboration;
  }

  function qualifiesAsEssential(article, rank) {
    if (rank >= BASE_ESSENTIAL_THRESHOLD) return true;
    if (article.noveltyStateV78 === 'development' && rank >= 34) return true;
    if (sourceCount(article) >= 3 && rank >= 36) return true;
    return false;
  }

  function fallbackWhy(article = {}) {
    if (article.noveltyStateV78 === 'development') return 'Nouveau développement';
    if (article.noveltyStateV78 === 'minor-update') return 'Nouvel élément';
    if (article.noveltyStateV78 === 'repeat') return 'Information déjà connue';
    return article.whyV78 && article.whyV78 !== 'Actualité majeure' ? article.whyV78 : 'Actualité récente';
  }

  function recomputeEssential(articles) {
    if (!Array.isArray(articles)) return [];

    const ranked = articles.map(article => ({ article, rank: rankScore(article) }))
      .filter(item => !item.article.seenHidden)
      .filter(item => item.article.noveltyStateV78 !== 'repeat')
      .filter(item => ageHours(item.article) <= MAX_AGE_HOURS)
      .filter(item => qualifiesAsEssential(item.article, item.rank))
      .sort((a, b) => b.rank - a.rank);

    const selected = [];
    const categoryCounts = new Map();
    const sourceCounts = new Map();

    for (const item of ranked) {
      if (selected.length >= MAX_ESSENTIAL) break;
      const category = clean(item.article.category || 'Autre');
      const source = normalize(item.article.source || 'source');
      if (Number(categoryCounts.get(category) || 0) >= 2) continue;
      if (Number(sourceCounts.get(source) || 0) >= 2) continue;
      selected.push(item);
      categoryCounts.set(category, Number(categoryCounts.get(category) || 0) + 1);
      sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
    }

    const selectedIds = new Map(selected.map((item, index) => [String(item.article.id || ''), index + 1]));

    return articles.map(article => {
      const copy = { ...article };
      const rank = selectedIds.get(String(copy.id || '')) || 0;
      copy.essential = rank > 0;
      copy.essentialRank = rank;
      copy.editorialImportanceV78 = Math.round(rankScore(copy));
      const base = Number.isFinite(Number(copy.editorialBaseScore)) ? Number(copy.editorialBaseScore) : Number(copy.score || 0);
      const noveltyV77 = Number(copy.noveltyScore || 0);
      const seenPenalty = Number(copy.seenPenalty || 0);
      const boost = rank ? Math.max(54, 86 - (rank - 1) * 5) : 0;
      copy.score = Math.round(base + noveltyV77 - seenPenalty + noveltyDelta(copy) + boost);
      copy.whyV78 = rank ? 'Actualité majeure' : fallbackWhy(copy);
      return copy;
    });
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = recomputeEssential(payload.articles);
    payload.stats = {
      ...(payload.stats || {}),
      essentialCount: payload.articles.filter(article => article.essential).length,
      intelligenceV78Final: true,
      essentialVariableV78: true
    };
    return payload;
  }

  function transformedResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(transformPayload(payload)), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function editorialV78Fetch(input, init) {
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

  function cachedArticleMap() {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    return new Map(articles.map(article => [String(article.id || ''), article]));
  }

  function decorateEssentialBoundary() {
    decorateScheduled = false;
    const articleMap = cachedArticleMap();

    document.querySelectorAll('.feed').forEach(feed => {
      const cards = [...feed.querySelectorAll(':scope > .article-card[data-article]')];
      if (!cards.length) {
        feed.querySelector(':scope > .essential-separator-v78')?.remove();
        return;
      }

      for (const card of cards) {
        const article = articleMap.get(String(card.dataset.article || ''));
        if (article) card.classList.toggle('essential-v77', Boolean(article.essential));
      }

      const essentialCount = cards.filter(card => card.classList.contains('essential-v77')).length;
      let separator = feed.querySelector(':scope > .essential-separator-v78');
      const shouldShow = essentialCount > 0 && essentialCount < cards.length;

      if (!shouldShow) {
        separator?.remove();
        return;
      }

      if (!separator) {
        separator = document.createElement('div');
        separator.className = 'essential-separator-v78';
        separator.setAttribute('aria-label', 'Toute l’actualité');
        separator.innerHTML = '<span>Toute l’actualité</span>';
      }

      if (feed.firstElementChild !== separator) feed.insertBefore(separator, feed.firstElementChild);
    });
  }

  function scheduleBoundary() {
    if (decorateScheduled) return;
    decorateScheduled = true;
    requestAnimationFrame(decorateEssentialBoundary);
  }

  const cache = readJson(CACHE_KEY, null);
  if (cache && Array.isArray(cache.articles) && cache.articles.some(article => article?.noveltyStateV78)) {
    cache.articles = recomputeEssential(cache.articles);
    cache.stats = { ...(cache.stats || {}), intelligenceV78Final: true, essentialVariableV78: true };
    writeJson(CACHE_KEY, cache);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(scheduleBoundary).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    scheduleBoundary();
  }, { once: true });

  window.addEventListener('focus', scheduleBoundary);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleBoundary(); });
})();
