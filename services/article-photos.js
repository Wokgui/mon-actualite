import { preparedVisualUrl, articleVisualUrl, sourceTileUrl, photoArticleKey, canonicalPhotoUrl } from './article-visuals.js?v=98.61';
export { photoArticleKey };

// Renderer and loader share this exact module. URL identity survives id/title
// changes on sync, and a successfully decoded photo is immutable in a document.
const records = new Map();
const CACHE_KEY = 'news-photo-selections-v1';
const MAX_AGE_MS = 7 * 86400000;
const BODY_CACHE = 'mon-actualite-photo-bodies-v1';
const MAX_BODIES = 160;
let cacheWrite = Promise.resolve();
let requestTurn = Promise.resolve();
let nextRequestAt = 0;
let replacementPromise;
const REPLACEMENT_ASSET = new URL('../assets/article-image-unavailable-v98.39.png', import.meta.url);
let saved = {};
try { saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch {}
export const photoMetrics = {
  startedAt: performance.now(), firstImageMs: null, requests: 0, active: 0,
  maxActive: 0, reused: 0, sourceChanges: 0, commits: [], attempts: {}, failures: 0,
  cacheHits: 0, cacheWrites: 0, cacheErrors: 0, clientRecoveries: 0, directRequests: 0,
  replacements: [], replacementLoads: 0
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
  const upgrade = url => {
    if (!allowed(url)) return '';
    const request = new URL(url, location.href);
    request.searchParams.set('clientRecovery', '1');
    request.searchParams.set('v', '98.61');
    return request.href;
  };
  const candidates = [...new Set([recent ? remembered.requestUrl : '', preparedVisualUrl(article), articleVisualUrl(article)].map(upgrade).filter(Boolean))];
  const record = { key, id: String(article.id || ''), candidates, status: 'idle', url: '', requestUrl: '', attempts: 0, retryAt: 0 };
  records.set(key, record);
  return record;
}

export function photoSnapshot(article) {
  const record = photoRecord(article);
  const ready = record.status === 'ready' && record.committed === true;
  const replacement = !ready && record.status === 'failed' && record.attempts >= 2 && record.fallbackCommitted === true;
  return { key: record.key, url: ready ? record.url : replacement ? record.fallbackUrl : sourceTileUrl(), ready, replacement };
}

// One packaged, off-DOM decoded illustration per document. It is deliberately
// separate from positive article-photo caches, selection locks and perf metrics.
function replacementPhoto() {
  if (!replacementPromise) {
    replacementPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        photoMetrics.replacementLoads++;
        const response = await fetch(REPLACEMENT_ASSET, { signal: controller.signal });
        if (!response.ok) throw new Error('Replacement asset unavailable');
        return await decodedBlob(await response.blob(), controller.signal);
      } finally { clearTimeout(timer); }
    })().catch(error => { replacementPromise = null; throw error; });
  }
  return replacementPromise;
}

// The renderer owns article identity; a concurrent catalogue refresh must not
// make an already rendered card disappear from the photo resolver's catalogue.
export function photoRecordByKey(key) { return records.get(key); }

function bodyKey(key) {
  const url = new URL('/__article_photo_cache__', location.origin);
  url.searchParams.set('article', key);
  return url.href;
}

async function cachedPhoto(record) {
  if (!globalThis.caches) return null;
  let cache;
  try {
    cache = await caches.open(BODY_CACHE);
    const response = await cache.match(bodyKey(record.key));
    if (!response) return null;
    const savedAt = Number(response.headers.get('X-Photo-Saved-At'));
    if (!savedAt || !Number.isFinite(savedAt) || Date.now() - savedAt >= MAX_AGE_MS) {
      await cache.delete(bodyKey(record.key)); return null;
    }
    const photo = await decodedBlob(await response.blob());
    photoMetrics.cacheHits++;
    return { ...photo, requestUrl: response.headers.get('X-Photo-Request-Url') || '' };
  } catch {
    photoMetrics.cacheErrors++;
    try { await cache?.delete(bodyKey(record.key)); } catch {}
    return null;
  }
}

