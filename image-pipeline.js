import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=98.10';

const MAX_CONCURRENT = 8;
const PRIORITY_COUNT = 16;
const REQUEST_TIMEOUT_MS = 6500;
const RETRY_AFTER_MS = 60_000;
const RECOVERY_DELAYS_MS = [8_000, 30_000];
const bound = new WeakSet();
const queued = new WeakSet();
const failures = new Map();
const managedInflight = new Map();
const managedBlobs = new Map();
const queue = [];
let active = 0;

function articleMap() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return new Map((Array.isArray(payload.articles) ? payload.articles : []).map(article => [String(article.id || ''), article]));
  } catch { return new Map(); }
}

function proxyUrl(article) {
  const params = new URLSearchParams({
    v: '98.10', url: String(article?.url || '').slice(0, 1900),
    image: String(article?.visual?.url || article?.image || '').slice(0, 1900),
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70),
    source: String(article?.source || article?.feedTitle || '').slice(0, 100)
  });
  return `/api/article-photo-fast?${params}`;
}

function recoveryUrl(article, attempt) {
  const url = new URL(proxyUrl(article), location.href);
  url.searchParams.set('recovery', String(attempt));
  return `${url.pathname}${url.search}`;
}

function absolute(url) {
  try { return new URL(url, location.href).href; } catch { return String(url || ''); }
}

function isManagedProxy(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin
      && ['/api/article-photo-fast', '/api/article-thumbnail', '/api/exact-news-thumbnail'].includes(parsed.pathname);
  } catch { return false; }
}

function isGenericResolver(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin && parsed.pathname === '/api/article-photo-fast';
  } catch { return false; }
}

function isExternalHttp(url) {
  try {
    const parsed = new URL(url, location.href);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== location.origin;
  } catch { return false; }
}

function rememberBlob(url, blob) {
  managedBlobs.delete(url);
  managedBlobs.set(url, blob);
  while (managedBlobs.size > 96) managedBlobs.delete(managedBlobs.keys().next().value);
  return blob;
}

function managedImageBlob(url) {
  if (managedBlobs.has(url)) return Promise.resolve(rememberBlob(url, managedBlobs.get(url)));
  if (managedInflight.has(url)) return managedInflight.get(url);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const request = fetch(url, { cache: 'force-cache', credentials: 'same-origin', signal: controller.signal }).then(async response => {
    const status = String(response.headers.get('X-Thumbnail-Status') || '').toLowerCase();
    const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
    if (!response.ok || status.includes('fallback') || contentType.includes('image/svg+xml')) {
      throw new Error(`unusable image response: ${response.status} ${status || contentType}`);
    }
    const blob = await response.blob();
    if (blob.size < 256 || !String(blob.type || contentType).toLowerCase().startsWith('image/')) {
      throw new Error('empty or invalid image response');
    }
    return rememberBlob(url, blob);
  }).finally(() => {
    window.clearTimeout(timeout);
    managedInflight.delete(url);
  });
  managedInflight.set(url, request);
  return request;
}

function mark(image, ready) {
  image.classList.remove('image-pending-v98');
  image.classList.toggle('image-ready-v98', ready);
  image.classList.toggle('image-fallback-v98', !ready);
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    if (!task.card.isConnected || task.finished) continue;
    active += 1;
    task.start();
  }
}

function enqueue(task) {
  if (task.started || task.finished || queued.has(task.card)) return;
  queued.add(task.card);
  queue.push(task);
  pump();
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const task = entry.target.__imageTaskV98;
    if (task) enqueue(task);
    observer.unobserve(entry.target);
  });
}, { rootMargin: '1200px 0px', threshold: 0.01 });

