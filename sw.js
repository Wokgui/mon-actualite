const CACHE = 'mon-actualite-v31-live-summary';
const ASSETS = ['./', './index.html', './styles.css', './feedly-compact.css', './feedly-left.css', './ui-fixes-v2.css', './article-quickview.css', './feed-quality.css', './app.js', './feedly-runtime.js', './summary-fixes.js', './article-images.js', './article-quickview.js', './feed-quality.js', './brief-quality.js', './services/source-connectors.js', './manifest.webmanifest', './assets/app-icon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png'];

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
