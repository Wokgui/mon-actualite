import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
let smartCalls = 0;

const articles = [
  {
    id: 'local-9145-1',
    title: 'Une nouvelle technologie améliore nettement l’autonomie des appareils mobiles',
    summary: 'Les chercheurs ont présenté une nouvelle technologie de gestion énergétique qui réduit la consommation lors des usages courants. Les premiers essais montrent une autonomie prolongée sans réduire les performances. La méthode doit encore être testée à plus grande échelle avant une intégration commerciale.',
    detail: 'Les chercheurs ont présenté une nouvelle technologie de gestion énergétique qui réduit la consommation lors des usages courants. Les premiers essais montrent une autonomie prolongée sans réduire les performances. La méthode doit encore être testée à plus grande échelle avant une intégration commerciale.',
    source: 'Source Test',
    category: 'Tech',
    publishedAt: new Date().toISOString(),
    url: 'https://example.test/local-9145-1',
    score: 200,
    essential: true
  },
  {
    id: 'local-9145-2',
    title: 'Un second article permet de vérifier le chargement progressif des résumés',
    summary: 'Ce second article contient plusieurs informations distinctes afin de vérifier que la préparation des résumés reste progressive et ne lance pas une rafale de requêtes simultanées.',
    detail: 'Ce second article contient plusieurs informations distinctes afin de vérifier que la préparation des résumés reste progressive et ne lance pas une rafale de requêtes simultanées.',
    source: 'Source Test 2',
    category: 'Science',
    publishedAt: new Date(Date.now() - 60000).toISOString(),
    url: 'https://example.test/local-9145-2',
    score: 180
  }
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.addInitScript(items => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    fetchedAt: new Date().toISOString(),
    stats: { feedsSucceeded: 2 },
    articles: items
  }));
  localStorage.removeItem('news-article-summaries-v8');
  localStorage.removeItem('news-visual-backfill-v3');
}, articles);

await context.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/news') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fetchedAt: new Date().toISOString(), stats: { feedsSucceeded: 2 }, articles })
    });
    return;
  }
  if (url.pathname === '/api/article-summary-smart') {
    smartCalls += 1;
    if (smartCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, text: '', ai: false, origin: 'unavailable', error: 'support-check' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        text: 'La nouvelle technologie réduit la consommation énergétique pendant les usages courants et prolonge l’autonomie sans baisse de performances. Les premiers essais sont positifs, mais une validation à plus grande échelle reste nécessaire avant une commercialisation.',
        ai: true,
        grounded: true,
        origin: 'groq-light',
        model: 'openai/gpt-oss-20b'
      })
    });
    return;
  }
  if (url.pathname === '/api/article-summary-groq') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: 'La nouvelle technologie réduit la consommation énergétique pendant les usages courants et prolonge l’autonomie sans baisse de performances. Les premiers essais sont positifs, mais une validation à plus grande échelle reste nécessaire avant une commercialisation.',
        ai: true,
        grounded: true,
        provider: 'groq-light',
        model: 'openai/gpt-oss-20b',
        unavailable: false
      })
    });
    return;
  }
  if (['/api/article-thumbnail', '/api/article-photo-fast', '/api/article-photo', '/api/exact-news-thumbnail'].includes(url.pathname)) {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__summaryVisualGuardV9145?.version === '91.45', null, { timeout: 10000 });

  const retryResult = await page.evaluate(async article => {
    const response = await fetch('/api/article-summary-smart?v=6&intent=foreground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article })
    });
    return response.json();
  }, articles[0]);
  assert.equal(retryResult.ai, true, 'semantic support-check rejection must get one lightweight retry');
  assert.equal(retryResult.retryV9145, true, 'successful second attempt must be marked as the v91.45 retry');
  assert.equal(smartCalls, 2, 'support-check recovery must use exactly one retry');

  await page.evaluate(() => {
    const existing = document.querySelector('#local-v9145-controlled-card');
    existing?.remove();
    const card = document.createElement('article');
    card.id = 'local-v9145-controlled-card';
    card.className = 'article-card';
    card.dataset.article = 'local-9145-1';
    card.innerHTML = '<img class="late-card-visual" src="/test-card-image.svg" alt=""><h2>Carte locale 91.45</h2>';
    document.body.appendChild(card);
  });

  await page.locator('#local-v9145-controlled-card').click();
  await page.waitForSelector('.quick-summary-backdrop', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.quick-summary-image')?.getAttribute('src')?.includes('/test-card-image.svg'), null, { timeout: 5000 });
  const modalImage = await page.locator('.quick-summary-image').getAttribute('src');
  assert.match(String(modalImage || ''), /test-card-image\.svg/, 'quick summary must reuse the image already rendered on the article card');

  await page.waitForFunction(() => /prolonge l’autonomie|prolonge l'autonomie/i.test(document.querySelector('[data-quick-summary-text]')?.textContent || ''), null, { timeout: 8000 });
  const summary = await page.locator('[data-quick-summary-text]').textContent();
  assert.ok(String(summary || '').length >= 100, 'opened article must receive a substantial summary');
  assert.doesNotMatch(String(summary || ''), /momentanément indisponible/i, 'opened article must not remain without a summary when Groq succeeds');

  console.log('v91.45 local summary + visual mobile checks passed.', JSON.stringify({ smartCalls, modalImage }));
} finally {
  await browser.close();
}
