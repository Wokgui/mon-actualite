(() => {
  'use strict';

  const CONTROLLED_PATHS = new Set([
    '/api/article-summary-groq',
    '/api/article-summary-multisource',
    '/api/article-story-intelligence'
  ]);
  const MAX_CONCURRENT = 1;
  const DEDUPE_TTL_MS = 20_000;
  const RELEASE_DELAY_MS = 120;
  const root = typeof window !== 'undefined' ? window : globalThis;
  const upstreamFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

  const queue = [];
  const inflight = new Map();
  let active = 0;
  let sequence = 0;
  let deduped = 0;
  let completed = 0;
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

  function requestPriority(pathname = '') {
    if (pathname === '/api/article-summary-groq') return 0;
    if (pathname === '/api/article-summary-multisource') return 1;
    return 2;
  }

  function stats() {
    return {
      version: '91.1',
      active,
      queued: queue.length,
      deduped,
      completed,
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

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.aiRequestControlVersion = '91.1';
  }

  root.__aiRequestControlV911 = {
    version: '91.1',
    controlledPaths: [...CONTROLLED_PATHS],
    requestPriority,
    stats
  };

  if (!upstreamFetch || typeof window === 'undefined') return;

  window.fetch = function aiRequestControlV911Fetch(input, init) {
    const url = requestUrl(input);
    if (!url
      || url.origin !== location.origin
      || requestMethod(input, init) !== 'POST'
      || !CONTROLLED_PATHS.has(url.pathname)) {
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

    const promise = enqueue(input, init, requestPriority(url.pathname));
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
