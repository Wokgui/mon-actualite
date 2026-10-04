import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/client-photo-recovery';
await mkdir(output, { recursive: true });
const png = await readFile(new URL('../assets/science-energie.png', import.meta.url));
const articles = Array.from({ length: 6 }, (_, i) => ({ id: 'recovery-' + i, title: 'Article de contrôle récupération ' + i, url: 'https://publisher.test/story/' + i, source: 'Source test', category: 'Tech', publishedAt: new Date(Date.now() - i * 60000).toISOString(), score: 20 - i }));
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.addInitScript(articles => {
    localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} }));
    localStorage.setItem('news-photo-selections-v1', JSON.stringify({ [articles[0].url]: { at: Date.now(), requestUrl: '/api/article-photo-fast?v=98.31&url=' + encodeURIComponent(articles[0].url) } }));
    window.__visibleNetworkPhotos = [];
    new MutationObserver(mutations => {
      for (const mutation of mutations) if (mutation.target.matches?.('img.article-image') && /^https?:/.test(mutation.target.getAttribute('src'))) window.__visibleNetworkPhotos.push(mutation.target.src);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['src'] });
  }, articles);
  const page = await context.newPage(), external = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.37' } }));
  await page.route('**/api/news**', route => route.fulfill({ json: { articles, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', route => {
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('clientRecovery'), '1', 'old persisted request URLs must be upgraded before their first attempt');
    const index = Number(url.searchParams.get('url').split('/').pop());
    if (index === 4) return route.fulfill({ contentType: 'image/png', body: png });
    const candidates = index === 0 ? ['https://cdn.publisher.test/corrupt.png', 'https://cdn.publisher.test/cover']
      : index === 2 ? ['https://127.0.0.1/private.png']
      : index === 3 ? ['https://cdn.publisher.test/logo.svg']
      : ['https://cdn.publisher.test/denied.png'];
    return route.fulfill({ status: 424, json: { kind: 'publisher-photo-candidates', articleUrl: index === 1 ? 'https://publisher.test/wrong-story' : url.searchParams.get('url'), candidates: candidates.map(url => ({ url, publisherUrl: 'https://publisher.test/story/' + index })) }, headers: { 'X-Thumbnail-Status': 'client-validation-required' } });
  });
  await page.route('https://cdn.publisher.test/**', route => {
    external.push(route.request().url());
    if (route.request().url().endsWith('/denied.png')) return route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    return route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: route.request().url().endsWith('/corrupt.png') ? 'not a valid image' : png });
  });
  await page.goto(process.env.PHOTO_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.querySelector('img[data-photo-key="https://publisher.test/story/0"]')?.dataset.photoFinal === '1', null, { timeout: 10000 });
  } catch (error) {
    console.log(JSON.stringify(await page.evaluate(() => ({ metrics: window.__articlePhotoMetrics, body: document.body.innerText, images: [...document.querySelectorAll('.article-card img')].map(i => ({ key: i.dataset.photoKey, final: i.dataset.photoFinal })) }))));
    console.log(JSON.stringify({ errors, external }));
    throw error;
  }
  await page.waitForFunction(() => document.querySelector('img[data-photo-key="https://publisher.test/story/4"]')?.dataset.photoFinal === '1');
  const first = await page.locator('img[data-photo-key="https://publisher.test/story/0"]').getAttribute('src');
  assert.ok(first.startsWith('blob:'), 'only the decoded final blob enters the visible DOM');
  await page.waitForFunction(() => !document.getElementById('startup-stability-v9815'));
  await page.locator('.nav-item[data-view="settings"]').click();
  await page.locator('.nav-item[data-view="home"]').click();
  assert.equal(await page.locator('img[data-photo-key="https://publisher.test/story/0"]').getAttribute('src'), first);
  const data = await page.evaluate(async () => ({ metrics: window.__articlePhotoMetrics, exposed: window.__visibleNetworkPhotos,
    ready: [...document.querySelectorAll('.article-card img')].map(i => i.dataset.photoFinal),
    cached: (await (await caches.open('mon-actualite-photo-bodies-v1')).keys()).map(request => new URL(request.url).searchParams.get('article')) }));
  assert.equal(data.metrics.clientRecoveries, 1);
  assert.deepEqual(data.exposed, []);
  assert.equal(data.metrics.sourceChanges, 0);
  assert.ok(data.cached.includes(articles[0].url), 'recovered photo bytes enter the same positive native cache');
  assert.ok(!external.some(url => /private|logo/.test(url)));
  assert.equal(external.filter(url => url.endsWith('/cover')).length, 1, 'extensionless CDN covers are validated by MIME and decoded dimensions');
  assert.ok([1, 2, 3, 5].every(i => data.ready[i] === '0'), 'mismatched, private, SVG and refused candidates stay invisible');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: output + '/recovery.png', scale: 'css' });
  const directCount = external.length;
  await page.unroute('**/api/article-photo-fast**');
  await page.route('**/api/article-photo-fast**', route => route.abort('failed'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('img[data-photo-key="https://publisher.test/story/0"]')?.dataset.photoFinal === '1');
  const warm = await page.evaluate(() => ({ firstImageMs: window.__articlePhotoMetrics.firstImageMs, cacheHits: window.__articlePhotoMetrics.cacheHits, clientRecoveries: window.__articlePhotoMetrics.clientRecoveries }));
  assert.ok(warm.cacheHits >= 1, 'recovered cover remains available when reopening without the photo API');
  assert.equal(warm.clientRecoveries, 0);
  assert.equal(external.length, directCount, 'reopening does not refetch the publisher cover');
  await writeFile(output + '/verification.json', JSON.stringify({ pass: true, ...data, external, errors, warm }, null, 2));
  console.log(JSON.stringify({ pass: true, clientRecoveries: data.metrics.clientRecoveries, exposedCandidates: data.exposed.length, sourceChanges: data.metrics.sourceChanges, requests: external, errors }));
} finally { await browser.close(); }
