import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/header-background';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const errors = [];
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/94' });
  const articles = [{ id: 'header-check', title: 'Article de contrôle du bandeau et de la navigation', source: 'Source test', category: 'Tech', publishedAt: new Date().toISOString(), url: 'https://example.test/header' }];
  await context.addInitScript(articles => localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} })), articles);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true, articles, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', route => route.fulfill({ contentType: 'image/png', body: readPng }));
  const readPng = await readFile(new URL('../assets/science-energie.png', import.meta.url));
  await page.goto(process.env.HEADER_BASE_URL || 'http://127.0.0.1:4174/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav.stable-bottom-nav-v9184');
  const state = () => page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav.stable-bottom-nav-v9184');
    const header = document.querySelector('.hero-header, .settings-page-v9185>.page-masthead-v9186, .page:has(.brief-mode-tabs)>.page-masthead-v9186');
    const dimensions = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const styles = (node, pseudo) => { const style = getComputedStyle(node, pseudo); return Object.fromEntries(Array.from(style).map(property => [property, style.getPropertyValue(property)])); };
    return { title: header?.innerText, header: header && { dimensions: dimensions(header), background: getComputedStyle(header).backgroundImage, motif: getComputedStyle(header, '::before').backgroundImage, after: getComputedStyle(header, '::after').content },
      bottom: { dimensions: dimensions(nav), style: styles(nav), before: styles(nav, '::before'), buttons: [...nav.querySelectorAll('button')].map(button => ({ dimensions: dimensions(button), style: styles(button) })) },
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const baseline = process.env.HEADER_BASELINE_CSS ? await readFile(process.env.HEADER_BASELINE_CSS, 'utf8') : null;
  for (const view of ['home', 'settings', 'brief']) {
    await page.locator('.nav-item[data-view="' + view + '"]').click();
    await page.waitForFunction(view => document.querySelector('.nav-item[data-view="' + view + '"]')?.classList.contains('active'), view);
    await page.waitForSelector(view === 'home' ? '.hero-header' : view === 'settings' ? '.settings-page-v9185>.page-masthead-v9186' : '.page:has(.brief-mode-tabs)>.page-masthead-v9186');
    let bottomPixelDifferences = null;
    if (baseline) {
      let PNG;
      try { ({ PNG } = await import('pngjs')); }
      catch { ({ PNG } = (await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs/lib/png.js')).default); }
      const previous = await page.addStyleTag({ content: baseline });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const before = await state();
      const beforeBottom = await page.locator('.bottom-nav').screenshot({ animations: 'disabled', path: output + '/bas-avant-' + view + '.png' });
      await previous.evaluate(node => node.remove());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await state();
      assert.deepEqual(after.bottom, before.bottom, view + ': navigation must stay unchanged');
      assert.deepEqual(after.header.dimensions, before.header.dimensions, view + ': header dimensions must stay unchanged');
      const afterBottom = await page.locator('.bottom-nav').screenshot({ animations: 'disabled', path: output + '/bas-apres-' + view + '.png' });
      const a = PNG.sync.read(beforeBottom), b = PNG.sync.read(afterBottom);
      assert.equal(a.width, b.width); assert.equal(a.height, b.height);
      bottomPixelDifferences = 0;
      for (let i = 0; i < a.data.length; i += 4) if ([0, 1, 2, 3].some(channel => a.data[i + channel] !== b.data[i + channel])) bottomPixelDifferences++;
      assert.equal(bottomPixelDifferences, 0, view + ': bottom pixels must stay unchanged');
    }
    const current = await state();
    assert.ok(current.header, view + ': header exists');
    assert.equal(current.header.background, current.bottom.style['background-image'], view + ': same background as bottom');
    assert.equal(current.header.motif, 'none', view + ': no extra wave image');
    assert.equal(current.header.after, 'none', view + ': no old wave overlay');
    assert.equal(current.bottom.dimensions.height, 58);
    assert.equal(current.overflow, false, view + ': no horizontal overflow');
    if (view !== 'home') assert.equal(current.header.dimensions.height, 116);
    await page.screenshot({ path: output + '/bandeau-' + view + '.png' });
    results.push({ view, title: current.title, headerDimensions: current.header.dimensions, identicalBackground: true, noExtraWaves: true, bottomStylesAndDimensionsUnchanged: Boolean(baseline), bottomPixelDifferences });
  }
  assert.deepEqual(errors, [], 'no application errors');
  await writeFile(output + '/verification-bandeaux.json', JSON.stringify({ pass: true, results, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, results, errors }));
} finally { await browser.close(); }