function persistBody(record) {
  if (!globalThis.caches || !record.blob) return;
  // Positive, decoded covers only. Native WebView deliberately has no service
  // worker; CacheStorage is used directly so reopening does not refetch covers.
  const { key, blob, requestUrl } = record;
  cacheWrite = cacheWrite.then(async () => {
    const cache = await caches.open(BODY_CACHE);
    await cache.put(bodyKey(key), new Response(blob, { headers: {
      'Content-Type': blob.type, 'X-Photo-Saved-At': String(Date.now()),
      'X-Photo-Request-Url': requestUrl
    } }));
    const keys = await cache.keys();
    for (const request of keys.slice(0, Math.max(0, keys.length - MAX_BODIES))) await cache.delete(request);
    photoMetrics.cacheWrites++;
  }).catch(() => { photoMetrics.cacheErrors++; });
}

function persistSelection(record) {
  saved[record.key] = { requestUrl: record.requestUrl, at: Date.now() };
  saved = Object.fromEntries(Object.entries(saved).filter(([, v]) => v && Date.now() - v.at < MAX_AGE_MS).sort((a, b) => b[1].at - a[1].at).slice(0, 500));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(saved)); } catch {}
}

async function pacedPhotoFetch(url, controller, cache, priority) {
    let responsePromise;
    // Pace the actual request, not the queue job: a disk-cache lookup can take
    // different amounts of time for two articles and otherwise bunch starts.
    const turn = requestTurn.then(async () => {
      while (performance.now() < nextRequestAt) await new Promise(resolve => setTimeout(resolve, Math.max(1, nextRequestAt - performance.now())));
      controller.signal.throwIfAborted();
      const interval = Number(window.__articlePhotoConfig?.intervalMs) || 120;
      nextRequestAt = performance.now() + interval;
      photoMetrics.requests++;
      responsePromise = fetch(url, { signal: controller.signal, cache, priority });
      responsePromise.catch(() => {});
    });
    requestTurn = turn.catch(() => {});
    await turn;
    return await responsePromise;
}

function recoveryCandidates(payload, requestUrl) {
  const request = new URL(requestUrl, location.href);
  const origin = location.hostname === 'wokgui.github.io' ? 'https://mon-actualite.vercel.app' : location.origin;
  if (request.origin !== origin || !['/api/article-photo-fast', '/api/article-thumbnail'].includes(request.pathname)
    || payload?.kind !== 'publisher-photo-candidates'
    || canonicalPhotoUrl(payload.articleUrl) !== canonicalPhotoUrl(request.searchParams.get('url'))) return [];
  return (Array.isArray(payload.candidates) ? payload.candidates : []).slice(0, 3).map(candidate => {
    try {
      const url = new URL(candidate.url), publisher = new URL(candidate.publisherUrl);
      if (url.protocol !== 'https:' || publisher.protocol !== 'https:' || url.username || url.password
        || /\.svg$/i.test(url.pathname)
        || !url.hostname.includes('.') || /(?:^|\.)localhost$|\.local$|^[\d.]+$|:/.test(url.hostname)
        || /(?:^|[\/_\-.])(?:logo|avatar|favicon|tracking|pixel)(?:[\/_\-.]|$)/i.test(url.pathname)) return '';
      return url.href;
    } catch { return ''; }
  }).filter(Boolean);
}

async function decodedResponse(response, signal, requireCover = false) {
    const type = response.headers.get('Content-Type') || '';
    const status = response.headers.get('X-Thumbnail-Status') || '';
    if (!response.ok || !/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(type) || /fallback|neutral|tile/i.test(status)) throw new Error('No article photo');
    const blob = await response.blob();
    if (!blob.size || blob.size > 7_000_000) throw new Error('Invalid image size');
    if (requireCover && blob.size < 3500) throw new Error('Weak publisher cover');
    return decodedBlob(blob, signal, requireCover);
}

