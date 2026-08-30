import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ai-request-control-v91.7.js', import.meta.url), 'utf8');
const smartApi = fs.readFileSync(new URL('../api/article-summary-smart.js', import.meta.url), 'utf8');
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
  const article = body?.article || {};
  active += 1;
  maxActive = Math.max(maxActive, active);
  calls.push({ path: url.pathname, body: String(init?.body || ''), at: Date.now() });

  let delay = 18;
  if (url.pathname === '/api/article-story-intelligence' && body?.id === 'foreground-blocker') delay = 900;
  if (url.pathname === '/api/article-summary-smart' && /Source lente/i.test(String(article.source || ''))) delay = 700;
  await new Promise(resolve => setTimeout(resolve, delay));
  active -= 1;

  if (url.pathname === '/api/article-summary-smart') {
    const parisien = /le parisien/i.test(String(article.source || ''));
    return new Response(JSON.stringify({
      ok: true,
      text: parisien
        ? 'Le résumé spécialisé du Parisien fournit ici suffisamment de faits précis pour éviter un second appel au modèle Groq.'
        : 'Le résumé sourcé de cet autre éditeur confirme plusieurs faits précis de l’article et permet de répondre sans solliciter inutilement le modèle Groq.',
      grounded: true,
      origin: parisien ? 'publisher-rss' : 'bing-news-rss'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({
    ok: true,
    path: url.pathname,
    summary: url.pathname === '/api/article-summary-groq'
      ? 'Le modèle Groq fournit un résumé factuel de premier plan sans attendre la fin des préchargements exécutés en arrière-plan.'
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
const summary = window.fetch('/api/article-summary-groq?v=17', post({ id: 'summary-priority' }));
await Promise.all([story, multi, summary]);

assert.deepEqual(
  calls.slice(0, 3).map(call => call.path),
  ['/api/article-summary-groq', '/api/article-summary-multisource', '/api/article-story-intelligence'],
  'normal controlled AI work must keep summary-first serialization'
);
assert.equal(maxActive, 1, 'normal controlled AI calls must be serialized before source-first traffic starts');

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
const parisienGroq = window.fetch('/api/article-summary-groq?v=17&intent=foreground', post({ mode: 'article', article: parisienArticle }));
await window.fetch('/api/article-summary-smart?v=4', post({ article: parisienArticle }));
const parisienResponse = await parisienGroq;
const parisienData = await parisienResponse.json();
const parisienCalls = calls.slice(beforeParisien).map(call => call.path);
assert.ok(parisienCalls.includes('/api/article-summary-smart'), 'Parisien smart recovery must run');
assert.ok(!parisienCalls.includes('/api/article-summary-groq'), 'Groq must be skipped when Parisien smart recovery succeeds during the foreground grace window');
assert.match(parisienData.summary, /résumé spécialisé du Parisien/i, 'synthetic response should reuse the specialized Parisien summary');

const genericArticle = {
  url: 'https://www.exemple.fr/monde/article-source.html',
  title: 'Un autre éditeur publie des faits nouveaux sur cet événement',
  source: 'Exemple Actualités'
};
const beforeGeneric = calls.length;
const genericResponse = await window.fetch('/api/article-summary-groq?v=17', post({ mode: 'article', article: genericArticle }));
const genericData = await genericResponse.json();
const genericCalls = calls.slice(beforeGeneric).map(call => call.path);
assert.ok(genericCalls.includes('/api/article-summary-smart'), 'generic source-first recovery must be attempted');
assert.ok(!genericCalls.includes('/api/article-summary-groq'), 'Groq must be skipped when a generic sourced summary succeeds during the grace window');
assert.match(genericData.summary, /autre éditeur/i, 'generic smart summary should be returned through the Groq-compatible response');

const slowArticle = {
  url: 'https://www.exemple.fr/monde/resume-prioritaire.html',
  title: 'Un événement important doit être résumé sans attendre les tâches de fond',
  source: 'Source lente'
};
const blocker = window.fetch('/api/article-story-intelligence?v=81', post({ id: 'foreground-blocker' }));
await new Promise(resolve => setTimeout(resolve, 35));
activeModalTitle = slowArticle.title;
const foregroundStarted = Date.now();
const foregroundResponse = await window.fetch('/api/article-summary-groq?v=17', post({ mode: 'article', article: slowArticle }));
const foregroundElapsed = Date.now() - foregroundStarted;
const foregroundData = await foregroundResponse.json();
activeModalTitle = '';
assert.match(foregroundData.summary, /premier plan/i, 'foreground lane must fall back to Groq when source-first recovery is too slow');
assert.ok(foregroundElapsed < 700, `foreground summary should not wait for the 2.8 s background grace (${foregroundElapsed} ms)`);
assert.ok(active > 0, 'foreground response must be able to finish while a background request is still active');
await blocker;

const outsideBefore = calls.length;
await window.fetch('/api/news', { method: 'GET' });
assert.equal(calls.length, outsideBefore + 1, 'uncontrolled requests must pass through');

const control = window.__aiRequestControlV9112;
assert.equal(control.version, '91.12');
assert.equal(window.__aiRequestControlV917.version, '91.12', 'legacy diagnostics alias must point to the current controller');
assert.equal(document.documentElement.dataset.aiRequestControlVersion, '91.12');
assert.equal(control.requestPriority('/api/article-summary-groq'), 0);
assert.equal(control.requestPriority('/api/article-summary-groq', 'foreground'), -10);
assert.equal(control.requestPriority('/api/article-summary-multisource'), 1);
assert.equal(control.requestPriority('/api/article-story-intelligence'), 2);
assert.equal(control.stats().foregroundGenericGraceMs, 450);
assert.ok(control.stats().foregroundCompleted >= 1, 'foreground lane diagnostics should count completed foreground Groq calls');
assert.ok(control.stats().deduped >= 1, 'dedupe counter should be exposed for diagnostics');
assert.ok(control.stats().smartGroqAvoided >= 2, 'source-first Groq avoidance should cover Parisien and generic sources');

assert.ok(smartApi.includes('genericSources: true'), 'smart summary status must expose generic source support');
assert.ok(!smartApi.includes("return send(res, 400, { error: 'Source non prise en charge' })"), 'smart summary API must no longer reject non-Parisien sources');
assert.ok(smartApi.includes('publié par ${sourceText}'), 'grounded search prompt must include the actual publisher');

console.log('v91.12 foreground AI request control checks passed');