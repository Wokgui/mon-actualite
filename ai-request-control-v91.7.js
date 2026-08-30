(() => {
  'use strict';

  const CONTROLLED_PATHS = new Set([
    '/api/article-summary-groq',
    '/api/article-summary-multisource',
    '/api/article-story-intelligence'
  ]);
  const SMART_PATH = '/api/article-summary-smart';
  const MAX_CONCURRENT = 1;
  const MAX_FOREGROUND_CONCURRENT = 1;
  const DEDUPE_TTL_MS = 20_000;
  const SMART_RESULT_TTL_MS = 30_000;
  const PARISIEN_GRACE_MS = 2_200;
  const GENERIC_SMART_GRACE_MS = 2_800;
  const FOREGROUND_PARISIEN_GRACE_MS = 650;
  const FOREGROUND_GENERIC_GRACE_MS = 450;
  const RELEASE_DELAY_MS = 120;
  const root = typeof window !== 'undefined' ? window : globalThis;
  const upstreamFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

  const queue = [];
  const foregroundQueue = [];
  const inflight = new Map();
  const smartResults = new Map();
  let active = 0;
  let foregroundActive = 0;
  let sequence = 0;
  let deduped = 0;
  let completed = 0;
  let foregroundCompleted = 0;
  let smartGroqAvoided = 0;
  let pumpScheduled = false;
  let foregroundPumpScheduled = false;

  function clean(value = '') { return String(value ?? '').trim(); }
  function normalize(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function requestMethod(input, init) { return String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase(); }
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
    } catch { return false; }
  }
  function foregroundArticleVisible(article = {}) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal || typeof modal.querySelector !== 'function') return false;
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
      version: '91.12',
      active,
      queued: queue.length,
      foregroundActive,
      foregroundQueued: foregroundQueue.length,
      deduped,
      completed,
      foregroundCompleted,
      smartGroqAvoided,
      maxConcurrent: MAX_CONCURRENT,
      maxForegroundConcurrent: MAX_FOREGROUND_CONCURRENT,
      foregroundGenericGraceMs: FOREGROUND_GENERIC_GRACE_MS,
      foregroundParisienGraceMs: FOREGROUND_PARISIEN_GRACE_MS
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
  function cloneResponse(promise) { return promise.then(response => response?.clone ? response.clone() : response); }

  function saveSmartResult(key, result) {
    if (!key || !result || clean(result.text || '').length < 55) return;
    smartResults.set(key, {
      text: clean(result.text || ''),
      savedAt: Date.now(),
      grounded: Boolean(result.grounded),
      origin: clean(result.origin || '')
    });
    setTimeout(() => {
      const current = smartResults.get(key);
      if (current && Date.now() - Number(current.savedAt || 0) >= SMART_RESULT_TTL_MS) smartResults.delete(key);
    }, SMART_RESULT_TTL_MS + 100);
  }
  function rememberSmartResponse(init, response) {
    const article = articleFromBody(init);
    const key = articleKey(article || {});
    if (!key || !response?.ok) return;
    response.clone().json().then(data => {
      const text = clean(data?.text || '');
      if (!data?.ok || text.length < 55) return;
      saveSmartResult(key, { text, grounded: Boolean(data?.grounded), origin: clean(data?.origin || '') });
    }).catch(() => {});
  }
  function smartResultFor(key) {
    const result = smartResults.get(key);
    if (!result) return null;
    if (Date.now() - Number(result.savedAt || 0) > SMART_RESULT_TTL_MS) { smartResults.delete(key); return null; }
    return result;
  }
  function syntheticGroqResponse(result) {
    return new Response(JSON.stringify({
      summary: result.text,
      unavailable: false,
      ai: Boolean(result.grounded),
      grounded: Boolean(result.grounded),
      provider: result.origin || 'source-smart'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-AI-Request-Control': 'source-smart' }
    });
  }
  function groqFallback(input, init, intent) {
    return intent === 'foreground'
      ? enqueueForeground(input, init)
      : enqueue(input, init, requestPriority('/api/article-summary-groq', intent));
  }
  function parisienAwareGroq(input, init, key, intent) {
    const grace = intent === 'foreground' ? FOREGROUND_PARISIEN_GRACE_MS : PARISIEN_GRACE_MS;
    return new Promise(resolve => setTimeout(resolve, grace)).then(() => {
      const smart = smartResultFor(key);
      if (smart) { smartGroqAvoided += 1; return syntheticGroqResponse(smart); }
      return groqFallback(input, init, intent);
    });
  }
  async function genericSourceFirstGroq(input, init, article, intent) {
    const key = articleKey(article);
    const body = JSON.stringify({ article });
    const smartPromise = upstreamFetch(`${SMART_PATH}?v=4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body
    }).then(async response => {
      if (!response?.ok) return null;
      const data = await response.clone().json().catch(() => null);
      const text = clean(data?.text || '');
      if (!data?.ok || text.length < 55) return null;
      const result = { text, grounded: Boolean(data?.grounded), origin: clean(data?.origin || '') };
      saveSmartResult(key, result);
      return result;
    }).catch(() => null);
    const grace = intent === 'foreground' ? FOREGROUND_GENERIC_GRACE_MS : GENERIC_SMART_GRACE_MS;
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), grace));
    const smart = await Promise.race([smartPromise, timeout]);
    if (smart) { smartGroqAvoided += 1; return syntheticGroqResponse(smart); }
    return groqFallback(input, init, intent);
  }

  if (typeof document !== 'undefined') document.documentElement.dataset.aiRequestControlVersion = '91.12';
  const publicControl = { version: '91.12', controlledPaths: [...CONTROLLED_PATHS], requestPriority, requestIntent, stats };
  root.__aiRequestControlV917 = publicControl;
  root.__aiRequestControlV9112 = publicControl;
  if (!upstreamFetch || typeof window === 'undefined') return;

  window.fetch = function aiRequestControlV9112Fetch(input, init) {
    const url = requestUrl(input);
    const sameOriginPost = Boolean(url && url.origin === location.origin && requestMethod(input, init) === 'POST');
    if (sameOriginPost && url.pathname === SMART_PATH) {
      const promise = upstreamFetch(input, init);
      promise.then(response => rememberSmartResponse(init, response)).catch(() => {});
      return promise;
    }
    if (!sameOriginPost || !CONTROLLED_PATHS.has(url.pathname)) return upstreamFetch(input, init);

    const article = url.pathname === '/api/article-summary-groq' ? articleFromBody(init) : null;
    const intent = requestIntent(url, article);
    const fingerprint = bodyFingerprint(init);
    const key = fingerprint ? `${url.pathname}|${intent}|${fingerprint}` : '';
    if (key) {
      const existing = inflight.get(key);
      if (existing) { deduped += 1; return cloneResponse(existing.promise); }
    }

    let promise;
    if (article && isParisienArticle(article)) promise = parisienAwareGroq(input, init, articleKey(article), intent);
    else if (article) promise = genericSourceFirstGroq(input, init, article, intent);
    else promise = enqueue(input, init, requestPriority(url.pathname, intent));

    if (key) {
      const entry = { promise, createdAt: Date.now() };
      inflight.set(key, entry);
      promise.finally(() => setTimeout(() => { if (inflight.get(key) === entry) inflight.delete(key); }, DEDUPE_TTL_MS)).catch(() => {});
    }
    return cloneResponse(promise);
  };
})();