async function decodedPhoto(url, priority, timeoutMs, cache = 'default') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let blobUrl = '';
  try {
    const response = await pacedPhotoFetch(url, controller, cache, priority);
    let photo;
    if (response.status === 424 && /^application\/json/i.test(response.headers.get('Content-Type') || '')) {
      const text = await response.text();
      if (text.length > 16000) throw new Error('Invalid recovery metadata');
      const candidates = recoveryCandidates(JSON.parse(text), url);
      for (const candidate of candidates) {
        try {
          photoMetrics.directRequests++;
          photo = await decodedResponse(await pacedPhotoFetch(candidate, controller, cache, priority), controller.signal, true);
          photoMetrics.clientRecoveries++;
          break;
        } catch {}
      }
      if (!photo) throw new Error('Publisher photo unavailable to this browser');
    } else photo = await decodedResponse(response, controller.signal);
    blobUrl = photo.url;
    controller.signal.throwIfAborted();
    return { ...photo, requestUrl: url };
  } catch (error) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    throw error;
  } finally { clearTimeout(timer); }
}

async function decodedBlob(blob, signal, requireCover = false) {
  if (!/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(blob.type) || !blob.size || blob.size > 7_000_000) throw new Error('Invalid cached image');
  let blobUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = blobUrl;
    await Promise.race([image.decode(), new Promise((_, reject) => {
      if (signal?.aborted) reject(new Error('Photo timeout'));
      else signal?.addEventListener('abort', () => reject(new Error('Photo timeout')), { once: true });
    })]);
    if (image.naturalWidth < 2 || image.naturalHeight < 2) throw new Error('Invalid photo dimensions');
    if (requireCover && (image.naturalWidth < 180 || image.naturalHeight < 100 || image.naturalWidth * image.naturalHeight < 45000
      || (image.naturalWidth <= 260 && image.naturalHeight <= 260 && Math.abs(image.naturalWidth - image.naturalHeight) < 25))) throw new Error('Weak publisher cover dimensions');
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
        blob = thumbnail;
        URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(thumbnail);
        image.src = blobUrl;
        await image.decode();
      }
    }
    signal?.throwIfAborted();
    return { url: blobUrl, blob };
  } catch (error) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    throw error;
  }
}

export function resolvePhoto(record, priority = 'auto', timeoutMs = 14000) {
  if (record.status === 'ready') return Promise.resolve(record);
  if (record.promise) return record.promise;
  if (record.status === 'failed' && record.attempts >= 2) return Promise.resolve(record);
  record.status = 'loading';
  record.attempts++;
  photoMetrics.attempts[record.key] = (photoMetrics.attempts[record.key] || 0) + 1;
  photoMetrics.active++;
  photoMetrics.maxActive = Math.max(photoMetrics.maxActive, photoMetrics.active);
  record.promise = (async () => {
    const cached = await cachedPhoto(record);
    if (cached) { Object.assign(record, cached); record.status = 'ready'; return record; }
    const deadline = performance.now() + timeoutMs;
    for (const candidate of record.candidates) {
      const remaining = deadline - performance.now();
      if (remaining < 100) break;
      try {
        Object.assign(record, await decodedPhoto(candidate, priority, remaining, record.attempts > 1 ? 'reload' : 'default'));
        record.status = 'ready';
        persistSelection(record);
        persistBody(record);
        return record;
      } catch {}
    }
    record.status = 'failed';
    record.retryAt = Date.now() + 8000;
    photoMetrics.failures++;
    if (record.attempts >= 2) {
      try { record.fallbackUrl = (await replacementPhoto()).url; } catch {}
    }
    return record;
  })().finally(() => { photoMetrics.active--; record.promise = null; });
  return record.promise;
}

export function commitPhoto(image, record) {
  if (!image?.isConnected || record.status !== 'ready') return false;
  if (image.dataset.photoReplacement === '1') return false;
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

export function commitReplacement(image, record) {
  if (!image?.isConnected || record.status !== 'failed' || record.attempts < 2
    || !record.fallbackUrl || image.dataset.photoFinal === '1' || image.dataset.photoReplacement === '1') return false;
  record.fallbackCommitted = true;
  image.src = record.fallbackUrl;
  image.dataset.photoReplacement = '1';
  image.alt = 'Illustration de remplacement — photo de l’article indisponible';
  image.classList.remove('image-pending-v98', 'source-tile-visual');
  image.classList.add('image-fallback-v98', 'image-replacement-v9839');
  photoMetrics.replacements.push({ key: record.key, id: record.id, at: performance.now() });
  if (photoMetrics.replacements.length > 1000) photoMetrics.replacements.shift();
  return true;
}
