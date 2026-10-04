import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); } catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/chat-normal';
await mkdir(output, { recursive: true });
const native = process.env.CHAT_NATIVE_FIXTURE !== '0', errors = [], photoRequests = [];
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
const sources = Array.from({ length: 8 }, (_, i) => ({ id: 'chat-source-' + i, url: 'https://example.test/news/' + i, title: 'Innovation ' + i, summary: 'Extrait vérifié ' + i, publishedAt: new Date(Date.now() - i * 60000).toISOString(), category: 'Science', source: 'Source ' + i, image: '' }));
const prompt = 'En un paragraphe résume les innovations de la semaine avec liens vers les articles';
const png = await readFile(new URL('../assets/icon-192.png', import.meta.url));
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  if (process.env.AI_APK_ASSETS) await context.route('https://mon-actualite.vercel.app/assets/**', route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    if (relative.split('/').includes('..')) return route.abort();
    return route.fulfill({ path: process.env.AI_APK_ASSETS + '/' + relative });
  });
  await context.addInitScript(({ sources, prompt, native }) => {
    localStorage.setItem('news-cache-language-v98', 'fr');
    localStorage.setItem('news-live-cache', JSON.stringify({ articles: sources, fetchedAt: new Date().toISOString(), stats: {} }));
    if (!localStorage.getItem('news-brief-ai-settings-v1')) localStorage.setItem('news-brief-ai-settings-v1', JSON.stringify({ provider: 'chatgpt', prompt, autoAtOpen: true, model: 'old' }));
    window.__OLD_AI = []; window.__HANDOFF = []; window.__COPIED = ''; window.__CHAT_URL = ''; window.__COPY_FAILURE = false;
    window.MonActualiteAI = { postMessage(text) { window.__OLD_AI.push(JSON.parse(text)); } };
    if (native) window.MonActualiteChat = { postMessage(text) {
      const request = JSON.parse(text); window.__HANDOFF.push(request);
      if (!window.__COPY_FAILURE) { window.__COPIED = request.text; if (request.action === 'copy_and_open') window.__CHAT_URL = 'https://chatgpt.com/'; }
      setTimeout(() => window.MonActualiteChat.onmessage?.({ data: JSON.stringify({ id: request.id, ok: !window.__COPY_FAILURE, error: 'Copie impossible. Sélectionne la demande ci-dessous.' }) }), 20);
    } };
    else {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { if (window.__COPY_FAILURE) throw Error('Copie impossible. Sélectionne la demande ci-dessous.'); window.__COPIED = text; } } });
      window.open = () => ({ opener: null, location: { replace(url) { window.__CHAT_URL = url; } }, close() {} });
    }
  }, { sources, prompt, native });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let currentSources = sources;
  await page.route('**/api/news**', route => route.fulfill({ json: { articles: currentSources, fetchedAt: new Date().toISOString(), stats: {} } }));
  await page.route('**/api/article-photo-fast**', route => { photoRequests.push(route.request().url()); return route.fulfill({ body: png, contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'feed' } }); });
  await page.route('**/version.json**', route => route.fulfill({ json: { version: '98', codeRelease: '98.45' } }));
  await page.goto(process.env.AI_BASE_URL || 'http://127.0.0.1:4173/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length >= 8);
  const homePhotos = await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.dataset.article, card.querySelector('img').src])));
  assert.deepEqual(await page.evaluate(() => window.__OLD_AI), []);
  const openSettings = async () => {
    await page.locator('.bottom-nav [data-view="settings"]').click();
    const section = page.locator('.settings-accordion-v9185').filter({ has: page.locator('summary:text-is("IA")') });
    if (!await section.evaluate(node => node.open)) await section.locator('summary').click();
  };
  await openSettings();
  assert.equal(await page.locator('[data-ai-provider] option').count(), 6);
  assert.equal(await page.locator('[data-ai-connect],[data-ai-model],[data-ai-auto],[data-ai-generate]').count(), 0);
  for (const provider of ['claude','gemini','mistral','perplexity','grok','chatgpt']) {
    await page.locator('[data-ai-provider]').selectOption(provider);
    assert.match(await page.locator('[data-ai-account]').textContent(), /chat habituel/);
  }
  assert.equal(await page.locator('[data-ai-prompt]').inputValue(), prompt);
  const editedPrompt = prompt + '. Merci.';
  await page.locator('[data-ai-prompt]').fill(editedPrompt);
  await page.locator('[data-ai-copy-open]').click();
  await page.waitForFunction(() => window.__COPIED && window.__CHAT_URL);
  assert.equal(await page.evaluate(() => window.__CHAT_URL), 'https://chatgpt.com/');
  assert.ok((await page.evaluate(() => window.__COPIED)).startsWith(editedPrompt), 'first click after editing works without a blur/rerender swallowing it');
  assert.equal(await page.locator('[data-ai-request]').inputValue(), await page.evaluate(() => window.__COPIED));
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('news-brief-ai-chat-draft-v1')));
  assert.equal(draft.articles.length, 8);
  await page.waitForFunction(() => { const overlay = document.getElementById('startup-stability-v9815'); return !overlay || Number(getComputedStyle(overlay).opacity) < .01; });
  await page.screenshot({ path: output + '/reglages-chat-normal.png', fullPage: true });
  const response = { summary: 'Résumé avec [la source](' + sources[0].url + ') et [faux](https://evil.test/invente). <img src=x onerror=alert(1)>', cards: sources.slice(0,3).map((article,i) => ({ sourceId: 'A' + (i+1), title: 'Analyse ' + i, summary: 'Résumé source ' + i, image: 'https://evil.test/photo.png' })).concat([{ sourceId: 'A900', title: 'Faux', summary: 'Faux' }]) };
  await page.locator('[data-ai-response]').fill(JSON.stringify(response));
  await page.locator('[data-ai-import]').click();
  await page.waitForSelector('.ai-result-v9840');
  assert.equal(await page.locator('.brief-mode-tab').count(), 3);
  assert.equal(await page.locator('.ai-result-v9840').count(), 3);
  assert.deepEqual(await page.locator('.ai-news-summary-v9840 a').evaluateAll(links => links.map(link => link.href)), [sources[0].url]);
  assert.equal(await page.locator('.ai-news-summary-v9840 img').count(), 0);
  await page.waitForFunction(() => document.querySelectorAll('.ai-result-v9840 img.image-ready-v98').length === 3);
  for (const card of await page.locator('.ai-result-v9840 article').evaluateAll(cards => cards.map(card => ({ id: card.dataset.article, src: card.querySelector('img').src })))) assert.equal(card.src, homePhotos[card.id]);
  assert.equal(new Set(photoRequests).size, photoRequests.length, 'same image locks across Home and Brief');
  const previous = await page.locator('.ai-results-v9840').textContent();
  await page.screenshot({ path: output + '/brief-chat-normal.png', fullPage: true });
  await openSettings();
  await page.locator('[data-ai-response]').fill('{"summary":');
  await page.locator('[data-ai-import]').click();
  await page.waitForSelector('.ai-error-v9840');
  assert.match(await page.locator('.ai-error-v9840').textContent(), /incomplet ou mal formé/);
  assert.equal(await page.locator('[data-ai-response]').inputValue(), '{"summary":');
  await page.locator('[data-ai-open-brief]').click();
  assert.equal(await page.locator('.ai-results-v9840').textContent(), previous);
  // A feed update during the chat must not change A1's original meaning.
  currentSources = sources.slice().reverse();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSettings();
  assert.equal(await page.locator('[data-ai-request]').inputValue(), draft.text);
  await page.locator('[data-ai-response]').fill(JSON.stringify(response));
  await page.locator('[data-ai-import]').click();
  assert.equal(await page.locator('.ai-result-v9840 article').first().getAttribute('data-article'), draft.articles[0].id);
  await page.evaluate(() => { for(let i=0;i<6;i++) window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  assert.deepEqual(await page.evaluate(() => window.__OLD_AI), [], 'no account, models, refresh or generation calls');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('news-brief-ai-settings-v1')).autoAtOpen), false);
  await openSettings();
  await page.evaluate(() => { window.__COPY_FAILURE = true; });
  await page.locator('[data-ai-copy]').click();
  await page.waitForSelector('.ai-error-v9840');
  assert.equal(await page.locator('[data-ai-request]').inputValue(), draft.text, 'manual-copy fallback preserves prepared request');
  await page.locator('[data-ai-response]').fill('Un paragraphe et [source](' + sources[1].url + ').');
  await page.locator('[data-ai-import]').click();
  assert.equal(await page.locator('.ai-result-v9840').count(), 1);
  await openSettings();
  await page.locator('[data-ai-response]').fill('Un résumé sans lien reconnu.');
  await page.locator('[data-ai-import]').click();
  assert.equal(await page.locator('.ai-result-v9840').count(), 0);
  assert.match(await page.locator('.ai-news-summary-v9840').textContent(), /Un résumé sans lien reconnu/);
  assert.deepEqual(errors, []);
  const verification = { pass: true, nativeHandoffFixture: native, actualProviderConversation: false, oldSubscriptionRequests: 0, autoAtOpenMigratedOff: true, promptCopied: true, officialChatURL: true, frozenSources: true, jsonAndProse: true, sourcePhotosReused: true, invalidImportPreservesResult: true, copyFailureFallback: true, apkAssets: !!process.env.AI_APK_ASSETS, errors };
  await writeFile(output + '/verification.json', JSON.stringify(verification,null,2));
  console.log(JSON.stringify(verification));
  await context.close();
} finally { await browser.close(); }
