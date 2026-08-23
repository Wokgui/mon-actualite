const CACHE = 'mon-actualite-v41-responsive';
const THUMB_CACHE = 'mon-actualite-thumbnails-v1';
const ASSETS = ['./', './index.html', './styles.css?v=41', './feedly-compact.css?v=41', './feedly-left.css?v=41', './ui-fixes-v2.css?v=41', './article-quickview.css?v=41', './feed-quality.css?v=41', './performance-v41.css?v=41', './stable-dom.js?v=41', './app.js?v=41', './feedly-runtime.js?v=41', './performance-v41.js?v=41', './summary-fixes.js?v=41', './article-quickview.js?v=41', './feed-quality.js?v=41', './brief-quality.js?v=41', './services/source-connectors.js', './manifest.webmanifest', './assets/app-icon.svg'];

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

async function thumbnailResponse(request, event) {
  const cache = await caches.open(THUMB_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {});
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }

  try {
    return await refresh;
  } catch {
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="100%" height="100%" fill="#f1f1f1"/></svg>', {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }
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

  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
