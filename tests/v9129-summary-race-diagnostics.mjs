import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('summary-race-v78.js', 'utf8');

function install(fetchImpl) {
  const window = { fetch: fetchImpl };
  const context = {
    window,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    URL,
    Headers,
    Response,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context, { filename: 'summary-race-v78.js' });
  return window.fetch;
}

const article = { url: 'https://news.example/item', title: 'Un article test', summary: '' };
const init = { method: 'POST', body: JSON.stringify({ article }) };

{
  const fetch = install(async input => {
    const path = new URL(String(input), 'https://example.test').pathname;
    if (path.endsWith('-groq')) return Response.json({ unavailable: true, summary: '' });
    return Response.json({ ok: false, text: '' });
  });
  await fetch('/api/article-summary-groq', init);
  const response = await fetch('/api/article-summary-smart', init);
  assert.deepEqual(await response.json(), {
    ok: false,
    text: '',
    origin: 'parallel-timeout',
    raced: true
  }, 'normal candidate misses must produce the existing quiet fallback response');
}

{
  const generated = 'Un résumé suffisamment détaillé apporte des faits précis et utiles sans répéter simplement le titre publié.';
  const fetch = install(async input => {
    const path = new URL(String(input), 'https://example.test').pathname;
    if (path.endsWith('-groq')) return Response.json({ unavailable: false, summary: generated, ai: true });
    return Response.json({ ok: false, text: '' });
  });
  await fetch('/api/article-summary-groq', init);
  const response = await fetch('/api/article-summary-smart', init);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.text, generated);
  assert.equal(payload.origin, 'parallel-groq');
}

assert.doesNotMatch(source, /throw new Error\(['"](?:smart|groq) summary unavailable/, 'an expected unavailable candidate must not create a console error');
assert.match(source, /firstUseful\(candidates\)/, 'the race must still select the first usable summary');

console.log('v91.29 quiet summary race diagnostics passed');
