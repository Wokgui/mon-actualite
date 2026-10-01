import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const evidence = process.argv[2] || 'test-results/photos-v9831';
const driverStallMs = Math.max(0, Math.min(300, Number(process.env.PHOTO_DRIVER_STALL_MS) || 0));
await mkdir(evidence, { recursive: true });
const png = await readFile(new URL('../assets/science-energie.png', import.meta.url));
const articles = Array.from({ length: 80 }, (_, i) => ({ id: `photo-${i}`, title: `Article ${i} de contrôle du chargement stable des images`, source: 'Source test', category: 'Politique', summary: 'Contrôle du pipeline photo.', score: 200 - i, publishedAt: new Date(Date.now() - i * 60000).toISOString(), url: `https://example.test/photo/${i}`, image: i === 1 ? 'https://cdn.example.test/photo.jpg' : '' }));
const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'], ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.addInitScript(articles => {
    window.__photoFetchStarts = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/article-photo-fast') window.__photoFetchStarts.push({ url: url.href, at: performance.now() });
      return originalFetch(input, options);
    };
    localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} }));
    localStorage.setItem('news-visual-backfill-v3', JSON.stringify({ 'photo-0': { url: 'https://bad.example.test/old.jpg', savedAt: Date.now() } }));
    window.__photoDomAudit = { changes: [], candidates: [], seen: {}, geometry: [] };
    const inspect = image => {
      if (!image.matches?.('img.article-image')) return;
      const card = image.closest('[data-article]');
      const key = image.dataset.photoKey || card?.dataset.article;
      const src = image.getAttribute('src') || '';
      if (!src.startsWith('blob:') && !src.startsWith('data:')) window.__photoDomAudit.candidates.push({ key, src });
      if (!src.startsWith('blob:')) {
        if (window.__photoDomAudit.seen[key]) window.__photoDomAudit.changes.push({ key, from: window.__photoDomAudit.seen[key], to: src });
        return;
      }
      const old = window.__photoDomAudit.seen[key];
      if (old && old !== src) window.__photoDomAudit.changes.push({ key, from: old, to: src });
      window.__photoDomAudit.seen[key] = src;
    };
    new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'attributes') inspect(m.target);
        for (const node of m.addedNodes) if (node.nodeType === 1) { inspect(node); node.querySelectorAll?.('img.article-image').forEach(inspect); }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  }, articles);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  const external = [];
  let active = 0, maxActive = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/cdn\.example|bad\.example/.test(new URL(request.url()).hostname)) external.push(request.url()); });
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.31' } }));
  await page.route('**/api/news**', route => route.fulfill({ json: { articles, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', async route => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get('url');
    const index = Number(key?.split('/').pop());
    requests.push({ url: url.href, key, index, at: performance.now() });
    if (index === 0 && driverStallMs) {
      const until = performance.now() + driverStallMs;
      while (performance.now() < until) {} // Stress the driver, not the app.
    }
    active++; maxActive = Math.max(active, maxActive);
    try {
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 500 : index % 3 === 0 ? 170 : 40));
      const attempts = requests.filter(request => request.key === key).length;
      if (index === 4) return await route.fulfill({ status: 200, contentType: 'image/png', body: 'not a decodable image' });
      if (index === 5 && attempts === 1) return await route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'X-Thumbnail-Status': 'neutral-fallback', 'Cache-Control': 'no-store' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224"/>' });
      await route.fulfill({ contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'publisher-metadata' }, body: png });
    } finally { active--; }
  });
  const started = performance.now();
  await page.goto(process.env.PHOTO_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-stable-home-feed] .article-card');
  const geometryBefore = await page.locator('.article-image').first().evaluate(image => { const r = image.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  await page.waitForFunction(() => document.querySelectorAll('.image-ready-v98').length >= 10);
  const initial = await page.evaluate(() => ({
    metrics: window.__articlePhotoMetrics, audit: window.__photoDomAudit,
    requestStarts: window.__photoFetchStarts,
    resourceStarts: performance.getEntriesByType('resource')
      .filter(entry => new URL(entry.name).pathname === '/api/article-photo-fast')
      .map(entry => ({ url: entry.name, at: entry.startTime })).sort((a, b) => a.at - b.at)
  }));
  assert.ok(initial.metrics.firstImageMs < 1200, `first photo: ${initial.metrics.firstImageMs}ms`);
  assert.ok(maxActive <= 4, `concurrency ${maxActive}`);
  assert.deepEqual(external, [], 'all hints go through the validated photo API');
  assert.deepEqual(initial.audit.candidates, [], 'network candidates must never be assigned to visible img.src');
  assert.deepEqual(initial.audit.changes, [], 'a visible real photo must never change');
  const commits = initial.metrics.commits;
  const sequence = commits.map(commit => Number(commit.key.split('/').pop()));
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b), 'out-of-order responses must display in FIFO order');
  const cadence = commits.slice(1).map((commit, i) => commit.at - commits[i].at);
  assert.ok(cadence.every(gap => gap >= 115), `no reveal bursts: ${cadence}`);
  assert.ok(cadence.filter(gap => gap < 200).length >= cadence.length - 1, `regular cadence: ${cadence}`);
  // An independent browser fetch audit includes rejected/unconsumed responses;
  // ResourceTiming independently checks completed responses. Node callback
  // receipt timestamps can batch after a driver CPU stall and are diagnostic.
  const browserStartGaps = initial.requestStarts.slice(1, 12).map((request, i) => request.at - initial.requestStarts[i].at);
  const observerGaps = requests.slice(1, 12).map((request, i) => request.at - requests[i].at);
  const resourceStartGaps = initial.resourceStarts.slice(1, 12).map((request, i) => request.at - initial.resourceStarts[i].at);
  console.log('REQUEST_START_CLOCKS', JSON.stringify({ browserStartGaps, resourceStartGaps, observerGaps, driverStallMs }));
  assert.ok(initial.requestStarts.length >= 12, 'all first-priority starts must be measured in the browser');
  assert.ok(browserStartGaps.every(gap => gap >= 110), 'actual browser request starts must be paced');
  assert.ok(initial.resourceStarts.length >= 12 && resourceStartGaps.every(gap => gap >= 110), 'browser ResourceTiming must independently confirm paced network starts');
  if (driverStallMs >= 150) assert.ok(observerGaps.some(gap => gap < 110), 'driver stall must reproduce the old false alarm while browser gates stay strict');
  assert.ok(requests.length < articles.length / 2, 'offscreen catalogue must not flood the network');
  const geometryAfter = await page.locator('.article-image').first().evaluate(image => { const r = image.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  assert.deepEqual(geometryAfter, geometryBefore, 'photo selection must not shift dimensions');
  assert.ok(Math.abs(geometryAfter.width - 119) < .75 && Math.abs(geometryAfter.height - 80) < .75);
  const first = await page.locator('.article-image').first().getAttribute('src');
  await page.waitForFunction(() => !document.getElementById('startup-stability-v9815'), null, { timeout: 5000 }).catch(async error => {
    console.log('STARTUP_DIAGNOSTIC', JSON.stringify({ errors, page: await page.evaluate(() => ({ at: performance.now(), state: document.readyState, overlay: document.getElementById('startup-stability-v9815')?.outerHTML, scripts: [...document.scripts].map(script => script.src) })) }));
    throw error;
  });
  for (let cycle = 0; cycle < 8; cycle++) {
    await page.locator('.bottom-nav [data-view="settings"]').click();
    await page.locator('.bottom-nav [data-view="home"]').click();
    assert.equal(await page.locator('.article-image').first().getAttribute('src'), first, 'rerender must immediately reuse the decoded final URL');
  }
  await page.evaluate(articles => window.__applyNewsPayloadV9128({ articles: articles.map(article => ({ ...article, id: `${article.id}-new`, image: 'https://cdn.example.test/different.jpg' })), fetchedAt: new Date().toISOString() }), articles);
  assert.equal(await page.locator('.article-image').first().getAttribute('src'), first, 'changed ids and image hints must preserve the URL lock');
  await page.waitForFunction(() => [...document.querySelectorAll('.article-card')].find(card => card.querySelector('h2')?.textContent.startsWith('Article 5 '))?.querySelector('img').classList.contains('image-ready-v98'), null, { timeout: 12000 });
  const final = await page.evaluate(() => ({ metrics: window.__articlePhotoMetrics, audit: window.__photoDomAudit }));
  assert.deepEqual(final.audit.changes, []);
  assert.deepEqual(final.audit.candidates, []);
  assert.equal(final.metrics.sourceChanges, 0);
  assert.ok(requests.filter(request => request.index === 5).length === 2, 'one retry recovers a neutral fallback');
  assert.ok(requests.filter(request => request.index === 4).length <= 2, 'a corrupt image has a strict retry budget');
  const bodies = await page.evaluate(async () => (await (await caches.open('mon-actualite-photo-bodies-v1')).keys()).map(request => new URL(request.url).searchParams.get('article')));
  assert.ok(!bodies.includes('https://example.test/photo/4'), 'corrupt photos must never enter the native body cache');
  assert.ok(bodies.includes('https://example.test/photo/5'), 'a recovered real cover is cached, never its initial neutral fallback');
  assert.ok(requests.filter(request => ![4, 5].includes(request.index)).every(request => requests.filter(other => other.key === request.key).length === 1), 'successful photos get one request across rerenders');
  assert.deepEqual(errors, [], 'no browser script errors');
  const report = { firstImageMs: Math.round(initial.metrics.firstImageMs), first10Ms: Math.round(commits[9].at - initial.metrics.startedAt), cadenceMs: cadence.map(Math.round), requestStartGapsMs: browserStartGaps.map(Math.round), observerGapsMs: observerGaps.map(Math.round), maxActive, requests: requests.length, requestsByArticle: Object.fromEntries([...new Set(requests.map(request => request.key))].map(key => [key, requests.filter(request => request.key === key).length])), sourceChanges: final.audit.changes.length, exposedCandidates: final.audit.candidates.length, geometry: geometryAfter, elapsedMs: Math.round(performance.now() - started), errors };
  await writeFile(`${evidence}/metrics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${evidence}/home.png`, animations: 'disabled', scale: 'css' });
} finally { await browser.close(); }
