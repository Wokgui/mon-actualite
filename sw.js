const CACHE = 'mon-actualite-v38-feedly-layout';
const ASSETS = ['./', './index.html', './styles.css?v=38', './feedly-compact.css?v=38', './feedly-left.css?v=38', './ui-fixes-v2.css?v=38', './article-quickview.css?v=38', './feed-quality.css?v=38', './stable-dom.js?v=38', './app.js?v=38', './feedly-runtime.js?v=38', './summary-fixes.js?v=38', './article-quickview.js?v=38', './feed-quality.js?v=38', './brief-quality.js?v=38', './services/source-connectors.js', './manifest.webmanifest', './assets/app-icon.svg'];

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
