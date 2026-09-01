(() => {
  'use strict';

  const CONTROLLED_PATHS = new Set([
    '/api/article-summary-groq',
    '/api/article-summary-multisource',
    '/api/article-story-intelligence'
  ]);
  const MAX_CONCURRENT = 1;
  const MAX_FOREGROUND_CONCURRENT = 1;
  const DEDUPE_TTL_MS = 20_000;
  const RELEASE_DELAY_MS = 120;
  const root = typeof window !== 'undefined' ? window : globalThis;
  const upstreamFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

  const queue = [];
  const foregroundQueue = [];
  const inflight = new Map();
  let active = 0;
  let foregroundActive = 0;
  let sequence = 0;
  let deduped = 0;
  let completed = 0;
  let foregroundCompleted = 0;
  let pumpScheduled = false;
  let foregroundPumpScheduled = false;

  function clean(value = '') { return String(value ?? '').trim(); }
  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function requestMethod(input, init) {
    return String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  }
  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); }
    catch { return null; }
  }
  function bodyFingerprint(init = {}) {
    if (typeof init?.body === 'string') return init.body;
    if (typeof URLSearchParams !== 'undefined' && init?.body instanceof URLSearchParams) return init.body.toString();
    return '';
  }
  function parsedBody(init = {}) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }
  function articleFromBody(init = {}) {
    const body = parsedBody(init);
    return body?.article && typeof body.article === 'object' ? body.article : null;
  }
  function foregroundArticleVisible(article = {}) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return false;
    const modalTitle = normalize(modal.querySelector('.quick-summary-head h2, h2')?.textContent || '');
    const articleTitle = normalize(article.title || '');
    if (!modalTitle || !articleTitle) return false;
    if (modalTitle === articleTitle) return true;
    return Math.min(modalTitle.length, articleTitle.length) >= 24
      && (modalTitle.includes(articleTitle) || articleTitle.includes(modalTitle));
  }
  function requestIntent(url, article = null) {
    const explicit = clean(url?.searchParams?.get('intent') || '').toLowerCase();
    if (explicit === 'foreground' || explicit === 'preload' || explicit === 'background') return explicit;
    if (url?.pathname === '/api/article-summary-groq' && article && foregroundArticleVisible(article)) return 'foreground';
    return 'background';
  }
  function requestPriority(pathname = '', intent = '') {
    if (pathname === '/api/article-summary-groq') return intent === 'foreground' ? -10 : 0;
    if (pathname === '/api/article-summary-multisource') return 1;
    return 2;
  }
  function stats() {
    return {
      version: '91.42',
      active,
      queued: queue.length,
      foregroundActive,
      foregroundQueued: foregroundQueue.length,
      deduped,
      completed,
      foregroundCompleted,
      maxConcurrent: MAX_CONCURRENT,
      maxForegroundConcurrent: MAX_FOREGROUND_CONCURRENT,
      groqSourceShortcutDisabled: true
    };
  }
  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => { pumpScheduled = false; pump(); }, 0);
  }
  function pump() {
    if (!upstreamFetch || active >= MAX_CONCURRENT || !queue.length) return;
    queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    const job = queue.shift();
    if (!job) return;
    active += 1;
    Promise.resolve().then(() => upstreamFetch(job.input, job.init)).then(job.resolve, job.reject).finally(() => {
      active = Math.max(0, active - 1);
      completed += 1;
      setTimeout(pump, RELEASE_DELAY_MS);
    });
  }
  function scheduleForegroundPump() {
    if (foregroundPumpScheduled) return;
    foregroundPumpScheduled = true;
    setTimeout(() => { foregroundPumpScheduled = false; pumpForeground(); }, 0);
  }
  function pumpForeground() {
    if (!upstreamFetch || foregroundActive >= MAX_FOREGROUND_CONCURRENT || !foregroundQueue.length) return;
    const job = foregroundQueue.shift();
    if (!job) return;
    foregroundActive += 1;
    Promise.resolve().then(() => upstreamFetch(job.input, job.init)).then(job.resolve, job.reject).finally(() => {
      foregroundActive = Math.max(0, foregroundActive - 1);
      foregroundCompleted += 1;
      scheduleForegroundPump();
    });
  }
  function enqueue(input, init, priority) {
    return new Promise((resolve, reject) => {
      queue.push({ input, init, priority, sequence: sequence += 1, resolve, reject });
      schedulePump();
    });
  }
  function enqueueForeground(input, init) {
    return new Promise((resolve, reject) => {
      foregroundQueue.push({ input, init, sequence: sequence += 1, resolve, reject });
      scheduleForegroundPump();
    });
  }
  function cloneResponse(promise) {
    return promise.then(response => response?.clone ? response.clone() : response);
  }

  if (typeof document !== 'undefined') document.documentElement.dataset.aiRequestControlVersion = '91.42';
  const publicControl = { version: '91.42', controlledPaths: [...CONTROLLED_PATHS], requestPriority, requestIntent, stats };
  root.__aiRequestControlV917 = publicControl;
  root.__aiRequestControlV9112 = publicControl;
  root.__aiRequestControlV9142 = publicControl;
  if (!upstreamFetch || typeof window === 'undefined') return;

  window.fetch = function aiRequestControlV9142Fetch(input, init) {
    const url = requestUrl(input);
    const sameOriginPost = Boolean(url && url.origin === location.origin && requestMethod(input, init) === 'POST');
    if (!sameOriginPost || !CONTROLLED_PATHS.has(url.pathname)) return upstreamFetch(input, init);

    const article = url.pathname === '/api/article-summary-groq' ? articleFromBody(init) : null;
    const intent = requestIntent(url, article);
    const fingerprint = bodyFingerprint(init);
    const key = fingerprint ? `${url.pathname}${url.search}|${intent}|${fingerprint}` : '';
    if (key) {
      const existing = inflight.get(key);
      if (existing) {
        deduped += 1;
        return cloneResponse(existing.promise);
      }
    }

    const promise = intent === 'foreground' && url.pathname === '/api/article-summary-groq'
      ? enqueueForeground(input, init)
      : enqueue(input, init, requestPriority(url.pathname, intent));

    if (key) {
      const entry = { promise, createdAt: Date.now() };
      inflight.set(key, entry);
      promise.finally(() => setTimeout(() => {
        if (inflight.get(key) === entry) inflight.delete(key);
      }, DEDUPE_TTL_MS)).catch(() => {});
    }
    return cloneResponse(promise);
  };
})();