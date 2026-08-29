(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const upstreamFetch = window.fetch.bind(window);

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function cleanArticle(article = {}) {
    const copy = { ...article };
    if (copy.titleOriginalV86) copy.title = copy.titleOriginalV86;
    else copy.title = String(copy.title || '').replace(TITLE_MARK_RE, '').trim();
    if (copy.eventKeyV78OriginalV86) copy.eventKeyV78 = copy.eventKeyV78OriginalV86;
    delete copy.titleOriginalV86;
    delete copy.eventKeyV78OriginalV86;
    return copy;
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = payload.articles.map(cleanArticle);
    payload.stats = { ...(payload.stats || {}), storyBoundaryV86: true };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function storyBoundaryCleanV86Fetch(input, init) {
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