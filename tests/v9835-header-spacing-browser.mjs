import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/header-spacing';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const results = [], errors = [];
try {
  const assets = process.env.CONTROLS_APK_ASSETS;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    ...(assets ? { userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/98.36' } : {}) });
  if (assets) await context.route('https://mon-actualite.vercel.app/assets/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    if (relative.split('/').includes('..')) return route.abort();
    await route.fulfill({ path: assets + '/' + relative });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.CONTROLS_LIVE !== '1') {
    await page.route('**/api/**', route => route.fulfill({ json: { articles: [], fetchedAt: new Date().toISOString(), stats: {} } }));
    await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.36' } }));
  }
  await page.goto(process.env.CONTROLS_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  const home = async () => {
    await page.locator('.nav-item[data-view="home"]').click();
    return page.locator('.hero-header').evaluate(header => {
      const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      const date = rect(header.querySelector('.eyebrow')), mark = rect(header.querySelector('.hero-mark')), title = rect(header.querySelector('h1')), h = rect(header);
      return { dateToMark: mark.top - date.bottom, markToTitle: title.top - mark.bottom, header: h.height,
        opticalOffset: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--home-mark-optical-offset')) || 0,
        dateHeight: date.height, markHeight: mark.height, titleHeight: title.height,
        fits: date.top >= h.top && title.bottom <= h.bottom,
        navHeight: document.querySelector('.bottom-nav').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
  };
  if (process.env.GAP_BASELINE === '1') {
    const baseline = await home();
    await page.locator('.hero-header').screenshot({ path: output + '/bandeau-avant.png' });
    await writeFile(output + '/verification.json', JSON.stringify({ baseline, errors }, null, 2));
    console.log(JSON.stringify({ baseline, errors }));
  } else {
    const check = async value => {
      const metrics = await home();
      assert.ok(Math.abs(metrics.dateToMark - value - metrics.opticalOffset) < .1, 'chosen spacing plus optical correction above mark');
      assert.ok(Math.abs(metrics.markToTitle - value + metrics.opticalOffset) < .1, 'optical correction preserves date/title position');
      assert.equal(metrics.fits, true); assert.equal(metrics.overflow, false); assert.equal(metrics.navHeight, 58);
      results.push({ value, ...metrics });
      return metrics;
    };
    const defaults = await check(20);
    await page.locator('.hero-header').screenshot({ path: output + '/bandeau-espaces-egaux.png' });
    const open = async () => {
      await page.locator('.nav-item[data-view="settings"]').click();
      const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('[data-ui-range="homeHeaderSpacing"]') });
      if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
    };
    const set = async (key, value) => { await open(); await page.locator('[data-ui-range="' + key + '"]').fill(String(value)); };
    await open();
    const ranges = await page.locator('.settings-accordion-v9185[open] [data-ui-range]').evaluateAll(nodes => nodes.map(node => node.dataset.uiRange));
    assert.equal(ranges[ranges.indexOf('density') + 1], 'homeHeaderSpacing', 'spacing control belongs immediately after article density');
    assert.equal(await page.locator('[data-ui-range="homeHeaderSpacing"]').inputValue(), '20');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('news-settings') || '{}'));
    for (const value of [4, 12, 28, 40]) {
      await set('homeHeaderSpacing', value);
      const actual = await check(value);
      assert.equal(actual.dateHeight, defaults.dateHeight, 'spacing never changes the date tile size');
      assert.ok(Math.abs(actual.markHeight - defaults.markHeight) < .0001, 'optical translation never resizes the 2px mark');
      assert.equal(actual.titleHeight, defaults.titleHeight, 'spacing never changes the title size');
    }
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('news-settings')));
    for (const [key, value] of Object.entries(before)) if (key !== 'homeHeaderSpacing') assert.deepEqual(after[key], value, key + ' must be preserved');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await check(40);
    await set('homeHeaderHeight', 170);
    assert.equal((await check(40)).header, 170);
    await set('titleSize', 140);
    await set('interfaceTextSize', 150);
    await set('homeHeaderHeight', 104);
    await check(40); // Grow only if necessary: never shrink/clamp the selected spacing or clip text.
    await set('homeHeaderSpacing', 4);
    assert.equal((await check(4)).header, 104);
    await set('titleSize', 100); await set('interfaceTextSize', 100); await set('homeHeaderSpacing', 20);
    await open(); await page.locator('[data-reset-header-heights]').click();
    assert.deepEqual(await check(20), defaults, 'restoring heights keeps the chosen spacing');
    await open(); await page.locator('[data-ui-range="homeHeaderSpacing"]').scrollIntoViewIfNeeded();
    await page.locator('[data-ui-range="homeHeaderSpacing"]').locator('..').screenshot({ path: output + '/curseur-espacement.png' });
    assert.deepEqual(errors, []);
    await writeFile(output + '/verification.json', JSON.stringify({ pass: true, results, persistence: true, errors }, null, 2));
    console.log(JSON.stringify({ pass: true, equalSpacing: true, persistence: true, results, errors }));
  }
} finally { await browser.close(); }
