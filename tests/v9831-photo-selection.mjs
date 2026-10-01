import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cachedPhoto, photoKey, withPhotoBudget, photoSignal } = require('../lib/article-photo-cache.js');
const response = byte => ({ statusCode: 200, headers: new Map([['content-type', 'image/jpeg'], ['x-thumbnail-status', 'publisher-metadata']]), buffer: Buffer.alloc(4000, byte) });
assert.equal(photoKey({ url: 'https://example.test/story/?utm_source=x&b=2&a=1#top', title: 'old' }), photoKey({ url: 'https://example.test/story?a=1&b=2', title: 'new', id: 'changed' }));
let calls = 0;
const query = { url: 'https://example.test/shared' };
const results = await Promise.all(Array.from({ length: 20 }, () => cachedPhoto(query, async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return response(1); })));
assert.equal(calls, 1, 'concurrent selections share one promise');
assert.ok(results.every(result => result.result.buffer.equals(results[0].result.buffer)));
assert.equal((await cachedPhoto({ ...query, title: 'new title', image: 'https://other.test/photo.jpg' }, () => { throw new Error('cache miss'); })).cache, 'hit');
let failedCalls = 0;
for (let i = 0; i < 2; i++) await cachedPhoto({ url: 'https://example.test/failed' }, () => { failedCalls++; return { statusCode: 404, headers: new Map(), buffer: Buffer.alloc(0) }; });
assert.equal(failedCalls, 2, 'negative results must not poison the positive cache');
const handoff = { statusCode: 424, headers: new Map([['content-type', 'application/json']]), buffer: Buffer.from('{}') };
const mixed = { url: 'https://example.test/capability-isolation' };
const [newClient, oldClient] = await Promise.all([
  cachedPhoto({ ...mixed, clientRecovery: '1' }, async () => { await new Promise(r => setTimeout(r, 10)); return handoff; }),
  cachedPhoto(mixed, () => response(7))
]);
assert.equal(newClient.result.statusCode, 424);
assert.equal(oldClient.result.statusCode, 200, 'legacy clients never receive a client-only handoff');
assert.equal((await cachedPhoto({ ...mixed, clientRecovery: '1' }, () => handoff)).result.buffer[0], 7, 'positive bytes are shared across capabilities');
const concurrent = { url: 'https://example.test/capability-lock' };
const overlap = await Promise.all([
  cachedPhoto(concurrent, async () => { await new Promise(r => setTimeout(r, 30)); return response(1); }),
  cachedPhoto({ ...concurrent, clientRecovery: '1' }, () => response(2))
]);
assert.ok(overlap.every(r => r.result.buffer[0] === 2), 'later capability flight cannot replace the first positive selection');
await withPhotoBudget(10, async () => { const signal = photoSignal(500); await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(signal.aborted, 'global budget propagates to all resolver tiers'); });

const code = await readFile(new URL('../api/article-photo-fast.js', import.meta.url), 'utf8');
async function fixedAuthority(publisherDelay, searchDelay, suffix) {
  const photo = Buffer.alloc(4000, 1);
  // A real-shaped PNG header/dimensions makes the discovery photo acceptable.
  photo.write('PNG', 1, 'ascii'); photo.writeUInt32BE(600, 16); photo.writeUInt32BE(338, 20);
  const main = async (req, res) => { await new Promise(resolve => setTimeout(resolve, publisherDelay)); res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('X-Thumbnail-Status', 'publisher-metadata'); res.end(Buffer.alloc(4000, 9)); };
  const context = {
    module: { exports: {} }, Buffer, URL, URLSearchParams, AbortSignal, performance,
    require: spec => spec.includes('article-photo-resolver') ? main : require(spec.replace('../lib/', '../lib/')),
    fetch: async input => {
      const url = String(input);
      await new Promise(resolve => setTimeout(resolve, searchDelay));
      if (url.includes('/news/search')) return new Response('<rss><item><title>Un événement de contrôle scientifique confirmé</title><News:Image>https://cdn.example.test/discovery.png</News:Image></item></rss>');
      return new Response(photo, { headers: { 'content-type': 'image/png' } });
    }
  };
  vm.runInNewContext(code, context);
  const headers = new Map(); let body;
  await context.module.exports({ method: 'GET', query: { url: `https://example.test/${suffix}`, title: 'Un événement de contrôle scientifique confirmé' } }, { setHeader: (name, value) => headers.set(name.toLowerCase(), value), end: value => { body = value; } });
  assert.equal(headers.get('x-thumbnail-status'), 'publisher-metadata');
  assert.equal(body[0], 9, 'publisher wins regardless of network arrival order');
}
await fixedAuthority(90, 1, 'slow-publisher');
await fixedAuthority(1, 90, 'fast-publisher');
assert.doesNotMatch(code, /Promise\.any/, 'ranked candidates must not race for selection');
const handoffContext = { module: { exports: {} }, Buffer, URL, URLSearchParams, AbortSignal, performance,
  require: spec => spec.includes('article-photo-resolver') ? async (req, res) => {
    req.photoClientCandidates = [{ url: 'https://cdn.publisher.test/cover.jpg', publisherUrl: req.query.url }];
    res.statusCode = 404; res.end();
  } : require(spec), fetch: async () => { throw new Error('No search'); } };
vm.runInNewContext(code, handoffContext);
for (const capability of ['1', '']) {
  const headers = new Map(); let body;
  const res = { statusCode: 200, setHeader: (k, v) => headers.set(k.toLowerCase(), v), end: v => { body = v; } };
  await handoffContext.module.exports({ method: 'GET', query: { url: 'https://example.test/handoff-' + capability, exact: '1', clientRecovery: capability } }, res);
  assert.equal(res.statusCode, capability ? 424 : 404);
  assert.equal(headers.get('cache-control'), 'no-store', 'handoffs are never positive image cache entries');
  if (capability) assert.equal(JSON.parse(body).articleUrl, 'https://example.test/handoff-1');
}
console.log('Deterministic authority, canonical identity, single flight, positive-only cache and budget passed.');
