const CACHE = 'mon-actualite-v91-7-core-r1';
const COMPAT_DIAGNOSTIC = 'v91.7-core';
const THUMB_CACHE = 'mon-actualite-thumbnails-v6-feedly';
const THUMB_NEGATIVE_TTL_MS = 15 * 60 * 1000;
const thumbnailInflight = new Map();
const ASSETS = ['./', './index.html', './styles.css?v=53', './feedly-compact.css?v=44', './feed-editorial-v77.css?v=77.2', './feedly-left.css?v=43', './ui-fixes-v2.css?v=43', './article-quickview.css?v=53', './feed-quality.css?v=43', './performance-v42.css?v=45', './personalization-v44.css?v=53', './feed-editorial-v78.css?v=78.1', './feed-experience-v79.css?v=79', './feed-experience-v80.css?v=80', './feed-intelligence-v81.css?v=81', './source-quality-v82.css?v=82', './content-trust-v83.css?v=83', './maintenance-v84.css?v=84', './experience-v85.css?v=85', './feed-v87.css?v=87', './quality-v88.css?v=88', './quality-signals-v89.css?v=89', './release-watch.js?v=91.7', './bootstrap-v42.js?v=54', './stable-dom.js?v=44', './content-intelligence-v76.js?v=76', './feed-editorial-v77.js?v=77', './feed-editorial-polish-v77.js?v=77.5', './content-intelligence-v78.js?v=78', './feed-editorial-v78.js?v=78.1', './summary-race-v78.js?v=78', './content-trust-v83.js?v=83.1', './source-quality-v82.js?v=82', './lead-choice-v91.js?v=91.3', './ai-request-control-v91.7.js?v=91.7', './feed-experience-v79.js?v=79', './navigation-cache-v79.js?v=79.1', './feed-experience-v80.js?v=80', './feed-intelligence-v81.js?v=81', './adaptive-preload-v83.js?v=83', './maintenance-v84.js?v=84', './experience-v85.js?v=85', './lifecycle-v86.js?v=86', './news-pipeline-v88.js?v=88.9', './brief-smart-v87.js?v=90.1', './quality-v88.js?v=88', './quality-signals-v89.js?v=89', './app.js?v=61', './feedly-runtime.js?v=61', './summary-fixes.js?v=44', './article-quickview.js?v=56', './feed-quality.js?v=45', './source-discovery-ui.js?v=3', './services/source-connectors.js?v=45.3', './services/article-visuals.js?v=85', './manifest.webmanifest?v=91.7', './version.json', './assets/app-icon-192.png', './assets/app-icon-512.png', './assets/app-icon-maskable-512.png', './assets/apple-touch-icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== THUMB_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  if (cached) return cached;
  return network;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok && response.type !== 'opaque') {
      cache.put('./index.html', response.clone()).catch(() => {});
      cache.put('./', response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./'));
  }
}

function neutralThumbnailResponse() {
  return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" rx="22" fill="#f1f1f4"/><path d="M0 340 150 225l64 43 66-67 179 129H0Z" fill="#d7d7de"/><circle cx="490" cy="115" r="39" fill="#dedee4"/></svg>', {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=900',
      'X-Thumbnail-Status': 'neutral-fallback',
      'X-Thumbnail-Cached-At': String(Date.now())
    }
  });
}

function thumbnailCacheKey(request) {
  try {
    const source = new URL(request.url);
    const key = new URL('/__cached-article-thumbnail', self.location.origin);
    const articleUrl = source.searchParams.get('url') || '';
    const title = source.searchParams.get('title') || '';
    const image = source.searchParams.get('image') || '';
    if (articleUrl) key.searchParams.set('url', articleUrl);
    else if (title) key.searchParams.set('title', title);
    else if (image) key.searchParams.set('image', image);
    else return request;
    return new Request(key.href);
  } catch {
    return request;
  }
}

function isFallbackThumbnail(response) {
  const status = response?.headers?.get('X-Thumbnail-Status') || '';
  const type = response?.headers?.get('Content-Type') || '';
  return status === 'fallback' || status === 'publisher-tile' || status === 'neutral-fallback' || /image\/svg\+xml/i.test(type);
}

async function cacheThumbnail(cache, request, canonicalKey, response) {
  if (!response) return;
  await cache.put(request, response.clone()).catch(() => {});
  if (canonicalKey.url !== request.url) await cache.put(canonicalKey, response.clone()).catch(() => {});
}

async function thumbnailResponse(request) {
  const cache = await caches.open(THUMB_CACHE);
  const canonicalKey = thumbnailCacheKey(request);
  let cached = await cache.match(canonicalKey);
  if (!cached) {
    cached = await cache.match(request);
    if (cached && canonicalKey.url !== request.url) cache.put(canonicalKey, cached.clone()).catch(() => {});
  }

  if (cached) {
    if (!isFallbackThumbnail(cached)) return cached;
    const cachedAt = Number(cached.headers.get('X-Thumbnail-Cached-At') || 0);
    if (cachedAt && Date.now() - cachedAt < THUMB_NEGATIVE_TTL_MS) return cached;
    await Promise.allSettled([cache.delete(request), cache.delete(canonicalKey)]);
  }

  const inflightKey = canonicalKey.url;
  const existing = thumbnailInflight.get(inflightKey);
  if (existing) {
    try { return (await existing).clone(); }
    catch {}
  }

  const job = (async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && response.type !== 'opaque' && !isFallbackThumbnail(response)) {
        await cacheThumbnail(cache, request, canonicalKey, response);
        return response;
      }

      await Promise.allSettled([cache.delete(request), cache.delete(canonicalKey)]);
      if (response.status === 404 || isFallbackThumbnail(response)) {
        const fallback = neutralThumbnailResponse();
        await cacheThumbnail(cache, request, canonicalKey, fallback);
        return fallback;
      }
      return response;
    } catch {
      const fallback = neutralThumbnailResponse();
      await cacheThumbnail(cache, request, canonicalKey, fallback);
      return fallback;
    }
  })();

  thumbnailInflight.set(inflightKey, job);
  try { return (await job).clone(); }
  finally { thumbnailInflight.delete(inflightKey); }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/exact-news-thumbnail') {
    const replacement = new URL('/api/article-thumbnail', url.origin);
    replacement.search = url.search;
    event.respondWith(thumbnailResponse(new Request(replacement.href)));
    return;
  }
  if (url.pathname === '/api/article-thumbnail' || url.pathname === '/api/article-photo-fast') {
    event.respondWith(thumbnailResponse(event.request));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname === '/version.json') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request, CACHE).catch(() => caches.match('./index.html')));
});
