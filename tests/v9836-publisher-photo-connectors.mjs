import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const connectors = require('../lib/publisher-photo-connectors.js');
let calls = 0;
const cover = 'https://medias.lequipe.fr/img-photo-jpg/portrait/100/0-{width}-{height}-{quality}/photo.jpg';
const io = {
  photoSignal: () => AbortSignal.timeout(1000), decode: text => text.replace(/&#039;/g, "'"),
  fetchWithRedirects: async url => {
    calls++;
    if (url.includes('/rss?')) return { response: new Response('<rss><item><title>Un événement sportif précis confirmé demain à Paris</title><link>https://www.lequipe.fr/Football/Actualites/story/7001</link><enclosure url="https://cdn.test/logo.png"/></item></rss>') };
    const id = url.split('/').pop();
    return { response: new Response(JSON.stringify({ id: Number(id), metas: { canonical: 'https://www.lequipe.fr/Football/Actualites/story/' + id, sharing_image: { url: cover } }, medias: [{ __type: 'image', featured: true, url: cover }] })) };
  }
};
const query = { url: 'https://www.lequipe.fr/Football/Actualites/story/7000', title: 'Story', source: 'lequipe.fr' };
const results = await Promise.all(Array.from({ length: 12 }, () => connectors(query, io)));
assert.equal(calls, 1, 'publisher metadata shares a single request');
assert.ok(results.every(result => result.images.length === 1 && result.images[0].includes('720-480-80')));
assert.equal((await connectors(query, io)).publisherUrl, query.url);
assert.equal(calls, 1, 'positive metadata cache survives repeated selection');
const indirect = await connectors({ url: 'https://news.google.com/rss/articles/indirect', title: 'Un événement sportif précis confirmé demain à Paris - lequipe.fr', source: 'lequipe.fr' }, io);
assert.equal(indirect.publisherUrl, 'https://www.lequipe.fr/Football/Actualites/story/7001');
assert.ok(!indirect.images.some(image => image.includes('logo')), 'official RSS logos are never article covers');
assert.equal(await connectors({ url: 'https://example.test/7000', title: 'Story', source: 'lequipe.fr' }, io), null, 'unrelated domains cannot invoke a publisher connector');
let mismatches = 0;
for (let i = 0; i < 2; i++) await assert.rejects(connectors({ ...query, url: query.url.replace('7000', '7002') }, { ...io, fetchWithRedirects: async () => { mismatches++; return { response: new Response(JSON.stringify({ id: 123, metas: { canonical: query.url } })) }; } }), /identity mismatch/);
assert.equal(mismatches, 2, 'failed metadata is never permanently cached');
console.log('Publisher canonical identity, single flight, positive cache, official feed recovery and no RSS logo substitution passed.');

// A public publisher returning 403 must recover its exact cover before search.
const resolverRequire = createRequire(new URL('../lib/article-photo-resolver.js', import.meta.url));
const requested = [];
const bytes = Buffer.alloc(4000, 1);
bytes.write('PNG', 1, 'ascii'); bytes.writeUInt32BE(600, 16); bytes.writeUInt32BE(338, 20);
const ctx = { module: { exports: {} }, Buffer, URL, URLSearchParams, TextDecoder, AbortSignal, console,
  require: spec => spec === 'node:dns' ? { promises: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] } } : resolverRequire(spec),
  fetch: async input => {
    const url = String(input); requested.push(url);
    if (url.startsWith('https://blocked-publisher.test/')) return new Response('', { status: 403 });
    if (url.startsWith('https://api.microlink.io/')) {
      assert.equal(new URL(url).searchParams.get('url'), 'https://blocked-publisher.test/exact-story');
      return new Response(JSON.stringify({ status: 'success', data: { image: { url: 'https://cdn.publisher.test/exact-cover.png' } } }), { headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://cdn.publisher.test/exact-cover.png') return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    throw new Error('Unexpected third-party search: ' + url);
  }
};
vm.runInNewContext(await readFile(new URL('../lib/article-photo-resolver.js', import.meta.url), 'utf8'), ctx);
const headers = new Map(); let body;
await ctx.module.exports({ method: 'GET', query: { url: 'https://blocked-publisher.test/exact-story', publisherOnly: '1' } }, {
  setHeader: (key, value) => headers.set(key.toLowerCase(), value), end: value => { body = value; }
});
assert.equal(headers.get('x-thumbnail-status'), 'publisher-rendered-metadata');
assert.equal(body.length, 4000);
assert.equal(requested.length, 3, 'one public page, one exact metadata lookup, one validated cover');
console.log('Blocked publisher recovery retains exact URL identity and publisher authority before search.');
