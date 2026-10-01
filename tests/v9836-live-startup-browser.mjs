import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/live-startup-v9836';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/98.36' });
  const assets = process.env.CONTROLS_APK_ASSETS;
  if (assets) await context.route('https://mon-actualite.vercel.app/assets/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    if (relative.split('/').includes('..')) return route.abort();
    await route.fulfill({ path: assets + '/' + relative });
  });
  const base = process.env.PHOTO_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1';
  await context.addInitScript(() => {
    window.__liveStart = { frames: [], sources: {}, changes: [] };
    let previous = '';
    setInterval(() => {
      const overlay = document.getElementById('startup-stability-v9815');
      if (overlay && !overlay.classList.contains('leaving')) return;
      const cards = [...document.querySelectorAll('[data-stable-home-feed] .article-card')].slice(0, 8);
      const rows = cards.map(card => {
        const title = card.querySelector('h2'), r = title.getBoundingClientRect(), image = card.querySelector('img'), src = image.getAttribute('src'), key = image.dataset.photoKey;
        if (src.startsWith('blob:')) {
          if (window.__liveStart.sources[key] && window.__liveStart.sources[key] !== src) window.__liveStart.changes.push(key);
          window.__liveStart.sources[key] = src;
        }
        return { key, title: title.textContent, y: r.y, height: r.height, width: r.width };
      });
      const signature = JSON.stringify(rows);
      if (rows.length && signature !== previous) window.__liveStart.frames.push({ at: performance.now(), rows });
      previous = signature;
    }, 40);
  });
  const page = await context.newPage(), errors = [], responses = [], cycles = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (/\/api\/article-(photo|thumbnail)/.test(new URL(response.url()).pathname)) responses.push({ url: response.url(), code: response.status(), type: response.headers()['content-type'], status: response.headers()['x-thumbnail-status'], serverMs: response.headers()['x-photo-resolve-ms'] });
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-stable-home-feed] .article-card', { timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-stable-home-feed] img')].slice(0, 8).every(i => i.dataset.photoFinal === '1'), null, { timeout: 45000 });
    await page.waitForTimeout(6500); // Also cover the complete live synchronization.
    const data = await page.evaluate(() => ({ audit: window.__liveStart, metrics: window.__articlePhotoMetrics, visible: [...document.querySelectorAll('[data-stable-home-feed] img')].slice(0, 8).map(i => ({ key: i.dataset.photoKey, ready: i.dataset.photoFinal, width: i.naturalWidth })) }));
    assert.equal(data.audit.frames.length, 1, 'live synchronization cannot change visible article lines/order');
    assert.deepEqual(data.audit.changes, []);
    assert.equal(data.metrics.sourceChanges, 0);
    assert.ok(data.metrics.maxActive <= 4);
    assert.ok(data.visible.every(i => i.ready === '1' && i.width >= 2));
    const gaps = data.metrics.commits.slice(1).map((c, i) => c.at - data.metrics.commits[i].at);
    assert.ok(gaps.every(gap => gap >= 115), 'live photos must not reveal in bursts');
    cycles.push({ cycle, firstImageMs: data.metrics.firstImageMs, requests: data.metrics.requests, cacheHits: data.metrics.cacheHits, visibleLayouts: data.audit.frames.length, sourceChanges: data.audit.changes.length, cadence: gaps, visible: data.visible });
    await page.screenshot({ path: output + `/accueil-${cycle}.png`, scale: 'css' });
  }
  assert.deepEqual(errors, []);
  const report = { pass: true, base, apkAssets: Boolean(assets), cycles, responses, errors };
  await writeFile(output + '/verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: true, apkAssets: Boolean(assets), cycles: cycles.map(({ visible, cadence, ...rest }) => rest), errors }));
} catch (error) {
  await writeFile(output + '/failure.txt', error.stack || String(error));
  throw error;
} finally { await browser.close(); }
