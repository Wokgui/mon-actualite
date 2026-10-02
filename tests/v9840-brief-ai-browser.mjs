import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); } catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/brief-ai';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const errors = [], photoRequests = [];
const sources = Array.from({ length: 8 }, (_, i) => ({ id: 'ai-source-' + i, title: 'Actualité source vérifiée ' + (i + 1), url: 'https://example.test/news/' + i, category: 'Science', source: 'Source ' + i, summary: 'Extrait factuel de la source ' + i, publishedAt: new Date(Date.now() - i * 60000).toISOString(), image: '' }));
const png = await readFile(new URL('../assets/icon-192.png', import.meta.url));
const nativeFixtures = process.env.AI_NATIVE_FIXTURE !== '0';
const assets = process.env.AI_APK_ASSETS;
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  if (assets) await context.route('https://mon-actualite.vercel.app/assets/**', route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    if (relative.split('/').includes('..')) return route.abort();
    return route.fulfill({ path: assets + '/' + relative });
  });
  await context.addInitScript(({ sources, nativeFixtures }) => {
    localStorage.setItem('news-live-cache', JSON.stringify({ articles: sources, fetchedAt: new Date().toISOString(), stats: {} }));
    localStorage.setItem('news-cache-language-v98', 'fr');
    window.__AI_REQUESTS = []; window.__AI_FAILURE = false;
    if (!nativeFixtures) return;
    // A protocol fixture, not a real subscription or successful provider login.
    let account = { profiles: [], activeId: '', connected: false, planEnabled: false, email: '' };
    window.MonActualiteAI = { onmessage: null, postMessage(text) {
      const request = JSON.parse(text); window.__AI_REQUESTS.push(request);
      let data, error;
      if (request.action === 'status') data = account;
      else if (request.action === 'connect') data = account = { profiles: [{ id: 'fixture-account', email: 'compte-test@example.test', connected: true }], activeId: 'fixture-account', connected: true, planEnabled: true, email: 'compte-test@example.test' };
      else if (request.action === 'models') data = [{ slug: 'fixture-model', name: 'Modèle de test' }];
      else if (request.action === 'disconnect') data = account = { profiles: [], activeId: '', connected: false, planEnabled: false, email: '' };
      else if (request.action === 'generate') {
        if (window.__AI_FAILURE) error = 'Limite d’utilisation atteinte. Consulte ChatGPT.';
        else data = { summary: 'Synthèse des actualités transmises.', model: request.model || 'fixture-model', generatedAt: new Date().toISOString(), cards: request.articles.slice(0, 3).map((article, index) => ({ sourceId: article.id, title: 'Analyse IA ' + (index + 1), summary: 'Résumé factuel ' + (index + 1), image: 'https://evil.test/invented.png', url: 'javascript:alert(1)' })).concat([{ sourceId: 'invented', title: 'Faux article', summary: 'À refuser' }]) };
      }
      setTimeout(() => window.MonActualiteAI.onmessage?.({ data: JSON.stringify({ id: request.id, ok: !error, data, error }) }), request.action === 'generate' ? 100 : 15);
    }};
  }, { sources, nativeFixtures });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/news**', route => route.fulfill({ json: { articles: sources, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', route => { photoRequests.push(route.request().url()); return route.fulfill({ contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'feed' }, body: png }); });
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.40' } }));
  await page.goto(process.env.AI_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length >= 8);
  let homePhotos = await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.article, card.querySelector('img').src])));
  assert.equal((await page.evaluate(() => window.__AI_REQUESTS)).filter(r => r.action === 'generate').length, 0, 'no startup generation');
  await page.locator('.bottom-nav [data-view="settings"]').click();
  const sections = await page.locator('.settings-accordion-v9185>summary').allTextContents();
  assert.equal(sections.indexOf('IA'), sections.indexOf('Veille') + 1, 'IA follows Veille');
  await page.locator('.settings-accordion-v9185').filter({ has: page.locator('summary:text-is("IA")') }).locator('summary').click();
  assert.equal(await page.locator('[data-ai-provider] option').count(), 6);
  for (const provider of ['claude', 'gemini', 'mistral', 'perplexity', 'grok']) {
    await page.locator('[data-ai-provider]').selectOption(provider);
    assert.match(await page.locator('[data-ai-account]').textContent(), /retour automatique.*n’est pas disponible/);
    assert.equal(await page.locator('[data-ai-connect]').count(), 0, 'no fake subscription integration');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length >= 8);
  homePhotos = await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.article, card.querySelector('img').src])));
  await page.locator('.bottom-nav [data-view="settings"]').click();
  const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('summary:text-is("IA")') });
  if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
  assert.equal(await page.locator('[data-ai-provider]').inputValue(), 'grok', 'chosen provider survives reload');
  await page.locator('[data-ai-provider]').selectOption('chatgpt');
  const custom = 'Résume uniquement la science et explique les conséquences.';
  await page.locator('[data-ai-prompt]').fill(custom);
  assert.equal(await page.locator('[data-ai-prompt]').inputValue(), custom, 'typing retains focus and all text');
  await page.screenshot({ path: output + '/reglages-ia.png', fullPage: true });
  if (nativeFixtures) {
    await page.locator('[data-ai-connect]').click();
    await page.waitForSelector('[data-ai-model]');
    await page.locator('[data-ai-model]').selectOption('fixture-model');
    await page.locator('[data-ai-open-brief]').click();
    assert.equal(await page.locator('.brief-mode-tab').count(), 3);
    await page.locator('[data-ai-generate]').click();
    await page.waitForSelector('.ai-result-v9840');
    assert.equal(await page.locator('.ai-result-v9840').count(), 3, 'invented source is discarded');
    await page.waitForFunction(() => document.querySelectorAll('.ai-result-v9840 img.image-ready-v98').length === 3);
    const cards = await page.locator('.ai-result-v9840 article').evaluateAll(cards => cards.map(card => ({ id: card.dataset.article, photo: card.querySelector('img').src })));
    for (const card of cards) assert.equal(card.photo, homePhotos[card.id], 'exact Home photo lock reused');
    assert.deepEqual(await page.locator('.ai-source-v9840').evaluateAll(links => links.map(link => link.href)), sources.slice(0, 3).map(article => article.url));
    assert.equal(new Set(photoRequests).size, photoRequests.length, 'one photo request per article across views');
    await page.screenshot({ path: output + '/brief-ia.png', fullPage: true });
    const previous = await page.locator('.ai-results-v9840').textContent();
    await page.evaluate(() => { window.__AI_FAILURE = true; });
    await page.locator('[data-ai-generate]').click();
    await page.waitForSelector('.ai-error-v9840');
    assert.equal(await page.locator('.ai-results-v9840').textContent(), previous, 'failure never overwrites a complete result');
    const invalid = await page.evaluate(async () => {
      const module = await import('./services/brief-ai.js?v=98.40');
      try { module.normalizeAIResult({ cards: [{ sourceId: 'bad', title: 'X', summary: 'X' }] }, [{ id: 'bad', url: 'javascript:alert(1)' }]); return false; } catch { return true; }
    });
    assert.equal(invalid, true, 'malformed persisted URLs rejected');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.bottom-nav [data-view="settings"]').click();
    const savedSection = page.locator('.settings-accordion-v9185').filter({ has: page.locator('summary:text-is("IA")') });
    if (!await savedSection.evaluate(node => node.open)) await savedSection.locator('summary').click();
    assert.equal(await page.locator('[data-ai-prompt]').inputValue(), custom);
    const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('news-brief-ai')).map(key => [key, localStorage.getItem(key)])));
    assert.doesNotMatch(JSON.stringify(storage), /access_token|refresh_token|id_token|password|api_key/);
    assert.equal(await page.evaluate(() => window.__AI_REQUESTS.filter(request => request.action === 'generate').length), 0, 'no generation on reload');
  } else {
    assert.equal(await page.locator('[data-ai-connect]').count(), 0);
    assert.match(await page.locator('[data-ai-account]').textContent(), /nécessite l’application Android/);
    await page.locator('[data-ai-open-brief]').click();
    assert.equal(await page.locator('[data-ai-generate]').isDisabled(), true);
  }
  assert.deepEqual(errors, []);
  const verification = { pass: true, fixture: nativeFixtures ? 'native protocol simulated; no real account login' : 'web without native bridge', apkAssets: !!assets, providers: 6, photos: photoRequests.length, errors };
  await writeFile(output + '/verification.json', JSON.stringify(verification, null, 2));
  console.log(JSON.stringify(verification));
} finally { await browser.close(); }
