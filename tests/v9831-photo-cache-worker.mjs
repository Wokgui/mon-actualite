import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const listeners = new Map(), stores = new Map();
const key = request => typeof request === 'string' ? request : request.url;
let fetches = 0, neutral = false, corrupt = false;
const context = {
  URL, Request, Response, Headers, Date, Map, Promise,
  createImageBitmap: async blob => {
    if (new Uint8Array(await blob.arrayBuffer())[0] === 9) throw new Error('Corrupt bytes');
    return { width: 600, height: 338, close() {} };
  },
  self: { location: { origin: 'https://app.test' }, addEventListener: (name, fn) => listeners.set(name, fn), skipWaiting() {}, clients: { claim() {} } },
  caches: {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) { store.set(key(request), response.clone()); },
        async delete(request) { return store.delete(key(request)); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  },
  fetch: async () => {
    fetches++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response(new Uint8Array([corrupt ? 9 : 1, 2, 3, 4]), { headers: { 'Content-Type': neutral ? 'image/svg+xml' : 'image/jpeg', 'X-Thumbnail-Status': neutral ? 'neutral-fallback' : 'publisher-metadata' } });
  }
};
vm.runInNewContext(await readFile(new URL('../sw-v98.js', import.meta.url), 'utf8'), context);
function request(path, article, title = '') {
  const url = new URL(path, 'https://app.test');
  url.searchParams.set('url', article);
  url.searchParams.set('title', title);
  let result;
  listeners.get('fetch')({ request: new Request(url), respondWith(promise) { result = promise; } });
  return result;
}
const responses = await Promise.all([
  request('/api/article-photo-fast', 'https://publisher.test/story/?utm_source=old', 'old'),
  request('/api/article-thumbnail', 'https://publisher.test/story', 'new'),
  request('/api/article-photo', 'https://publisher.test/story#top', 'other')
]);
assert.equal(fetches, 1, 'endpoint aliases and changed hints share one worker request');
assert.deepEqual(await Promise.all(responses.map(response => response.text())), Array(3).fill('\u0001\u0002\u0003\u0004'), 'each response has an independently readable body');
await (await request('/api/article-photo-fast', 'https://publisher.test/story')).text();
assert.equal(fetches, 1, 'positive cache survives a rerender');
neutral = true;
await request('/api/article-photo-fast', 'https://publisher.test/negative');
neutral = false;
assert.equal((await request('/api/article-photo-fast', 'https://publisher.test/negative')).headers.get('X-Thumbnail-Status'), 'publisher-metadata');
assert.equal(fetches, 3, 'temporary fallback is never cached');
corrupt = true;
assert.equal((await request('/api/article-photo-fast', 'https://publisher.test/corrupt')).status, 422);
corrupt = false;
assert.equal((await request('/api/article-photo-fast', 'https://publisher.test/corrupt')).status, 200);
assert.equal(fetches, 5, 'corrupt raster bytes are rejected and never pinned');
const store = stores.get('mon-actualite-thumbnails-v11');
for (const [url, response] of store) {
  const headers = new Headers(response.headers);
  headers.set('X-Photo-Cached-At', '1');
  store.set(url, new Response(await response.arrayBuffer(), { headers }));
}
await request('/api/article-photo-fast', 'https://publisher.test/story');
assert.equal(fetches, 6, 'expired positives are fetched again');
stores.set('mon-actualite-thumbnails-v9', new Map());
stores.set('unrelated-cache', new Map());
let activation;
listeners.get('activate')({ waitUntil(promise) { activation = promise; } });
await activation;
assert.ok(!stores.has('mon-actualite-thumbnails-v9'));
assert.ok(stores.has('unrelated-cache'));
console.log('Worker canonical single flight, independent bodies, positive-only TTL cache and scoped migration passed.');
