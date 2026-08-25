const CACHE = 'mon-actualite-v48-visual-retry';
const THUMB_CACHE = 'mon-actualite-thumbnails-v5-legacy';
const ASSETS = ['./', './index.html', './styles.css?v=43', './feedly-compact.css?v=43', './feedly-left.css?v=43', './ui-fixes-v2.css?v=43', './article-quickview.css?v=43', './feed-quality.css?v=43', './performance-v42.css?v=45', './personalization-v44.css?v=44', './bootstrap-v42.js?v=44', './stable-dom.js?v=44', './app.js?v=48', './feedly-runtime.js?v=45.3', './performance-v42.js?v=46', './summary-fixes.js?v=44', './article-quickview.js?v=44', './feed-quality.js?v=44.1', './services/source-connectors.js?v=45.3', './services/article-visuals.js?v=45.3', './manifest.webmanifest', './assets/app-icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
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

async function thumbnailResponse(request, event) {
  const cache = await caches.open(THUMB_CACHE);
  let cached = await cache.match(request);
  const isFallback = response => {
    const status = response?.headers?.get('X-Thumbnail-Status') || '';
    const type = response?.headers?.get('Content-Type') || '';
    return status === 'fallback' || /image\/svg\+xml/i.test(type);
  };
  if (cached && isFallback(cached)) {
    await cache.delete(request);
    cached = null;
  }
  const refresh = fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque' && !isFallback(response)) {
      cache.put(request, response.clone()).catch(() => {});
    } else if (isFallback(response)) {
      cache.delete(request).catch(() => {});
    }
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  try { return await refresh; }
  catch {
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="100%" height="100%" fill="#f1f1f1"/></svg>', {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Thumbnail-Status': 'fallback' }
    });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/article-thumbnail') {
    event.respondWith(thumbnailResponse(event.request, event));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // Static application shell is returned from cache immediately. Refresh in
  // the background so launching the installed PWA no longer waits on network.
  event.respondWith(staleWhileRevalidate(event.request, CACHE).catch(() => caches.match('./index.html')));
});
