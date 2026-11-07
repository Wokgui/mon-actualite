import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const evidence = process.argv[2] || 'test-results/photos-live';
const pwa = process.env.PHOTO_PWA === '1';
const base = process.env.PHOTO_BASE_URL || (pwa ? 'http://127.0.0.1:4174/' : 'http://127.0.0.1:4174/?nativePreview=1');
await mkdir(evidence, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'], ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'allow', userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' + (pwa ? '' : ' MonActualiteAndroid/98.31') });
  const page = await context.newPage();
  const errors = [], responses = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/api\/article-(?:photo|thumbnail)/.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  page.on('response', response => { if (/\/api\/article-(?:photo|thumbnail)/.test(new URL(response.url()).pathname)) responses.push({ url: response.url(), code: response.status(), type: response.headers()['content-type'], status: response.headers()['x-thumbnail-status'], cache: response.headers()['x-photo-cache'], serverMs: response.headers()['x-photo-resolve-ms'] }); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  if (pwa) await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  await page.waitForSelector('.article-card[data-article]', { timeout: 30000 });
  await page.waitForFunction(() => window.__articlePhotoMetrics?.commits.length >= 6, null, { timeout: 60000 });
  const before = await page.evaluate(() => ({ metrics: window.__articlePhotoMetrics, visible: [...document.querySelectorAll('.article-card')].slice(0, 8).map(card => ({ id: card.dataset.article, title: card.querySelector('h2')?.textContent, src: card.querySelector('img')?.getAttribute('src'), photo: card.querySelector('img')?.dataset.photoFinal, width: card.querySelector('img')?.naturalWidth })) }));
  await page.waitForFunction(() => !document.getElementById('startup-stability-v9815'));
  await page.screenshot({ path: `${evidence}/home-live.png`, scale: 'css' });
  for (let i = 0; i < 3; i++) {
    await page.locator('.bottom-nav [data-view="settings"]').click();
    await page.locator('.bottom-nav [data-view="home"]').click();
    for (const item of before.visible.filter(item => item.photo === '1')) assert.equal(await page.locator(`[data-article="${item.id}"] img`).getAttribute('src'), item.src);
  }
  await page.evaluate(() => window.scrollTo(0, innerHeight * 2));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${evidence}/scrolled-live.png`, scale: 'css' });
  const after = await page.evaluate(() => ({ metrics: window.__articlePhotoMetrics, cards: document.querySelectorAll('.article-card').length, ready: document.querySelectorAll('.image-ready-v98').length, controller: Boolean(navigator.serviceWorker.controller) }));
  assert.equal(after.metrics.sourceChanges, 0);
  assert.ok(after.metrics.maxActive <= 4);
  assert.deepEqual(errors, []);
  if (pwa) assert.equal(after.controller, true, 'the real service worker must control the PWA test');
  const cadence = before.metrics.commits.slice(1).map((commit, i) => Math.round(commit.at - before.metrics.commits[i].at));
  assert.ok(cadence.every(gap => gap >= 115));
  const report = { base, firstImageMs: Math.round(before.metrics.firstImageMs), cadenceMs: cadence, maxActive: after.metrics.maxActive, photoRequests: requests.length, realPhotoResponses: responses.filter(response => response.code === 200 && !/svg|fallback|neutral/.test(response.type + response.status)).length, sourceChanges: after.metrics.sourceChanges, cards: after.cards, readyPhotos: after.ready, serviceWorker: after.controller, errors, visible: before.visible.map(({ src, ...rest }) => rest), responses };
  await writeFile(`${evidence}/live-metrics.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, responses: report.responses.map(({ url, ...rest }) => rest) }, null, 2));
} finally { await browser.close(); }
