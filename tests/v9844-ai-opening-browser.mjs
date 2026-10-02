import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); } catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/ai-opening';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const png = await readFile(new URL('../assets/icon-192.png', import.meta.url));
const sources = Array.from({ length: 8 }, (_, i) => ({ id: 'opening-' + i, url: 'https://example.test/news/' + i, title: 'Innovation ' + i, summary: 'Extrait vérifié ' + i, publishedAt: new Date(Date.now() - i * 86400000).toISOString(), category: 'Science', source: 'Source ' + i, image: '' }));
const prompt = 'En un paragraphe résume les innovations de la semaine avec liens vers les articles';
const errors = [];
async function scenario({ enabled = true, connected = true, cached = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const assets = process.env.AI_APK_ASSETS;
  if (assets) await context.route('https://mon-actualite.vercel.app/assets/**', route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    if (relative.split('/').includes('..')) return route.abort();
    return route.fulfill({ path: assets + '/' + relative });
  });
  await context.addInitScript(({ sources, prompt, enabled, connected, cached }) => {
    localStorage.setItem('news-cache-language-v98', 'fr');
    if (cached) localStorage.setItem('news-live-cache', JSON.stringify({ articles: sources, fetchedAt: new Date().toISOString(), stats: {} }));
    if (!localStorage.getItem('news-brief-ai-settings-v1')) localStorage.setItem('news-brief-ai-settings-v1', JSON.stringify({ prompt, autoAtOpen: enabled }));
    window.__OPENING_REQUESTS = [];
    const account = { profiles: connected ? [{ id: 'test-account', connected: true }] : [], activeId: connected ? 'test-account' : '', connected, planEnabled: connected };
    window.MonActualiteAI = { onmessage: null, postMessage(text) {
      const request = JSON.parse(text); window.__OPENING_REQUESTS.push(request);
      let data, error;
      if (request.action === 'status') data = account;
      else if (request.action === 'models') data = [{ slug: 'fixture-model', name: 'Modèle de test' }];
      else if (request.action === 'generate') {
        if (sessionStorage.getItem('test-inference-failure')) error = 'L’IA a terminé mais son résultat n’est pas au format demandé. Étape : résultat JSON. HTTP 200 · format absent · contenu SSE';
        else data = { summary: 'Un paragraphe avec [la source](' + request.articles[0].url + ') et [lien inventé](https://evil.test/unknown). <img src=x onerror=alert(1)>', model: 'fixture-model', cards: request.articles.slice(0, 3).map(article => ({ sourceId: article.id, title: article.title, summary: 'Résumé vérifié' })) };
      }
      setTimeout(() => window.MonActualiteAI.onmessage?.({ data: JSON.stringify({ id: request.id, ok: !error, data, error }) }), request.action === 'generate' ? 250 : 20);
    }};
  }, { sources, prompt, enabled, connected, cached });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/news**', async route => { if (!cached) await new Promise(resolve => setTimeout(resolve, 350)); return route.fulfill({ json: { articles: sources, fetchedAt: new Date().toISOString(), stats: {} } }); });
  await page.route('**/api/article-photo-fast**', route => route.fulfill({ body: png, contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'feed' } }));
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.44' } }));
  await page.goto(process.env.AI_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__OPENING_REQUESTS.some(request => request.action === 'status'));
  return { context, page };
}
try {
  const { context, page } = await scenario();
  await page.waitForFunction(() => !!localStorage.getItem('news-brief-ai-results-v1'));
  const requests = await page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate'));
  assert.equal(requests.length, 1, 'one automatic inference without pressing a button');
  assert.equal(requests[0].prompt, prompt, 'exact saved prompt is used');
  assert.equal(requests[0].articles.length, 8);
  await page.locator('.bottom-nav [data-view="brief"]').click();
  await page.locator('[data-brief-mode="ai"]').click();
  await page.waitForSelector('.ai-result-v9840');
  assert.equal(await page.locator('.ai-result-v9840').count(), 3);
  assert.deepEqual(await page.locator('.ai-news-summary-v9840 a').evaluateAll(links => links.map(link => link.href)), [sources[0].url], 'only supplied source links become clickable');
  assert.equal(await page.locator('.ai-news-summary-v9840 img').count(), 0, 'model HTML is inert');
  await page.waitForFunction(() => document.querySelectorAll('.ai-result-v9840 img.image-ready-v98').length === 3);
  const previous = await page.locator('.ai-results-v9840').textContent();
  await page.evaluate(() => { for (let i = 0; i < 6; i++) window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => window.__OPENING_REQUESTS.filter(request => request.action === 'status').length >= 7);
  assert.equal(await page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate').length), 1, 'focus and account updates cannot duplicate generation');
  await page.waitForFunction(() => { const overlay = document.getElementById('startup-stability-v9815'); return !overlay || Number(getComputedStyle(overlay).opacity) < .01; });
  await page.screenshot({ path: output + '/brief-ia-automatique.png', fullPage: true });
  await page.evaluate(() => sessionStorage.setItem('test-inference-failure', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav [data-view="brief"]').click();
  await page.locator('[data-brief-mode="ai"]').click();
  await page.waitForFunction(() => document.querySelector('.ai-brief-v9840 .ai-error-v9840')?.textContent.includes('résultat JSON'));
  assert.equal(await page.locator('.ai-results-v9840').textContent(), previous, 'failed automatic opening retains previous complete Brief');
  assert.equal(await page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate').length), 1, 'no automatic retry after failure');
  await page.locator('.bottom-nav [data-view="settings"]').click();
  const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('summary:text-is("IA")') });
  if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
  assert.equal(await page.locator('[data-ai-prompt]').inputValue(), prompt);
  await page.locator('[data-ai-auto]').uncheck();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__OPENING_REQUESTS.some(request => request.action === 'models'));
  assert.equal(await page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate').length), 0, 'automatic setting persists and stops startup inference');
  await context.close();
  const absent = await scenario({ connected: false });
  await absent.page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] .article-card').length > 0);
  assert.equal(await absent.page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate').length), 0, 'no generation without connected authorized account');
  await absent.context.close();
  const cold = await scenario({ cached: false });
  await cold.page.waitForFunction(() => !!localStorage.getItem('news-brief-ai-results-v1'));
  assert.equal(await cold.page.evaluate(() => window.__OPENING_REQUESTS.filter(request => request.action === 'generate').length), 1, 'cold opening waits for articles then generates once');
  await cold.context.close();
  assert.deepEqual(errors, []);
  const verification = { pass: true, fixture: 'native protocol simulated; no real subscription request', automaticAtOpen: true, automaticRequestsPerOpening: 1, savedPromptUsed: true, failedResultRetained: true, noRetry: true, coldOpening: true, optOut: true, sourcesOnlyLinks: true, apkAssets: !!process.env.AI_APK_ASSETS, errors };
  await writeFile(output + '/verification.json', JSON.stringify(verification, null, 2)); console.log(JSON.stringify(verification));
} finally { await browser.close(); }
