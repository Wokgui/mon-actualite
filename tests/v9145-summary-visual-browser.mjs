import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
let smartCalls = 0;

const article = {
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
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.addInitScript(item => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    fetchedAt: new Date().toISOString(),
    stats: { feedsSucceeded: 1 },
    articles: [item]
  }));
  localStorage.removeItem('news-article-summaries-v8');
  localStorage.removeItem('news-visual-backfill-v3');
}, article);

await context.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/news') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ fetchedAt: new Date().toISOString(), stats: { feedsSucceeded: 1 }, articles: [article] })
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
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__summaryVisualGuardV9145?.version === '91.45', null, { timeout: 10000 });

  // 1. A semantic false-negative gets one and only one lightweight retry.
  const retryResult = await page.evaluate(async item => {
    const response = await fetch('/api/article-summary-smart?v=6&intent=foreground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: item })
    });
    return response.json();
  }, article);
  assert.equal(retryResult.ai, true, 'semantic support-check rejection must get one lightweight retry');
  assert.equal(retryResult.retryV9145, true, 'successful second attempt must be marked as the v91.45 retry');
  assert.equal(smartCalls, 2, 'support-check recovery must use exactly one retry');

  // The non-AI fallback algorithm itself must produce useful condensed text.
  const extracted = await page.evaluate(item => window.__summaryVisualGuardV9145.extractiveFallback(item), article);
  const combinedSource = `${article.summary} ${article.detail}`;
  assert.ok(String(extracted || '').length >= 100, 'extractive fallback must contain useful information');
  assert.ok(String(extracted || '').length < combinedSource.length * 0.7, 'fallback must condense duplicated source material');
  assert.doesNotMatch(String(extracted || ''), /newsletter|cookie|abonn|connectez|partager|lire aussi|voir aussi/i, 'fallback must exclude boilerplate');

  // 2. Reproduce the real image bug independently from the historical quickview stack:
  // the card owns a late-loaded image, while the article object itself has no image URL.
  await page.evaluate(item => {
    localStorage.setItem('news-live-cache', JSON.stringify({
      fetchedAt: new Date().toISOString(), stats: { feedsSucceeded: 1 }, articles: [item]
    }));
    document.querySelector('#local-v9145-controlled-card')?.remove();
    document.querySelector('#local-v9145-controlled-modal')?.remove();

    const card = document.createElement('article');
    card.id = 'local-v9145-controlled-card';
    card.className = 'article-card';
    card.dataset.article = item.id;
    card.innerHTML = '<img class="late-card-visual" src="/test-card-image.svg" alt=""><h2>Carte locale 91.45</h2>';
    document.body.appendChild(card);
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' }));

    const modal = document.createElement('div');
    modal.id = 'local-v9145-controlled-modal';
    modal.className = 'quick-summary-backdrop';
    modal.innerHTML = `<section class="quick-summary-sheet">
      <header class="quick-summary-head"><h2>${item.title}</h2></header>
      <div class="quick-summary-text" data-quick-summary-text>Résumé IA momentanément indisponible pour cet article.</div>
    </section>`;
    document.body.appendChild(modal);
  }, article);

  await page.waitForFunction(() => document.querySelector('#local-v9145-controlled-modal .quick-summary-image')?.getAttribute('src')?.includes('/test-card-image.svg'), null, { timeout: 5000 });
  const modalImage = await page.locator('#local-v9145-controlled-modal .quick-summary-image').getAttribute('src');
  assert.match(String(modalImage || ''), /test-card-image\.svg/, 'summary modal must reuse the image already rendered on the article card');

  // 3. Reassert the failure state and mutate the modal to trigger the guard after all
  // historical layers have seen it. The guard must replace it with a clearly non-AI fallback.
  await page.evaluate(item => {
    localStorage.setItem('news-live-cache', JSON.stringify({
      fetchedAt: new Date().toISOString(), stats: { feedsSucceeded: 1 }, articles: [item]
    }));
    const modal = document.querySelector('#local-v9145-controlled-modal');
    const box = modal?.querySelector('[data-quick-summary-text]');
    if (box) box.textContent = 'Résumé IA momentanément indisponible pour cet article.';
    modal?.appendChild(document.createElement('i'));
  }, article);

  await page.waitForFunction(() => {
    const modal = document.querySelector('#local-v9145-controlled-modal');
    const text = modal?.querySelector('[data-quick-summary-text]')?.textContent || '';
    return text.length >= 100 && !/momentanément indisponible/i.test(text);
  }, null, { timeout: 5000 });

  const fallback = await page.evaluate(() => ({
    text: document.querySelector('#local-v9145-controlled-modal [data-quick-summary-text]')?.textContent || '',
    status: document.querySelector('#local-v9145-controlled-modal .quick-summary-status-v9138')?.textContent || '',
    localFallback: document.querySelector('#local-v9145-controlled-modal')?.dataset.localFallbackV9145 || ''
  }));
  assert.ok(fallback.text.length >= 100, 'automatic fallback must contain useful information');
  assert.equal(fallback.status, 'Résumé automatique', `non-AI fallback must be clearly labeled, got ${fallback.status}`);
  assert.equal(fallback.localFallback, '1', 'fallback must expose the local v91.45 marker');

  console.log('v91.45 local summary + visual mobile checks passed.', JSON.stringify({
    smartCalls,
    modalImage,
    fallbackStatus: fallback.status,
    fallbackChars: fallback.text.length
  }));
} finally {
  await browser.close();
}
