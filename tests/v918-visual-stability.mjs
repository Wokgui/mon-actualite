import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const publishedAt = new Date().toISOString();
let revision = 1;
let preparedRequests = 0;
let regeneratedRequests = 0;

function payload() {
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    stats: {},
    articles: [{
      id: 'visual-stability',
      title: 'Une image reste stable après actualisation du flux',
      summary: 'Article de test pour vérifier qu’une image déjà affichée ne disparaît pas pendant un nouveau rendu.',
      source: 'Source Test',
      category: 'Science',
      publishedAt,
      url: 'https://example.test/visual-stability',
      score: 100,
      editorialImportance: 80,
      image: revision === 1 ? 'https://cdn.example.test/known-image.jpg' : ''
    }]
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});

await context.route('**/api/news**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(payload())
}));

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#ddd"/></svg>';
await context.route('**/api/article-photo-fast**', route => {
  const url = new URL(route.request().url());
  if (url.searchParams.get('image')) preparedRequests += 1;
  else regeneratedRequests += 1;
  return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
});
await context.route('**/api/article-thumbnail**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'X-Thumbnail-Status': 'fallback' }, body: svg }));
await context.route('**/api/article-photo**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
await context.route('https://oxdrhwveuctrorrkuurw.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.article-card[data-article="visual-stability"] img.article-image', { timeout: 15000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.article-card[data-article="visual-stability"] img.article-image');
    return Boolean(image?.complete && image.naturalWidth > 1 && window.__visualStabilityV918?.remembered >= 1);
  }, null, { timeout: 10000 });

  const initial = await page.evaluate(() => {
    const image = document.querySelector('.article-card[data-article="visual-stability"] img.article-image');
    return {
      src: image?.src || '',
      classes: image?.className || '',
      stats: { ...window.__visualStabilityV918 }
    };
  });
  assert.match(initial.src, /article-photo-fast/);
  assert.match(initial.src, /image=/);
  assert.match(initial.classes, /prepared-visual/);
  assert.ok(initial.stats.remembered >= 1, 'known-good visual should be remembered');

  revision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await page.waitForFunction(expected => {
    const image = document.querySelector('.article-card[data-article="visual-stability"] img.article-image');
    return image?.src === expected && window.__visualStabilityV918?.reused >= 1;
  }, initial.src, { timeout: 10000 });

  const after = await page.evaluate(() => {
    const image = document.querySelector('.article-card[data-article="visual-stability"] img.article-image');
    return {
      src: image?.src || '',
      classes: image?.className || '',
      stats: { ...window.__visualStabilityV918 }
    };
  });

  assert.equal(after.src, initial.src, 'rerender should keep the last successfully loaded visual URL');
  assert.match(after.classes, /prepared-visual/);
  assert.ok(after.stats.reused >= 1, 'visual stability guard should reuse the known-good URL');
  assert.ok(after.stats.preventedChanges >= 1, 'guard should report a prevented visual URL change');
  assert.ok(preparedRequests >= 1, 'expected at least one prepared image request');
  assert.ok(regeneratedRequests <= 1, `unexpected repeated regenerated image requests: ${regeneratedRequests}`);

  console.log('v91.8 visual stability browser check passed.', JSON.stringify({ preparedRequests, regeneratedRequests, stats: after.stats }));
} finally {
  await browser.close();
}
