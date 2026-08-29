const CACHE = 'mon-actualite-v75-three-line-titles';
const THUMB_CACHE = 'mon-actualite-thumbnails-v6-feedly';
const ASSETS = ['./', './index.html', './styles.css?v=53', './feedly-compact.css?v=44', './feedly-left.css?v=43', './ui-fixes-v2.css?v=43', './article-quickview.css?v=53', './feed-quality.css?v=43', './performance-v42.css?v=45', './personalization-v44.css?v=53', './bootstrap-v42.js?v=54', './stable-dom.js?v=44', './app.js?v=61', './feedly-runtime.js?v=61', './image-prewarm-v72.js?v=73', './summary-fixes.js?v=44', './article-quickview.js?v=56', './feed-quality.js?v=45', './source-discovery-ui.js?v=3', './services/source-connectors.js?v=45.3', './services/article-visuals.js?v=56', './manifest.webmanifest?v=60', './version.json', './assets/app-icon-192.png', './assets/app-icon-512.png', './assets/app-icon-maskable-512.png', './assets/apple-touch-icon-180.png'];

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
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Thumbnail-Status': 'neutral-fallback' }
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

async function thumbnailResponse(request, event) {
  const cache = await caches.open(THUMB_CACHE);
  const canonicalKey = thumbnailCacheKey(request);
  let cached = await cache.match(canonicalKey);
  if (!cached) {
    cached = await cache.match(request);
    if (cached && canonicalKey.url !== request.url) cache.put(canonicalKey, cached.clone()).catch(() => {});
  }

  const isFallback = response => {
    const status = response?.headers?.get('X-Thumbnail-Status') || '';
    const type = response?.headers?.get('Content-Type') || '';
    return status === 'fallback' || status === 'publisher-tile' || status === 'neutral-fallback' || /image\/svg\+xml/i.test(type);
  };

  if (cached && isFallback(cached)) {
    await Promise.allSettled([cache.delete(request), cache.delete(canonicalKey)]);
    cached = null;
  }

  const refresh = fetch(request, { cache: 'no-store' }).then(response => {
    if (response.ok && response.type !== 'opaque' && !isFallback(response)) {
      cache.put(request, response.clone()).catch(() => {});
      if (canonicalKey.url !== request.url) cache.put(canonicalKey, response.clone()).catch(() => {});
      return response;
    }
    cache.delete(request).catch(() => {});
    if (canonicalKey.url !== request.url) cache.delete(canonicalKey).catch(() => {});
    if (response.status === 404 || isFallback(response)) return neutralThumbnailResponse();
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  try { return await refresh; }
  catch { return neutralThumbnailResponse(); }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/article-thumbnail' || url.pathname === '/api/exact-news-thumbnail' || url.pathname === '/api/article-photo-fast') {
    event.respondWith(thumbnailResponse(event.request, event));
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
