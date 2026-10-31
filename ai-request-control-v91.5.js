(() => {
  'use strict';

  const CONTROLLED_PATHS = new Set([
    '/api/article-summary-groq',
    '/api/article-summary-multisource',
    '/api/article-story-intelligence'
  ]);
  const SMART_PATH = '/api/article-summary-smart';
  const MAX_CONCURRENT = 1;
  const DEDUPE_TTL_MS = 20_000;
  const SMART_RESULT_TTL_MS = 30_000;
  const PARISIEN_GRACE_MS = 2_200;
  const RELEASE_DELAY_MS = 120;
  const root = typeof window !== 'undefined' ? window : globalThis;
  const upstreamFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

  const queue = [];
  const inflight = new Map();
  const smartResults = new Map();
  let active = 0;
  let sequence = 0;
  let deduped = 0;
  let completed = 0;
  let parisienGroqAvoided = 0;
  let pumpScheduled = false;

  function clean(value = '') {
    return String(value ?? '').trim();
  }

  function requestMethod(input, init) {
    return String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  }

  function requestUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      return new URL(raw, location.href);
    } catch {
      return null;
    }
  }

  function bodyFingerprint(init = {}) {
    if (typeof init?.body === 'string') return init.body;
    if (typeof URLSearchParams !== 'undefined' && init?.body instanceof URLSearchParams) return init.body.toString();
    return '';
  }

  function parsedBody(init = {}) {
    try {
      return typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      return null;
    }
  }

  function articleFromBody(init = {}) {
    const body = parsedBody(init);
    return body?.article && typeof body.article === 'object' ? body.article : null;
  }

  function articleKey(article = {}) {
    const url = clean(article.url || '').toLowerCase();
    const title = clean(article.title || '').toLowerCase().replace(/\s+/g, ' ');
    return url || title ? `${url}|${title}` : '';
  }

  function isParisienArticle(article = {}) {
    const source = clean(article.source || '');
    if (/\ble\s+parisien\b/i.test(source)) return true;
    try {
      const host = new URL(clean(article.url || ''), location.href).hostname.toLowerCase();
      return host === 'leparisien.fr' || host.endsWith('.leparisien.fr');
    } catch {
      return false;
    }
  }

  function requestPriority(pathname = '') {
    if (pathname === '/api/article-summary-groq') return 0;
    if (pathname === '/api/article-summary-multisource') return 1;
    return 2;
  }

  function stats() {
    return {
      version: '91.5',
      active,
      queued: queue.length,
      deduped,
      completed,
      parisienGroqAvoided,
      maxConcurrent: MAX_CONCURRENT
    };
  }

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => {
      pumpScheduled = false;
      pump();
    }, 0);
  }

  function pump() {
    if (!upstreamFetch || active >= MAX_CONCURRENT || !queue.length) return;
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    const job = queue.shift();
    if (!job) return;

    active += 1;
    Promise.resolve()
      .then(() => upstreamFetch(job.input, job.init))
      .then(job.resolve, job.reject)
      .finally(() => {
        active = Math.max(0, active - 1);
        completed += 1;
        setTimeout(pump, RELEASE_DELAY_MS);
      });
  }

  function enqueue(input, init, priority) {
    return new Promise((resolve, reject) => {
      queue.push({ input, init, priority, sequence: sequence += 1, resolve, reject });
      schedulePump();
    });
  }

  function cloneResponse(promise) {
    return promise.then(response => response?.clone ? response.clone() : response);
  }

  function rememberSmartResponse(init, response) {
    const article = articleFromBody(init);
    const key = articleKey(article || {});
    if (!key || !response?.ok) return;
    response.clone().json().then(data => {
      const text = clean(data?.text || '');
      if (!data?.ok || text.length < 55) return;
      smartResults.set(key, { text, savedAt: Date.now(), grounded: Boolean(data?.grounded), origin: clean(data?.origin || '') });
      setTimeout(() => {
        const current = smartResults.get(key);
        if (current && Date.now() - Number(current.savedAt || 0) >= SMART_RESULT_TTL_MS) smartResults.delete(key);
      }, SMART_RESULT_TTL_MS + 100);
    }).catch(() => {});
  }

  function smartResultFor(key) {
    const result = smartResults.get(key);
    if (!result) return null;
    if (Date.now() - Number(result.savedAt || 0) > SMART_RESULT_TTL_MS) {
      smartResults.delete(key);
      return null;
    }
    return result;
  }

  function syntheticGroqResponse(result) {
    return new Response(JSON.stringify({
      summary: result.text,
      unavailable: false,
      ai: Boolean(result.grounded),
      grounded: Boolean(result.grounded),
      provider: result.origin || 'parisien-smart'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-AI-Request-Control': 'parisien-smart' }
    });
  }

  function parisienAwareGroq(input, init, key) {
    return new Promise(resolve => setTimeout(resolve, PARISIEN_GRACE_MS)).then(() => {
      const smart = smartResultFor(key);
      if (smart) {
        parisienGroqAvoided += 1;
        return syntheticGroqResponse(smart);
      }
      return enqueue(input, init, requestPriority('/api/article-summary-groq'));
    });
  }

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.aiRequestControlVersion = '91.5';
  }

  root.__aiRequestControlV915 = {
    version: '91.5',
    controlledPaths: [...CONTROLLED_PATHS],
    requestPriority,
    stats
  };

  if (!upstreamFetch || typeof window === 'undefined') return;

  window.fetch = function aiRequestControlV915Fetch(input, init) {
    const url = requestUrl(input);
    const sameOriginPost = Boolean(url && url.origin === location.origin && requestMethod(input, init) === 'POST');

    if (sameOriginPost && url.pathname === SMART_PATH) {
      const promise = upstreamFetch(input, init);
      promise.then(response => rememberSmartResponse(init, response)).catch(() => {});
      return promise;
    }

    if (!sameOriginPost || !CONTROLLED_PATHS.has(url.pathname)) {
      return upstreamFetch(input, init);
    }

    const fingerprint = bodyFingerprint(init);
    const key = fingerprint ? `${url.pathname}|${fingerprint}` : '';
    if (key) {
      const existing = inflight.get(key);
      if (existing) {
        deduped += 1;
        return cloneResponse(existing.promise);
      }
    }

    const article = url.pathname === '/api/article-summary-groq' ? articleFromBody(init) : null;
    const smartKey = article && isParisienArticle(article) ? articleKey(article) : '';
    const promise = smartKey
      ? parisienAwareGroq(input, init, smartKey)
      : enqueue(input, init, requestPriority(url.pathname));

    if (key) {
      const entry = { promise, createdAt: Date.now() };
      inflight.set(key, entry);
      promise.finally(() => {
        setTimeout(() => {
          if (inflight.get(key) === entry) inflight.delete(key);
        }, DEDUPE_TTL_MS);
      }).catch(() => {});
    }

    return cloneResponse(promise);
  };
})();
