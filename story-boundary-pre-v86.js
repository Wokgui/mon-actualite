(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const MAX_STORY_GAP = 72 * 60 * 60 * 1000;
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const upstreamFetch = window.fetch.bind(window);

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
    return clean(value).replace(TITLE_MARK_RE, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function bucket(at) {
    return Math.floor(Number(at || 0) / MAX_STORY_GAP);
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    let boundedKeys = 0;
    let markedTitles = 0;
    const articles = payload.articles.map(article => {
      const copy = { ...article };
      const at = publishedAt(copy);
      const key = clean(copy.eventKeyV78 || '');
      if (key && at) {
        copy.eventKeyV78OriginalV86 = copy.eventKeyV78OriginalV86 || key;
        copy.eventKeyV78 = `${key}:v86b${bucket(at)}`.slice(0, 300);
        boundedKeys += 1;
      }
      return copy;
    });

    const byTitle = new Map();
    for (const article of articles) {
      const key = normalize(article.title || '');
      if (!key) continue;
      const list = byTitle.get(key) || [];
      list.push(article);
      byTitle.set(key, list);
    }

    for (const group of byTitle.values()) {
      const times = group.map(publishedAt).filter(Boolean);
      if (times.length < 2 || Math.max(...times) - Math.min(...times) <= MAX_STORY_GAP) continue;
      for (const article of group) {
        const at = publishedAt(article);
        if (!at) continue;
        const original = clean(article.title || '').replace(TITLE_MARK_RE, '');
        article.titleOriginalV86 = article.titleOriginalV86 || original;
        article.title = `${original} [v86b${bucket(at)}]`;
        markedTitles += 1;
      }
    }

    payload.articles = articles;
    payload.stats = { ...(payload.stats || {}), storyBoundaryPrepareV86: true, boundedEventKeysV86: boundedKeys, markedDuplicateTitlesV86: markedTitles };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function storyBoundaryPrepareV86Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return responseFromPayload(response, transformPayload(payload));
      }
    } catch {}
    return response;
  };

  const initial = readJson(CACHE_KEY, null);
  if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, transformPayload(initial));
})();