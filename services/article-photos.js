import { preparedVisualUrl, articleVisualUrl, sourceTileUrl, photoArticleKey } from './article-visuals.js?v=98.31';

// Renderer and loader share this exact module. URL identity survives id/title
// changes on sync, and a successfully decoded photo is immutable in a document.
const records = new Map();
const CACHE_KEY = 'news-photo-selections-v1';
const MAX_AGE_MS = 7 * 86400000;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch {}
export const photoMetrics = {
  startedAt: performance.now(), firstImageMs: null, requests: 0, active: 0,
  maxActive: 0, reused: 0, sourceChanges: 0, commits: [], attempts: {}, failures: 0
};
if (typeof window !== 'undefined') window.__articlePhotoMetrics = photoMetrics;

export function photoRecord(article = {}) {
  const key = photoArticleKey(article);
  if (records.has(key)) return records.get(key);
  const remembered = saved[key];
  const recent = remembered && Date.now() - remembered.at < MAX_AGE_MS;
  const allowed = url => {
    try {
      const u = new URL(url, location.href);
      const origin = location.hostname === 'wokgui.github.io' ? 'https://mon-actualite.vercel.app' : location.origin;
      return u.origin === origin && ['/api/article-photo-fast', '/api/article-thumbnail'].includes(u.pathname);
    } catch { return false; }
  };
  // Persist only request URLs, never blobs or flags claiming a photo is ready.
  const candidates = [...new Set([recent && allowed(remembered.requestUrl) ? remembered.requestUrl : '', preparedVisualUrl(article), articleVisualUrl(article)].filter(allowed))];
  const record = { key, id: String(article.id || ''), candidates, status: 'idle', url: '', requestUrl: '', attempts: 0, retryAt: 0 };
  records.set(key, record);
  return record;
}

export function photoSnapshot(article) {
  const record = photoRecord(article);
  const ready = record.status === 'ready' && record.committed === true;
  return { key: record.key, url: ready ? record.url : sourceTileUrl(), ready };
}

function persistSelection(record) {
  saved[record.key] = { requestUrl: record.requestUrl, at: Date.now() };
  saved = Object.fromEntries(Object.entries(saved).filter(([, v]) => v && Date.now() - v.at < MAX_AGE_MS).sort((a, b) => b[1].at - a[1].at).slice(0, 500));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(saved)); } catch {}
}

async function decodedPhoto(url, priority, timeoutMs, cache = 'default') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let blobUrl = '';
  photoMetrics.requests++;
  try {
    const response = await fetch(url, { signal: controller.signal, cache, priority });
    const type = response.headers.get('Content-Type') || '';
    const status = response.headers.get('X-Thumbnail-Status') || '';
    if (!response.ok || !/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(type) || /fallback|neutral|tile/i.test(status)) throw new Error('No article photo');
    const blob = await response.blob();
    if (!blob.size || blob.size > 7_000_000) throw new Error('Invalid image size');
    blobUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.src = blobUrl;
    await Promise.race([image.decode(), new Promise((_, reject) => {
      if (controller.signal.aborted) reject(new Error('Photo timeout'));
      else controller.signal.addEventListener('abort', () => reject(new Error('Photo timeout')), { once: true });
    })]);
    if (image.naturalWidth < 2 || image.naturalHeight < 2) throw new Error('Invalid photo dimensions');
    // Feeds often supply multi-megapixel originals for a 119px card. Retain
    // enough pixels for high-DPI / enlarged text without keeping every full
    // decoded original alive through navigation.
    const scale = Math.min(1, 720 / image.naturalWidth, 540 / image.naturalHeight);
    if (scale < 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .9));
      if (thumbnail) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(thumbnail);
        image.src = blobUrl;
        await image.decode();
      }
    }
    controller.signal.throwIfAborted();
    return { url: blobUrl, requestUrl: url };
  } catch (error) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    throw error;
  } finally { clearTimeout(timer); }
}

export function resolvePhoto(record, priority = 'auto', timeoutMs = 14000) {
  if (record.status === 'ready') return Promise.resolve(record);
  if (record.promise) return record.promise;
  record.status = 'loading';
  record.attempts++;
  photoMetrics.attempts[record.key] = (photoMetrics.attempts[record.key] || 0) + 1;
  photoMetrics.active++;
  photoMetrics.maxActive = Math.max(photoMetrics.maxActive, photoMetrics.active);
  record.promise = (async () => {
    const deadline = performance.now() + timeoutMs;
    for (const candidate of record.candidates) {
      const remaining = deadline - performance.now();
      if (remaining < 100) break;
      try {
        Object.assign(record, await decodedPhoto(candidate, priority, remaining, record.attempts > 1 ? 'reload' : 'default'));
        record.status = 'ready';
        persistSelection(record);
        return record;
      } catch {}
    }
    record.status = 'failed';
    record.retryAt = Date.now() + 8000;
    photoMetrics.failures++;
    return record;
  })().finally(() => { photoMetrics.active--; record.promise = null; });
  return record.promise;
}

export function commitPhoto(image, record) {
  if (!image?.isConnected || record.status !== 'ready') return false;
  if (image.dataset.photoFinal === '1') {
    if (image.getAttribute('src') !== record.url) photoMetrics.sourceChanges++;
    else photoMetrics.reused++;
    return false;
  }
  image.loading = 'eager';
  record.committed = true;
  image.src = record.url;
  image.dataset.photoFinal = '1';
  image.classList.remove('image-pending-v98', 'image-fallback-v98', 'source-tile-visual');
  image.classList.add('image-ready-v98', 'prepared-visual');
  image.closest('[data-article]')?.setAttribute('data-photo-locked', '1');
  const at = performance.now();
  photoMetrics.firstImageMs ??= at - photoMetrics.startedAt;
  photoMetrics.commits.push({ key: record.key, id: record.id, at, requestUrl: record.requestUrl });
  if (photoMetrics.commits.length > 1000) photoMetrics.commits.shift();
  window.dispatchEvent(new CustomEvent('news:photo-locked', { detail: { id: record.id, key: record.key, url: record.url } }));
  return true;
}
