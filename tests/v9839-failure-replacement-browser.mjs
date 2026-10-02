import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const evidence = process.argv[2] || 'test-results/replacement-v9839';
await mkdir(evidence, { recursive: true });
const png = await readFile(new URL('../assets/science-energie.png', import.meta.url));
const articles = Array.from({ length: 16 }, (_, i) => ({ id: `replacement-${i}`, title: `Article ${i} contrôle du remplacement conditionnel`, source: 'Test', category: 'Politique', summary: 'Article témoin.', score: 200 - i, publishedAt: new Date(Date.now() - i * 60000).toISOString(), url: `https://example.test/replacement/${i}`, image: '' }));
const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'], ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.addInitScript(articles => {
    localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} }));
    window.__replacementAudit = [];
    new MutationObserver(mutations => {
      for (const mutation of mutations) if (mutation.type === 'attributes' && mutation.target.matches('img.article-image')) {
        const image = mutation.target;
        window.__replacementAudit.push({ at: performance.now(), key: image.dataset.photoKey, src: image.getAttribute('src'), replacement: image.dataset.photoReplacement === '1', real: image.dataset.photoFinal === '1' });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
  }, articles);
  const page = await context.newPage();
  const errors = [], requests = [], assetRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('article-image-unavailable')) assetRequests.push(request.url()); });
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.39' } }));
  await page.route('**/api/news**', route => route.fulfill({ json: { articles, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', async route => {
    const url = new URL(route.request().url());
    const index = Number(url.searchParams.get('url')?.split('/').pop());
    requests.push({ index, at: performance.now() });
    const attempt = requests.filter(request => request.index === index).length;
    if (index === 1 && attempt === 1) await new Promise(resolve => setTimeout(resolve, 2200));
    if (index === 2 || (index === 3 && attempt === 1)) return route.fulfill({ status: 404, body: '' });
    if (index === 4) return route.fulfill({ contentType: 'image/png', body: 'corrupt image' });
    return route.fulfill({ contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'publisher' }, body: png });
  });
  await page.goto(process.env.PHOTO_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  const image = index => page.locator(`img[data-photo-key="https://example.test/replacement/${index}"]`);
  await image(0).waitFor();
  const geometryBefore = await image(2).boundingBox();
  await page.waitForFunction(() => window.__articlePhotoMetrics?.failures >= 3);
  assert.equal(await image(1).getAttribute('data-photo-final'), '0', 'slow genuine photo is still pending');
  assert.equal(await image(1).getAttribute('data-photo-replacement'), '0', 'never replace a slow photo');
  for (const index of [2, 3, 4]) assert.equal(await image(index).getAttribute('data-photo-replacement'), '0', 'first failure is not definitive');
  assert.equal(assetRequests.length, 0, 'illustration is not fetched speculatively or during initial waiting');
  await page.waitForFunction(() => document.querySelector('img[data-photo-key="https://example.test/replacement/1"]')?.dataset.photoFinal === '1');
  assert.equal(await image(1).getAttribute('data-photo-replacement'), '0');
  await page.waitForFunction(() => [2, 4].every(index => document.querySelector(`img[data-photo-key="https://example.test/replacement/${index}"]`)?.dataset.photoReplacement === '1'), null, { timeout: 18000 });
  await page.waitForFunction(() => document.querySelector('img[data-photo-key="https://example.test/replacement/3"]')?.dataset.photoFinal === '1');
  const replacement = await image(2).getAttribute('src');
  assert.ok(replacement.startsWith('blob:'), 'off-DOM decoded illustration only');
  assert.equal(await image(4).getAttribute('src'), replacement, 'one decoded illustration shared by failed cards');
  assert.equal(await image(3).getAttribute('data-photo-replacement'), '0', 'successful retry never shows the illustration');
  for (const index of [2, 4]) {
    assert.equal(requests.filter(request => request.index === index).length, 2, 'strict two-attempt budget');
    assert.equal(await image(index).getAttribute('data-photo-final'), '0', 'replacement must not be called a real photo');
    assert.equal(await image(index).evaluate(image => image.complete && image.naturalWidth > 2), true, 'replacement actually renders');
  }
  const geometryAfter = await image(2).boundingBox();
  assert.equal(geometryAfter.width, geometryBefore.width);
  assert.equal(geometryAfter.height, geometryBefore.height);
  const guard = await page.evaluate(async () => {
    const { commitReplacement, photoRecordByKey } = await import(document.querySelector('script[type="module"][src*="app.js"]').src.replace(/app\.js/, 'services/article-photos.js'));
    const image = document.querySelector('img[data-photo-final="1"]');
    const src = image.src;
    const record = photoRecordByKey(image.dataset.photoKey);
    const result = commitReplacement(image, { ...record, status: 'failed', attempts: 2, fallbackUrl: document.querySelector('[data-photo-replacement="1"]').src });
    return { result, unchanged: image.src === src };
  });
  assert.deepEqual(guard, { result: false, unchanged: true }, 'even an explicit fallback commit cannot overwrite a genuine image');
  await page.screenshot({ path: `${evidence}/replacement-mobile.png`, animations: 'disabled', scale: 'css' });
  for (let cycle = 0; cycle < 5; cycle++) {
    await page.locator('.bottom-nav [data-view="settings"]').click();
    await page.locator('.bottom-nav [data-view="home"]').click();
    assert.equal(await image(2).getAttribute('src'), replacement, 'rerenders preserve replacement identity');
    assert.equal(await image(2).getAttribute('data-photo-replacement'), '1');
  }
  const report = await page.evaluate(async () => ({
    metrics: window.__articlePhotoMetrics, audit: window.__replacementAudit,
    selections: JSON.parse(localStorage.getItem('news-photo-selections-v1') || '{}'),
    bodies: (await (await caches.open('mon-actualite-photo-bodies-v1')).keys()).map(request => new URL(request.url).searchParams.get('article'))
  }));
  for (const index of [2, 4]) {
    const key = articles[index].url;
    assert.ok(!report.selections[key], 'replacement never enters real URL selections');
    assert.ok(!report.bodies.includes(key), 'replacement never poisons real photo cache');
    assert.ok(!report.metrics.commits.some(commit => commit.key === key), 'real-photo perf never counts illustration');
  }
  assert.equal(report.metrics.sourceChanges, 0);
  assert.equal(report.metrics.replacements.length, 2);
  assert.equal(assetRequests.length, 1, 'only one local illustration fetch');
  assert.deepEqual([...new Set(report.audit.filter(entry => entry.replacement).map(entry => entry.key))].sort(), [articles[2].url, articles[4].url]);
  assert.deepEqual(errors, []);
  // A new document must try real photos again; an old failure is not persisted.
  const beforeReload = requests.filter(request => request.index === 2).length;
  const realRetry = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/article-photo-fast' && url.searchParams.get('url') === articles[2].url;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await realRetry;
  await page.waitForFunction(() => window.__articlePhotoMetrics?.attempts['https://example.test/replacement/2'] === 1);
  await image(2).waitFor();
  assert.equal(await image(2).getAttribute('data-photo-replacement'), '0', 'reopen does not persist failure or mask a recovered source');
  assert.equal(requests.filter(request => request.index === 2).length, beforeReload + 1);
  await writeFile(`${evidence}/metrics.json`, JSON.stringify({ ...report, requests, assetRequests, geometryBefore, geometryAfter, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', realFirstImageMs: Math.round(report.metrics.firstImageMs), replacementArticles: report.metrics.replacements.map(entry => entry.key), localAssetLoads: report.metrics.replacementLoads, sourceChanges: report.metrics.sourceChanges, errors }, null, 2));
} finally { await browser.close(); }
