import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
