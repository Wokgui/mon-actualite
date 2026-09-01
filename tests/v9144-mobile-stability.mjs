import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const now = Date.now();
const articles = Array.from({ length: 12 }, (_, index) => ({
  id: `v9144-${index + 1}`,
  title: `Article de test ${index + 1} avec suffisamment de contexte`,
  summary: `Le texte source de l’article ${index + 1} contient plusieurs informations factuelles destinées à vérifier que le résumé IA est préparé en arrière-plan sans saturer les requêtes.`,
  detail: `Le texte source de l’article ${index + 1} contient plusieurs informations factuelles destinées à vérifier que le résumé IA est préparé en arrière-plan sans saturer les requêtes.`,
  source: `Source ${index + 1}`,
  sources: [`Source ${index + 1}`],
  category: index % 2 ? 'Tech' : 'IA',
  publishedAt: new Date(now - index * 60000).toISOString(),
  url: `https://example.test/v9144-${index + 1}`,
  score: 200 - index,
  essential: index < 4
}));

let smartCalls = 0;
let groqNetworkCalls = 0;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.addInitScript(seed => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    fetchedAt: new Date().toISOString(),
    stats: { feedsSucceeded: seed.length },
    articles: seed
  }));
  localStorage.removeItem('news-article-summaries-v8');
  localStorage.removeItem('news-summary-prewarm-attempts-v1');
}, articles);

await context.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/news') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fetchedAt: new Date().toISOString(), stats: { feedsSucceeded: articles.length }, articles })
    });
    return;
  }
  if (url.pathname === '/api/article-summary-smart') {
    smartCalls += 1;
    const body = route.request().postDataJSON?.() || {};
    const title = String(body?.article?.title || 'cet article');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ai: true,
        grounded: true,
        origin: 'groq-light-test',
        model: 'openai/gpt-oss-20b',
        text: `Résumé IA préparé pour ${title}. Il reprend les informations factuelles utiles de la source et reste disponible avant l’ouverture de l’article.`
      })
    });
    return;
  }
  if (url.pathname === '/api/article-summary-groq') {
    groqNetworkCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: '', unavailable: true, ai: false })
    });
    return;
  }
  if (['/api/article-thumbnail', '/api/article-photo-fast', '/api/article-photo', '/api/exact-news-thumbnail'].includes(url.pathname)) {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'X-Thumbnail-Status': 'ready' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#ddd"/></svg>'
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
await context.route('https://oxdrhwveuctrorrkuurw.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav [data-view="sheet"]', { timeout: 15000 });
  await page.waitForSelector('.article-card[data-article]', { timeout: 15000 });

  // One real mobile tap must open Personnaliser and it must remain open.
  await page.locator('.bottom-nav [data-view="sheet"]').tap();
  await page.waitForSelector('.personalization-sheet', { timeout: 5000 });
  await page.evaluate(() => { window.__v9144SheetNode = document.querySelector('.personalization-sheet'); });
  await page.waitForTimeout(1100);
  const personalizeStable = await page.evaluate(() => ({
    present: Boolean(document.querySelector('.personalization-sheet')),
    sameNode: document.querySelector('.personalization-sheet') === window.__v9144SheetNode,
    briefActive: Boolean(document.querySelector('.bottom-nav [data-view="brief"].active'))
  }));
  assert.equal(personalizeStable.present, true, 'Personnaliser must stay open after a single mobile tap');
  assert.equal(personalizeStable.sameNode, true, 'Personnaliser must not be torn down and rebuilt immediately after opening');
  assert.equal(personalizeStable.briefActive, false, 'opening Personnaliser must not accidentally activate Brief');

  // Reload to start from a clean visible state, then one tap must load Brief.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav [data-view="brief"]', { timeout: 15000 });
  await page.locator('.bottom-nav [data-view="brief"]').tap();
  await page.waitForSelector('.bottom-nav [data-view="brief"].active', { timeout: 5000 });
  await page.waitForSelector('.runtime-brief-content, [data-stable-brief-content]', { timeout: 10000 });
  await page.waitForTimeout(1100);
  const briefStable = await page.evaluate(() => ({
    active: Boolean(document.querySelector('.bottom-nav [data-view="brief"].active')),
    content: Boolean(document.querySelector('.runtime-brief-content, [data-stable-brief-content]')),
    personalizationOpen: Boolean(document.querySelector('.personalization-sheet'))
  }));
  assert.equal(briefStable.active, true, 'Brief must remain active after one mobile tap');
  assert.equal(briefStable.content, true, 'Brief content must remain rendered after navigation settles');
  assert.equal(briefStable.personalizationOpen, false, 'Brief must not leave the Personnaliser sheet open');

  // v91.44 must progressively prepare AI summaries instead of flooding Groq.
  await page.locator('.bottom-nav [data-view="home"]').tap();
  await page.waitForSelector('.bottom-nav [data-view="home"].active', { timeout: 5000 });
  const smartBefore = smartCalls;
  await page.waitForFunction(() => document.documentElement.dataset.summaryDemand === '91.44', null, { timeout: 5000 });
  await page.waitForTimeout(3500);
  const newSmartCalls = smartCalls - smartBefore;
  assert.ok(newSmartCalls >= 1, `progressive prewarm should prepare at least one summary, got ${newSmartCalls}`);
  assert.ok(newSmartCalls <= 1, `progressive prewarm must not burst requests during the first seconds, got ${newSmartCalls}`);
  assert.equal(groqNetworkCalls, 0, 'background prewarm must not send direct /api/article-summary-groq network calls');

  const cached = await page.evaluate(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('news-article-summaries-v8') || '{}');
      return Object.values(cache).filter(item => item?.ai === true && item?.progressiveV9144 === true && String(item?.summary || '').length >= 55).length;
    } catch {
      return 0;
    }
  });
  assert.ok(cached >= 1, 'at least one progressive AI summary must be cached before article opening');

  console.log('v91.44 local Android stability and progressive-summary checks passed.', JSON.stringify({ smartCalls, groqNetworkCalls, cached }));
} finally {
  await browser.close();
}
