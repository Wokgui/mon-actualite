import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const now = Date.now();
const seedFetchedAt = '2000-01-01T00:00:00.000Z';
let generation = 1;
let newsRequests = 0;

function articlesForGeneration(value = 1) {
  const rows = [
    ['france-budget', 'Le gouvernement présente un nouveau calendrier budgétaire', 'Politique'],
    ['islande-europe', 'Islande : le référendum sur l’Union européenne se précise', 'Europe'],
    ['science-lune', 'Une nouvelle mission scientifique prépare des mesures sur la Lune', 'Science'],
    ['energie-solaire', 'Un projet solaire de grande ampleur entre en service', 'Énergie'],
    ['sante-recherche', 'Une étude clinique confirme une nouvelle piste thérapeutique', 'Santé'],
    ['international-accord', 'Un accord diplomatique est annoncé après plusieurs semaines de négociations', 'International']
  ];
  return rows.map(([id, title, category], index) => ({
    id,
    title: value === 2 && index === 0 ? `${title} avec une nouvelle date` : title,
    summary: `Résumé éditorial stable pour ${title.toLowerCase()}, avec assez de contexte pour les cartes et le Brief.`,
    detail: `Résumé éditorial stable pour ${title.toLowerCase()}, avec assez de contexte pour les cartes et le Brief.`,
    source: `Source ${index + 1}`,
    sources: [`Source ${index + 1}`],
    category,
    publishedAt: new Date(now - index * 60000).toISOString(),
    url: `https://example.test/${id}`,
    score: 180 - index * 5,
    essential: index < 3
  }));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.addInitScript(({ articles, fetchedAt }) => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    fetchedAt,
    stats: { feedsSucceeded: 6 },
    articles
  }));
}, { articles: articlesForGeneration(1), fetchedAt: seedFetchedAt });

await context.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/news') {
    newsRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        stats: { feedsSucceeded: 6 },
        articles: articlesForGeneration(generation)
      })
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
  await page.waitForFunction(() => window.__navigationPerformanceV9111?.version === '91.11', null, { timeout: 10000 });
  await page.waitForSelector('.article-card[data-article]', { timeout: 15000 });
  await page.waitForFunction(() => window.__navigationPerformanceV9111?.newsResponses >= 1, null, { timeout: 15000 });
  await page.waitForFunction(seed => {
    try { return JSON.parse(localStorage.getItem('news-live-cache') || '{}').fetchedAt !== seed; }
    catch { return false; }
  }, seedFetchedAt, { timeout: 15000 });
  // Several historical layers may finish their own startup work after the first
  // response. Start the navigation measurement only once /api/news is quiet.
  for (let pass = 0; pass < 5; pass += 1) {
    const before = newsRequests;
    await page.waitForTimeout(300);
    if (newsRequests === before) break;
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await page.locator('.bottom-nav [data-view="brief"]').click();
  await page.waitForSelector('.bottom-nav [data-view="brief"].active');
  await page.waitForSelector('.runtime-brief-content', { timeout: 10000 });
  await page.evaluate(() => { window.__v9111BriefNode = document.querySelector('#app > .page'); });

  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.waitForSelector('.bottom-nav [data-view="home"].active');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { window.__v9111HomeNode = document.querySelector('#app > .page'); });

  const beforeSame = await page.evaluate(() => ({
    perf: { ...window.__navigationPerformanceV9111 },
    cache: { ...window.__navigationCacheV9111.stats },
    cacheSize: window.__navigationCacheV9111.cacheSize()
  }));
  assert.ok(beforeSame.cacheSize >= 1, `Brief should be cached after the initial round trip: ${JSON.stringify({ newsRequests, beforeSame })}`);

  const requestsBeforeSame = newsRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(previous => {
    const stats = window.__navigationPerformanceV9111;
    return stats.unchangedResponses > previous.unchangedResponses
      && stats.suppressedSilentRenders > previous.suppressedSilentRenders;
  }, beforeSame.perf, { timeout: 15000 });
  assert.ok(newsRequests > requestsBeforeSame, 'silent online refresh should perform a news request');

  const sameRefresh = await page.evaluate(() => ({
    sameHomeNode: document.querySelector('#app > .page') === window.__v9111HomeNode,
    perf: { ...window.__navigationPerformanceV9111 },
    cache: { ...window.__navigationCacheV9111.stats },
    cacheSize: window.__navigationCacheV9111.cacheSize()
  }));
  assert.equal(sameRefresh.sameHomeNode, true, 'unchanged silent refresh must not replace the current Home DOM');
  assert.ok(sameRefresh.cacheSize >= 1, 'unchanged silent refresh must preserve the inactive Brief cache');
  assert.ok(sameRefresh.cache.preservedRefreshes > beforeSame.cache.preservedRefreshes);

  const restoreBefore = sameRefresh.cache.restored;
  const navTiming = await page.evaluate(async () => {
    const start = performance.now();
    document.querySelector('.bottom-nav [data-view="brief"]')?.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      duration: performance.now() - start,
      sameBriefNode: document.querySelector('#app > .page') === window.__v9111BriefNode
    };
  });
  assert.equal(navTiming.sameBriefNode, true, 'Brief must reuse the cached DOM after an unchanged background refresh');
  assert.ok(navTiming.duration < 250, `cached Home→Brief navigation should stay fast on the mobile runner (${navTiming.duration.toFixed(1)} ms)`);
  const restoreAfter = await page.evaluate(() => window.__navigationCacheV9111.stats.restored);
  assert.ok(restoreAfter > restoreBefore, 'navigation cache should record the Brief restoration');

  generation = 2;
  const beforeChanged = await page.evaluate(() => ({ ...window.__navigationPerformanceV9111 }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(previous => window.__navigationPerformanceV9111.changedResponses > previous.changedResponses, beforeChanged, { timeout: 15000 });
  await page.waitForFunction(() => {
    try {
      return JSON.parse(localStorage.getItem('news-live-cache') || '{}').articles?.some(article => /nouvelle date/i.test(article.title || ''));
    } catch { return false; }
  }, null, { timeout: 15000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const changed = await page.evaluate(() => ({
    sameOldBriefNode: document.querySelector('#app > .page') === window.__v9111BriefNode,
    perf: { ...window.__navigationPerformanceV9111 },
    cache: { ...window.__navigationCacheV9111.stats },
    cacheSize: window.__navigationCacheV9111.cacheSize(),
    text: document.querySelector('#app')?.textContent || ''
  }));
  assert.equal(changed.sameOldBriefNode, false, 'real news change must allow the current Brief to rerender');
  assert.ok(changed.perf.cacheInvalidations > beforeChanged.cacheInvalidations);
  assert.equal(changed.cacheSize, 0, 'real news change must invalidate inactive cached views');

  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.waitForSelector('.bottom-nav [data-view="home"].active');
  const homeAfterChange = await page.evaluate(() => ({
    reusedOldHome: document.querySelector('#app > .page') === window.__v9111HomeNode,
    text: document.querySelector('#app')?.textContent || ''
  }));
  assert.equal(homeAfterChange.reusedOldHome, false, 'Home cache must not reuse stale DOM after a real feed change');
  assert.match(homeAfterChange.text, /nouvelle date/i, 'the changed article title must be visible after invalidation');

  console.log('v91.11 navigation performance browser check passed.', JSON.stringify({
    navMs: Math.round(navTiming.duration),
    performance: changed.perf,
    cache: changed.cache
  }));
} finally {
  await browser.close();
}
