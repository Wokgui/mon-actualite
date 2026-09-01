(() => {
  'use strict';

  const RELEASE = '91.46';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const baseFetch = window.fetch.bind(window);

  document.documentElement.dataset.summaryQualityForeground = RELEASE;

  function clean(value = '') {
    return String(value ?? '')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&hellip;/gi, '…')
      .replace(/\uFFFD+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); }
    catch { return null; }
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function truncated(value = '') {
    const text = clean(value);
    if (!text || text.length < 55) return true;
    if (/(?:\.{3}|…|\.\.\.)\s*[»”"']?\s*$/.test(text)) return true;
    if (/[-–—,:;\/(]\s*$/.test(text)) return true;
    if (/\b(?:lire la suite|read more|en savoir plus)\s*[.!…]*$/i.test(text)) return true;
    if (/résumé (?:ia )?(?:momentanément )?indisponible/i.test(text)) return true;
    return false;
  }

  function cacheEntryBad(entry = {}) {
    const text = clean(entry?.summary || '');
    if (truncated(text)) return true;
    // The detail sheet must contain an actual generated summary, not a raw
    // RSS/page excerpt that was merely marked as grounded upstream.
    if (entry?.ai !== true) return true;
    return false;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function writeCache(cache) {
    try { localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function evictBadCache(targetId = '') {
    const cache = readCache();
    let changed = false;
    for (const [key, entry] of Object.entries(cache)) {
      if (targetId && key !== `article:${targetId}`) continue;
      if (!cacheEntryBad(entry)) continue;
      delete cache[key];
      changed = true;
    }
    if (changed) writeCache(cache);
    return changed;
  }

  function cloneJsonResponse(response, payload) {
    const headers = new Headers(response?.headers || {});
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(payload), {
      status: response?.status && response.status >= 200 && response.status < 300 ? response.status : 200,
      statusText: response?.statusText || 'OK',
      headers
    });
  }

  function goodReliable(data = {}) {
    const text = clean(data?.summary || data?.text || '');
    return Boolean(data && data?.ai === true && !data?.unavailable && !truncated(text));
  }

  async function reliableSummary(body, originalResponse = null) {
    try {
      const response = await baseFetch('/api/article-summary-reliable?v=91.46&intent=foreground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ ...body, mode: 'article' })
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!goodReliable(data)) return null;
      const text = clean(data.summary || data.text || '');
      return cloneJsonResponse(originalResponse || response, {
        ...data,
        summary: text,
        text,
        ai: true,
        grounded: true,
        unavailable: false,
        reliableSummaryV9146: true
      });
    } catch {
      return null;
    }
  }

  window.fetch = async function summaryQualityForegroundFetch(input, init) {
    const url = requestUrl(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const sameOrigin = Boolean(url && url.origin === location.origin);
    const isForegroundGroq = sameOrigin
      && method === 'POST'
      && url.pathname === '/api/article-summary-groq'
      && url.searchParams.get('intent') === 'foreground';

    if (!isForegroundGroq) return baseFetch(input, init);

    const body = parseBody(init) || {};
    const article = body?.article && typeof body.article === 'object' ? body.article : {};
    if (article?.id) evictBadCache(String(article.id));

    const reliable = await reliableSummary(body);
    if (reliable) return reliable;

    // Last resort: keep the existing request path, but never allow an obvious
    // truncated/placeholder response to be treated as a valid summary.
    const response = await baseFetch(input, init);
    try {
      const data = await response.clone().json();
      const text = clean(data?.summary || data?.text || '');
      if (data?.ai === true && !data?.unavailable && !truncated(text)) return response;
      return cloneJsonResponse(response, {
        ...data,
        summary: '',
        text: '',
        ai: false,
        grounded: false,
        unavailable: true,
        provider: data?.provider || 'summary-quality-rejected-v91.46',
        qualityRejectedV9146: true
      });
    } catch {
      return response;
    }
  };

  // Clean old v91.44/v91.45 entries immediately. This is important because
  // article-quickview reads the cache before issuing any network request.
  evictBadCache();

  document.addEventListener('pointerdown', event => {
    const card = event.target.closest?.('[data-article]');
    if (!card) return;
    evictBadCache(String(card.dataset.article || ''));
  }, true);

  document.addEventListener('click', event => {
    const card = event.target.closest?.('[data-article]');
    if (!card) return;
    evictBadCache(String(card.dataset.article || ''));
  }, true);

  window.addEventListener('news:ai-summary-ready', event => {
    const id = String(event?.detail?.id || '');
    setTimeout(() => evictBadCache(id), 0);
  });

  window.addEventListener('focus', () => evictBadCache());
})();
