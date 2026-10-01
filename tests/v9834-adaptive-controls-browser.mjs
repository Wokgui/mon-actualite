import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/adaptive-controls';
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
  await context.addInitScript(() => localStorage.setItem('news-keywords', JSON.stringify(['Une veille de contrôle'])));
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.CONTROLS_LIVE !== '1') {
    await page.route('**/api/**', route => route.fulfill({ json: { articles: [], fetchedAt: new Date().toISOString(), stats: {} } }));
    await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.36' } }));
  }
  await page.goto(process.env.CONTROLS_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.locator('.nav-item[data-view="settings"]').click();
  for (const selector of ['[data-accent]', '[data-general-category]', '[data-brief-essential]']) {
    const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator(selector).first() });
    if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
  }
  for (const key of ['data-general-category', 'data-brief-essential']) await page.locator('[' + key + '="Europe"]').click();
  const colors = ['#7461e8', '#4b2b82', '#e8345f', '#1262df', '#169c54', '#ffcc00', '#00ffff', '#ffffff', '#000000', '#808080', '#f4c5e3'];
  for (const color of colors) {
    await page.locator('[data-accent]').evaluate((input, color) => { input.value = color; input.dispatchEvent(new Event('input', { bubbles: true })); }, color);
    const result = await page.evaluate(color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgb = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = channels => channels.map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const inspect = node => { const style = getComputedStyle(node), rect = node.getBoundingClientRect(), text = rgb(style.color), background = rgb(style.backgroundColor);
        const a = luminance(text), b = luminance(background);
        return { text, background, border: rgb(style.borderTopColor), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), geometry: { width: rect.width, height: rect.height, padding: style.padding, radius: style.borderRadius } }; };
      const tile = key => ({ active: inspect(document.querySelector('[' + key + '].active')), inactive: inspect(document.querySelector('[' + key + ']:not(.active)')) });
      const icons = [...document.querySelectorAll('.bottom-nav .nav-item svg')].map(svg => {
        const style = getComputedStyle(svg), rect = svg.getBoundingClientRect();
        return { width: rect.width, height: rect.height, color: rgb(style.color), fill: style.fill, stroke: style.stroke, opacity: style.opacity, filter: style.filter };
      });
      const detail = document.querySelector('.bottom-nav [data-view="brief"] svg path[stroke="#fff"], .bottom-nav [data-view="brief"] .nav-solid-cut-v9188');
      return { color, general: tile('data-general-category'), essential: tile('data-brief-essential'), icons, briefDetail: rgb(getComputedStyle(detail).stroke),
        navHeight: document.querySelector('.bottom-nav').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth };
    }, color);
    assert.deepEqual(result.general, result.essential, color + ': both tile groups must match');
    for (const tile of [result.general.active, result.general.inactive]) assert.ok(tile.contrast >= 4.5, color + ': text contrast ' + tile.contrast);
    if (['#7461e8', '#4b2b82', '#1262df', '#000000'].includes(color)) assert.deepEqual(result.general.active.text, [255, 255, 255], 'readable white must be preferred on dark colours');
    assert.deepEqual(result.general.active.background, color.slice(1).match(/../g).map(channel => parseInt(channel, 16)), 'selected tile uses chosen colour');
    assert.notDeepEqual(result.general.active.background, result.general.inactive.background, 'selection stays distinguishable');
    for (const icon of result.icons) {
      assert.deepEqual(icon.color, [255, 255, 255]); assert.equal(icon.fill, 'rgb(255, 255, 255)'); assert.equal(icon.stroke, 'none');
      assert.equal(icon.opacity, '1'); assert.equal(icon.width, 21); assert.equal(icon.height, 21); assert.match(icon.filter, /drop-shadow/);
    }
    assert.notDeepEqual(result.briefDetail, [255, 255, 255], 'white document needs contrasting internal lines');
    assert.equal(result.navHeight, 58); assert.equal(result.overflow, false);
    if (['#7461e8', '#e8345f', '#ffcc00'].includes(color)) {
      await page.locator('.settings-accordion-v9185').filter({ has: page.locator('[data-general-category]').first() }).screenshot({ path: output + '/actualite-generale-' + color.slice(1) + '.png' });
      await page.locator('.settings-accordion-v9185').filter({ has: page.locator('[data-brief-essential]').first() }).screenshot({ path: output + '/essentiel-' + color.slice(1) + '.png' });
      await page.locator('.bottom-nav').screenshot({ path: output + '/icones-' + color.slice(1) + '.png' });
    }
    results.push(result);
    await page.locator('.nav-item[data-view="brief"]').click();
    await page.locator('[data-brief-mode="watches"]').click();
    const watchText = await page.locator('.brief-mode-tab.active').evaluate(node => ({ color: getComputedStyle(node).color, ink: getComputedStyle(document.documentElement).getPropertyValue('--app-accent-ink').trim() }));
    assert.equal(watchText.color, watchText.ink === '#ffffff' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)', 'Veille shares the adaptive foreground');
    await page.locator('.nav-item[data-view="settings"]').click();
  }
  await page.locator('[data-reset-accent]').click();
  assert.equal(await page.locator('[data-accent]').inputValue(), '#7461e8');
  assert.deepEqual(errors, []);
  await writeFile(output + '/verification.json', JSON.stringify({ pass: true, results, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, colorsTested: colors.length, minContrast: Math.min(...results.flatMap(r => [r.general.active.contrast, r.general.inactive.contrast])), errors }));
} finally { await browser.close(); }
