(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
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

  function annotate(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = payload.articles.map(article => {
      const copy = { ...article };
      if (!copy.semanticOriginalCategoryV87) copy.semanticOriginalCategoryV87 = clean(copy.category || '');
      return copy;
    });
    payload.stats = { ...(payload.stats || {}), semanticOriginV87: true };
    return payload;
  }

  function responseFrom(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function semanticOriginV87Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        return responseFrom(response, annotate(await response.clone().json()));
      }
    } catch {}
    return response;
  };

  const initial = readJson(CACHE_KEY, null);
  if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, annotate(initial));
})();