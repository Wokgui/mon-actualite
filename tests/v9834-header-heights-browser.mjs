import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/header-heights';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const errors = [], results = [];
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
  const open = async () => {
    await page.locator('[data-view="settings"]').click();
    const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('[data-ui-range="homeHeaderHeight"]') });
    if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
    return section;
  };
  const sizes = async () => {
    const result = {};
    for (const view of ['home', 'settings', 'brief']) {
      await page.locator('.nav-item[data-view="' + view + '"]').click();
      const selector = view === 'home' ? '.hero-header' : view === 'settings' ? '.settings-page-v9185>.page-masthead-v9186' : '.page:has(.brief-mode-tabs)>.page-masthead-v9186';
      await page.waitForSelector(selector);
      result[view] = await page.locator(selector).evaluate(node => {
        const r = node.getBoundingClientRect();
        return { height: r.height, titleFont: getComputedStyle(node.querySelector('h1')).fontSize, navHeight: document.querySelector('.bottom-nav').getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > innerWidth, contentFits: [...node.querySelectorAll('h1,.eyebrow,.hero-mark')].every(child => { const c = child.getBoundingClientRect(); return c.top >= r.top && c.bottom <= r.bottom; }) };
      });
      assert.equal(result[view].navHeight, 58); assert.equal(result[view].overflow, false); assert.equal(result[view].contentFits, true, view + ': header content must fit');
    }
    return result;
  };
  await open();
  for (const key of ['homeHeaderHeight', 'settingsHeaderHeight', 'briefHeaderHeight']) assert.equal(await page.locator('[data-ui-range="' + key + '"]').count(), 1);
  const defaults = await sizes();
  const set = async (key, value) => { await open(); await page.locator('[data-ui-range="' + key + '"]').fill(String(value)); };
  await set('homeHeaderHeight', 170);
  let actual = await sizes();
  assert.equal(actual.home.height, 170); assert.deepEqual(actual.settings, defaults.settings); assert.deepEqual(actual.brief, defaults.brief);
  assert.equal(actual.home.titleFont, defaults.home.titleFont);
  await set('settingsHeaderHeight', 150);
  actual = await sizes();
  assert.equal(actual.home.height, 170); assert.equal(actual.settings.height, 150); assert.deepEqual(actual.brief, defaults.brief);
  await set('briefHeaderHeight', 140);
  actual = await sizes();
  assert.equal(actual.home.height, 170); assert.equal(actual.settings.height, 150); assert.equal(actual.brief.height, 140);
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.deepEqual(await sizes(), actual, 'all independent heights persist after reload');
  results.push({ independentAndPersistent: actual });
  await set('titleSize', 140);
  await set('interfaceTextSize', 150);
  await set('homeHeaderHeight', 104);
  await set('settingsHeaderHeight', 72);
  await set('briefHeaderHeight', 72);
  results.push({ minimumHeightsWithLargeTitle: await sizes() });
  await set('homeHeaderHeight', 260);
  await set('settingsHeaderHeight', 260);
  await set('briefHeaderHeight', 260);
  results.push({ maximumHeights: await sizes() });
  await set('titleSize', 100);
  await set('interfaceTextSize', 100);
  await open();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('news-settings')));
  await page.locator('[data-reset-header-heights]').click();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('news-settings')));
  assert.deepEqual(after, { ...before, homeHeaderHeight: null, settingsHeaderHeight: 116, briefHeaderHeight: 116 }, 'restore only header heights');
  assert.deepEqual(await sizes(), defaults, 'original dimensions are restored exactly');
  const section = await open();
  await section.screenshot({ path: output + '/trois-hauteurs-independantes.png' });
  assert.deepEqual(errors, []);
  await writeFile(output + '/verification.json', JSON.stringify({ pass: true, results, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, independentHeights: true, persistence: true, restoredDefaults: true, errors }));
} finally { await browser.close(); }
