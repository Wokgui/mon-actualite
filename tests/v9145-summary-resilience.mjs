import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legacy = require('../api/article-summary.js');
const smart = require('../api/article-summary-smart.js');

function invoke(handler, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
      end(raw = '') { resolve({ statusCode: this.statusCode, headers, data: JSON.parse(String(raw || '{}')) }); }
    };
    Promise.resolve(handler({ method: 'POST', query: {}, body }, res)).catch(reject);
  });
}

const jsonLd = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'NewsArticle',
  headline: 'Une décision locale',
  articleBody: 'La mairie a adopté une nouvelle mesure lundi. Elle entrera en vigueur en octobre et concernera les habitants de six quartiers. Le conseil municipal a publié le calendrier détaillé de sa mise en œuvre.'
})}</script></head><body><p>Connexion requise.</p></body></html>`;
const structured = legacy.extractArticleContent(jsonLd);
assert.equal(structured.method, 'json-ld-articleBody');
assert.equal(structured.fullText, true);
assert.match(structured.text, /six quartiers/);

const metadata = '<html><head><meta property="og:description" content="Le tribunal a rendu sa décision mardi. La mesure prendra effet immédiatement et les parties disposent de dix jours pour faire appel."></head><body></body></html>';
const pageSnippet = legacy.extractArticleContent(metadata);
assert.equal(pageSnippet.method, 'page-metadata');
assert.equal(pageSnippet.fullText, false);
assert.match(pageSnippet.text, /dix jours/);

const feedSummary = 'Le conseil municipal a adopté la mesure lundi. Elle entrera en vigueur en septembre et concernera directement les habitants de la commune.';
assert.equal(legacy.trustedFeedFallback({ url: 'https://publisher.example/article' }, feedSummary), feedSummary);
assert.equal(legacy.trustedFeedFallback({ url: 'https://news.google.com/rss/articles/example' }, feedSummary), '',
  'a Google News headline cluster must never be treated as a publisher RSS snippet');

const article = {
  title: 'Une mesure locale entre en vigueur',
  source: 'Publisher',
  url: '',
  summary: feedSummary
};

const savedKey = process.env.GROQ_API_KEY;
const savedFetch = global.fetch;
delete process.env.GROQ_API_KEY;
const noKey = await invoke(smart, { article });
assert.equal(noKey.data.ok, true);
assert.equal(noKey.data.ai, false);
assert.equal(noKey.data.grounded, true);
assert.equal(noKey.data.unavailable, false);
assert.equal(noKey.data.fallbackQuality, 'trusted');
assert.equal(noKey.data.error, 'groq-key-missing');
assert.match(noKey.data.text, /conseil municipal/);

process.env.GROQ_API_KEY = 'gsk_test_only';
let requests = 0;
global.fetch = async () => {
  requests += 1;
  return Response.json({ error: { message: 'rate limited, try again in 0.01s' } }, {
    status: 429,
    headers: { 'retry-after': '0.01' }
  });
};
const limited = await invoke(smart, { article });
assert.equal(requests, 2, 'a short explicit rate limit should receive one bounded retry');
assert.equal(limited.data.ok, true);
assert.equal(limited.data.unavailable, false);
assert.equal(limited.data.error, 'rate-limit');
assert.equal(limited.data.diagnostics.groqAttempts.length, 2);
assert.match(limited.headers['cache-control'], /no-store/);

requests = 0;
global.fetch = async () => {
  requests += 1;
  const error = new Error('request timed out');
  error.name = 'AbortError';
  throw error;
};
const timedOut = await invoke(smart, { article });
assert.equal(requests, 1, 'a full timeout must not be multiplied by an immediate retry');
assert.equal(timedOut.data.ok, true);
assert.equal(timedOut.data.unavailable, false, 'a Groq timeout must fall back to trusted factual material');
assert.equal(timedOut.data.error, 'timeout');
assert.equal(timedOut.data.diagnostics.groqAttempts[0].error, 'timeout');

global.fetch = savedFetch;
if (savedKey == null) delete process.env.GROQ_API_KEY;
else process.env.GROQ_API_KEY = savedKey;

const demand = fs.readFileSync(new URL('../summary-demand-v91.43.js', import.meta.url), 'utf8');
const quickview = fs.readFileSync(new URL('../article-quickview.js', import.meta.url), 'utf8');
assert.match(demand, /data\?\.grounded === true[\s\S]*fallbackQuality/, 'the fetch interceptor must retain trusted grounded fallbacks');
assert.match(demand, /item\?\.ai === true \|\| item\?\.grounded === true/, 'successful grounded fallbacks must be reusable without caching failures');
assert.match(quickview, /cached\?\.ai === true \|\| cached\?\.grounded === true/, 'quick view must reopen a previously validated factual fallback');
assert.doesNotMatch(demand, /item\?\.unavailable[^\n]*writeJson/, 'unavailable results must not be persisted as successful summaries');

console.log('v91.45 resilient extraction, fallback, retry and cache checks passed');
