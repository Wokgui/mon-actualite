const CORE_CACHE = 'mon-actualite-v98-58-core-r1';
const THUMB_CACHE = 'mon-actualite-thumbnails-v11';
const PHOTO_BODY_CACHE = 'mon-actualite-photo-bodies-v1';
const PHOTO_TTL_MS = 7 * 86400000;
const thumbnailInflight = new Map();
const ASSETS = ['./', './index.html', './version.json', './assets/article-image-unavailable-v98.39.png', './styles.css?v=53', './app-controls.css?v=98.58', './loading-and-text-v98.12.css?v=98.58',
  './app.js?v=98.58', './image-pipeline.js?v=98.58', './services/article-photos.js?v=98.58', './services/brief-groq.js?v=98.58', './services/brief-presentation.js?v=98.58',
  './services/article-visuals.js?v=98.58', './services/source-connectors.js?v=98.58', './manifest.webmanifest?v=98.10',
  './startup-stability-v98.15.js?v=98.17', './release-watch.js?v=98.58', './premium-adaptive-theme-v98.20.css?v=98.58', './article-access-v91.48.js?v=91.88',
  './startup-news-prefetch-v91.83.js?v=98.26', './nav-solid-hardfix-v91.89.js?v=98.10',
  './ui-settings-fix-v98.11.js?v=98.12', './brief-prefetch-v98.15.js?v=98.58'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CORE_CACHE);
  await Promise.allSettled(ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' }))));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('mon-actualite-') && ![CORE_CACHE, THUMB_CACHE, PHOTO_BODY_CACHE].includes(name)).map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

async function navigation(request) {
  const cache = await caches.open(CORE_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch { return await cache.match('./index.html') || new Response('Hors connexion', { status: 503 }); }
}

async function staticAsset(request) {
  const cache = await caches.open(CORE_CACHE);
  // Versioned assets are immutable in this cache; do not re-fetch every rerender.
  const cached = await cache.match(request);
  if (cached && new URL(request.url).searchParams.has('v')) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch { return cached || new Response('', { status: 503 }); }
}

function thumbnailKey(request) {
  const source = new URL(request.url);
  let identity = source.searchParams.get('url') || '';
  try {
    const article = new URL(identity);
    article.hash = '';
    for (const key of [...article.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) article.searchParams.delete(key);
    article.searchParams.sort();
    article.pathname = article.pathname.replace(/\/$/, '') || '/';
    identity = article.href;
  } catch {}
  identity ||= source.searchParams.get('id') || source.searchParams.get('image') || (source.searchParams.get('source') || '') + '|' + (source.searchParams.get('title') || '');
  const key = new URL('/__cached-article-photo-v11', self.location.origin);
  key.searchParams.set('article', identity);
  return new Request(key.href);
}

function positive(response) {
  const status = response.headers.get('X-Thumbnail-Status') || '';
  const type = response.headers.get('Content-Type') || '';
  return response.ok && /^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(type) && !/fallback|tile|neutral/i.test(status);
}

async function thumbnail(request) {
  const cache = await caches.open(THUMB_CACHE);
  const key = thumbnailKey(request);
  const cached = await cache.match(key);
  const at = Number(cached?.headers.get('X-Photo-Cached-At') || 0);
  if (cached && positive(cached) && Date.now() - at < PHOTO_TTL_MS) return cached;
  if (cached) await cache.delete(key);
  if (!thumbnailInflight.has(key.url)) {
    const task = (async () => {
      try {
        const response = await fetch(request);
        if (!positive(response)) return response;
        const headers = new Headers(response.headers);
        headers.set('X-Photo-Cached-At', String(Date.now()));
        const stored = new Response(await response.arrayBuffer(), { status: response.status, headers });
        // MIME/header checks alone can accept truncated or undecodable bytes.
        // Persist only images that this browser can actually decode. Without
        // worker bitmap support the page still validates, but no bytes are pinned.
        if (typeof createImageBitmap !== 'function') return stored;
        try {
          const bitmap = await createImageBitmap(await stored.clone().blob());
          const valid = bitmap.width >= 2 && bitmap.height >= 2;
          bitmap.close();
          if (!valid) throw new Error('Invalid photo dimensions');
        } catch {
          return new Response('', { status: 422, headers: { 'Cache-Control': 'no-store', 'X-Thumbnail-Status': 'invalid-image' } });
        }
        await cache.put(key, stored.clone());
        return stored;
      } catch { return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
    })().finally(() => thumbnailInflight.delete(key.url));
    thumbnailInflight.set(key.url, task);
  }
  // Response bodies are streams. Each consumer needs its own clone.
  return (await thumbnailInflight.get(key.url)).clone();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(navigation(request)); return; }
  if (request.method === 'GET' && url.origin === self.location.origin && ['/api/article-photo-fast', '/api/article-photo', '/api/article-thumbnail'].includes(url.pathname)) {
    event.respondWith(thumbnail(request)); return;
  }
  if (request.method === 'GET' && url.origin === self.location.origin) event.respondWith(staticAsset(request));
});
