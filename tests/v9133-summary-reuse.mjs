import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('summary-race-v78.js', 'utf8');

function install(fetchImpl) {
  const listeners = new Map();
  const document = {
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  const local = new Map();
  const localStorage = {
    getItem(key) { return local.has(key) ? local.get(key) : null; },
    setItem(key, value) { local.set(key, String(value)); }
  };
  const window = { fetch: fetchImpl };
  const context = {
    window,
    document,
    localStorage,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    performance: { now: () => Date.now() },
    URL,
    Headers,
    Response,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context, { filename: 'summary-race-v78.js' });
  return { fetch: window.fetch, listeners, localStorage, stats: window.__summaryLatencyV9133 };
}

const generated = 'Un résumé suffisamment détaillé apporte des faits précis et utiles sans répéter simplement le titre publié.';
const article = { id: 'a1', url: 'https://news.example/item', title: 'Un article test', summary: '' };
const init = { method: 'POST', body: JSON.stringify({ article }) };

{
  let calls = 0;
  const { fetch, stats } = install(async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 25));
    return Response.json({ unavailable: false, summary: generated, ai: true });
  });

  const first = fetch('/api/article-summary-groq', init);
  const second = fetch('/api/article-summary-groq', init);
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls, 1, 'two concurrent Groq requests for the same article must share one upstream request');
  assert.equal((await one.json()).summary, generated);
  assert.equal((await two.json()).summary, generated);
  assert.equal(stats.groqStarted, 1);
  assert.equal(stats.groqReused, 1);
}

assert.match(source, /pointerdown/, 'Android pointerdown must start summary warming before click');
assert.match(source, /news-live-cache/, 'pointer warming must resolve the live article from the feed cache');
assert.match(source, /__summaryLatencyV9133/, 'v91.33 must expose local latency diagnostics');
assert.match(source, /reusedInflight/, 'reused in-flight responses must be identifiable');

console.log('v91.33 summary reuse checks passed');
