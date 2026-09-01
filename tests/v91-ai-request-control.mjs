import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ai-request-control-v91.7.js', import.meta.url), 'utf8');
const calls = [];
let active = 0;
let maxActive = 0;
let activeModalTitle = '';

function parseBody(init = {}) {
  try { return JSON.parse(String(init?.body || '{}')); } catch { return {}; }
}

async function fakeFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input?.url || '';
  const url = new URL(raw, 'https://app.test/');
  const body = parseBody(init);
  active += 1;
  maxActive = Math.max(maxActive, active);
  calls.push({ path: url.pathname, search: url.search, body: String(init?.body || ''), at: Date.now() });

  let delay = 18;
  if (url.pathname === '/api/article-story-intelligence' && body?.id === 'foreground-blocker') delay = 900;
  await new Promise(resolve => setTimeout(resolve, delay));
  active -= 1;

  return new Response(JSON.stringify({
    ok: true,
    path: url.pathname,
    summary: url.pathname === '/api/article-summary-groq'
      ? 'Le modèle Groq fournit directement un résumé factuel prioritaire sans passer par un extrait de source intermédiaire.'
      : undefined
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

const location = { href: 'https://app.test/', origin: 'https://app.test' };
const document = {
  hidden: false,
  documentElement: { dataset: {} },
  querySelector(selector) {
    if (selector !== '.quick-summary-backdrop' || !activeModalTitle) return null;
    return {
      querySelector(inner) {
        if (!inner.includes('h2')) return null;
        return { textContent: activeModalTitle };
      }
    };
  }
};
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
vm.runInContext(source, context, { filename: 'ai-request-control-v91.7.js' });

const post = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const story = window.fetch('/api/article-story-intelligence?v=81', post({ id: 'story-priority' }));
const multi = window.fetch('/api/article-summary-multisource?v=1', post({ id: 'multi-priority' }));
const summary = window.fetch('/api/article-summary-groq?v=18', post({ id: 'summary-priority' }));
await Promise.all([story, multi, summary]);

assert.deepEqual(
  calls.slice(0, 3).map(call => call.path),
  ['/api/article-summary-groq', '/api/article-summary-multisource', '/api/article-story-intelligence'],
  'normal controlled AI work must keep summary-first serialization'
);
assert.equal(maxActive, 1, 'normal controlled AI calls must remain serialized');

const beforeDedup = calls.length;
const duplicateInit = post({ id: 'same-request' });
const [a, b] = await Promise.all([
  window.fetch('/api/article-summary-groq?v=18', duplicateInit),
  window.fetch('/api/article-summary-groq?v=18', duplicateInit)
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
const parisienResponse = await window.fetch('/api/article-summary-groq?v=18&intent=foreground', post({ mode: 'article', article: parisienArticle }));
const parisienData = await parisienResponse.json();
const parisienCalls = calls.slice(beforeParisien).map(call => call.path);
assert.deepEqual(parisienCalls, ['/api/article-summary-groq'], 'foreground Parisien article must go directly to Groq');
assert.match(parisienData.summary, /directement un résumé factuel/i, 'foreground response must come from Groq');

const genericArticle = {
  url: 'https://www.exemple.fr/monde/article-source.html',
  title: 'Un autre éditeur publie des faits nouveaux sur cet événement',
  source: 'Exemple Actualités'
};
const beforeGeneric = calls.length;
const genericResponse = await window.fetch('/api/article-summary-groq?v=18&intent=foreground', post({ mode: 'article', article: genericArticle }));
const genericData = await genericResponse.json();
const genericCalls = calls.slice(beforeGeneric).map(call => call.path);
assert.deepEqual(genericCalls, ['/api/article-summary-groq'], 'generic foreground article must also go directly to Groq');
assert.match(genericData.summary, /directement un résumé factuel/i);

const slowArticle = {
  url: 'https://www.exemple.fr/monde/resume-prioritaire.html',
  title: 'Un événement important doit être résumé sans attendre les tâches de fond',
  source: 'Source lente'
};
const blocker = window.fetch('/api/article-story-intelligence?v=81', post({ id: 'foreground-blocker' }));
await new Promise(resolve => setTimeout(resolve, 35));
activeModalTitle = slowArticle.title;
const foregroundStarted = Date.now();
const foregroundResponse = await window.fetch('/api/article-summary-groq?v=18', post({ mode: 'article', article: slowArticle }));
const foregroundElapsed = Date.now() - foregroundStarted;
const foregroundData = await foregroundResponse.json();
activeModalTitle = '';
assert.match(foregroundData.summary, /directement un résumé factuel/i, 'foreground lane must call Groq directly');
assert.ok(foregroundElapsed < 700, `foreground summary should bypass background work (${foregroundElapsed} ms)`);
assert.ok(active > 0, 'foreground response must be able to finish while a background request is still active');
await blocker;

const outsideBefore = calls.length;
await window.fetch('/api/news', { method: 'GET' });
assert.equal(calls.length, outsideBefore + 1, 'uncontrolled requests must pass through');

const control = window.__aiRequestControlV9142;
assert.equal(control.version, '91.42');
assert.equal(window.__aiRequestControlV917.version, '91.42', 'legacy diagnostics alias must point to the current controller');
assert.equal(window.__aiRequestControlV9112.version, '91.42', 'v91.12 diagnostics alias must point to the current controller');
assert.equal(document.documentElement.dataset.aiRequestControlVersion, '91.42');
assert.equal(control.requestPriority('/api/article-summary-groq'), 0);
assert.equal(control.requestPriority('/api/article-summary-groq', 'foreground'), -10);
assert.equal(control.requestPriority('/api/article-summary-multisource'), 1);
assert.equal(control.requestPriority('/api/article-story-intelligence'), 2);
assert.equal(control.stats().groqSourceShortcutDisabled, true, 'source-first shortcut must stay disabled');
assert.ok(control.stats().foregroundCompleted >= 3, 'foreground lane diagnostics should count direct Groq calls');
assert.ok(control.stats().deduped >= 1, 'dedupe counter should be exposed for diagnostics');

assert.ok(!source.includes('genericSourceFirstGroq'), 'generic source-first shortcut must not return');
assert.ok(!source.includes('parisienAwareGroq'), 'Parisien source-first shortcut must not return');

console.log('v91.42 direct-Groq AI request control checks passed');
