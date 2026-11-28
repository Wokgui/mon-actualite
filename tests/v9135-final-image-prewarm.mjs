import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PREWARM_LIMIT,
  suppressCorePrewarmRequest,
  prewarmPhotoUrl
} = require('../lib/final-image-prewarm.js');

const apiSource = fs.readFileSync('api/news.js', 'utf8');

assert.equal(PREWARM_LIMIT, 16, 'v91.35 must keep the existing 16-image prewarm budget');

const original = {
  method: 'GET',
  headers: {
    host: 'mon-actualite.vercel.app',
    'x-forwarded-host': 'mon-actualite.vercel.app',
    'x-forwarded-proto': 'https'
  }
};
const suppressed = suppressCorePrewarmRequest(original);
assert.equal(original.headers.host, 'mon-actualite.vercel.app', 'suppressing the early prewarm must not mutate the real request');
assert.equal(suppressed.headers.host, undefined, 'the core capture request must not expose a host for its historical prewarm');
assert.equal(suppressed.headers['x-forwarded-host'], undefined, 'the forwarded host must also be hidden from the core prewarm');
assert.equal(suppressed.method, 'GET', 'the cloned request must preserve the API method');

const photoUrl = prewarmPhotoUrl('https://mon-actualite.vercel.app', {
  title: 'Article final important',
  url: 'https://example.test/story',
  image: '/api/article-thumbnail?v=18&image=https%3A%2F%2Fcdn.example.test%2Fphoto.jpg&exact=1',
  category: 'International',
  source: 'Exemple'
});
const parsed = new URL(photoUrl);
assert.equal(parsed.pathname, '/api/article-photo-fast');
assert.equal(parsed.searchParams.get('url'), 'https://example.test/story');
assert.equal(parsed.searchParams.get('image'), 'https://cdn.example.test/photo.jpg');
assert.equal(parsed.searchParams.get('v'), '98.31', 'server warming should align with the current photo URL generation');

const rankIndex = apiSource.indexOf('rankCatalogArticles(uniqueCandidates)');
const scheduleIndex = apiSource.indexOf('scheduleFinalImagePrewarm(req, articles)');
assert.ok(rankIndex >= 0 && scheduleIndex > rankIndex,
  'image prewarming must be scheduled only after semantic deduplication and final catalogue ranking');
assert.match(apiSource, /coreHandler\(suppressCorePrewarmRequest\(req\), capture\)/,
  'the historical core prewarm must be suppressed for the wrapped /api/news route');
assert.match(apiSource, /prewarmStageV9135:\s*'final-ranked-catalog'/,
  'production diagnostics must expose the final-ranked prewarm stage');
assert.match(apiSource, /articles\.splice\(CATALOG_LIMIT\)/,
  'the final prewarm source must be the bounded final-ranked catalogue');
assert.match(fs.readFileSync('lib/final-image-prewarm.js', 'utf8'), /articles\.slice\(0, PREWARM_LIMIT\)/,
  'the actual prewarm worker must never warm beyond the first 16 final-ranked articles');

console.log('v91.35 final-ranked image prewarm checks passed');
