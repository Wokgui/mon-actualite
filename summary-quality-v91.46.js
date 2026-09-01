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
    // A raw RSS/page extract is not a final summary for the detail sheet.
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

  function goodGenerated(data = {}) {
    const text = clean(data?.summary || data?.text || '');
    return Boolean(data && data?.ai === true && !data?.unavailable && !truncated(text));
  }

  async function callGenerated(path, body, source) {
    try {
      const response = await baseFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body)
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!goodGenerated(data)) return null;
      const text = clean(data.summary || data.text || '');
      return cloneJsonResponse(response, {
        ...data,
        summary: text,
        text,
        ai: true,
        grounded: true,
        unavailable: false,
        provider: clean(data.provider || data.origin || source),
        reliableSummaryV9146: true,
        reliableSourceV9146: source
      });
    } catch {
      return null;
    }
  }

  async function reliableSummary(body) {
    const article = body?.article && typeof body.article === 'object' ? body.article : {};
    const articleBody = { ...body, mode: 'article', article };

    // 1. Fast generated summary from the best source material available.
    const smart = await callGenerated('/api/article-summary-smart?v=7&intent=foreground', {
      ...articleBody,
      lightweight: true,
      intent: 'foreground'
    }, 'groq-light');
    if (smart) return smart;

    // 2. If the source only exposes a cut-off teaser, reconstruct the event
    // from concordant search results and accept only a generated synthesis.
    return callGenerated('/api/article-summary-multisource?v=91.46&intent=foreground', articleBody, 'groq-multisource');
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

    // Do not turn a cut-off feed teaser into a fake "summary". If both
    // generated paths fail, the UI says that the summary is unavailable.
    return cloneJsonResponse(null, {
      ok: false,
      summary: '',
      text: '',
      ai: false,
      grounded: false,
      unavailable: true,
      provider: 'summary-quality-unavailable-v91.46',
      qualityRejectedV9146: true
    });
  };

  // Old v91.44/v91.45 entries can otherwise be displayed before any network
  // request, so purge non-generated and visibly truncated entries immediately.
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
