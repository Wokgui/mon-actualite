import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/startup-v9836';
await mkdir(output, { recursive: true });
const png = await readFile(new URL('../assets/science-energie.png', import.meta.url));
const articles = Array.from({ length: 80 }, (_, i) => ({ id: `startup-${i}`, url: `https://example.test/startup/${i}`, title: `Article ${i} : un titre qui conserve ses lignes pendant la synchronisation`, source: 'Source test ' + Math.floor(i / 10), category: 'Politique', publishedAt: new Date(Date.now() - i * 60000).toISOString(), summary: 'Test de stabilité.' }));
const latest = [{ ...articles[0], id: 'new-story', url: 'https://example.test/new-story', title: 'Une nouvelle actualité reçue pendant la lecture', publishedAt: new Date(Date.now() + 1000).toISOString() }, ...articles.map(a => ({ ...a, id: a.id + '-changed' }))];
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/98.36' });
  await context.addInitScript(articles => {
    if (!localStorage.getItem('news-live-cache')) localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString() }));
    window.__startupAudit = { snapshots: [], sourceChanges: [], sources: {} };
    let oldSignature = '';
    setInterval(() => {
      const overlay = document.getElementById('startup-stability-v9815');
      if (overlay && !overlay.classList.contains('leaving')) return;
      const rows = [...document.querySelectorAll('[data-stable-home-feed] .article-card')].slice(0, 8).map(card => {
        const title = card.querySelector('h2'), r = title.getBoundingClientRect(), image = card.querySelector('img');
        const src = image.getAttribute('src');
        const key = image.dataset.photoKey;
        if (src.startsWith('blob:')) {
          if (window.__startupAudit.sources[key] && window.__startupAudit.sources[key] !== src) window.__startupAudit.sourceChanges.push(key);
          window.__startupAudit.sources[key] = src;
        }
        return { key, title: title.textContent, top: r.top, height: r.height, width: r.width };
      });
      const signature = JSON.stringify(rows);
      if (rows.length && signature !== oldSignature) window.__startupAudit.snapshots.push({ at: performance.now(), rows });
      oldSignature = signature;
    }, 40);
  }, articles);
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/version.json**', r => r.fulfill({ json: { version: '98', codeRelease: '98.36' } }));
  let newsRequests = 0;
  await page.route('**/api/news**', async route => {
    const fast = new URL(route.request().url()).searchParams.has('fast');
    newsRequests++;
    await new Promise(r => setTimeout(r, fast ? 500 : 2600));
    await route.fulfill({ json: { articles: fast ? articles : latest, fetchedAt: new Date().toISOString(), stats: {} } });
  });
  await page.route('**/api/article-photo-fast**', async route => {
    const key = new URL(route.request().url()).searchParams.get('url');
    requests.push(key);
    await new Promise(r => setTimeout(r, key.endsWith('/0') ? 2400 : 40));
    await route.fulfill({ body: png, contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'publisher-metadata' } });
  });
  const base = process.env.PHOTO_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1';
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7500);
  const before = await page.evaluate(() => ({ audit: window.__startupAudit, metrics: window.__articlePhotoMetrics, ready: [...document.querySelectorAll('[data-stable-home-feed] img')].slice(0, 8).filter(i => i.dataset.photoFinal === '1').length, cacheUrls: JSON.parse(localStorage.getItem('news-live-cache')).articles.map(a => a.url) }));
  await page.screenshot({ path: output + '/demarrage.png', scale: 'css' });
  await writeFile(output + '/verification.json', JSON.stringify({ before, errors, requests, newsRequests }, null, 2));
  if (process.env.STARTUP_BASELINE === '1') {
    console.log(JSON.stringify({ visibleLayouts: before.audit.snapshots.length, first8Ready: before.ready, firstImageMs: before.metrics.firstImageMs, sourceChanges: before.audit.sourceChanges.length, errors }));
  } else {
    assert.equal(before.audit.snapshots.length, 1, 'background news must not move/rewrite visible rows or title lines');
    assert.equal(before.ready, 8, 'cache ID changes cannot strand the rendered photo queue');
    assert.deepEqual(before.audit.sourceChanges, []);
    assert.ok(before.cacheUrls.includes('https://example.test/new-story'), 'synchronization must still update the catalogue');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    const scrolledKeys = await page.locator('[data-stable-home-feed] img').evaluateAll(images => images.map(i => i.dataset.photoKey));
    assert.ok(scrolledKeys.length > 36, 'continuous scrolling must keep loading the reading snapshot');
    assert.equal(new Set(scrolledKeys).size, scrolledKeys.length, 'changed catalogue IDs must not append duplicate URL-identical articles');
    assert.ok(!scrolledKeys.includes('https://example.test/new-story'), 'incoming stories are accepted explicitly, never inserted while scrolling');
    await page.locator('.nav-item[data-view="home"]').click();
    await page.waitForFunction(() => document.querySelector('[data-stable-home-feed] h2')?.textContent.includes('nouvelle actualité'));
    await page.waitForFunction(() => document.querySelector('[data-stable-home-feed] img')?.dataset.photoFinal === '1');
    // Reload the native-like app: successful photos must survive across documents,
    // with no API requests for those exact article URLs, including offline.
    await page.waitForFunction(() => window.__articlePhotoMetrics.cacheWrites >= 8);
    const savedKeys = await page.evaluate(async () => (await (await caches.open('mon-actualite-photo-bodies-v1')).keys()).map(r => new URL(r.url).searchParams.get('article')));
    const requestCount = requests.length;
    // Local application assets stay available; the photo API is unreachable.
    await page.unroute('**/api/article-photo-fast**');
    const uncached = [];
    await page.route('**/api/article-photo-fast**', route => { uncached.push(new URL(route.request().url()).searchParams.get('url')); return route.abort(); });
    const warmCycles = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-stable-home-feed] img')].slice(0, 8).every(i => i.dataset.photoFinal === '1'));
      const metrics = await page.evaluate(() => window.__articlePhotoMetrics);
      assert.ok(metrics.cacheHits >= 8, 'native warm reopening must decode durable photo bodies');
      assert.ok(!uncached.some(key => savedKeys.includes(key)), 'a valid stored cover needs no repeated photo request');
      warmCycles.push({ firstImageMs: metrics.firstImageMs, cacheHits: metrics.cacheHits });
    }
    const warm = warmCycles[0];
    assert.deepEqual(errors, []);
    const report = { pass: true, visibleLayouts: before.audit.snapshots.length, first8Ready: before.ready, coldFirstImageMs: before.metrics.firstImageMs, warmFirstImageMs: warm.firstImageMs, warmCacheHits: warm.cacheHits, warmCycles, sourceChanges: before.audit.sourceChanges.length, newsRequests, requests: requestCount, errors };
    await writeFile(output + '/verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
} finally { await browser.close(); }
