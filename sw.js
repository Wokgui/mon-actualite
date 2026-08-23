const CACHE = 'mon-actualite-v40-fast-images-summaries';
const ASSETS = ['./', './index.html', './styles.css?v=40', './feedly-compact.css?v=40', './feedly-left.css?v=40', './ui-fixes-v2.css?v=40', './article-quickview.css?v=40', './feed-quality.css?v=40', './speed-fixes.css?v=40', './stable-dom.js?v=40', './app.js?v=40', './speed-fixes.js?v=40', './feedly-runtime.js?v=40', './summary-fixes.js?v=40', './article-quickview.js?v=40', './feed-quality.js?v=40', './brief-quality.js?v=40', './services/source-connectors.js', './manifest.webmanifest', './assets/app-icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