function bind(card, index, articles) {
  if (bound.has(card)) return;
  const image = card.querySelector('img.article-image');
  const article = articles.get(String(card.dataset.article || ''));
  if (!image || !article) return;
  bound.add(card);

  const tile = sourceTileUrl(article);
  const prepared = image.dataset.photoSrc || preparedVisualUrl(article);
  // A prepared exact same-origin endpoint has already selected a validated
  // cover. Keep it first; refresh generated/legacy generic URLs to this build.
  const preferred = isExternalHttp(prepared) || isGenericResolver(prepared) ? proxyUrl(article) : prepared;
  const candidates = [...new Set([preferred, proxyUrl(article)]
    .filter(url => url && absolute(url) !== absolute(tile)))];
  const task = { card, image, article, candidates, tile, cursor: 0, started: false, finished: false, waitingRetry: false, retryCount: 0, released: false, currentCandidate: '', objectUrl: '', start: null };

  const release = () => {
    if (task.released) return;
    task.released = true;
    active = Math.max(0, active - 1);
    pump();
  };
  const finish = ready => {
    if (task.finished) return;
    mark(image, ready);
    if (!ready && task.retryCount < RECOVERY_DELAYS_MS.length && card.isConnected) {
      task.waitingRetry = true;
      release();
      const delay = RECOVERY_DELAYS_MS[task.retryCount];
      task.retryCount += 1;
      window.setTimeout(() => {
        if (!card.isConnected || task.finished) return;
        task.waitingRetry = false;
        task.started = false;
        task.released = false;
        task.cursor = 0;
        task.currentCandidate = '';
        task.candidates = [recoveryUrl(task.article, task.retryCount)];
        task.candidates.forEach(candidate => failures.delete(candidate));
        queued.delete(card);
        enqueue(task);
      }, delay);
      return;
    }
    task.finished = true;
    release();
  };
  const revokeObjectUrl = () => {
    if (!task.objectUrl) return;
    URL.revokeObjectURL(task.objectUrl);
    task.objectUrl = '';
  };
  const assignCandidate = async candidate => {
    task.currentCandidate = candidate;
    if (!isManagedProxy(candidate)) {
      image.src = candidate;
      return;
    }
    try {
      const blob = await managedImageBlob(candidate);
      if (task.finished || task.currentCandidate !== candidate) return;
      if (!card.isConnected) { finish(false); return; }
      revokeObjectUrl();
      task.objectUrl = URL.createObjectURL(blob);
      image.src = task.objectUrl;
    } catch {
      if (task.finished || task.currentCandidate !== candidate) return;
      if (!card.isConnected) { finish(false); return; }
      failures.set(candidate, Date.now());
      next();
    }
  };
  const next = () => {
    while (task.cursor < task.candidates.length) {
      const candidate = task.candidates[task.cursor++];
      const failedAt = failures.get(candidate) || 0;
      if (Date.now() - failedAt < RETRY_AFTER_MS) continue;
      void assignCandidate(candidate);
      return;
    }
    task.currentCandidate = '';
    revokeObjectUrl();
    image.src = tile;
    finish(false);
  };

  image.loading = 'eager';
  image.decoding = 'async';
  if (index < PRIORITY_COUNT) image.fetchPriority = 'high';
  image.addEventListener('load', async () => {
    if (!task.started || task.finished || task.waitingRetry) return;
    if (absolute(image.src) === absolute(tile)) {
      if (!task.currentCandidate) finish(false);
      return;
    }
    try { await image.decode(); } catch {}
    if (image.naturalWidth > 1 && image.naturalHeight > 1) {
      finish(true);
      if (task.objectUrl) setTimeout(revokeObjectUrl, 1000);
    }
    else next();
  });
  image.addEventListener('error', () => {
    if (!task.started || task.finished || task.waitingRetry) return;
    if (task.currentCandidate) failures.set(task.currentCandidate, Date.now());
    revokeObjectUrl();
    next();
  });
  task.start = () => {
    if (task.started || task.finished) return;
    task.started = true;
    next();
  };
  card.__imageTaskV98 = task;

  if (!candidates.length) { mark(image, false); task.finished = true; return; }
  if (index < PRIORITY_COUNT) enqueue(task);
  else observer.observe(card);
}

function scan() {
  const articles = articleMap();
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => bind(card, index, articles));
}

window.addEventListener('news:stable-render', () => requestAnimationFrame(scan));
window.addEventListener('pageshow', scan);
new MutationObserver(() => requestAnimationFrame(scan)).observe(document.getElementById('app'), { childList: true, subtree: true });
scan();
