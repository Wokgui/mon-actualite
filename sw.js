const CACHE = 'mon-actualite-v92-04-core-r2';
const COMPAT_DIAGNOSTIC = 'v92.04-core';
const THUMB_CACHE = 'mon-actualite-thumbnails-v6-feedly';
const THUMB_NEGATIVE_TTL_MS = 90 * 1000;
const thumbnailInflight = new Map();
const ASSETS = [
  './',
  './index.html',
  './version.json',
  './styles.css?v=53',
  './feedly-compact.css?v=44',
  './feedly-left.css?v=43',
  './ui-fixes-v2.css?v=43',
  './ui-polish-v91.64.css?v=91.64',
  './structural-stability-v91.38.11.css?v=91.40',
  './fresh-ui-v91.82.css?v=91.83',
  './stability-v91.84.css?v=1',
  './simplify-v91.85.css?v=1', './polish-v91.86.css?v=1', './polish-v91.87.css?v=1', './theme-blue-v91.88.css?v=2', './nav-solid-hardfix-v91.89.css?v=1', './theme-periwinkle-v91.90.css?v=2', './top-continuity-v91.92.css?v=1', './nav-stability-separator-v91.93.css?v=2', './s23-header-polish-v91.94.css?v=2', './feed-row-fix-v91.97.css?v=3',
  './release-watch.js?v=92.04',
  './article-access-v91.48.js?v=91.88',
  './startup-news-prefetch-v91.83.js?v=91.88',
  './app.js?v=92.04',
  './image-sequence-v91.82.js?v=92.04', './nav-solid-hardfix-v91.89.js?v=1', './ui-controls-v95.js?v=2',
  './services/source-connectors.js?v=91.97', './services/article-visuals.js?v=92.04',
  './services/article-visuals.js?v=57',
  './manifest.webmanifest?v=92.04',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './assets/app-icon-maskable-512.png',
  './assets/apple-touch-icon-180.png'
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' }))));
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== THUMB_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
async function staleWhileRevalidate(request, cacheName) { const cache = await caches.open(cacheName); const cached = await cache.match(request); const network = fetch(request).then(response => { if (response.ok && response.type !== 'opaque') cache.put(request, response.clone()).catch(() => {}); return response; }); if (cached) return cached; return network; }
async function cachedNavigation() { const cache = await caches.open(CACHE); return (await cache.match('./index.html')) || (await cache.match('./')) || null; }
async function refreshNavigation(request) { const cache = await caches.open(CACHE); try { const response = await fetch(request, { cache: 'no-store' }); if (response.ok && response.type !== 'opaque') await Promise.allSettled([cache.put('./index.html', response.clone()),cache.put('./', response.clone())]); } catch {} }
async function navigationResponse(request) { const cached = await cachedNavigation(); if (cached) return cached; try { return await fetch(request, { cache: 'no-store' }); } catch { return new Response('Hors connexion', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); } }
function neutralThumbnailResponse() { return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" rx="22" fill="#f1f1f4"/><path d="M0 340 150 225l64 43 66-67 179 129H0Z" fill="#d7d7de"/><circle cx="490" cy="115" r="39" fill="#dedee4"/></svg>', {status:200,headers:{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=90','X-Thumbnail-Status':'neutral-fallback','X-Thumbnail-Cached-At':String(Date.now())}}); }
function thumbnailCacheKey(request) { try { const source=new URL(request.url),key=new URL('/__cached-article-thumbnail',self.location.origin),articleUrl=source.searchParams.get('url')||'',title=source.searchParams.get('title')||'',image=source.searchParams.get('image')||'';if(articleUrl)key.searchParams.set('url',articleUrl);else if(title)key.searchParams.set('title',title);else if(image)key.searchParams.set('image',image);else return request;return new Request(key.href);}catch{return request;} }
function isFallbackThumbnail(response){return response?.headers?.get('X-Thumbnail-Status')==='neutral-fallback'}
async function thumbnailResponse(request){const cache=await caches.open(THUMB_CACHE),key=thumbnailCacheKey(request),cached=await cache.match(key);if(cached&&!isFallbackThumbnail(cached))return cached;if(cached&&isFallbackThumbnail(cached)){const at=Number(cached.headers.get('X-Thumbnail-Cached-At')||0);if(Date.now()-at<THUMB_NEGATIVE_TTL_MS)return cached}const id=key.url;if(thumbnailInflight.has(id))return thumbnailInflight.get(id);const task=(async()=>{try{const response=await fetch(request,{cache:'no-store'});if(response.ok){await cache.put(key,response.clone()).catch(()=>{});return response}}catch{}const fallback=neutralThumbnailResponse();await cache.put(key,fallback.clone()).catch(()=>{});return fallback})().finally(()=>thumbnailInflight.delete(id));thumbnailInflight.set(id,task);return task}
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.mode==='navigate'){event.respondWith(navigationResponse(request));event.waitUntil(refreshNavigation(request));return}if(url.origin===self.location.origin&&url.pathname==='/api/article-photo-fast'){event.respondWith(thumbnailResponse(request));return}if(request.method==='GET'&&url.origin===self.location.origin){event.respondWith(staleWhileRevalidate(request,CACHE));}});