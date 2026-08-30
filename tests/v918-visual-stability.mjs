import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const publishedAt = new Date().toISOString();
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
      image: 'https://cdn.example.test/known-image.jpg'
    }]
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

await context.route('**/api/news**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) }));
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
  await page.waitForSelector('.article-card[data-article] img.article-image', { timeout: 15000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.article-card[data-article] img.article-image');
    return Boolean(image?.complete && image.naturalWidth > 1 && window.__visualStabilityV918?.remembered >= 1);
  }, null, { timeout: 10000 });

  const initial = await page.evaluate(() => {
    const card = document.querySelector('.article-card[data-article]');
    const image = card?.querySelector('img.article-image');
    return { articleId: String(card?.dataset.article || ''), src: image?.src || '', classes: image?.className || '', stats: { ...window.__visualStabilityV918 } };
  });
  assert.ok(initial.articleId);
  assert.match(initial.src, /article-photo-fast/);
  assert.match(initial.src, /image=/);
  assert.match(initial.classes, /prepared-visual/);

  const baselineReused = Number(initial.stats.reused || 0);
  const baselinePrevented = Number(initial.stats.preventedChanges || 0);

  // Reproduce what the historical visual layers actually do: mutate the src
  // and classes of the already-rendered image. Do not replace #app, because
  // the application itself legitimately rebuilds that container.
  await page.evaluate(id => {
    const image = document.querySelector(`.article-card[data-article="${CSS.escape(id)}"] img.article-image`);
    if (!image) throw new Error('target image missing');
    image.classList.remove('prepared-visual');
    image.classList.add('source-tile-visual');
    image.src = '/api/article-photo-fast?v=85&url=https%3A%2F%2Fexample.test%2Fvisual-stability&title=regenerated';
  }, initial.articleId);

  await page.waitForFunction(({ id, expected, baselineReused }) => {
    const image = document.querySelector(`.article-card[data-article="${CSS.escape(id)}"] img.article-image`);
    return image?.src === expected && Number(window.__visualStabilityV918?.reused || 0) > baselineReused;
  }, { id: initial.articleId, expected: initial.src, baselineReused }, { timeout: 5000 });

  const after = await page.evaluate(id => {
    const image = document.querySelector(`.article-card[data-article="${CSS.escape(id)}"] img.article-image`);
    return { src: image?.src || '', classes: image?.className || '', stats: { ...window.__visualStabilityV918 } };
  }, initial.articleId);

  assert.equal(after.src, initial.src, 'layered rerender should restore the last successfully loaded visual URL');
  assert.match(after.classes, /prepared-visual/);
  assert.doesNotMatch(after.classes, /source-tile-visual/);
  assert.ok(Number(after.stats.reused || 0) > baselineReused);
  assert.ok(Number(after.stats.preventedChanges || 0) > baselinePrevented);
  assert.ok(preparedRequests >= 1);
  assert.ok(regeneratedRequests <= 1, `unexpected repeated regenerated image requests: ${regeneratedRequests}`);

  console.log('v91.8 visual stability browser check passed.', JSON.stringify({ preparedRequests, regeneratedRequests, stats: after.stats }));
} finally {
  await browser.close();
}
