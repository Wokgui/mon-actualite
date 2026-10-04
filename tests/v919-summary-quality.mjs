import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const publishedAt = new Date().toISOString();
const aggregate = 'Le fait principal &nbsp;&nbsp; Source Test Deuxième titre sans rapport &nbsp;&nbsp; Autre Média Voir plus de titres et de points de vue sur Google Actualités';
const realSummary = 'Une source directe fournit ici un véritable résumé éditorial suffisamment long pour rester affiché dans la carte.';

function googleArticle(id = 'google-cluster') {
  return {
    id,
    title: 'Le fait principal - Source Test',
    summary: aggregate,
    detail: aggregate,
    source: 'Source Test',
    sources: ['Source Test'],
    category: 'International',
    publishedAt,
    url: 'https://news.google.com/rss/articles/CBMi-summary-v919?oc=5',
    score: 100
  };
}

function directArticle() {
  return {
    id: 'direct-summary',
    title: 'Une information avec un vrai résumé',
    summary: realSummary,
    detail: realSummary,
    source: 'Source Directe',
    sources: ['Source Directe'],
    category: 'Science',
    publishedAt: new Date(Date.now() - 60000).toISOString(),
    url: 'https://example.test/direct-summary',
    score: 90
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.addInitScript(({ aggregateValue, directValue }) => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    fetchedAt: new Date().toISOString(),
    articles: [
      {
        id: 'cached-google-cluster',
        title: 'Ancien fait principal - Source Test',
        summary: aggregateValue,
        detail: aggregateValue,
        source: 'Source Test',
        category: 'International',
        publishedAt: new Date().toISOString(),
        url: 'https://news.google.com/rss/articles/CBMi-cached-v919?oc=5'
      },
      {
        id: 'cached-direct-summary',
        title: 'Résumé direct conservé',
        summary: directValue,
        detail: directValue,
        source: 'Source Directe',
        category: 'Science',
        publishedAt: new Date().toISOString(),
        url: 'https://example.test/cached-direct'
      }
    ]
  }));
}, { aggregateValue: aggregate, directValue: realSummary });

await context.route('**/api/news**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ fetchedAt: new Date().toISOString(), stats: {}, articles: [googleArticle(), directArticle()] })
}));
await context.route('https://oxdrhwveuctrorrkuurw.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#ddd"/></svg>';
await context.route('**/api/article-thumbnail**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
await context.route('**/api/article-photo-fast**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
await context.route('**/api/article-photo**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__summaryQualityV919?.version === '91.9', null, { timeout: 10000 });

  const fetched = await page.evaluate(async () => {
    const response = await fetch('/api/news?v=summary-quality-v919');
    return response.json();
  });
  const google = fetched.articles.find(article => article.source === 'Source Test');
  const direct = fetched.articles.find(article => article.source === 'Source Directe');
  assert.ok(google, 'Google News test article must remain in the feed');
  assert.equal(google.summary, '', 'Google News headline cluster must not be exposed as a summary');
  assert.equal(google.detail, '', 'Google News headline cluster must not survive in detail either');
  assert.equal(google.summaryQualityV919, 'google-news-headline-cluster');
  assert.equal(google.summaryNeedsFetchV919, true);
  assert.equal(direct?.summary, realSummary, 'real non-Google summary must be preserved');

  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('news-live-cache') || '{}'));
  const cachedGoogle = cached.articles?.find(article => article.id === 'cached-google-cluster');
  const cachedDirect = cached.articles?.find(article => article.id === 'cached-direct-summary');
  assert.equal(cachedGoogle?.summary, '', 'existing cached Google headline cluster must be cleaned at startup');
  assert.equal(cachedGoogle?.detail, '', 'existing cached Google detail cluster must be cleaned at startup');
  assert.equal(cachedDirect?.summary, realSummary, 'existing direct summary must survive cache migration');

  await page.waitForSelector('.article-card', { timeout: 15000 });
  const dom = await page.evaluate(() => ({
    text: document.body.textContent || '',
    visibleEmptySummaries: [...document.querySelectorAll('.article-card .summary')]
      .filter(node => !String(node.textContent || '').trim() && !node.hidden).length,
    stats: { ...window.__summaryQualityV919 }
  }));
  assert.doesNotMatch(dom.text, /Deuxième titre sans rapport/, 'aggregate secondary headlines must not leak into rendered cards or Brief');
  assert.equal(dom.visibleEmptySummaries, 0, 'empty summary paragraphs should be hidden');
  assert.ok(dom.stats.cleanedFeedSummaries >= 1);
  assert.ok(dom.stats.cleanedCacheSummaries >= 1);

  console.log('v91.9 summary quality browser check passed.', JSON.stringify(dom.stats));
} finally {
  await browser.close();
}
