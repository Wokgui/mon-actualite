import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/optical-header';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => route.fulfill({ json: { articles: [], fetchedAt: new Date().toISOString() } }));
  await page.goto(process.env.CONTROLS_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  const set = async (key, value) => {
    await page.locator('.nav-item[data-view="settings"]').click();
    const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('[data-ui-range="' + key + '"]') });
    if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
    await section.locator('[data-ui-range="' + key + '"]').fill(String(value));
  };
  for (const titleScale of [70, 100, 140]) for (const spacing of [4, 20, 40]) {
    await set('titleSize', titleScale); await set('homeHeaderSpacing', spacing);
    await set('homeHeaderHeight', titleScale === 70 ? 104 : titleScale === 100 ? 170 : 260);
    await page.locator('.nav-item[data-view="home"]').click();
    const header = page.locator('.hero-header');
    const geometry = await header.evaluate(node => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { header: rect(node), date: rect(node.querySelector('.eyebrow')), mark: rect(node.querySelector('.hero-mark')), title: rect(node.querySelector('h1')) };
    });
    const shot = await header.screenshot({ path: output + `/titre-${titleScale}-ecart-${spacing}.png` });
    // Independent optical gate: measure rendered white glyph pixels, not CSS
    // line-box metrics or the same formula as the implementation.
    const inkTop = await page.evaluate(async ({ imageUrl, geometry }) => {
      const image = new Image(); image.src = imageUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      const ratio = canvas.width / geometry.header.width, pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const title = geometry.title;
      for (let y = Math.ceil((title.y - geometry.header.y) * ratio); y < Math.floor((title.bottom - geometry.header.y) * ratio); y++) {
        let white = 0;
        for (let x = Math.ceil((title.x - geometry.header.x) * ratio); x < Math.floor((title.x + title.width - geometry.header.x) * ratio); x++) {
          const i = (y * canvas.width + x) * 4;
          if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) white++;
        }
        if (white >= 3) return geometry.header.y + y / ratio;
      }
      throw new Error('No title glyph pixels found');
    }, { imageUrl: 'data:image/png;base64,' + shot.toString('base64'), geometry });
    const markCenter = geometry.mark.y + geometry.mark.height / 2;
    const target = (geometry.date.bottom + inkTop) / 2;
    const errorPx = markCenter - target;
    assert.ok(Math.abs(errorPx) <= 1, `optical midpoint ${titleScale}/${spacing}: ${errorPx}px`);
    results.push({ titleScale, spacing, errorPx, dateToMark: geometry.mark.y - geometry.date.bottom, markToInk: inkTop - geometry.mark.bottom });
  }
  assert.deepEqual(errors, []);
  await writeFile(output + '/verification.json', JSON.stringify({ pass: true, results, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, maxOpticalErrorPx: Math.max(...results.map(r => Math.abs(r.errorPx))), results, errors }));
} finally { await browser.close(); }
