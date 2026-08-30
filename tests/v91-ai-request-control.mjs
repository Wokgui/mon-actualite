import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ai-request-control-v91.5.js', import.meta.url), 'utf8');
const calls = [];
let active = 0;
let maxActive = 0;

async function fakeFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input?.url || '';
  const url = new URL(raw, 'https://app.test/');
  active += 1;
  maxActive = Math.max(maxActive, active);
  calls.push({ path: url.pathname, body: String(init?.body || ''), at: Date.now() });
  await new Promise(resolve => setTimeout(resolve, 18));
  active -= 1;
  if (url.pathname === '/api/article-summary-smart') {
    return new Response(JSON.stringify({
      ok: true,
      text: 'Le résumé spécialisé du Parisien fournit ici suffisamment de faits précis pour éviter un second appel au modèle Groq.',
      grounded: true,
      origin: 'publisher-rss'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const location = { href: 'https://app.test/', origin: 'https://app.test' };
const document = { hidden: false, documentElement: { dataset: {} } };
const window = { fetch: fakeFetch, location };
const context = vm.createContext({
  window,
  document,
  location,
  URL,
  URLSearchParams,
  Request,
  Response,
  Headers,
  Promise,
  setTimeout,
  clearTimeout,
  console
});
vm.runInContext(source, context, { filename: 'ai-request-control-v91.5.js' });

const post = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const story = window.fetch('/api/article-story-intelligence?v=81', post({ id: 'story-priority' }));
const multi = window.fetch('/api/article-summary-multisource?v=1', post({ id: 'multi-priority' }));
const summary = window.fetch('/api/article-summary-groq?v=17', post({ id: 'summary-priority' }));
await Promise.all([story, multi, summary]);

assert.deepEqual(
  calls.slice(0, 3).map(call => call.path),
  ['/api/article-summary-groq', '/api/article-summary-multisource', '/api/article-story-intelligence'],
  'visible summary must run before lower-priority AI work'
);
assert.equal(maxActive, 1, 'controlled AI calls must be serialized');

const beforeDedup = calls.length;
const duplicateInit = post({ id: 'same-request' });
const [a, b] = await Promise.all([
  window.fetch('/api/article-summary-groq?v=17', duplicateInit),
  window.fetch('/api/article-summary-groq?v=17', duplicateInit)
]);
assert.equal(a.status, 200);
assert.equal(b.status, 200);
assert.equal(calls.length, beforeDedup + 1, 'identical in-flight request must hit upstream only once');

const parisienArticle = {
  url: 'https://www.leparisien.fr/politique/exemple-30-08-2026.html',
  title: 'Un article du Parisien avec des informations précises',
  source: 'Le Parisien'
};
const beforeParisien = calls.length;
const parisienGroq = window.fetch('/api/article-summary-groq?v=17', post({ mode: 'article', article: parisienArticle }));
await window.fetch('/api/article-summary-smart?v=3', post({ article: parisienArticle }));
const parisienResponse = await parisienGroq;
const parisienData = await parisienResponse.json();
const parisienCalls = calls.slice(beforeParisien).map(call => call.path);
assert.ok(parisienCalls.includes('/api/article-summary-smart'), 'Parisien smart recovery must run');
assert.ok(!parisienCalls.includes('/api/article-summary-groq'), 'Groq must be skipped when Parisien smart recovery succeeds during the grace window');
assert.match(parisienData.summary, /résumé spécialisé du Parisien/i, 'synthetic Groq response should reuse the specialized Parisien summary');

const outsideBefore = calls.length;
await window.fetch('/api/news', { method: 'GET' });
assert.equal(calls.length, outsideBefore + 1, 'uncontrolled requests must pass through');

const control = window.__aiRequestControlV915;
assert.equal(control.version, '91.5');
assert.equal(document.documentElement.dataset.aiRequestControlVersion, '91.5');
assert.equal(control.requestPriority('/api/article-summary-groq'), 0);
assert.equal(control.requestPriority('/api/article-summary-multisource'), 1);
assert.equal(control.requestPriority('/api/article-story-intelligence'), 2);
assert.ok(control.stats().deduped >= 1, 'dedupe counter should be exposed for diagnostics');
assert.ok(control.stats().parisienGroqAvoided >= 1, 'Parisien Groq avoidance should be exposed for diagnostics');

console.log('v91.5 AI request control checks passed');
