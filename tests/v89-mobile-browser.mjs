import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const publishedAt = new Date().toISOString();
let revision = 1;

function newsPayload() {
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    stats: {},
    articles: [
      {
        id: 'reaction',
        title: 'Une célébrité réagit à la nouvelle et donne son avis',
        summary: 'La personnalité a réagi sur les réseaux sociaux et a expliqué ce qu’elle pensait de la situation, sans annoncer de décision ni apporter de fait supplémentaire.',
        source: 'Source Réaction',
        category: 'Culture',
        publishedAt,
        url: 'https://example.test/reaction',
        score: 82,
        editorialImportance: 45,
        image: ''
      },
      {
        id: 'factual',
        title: 'La NASA confirme une nouvelle étape de la mission Artemis',
        summary: revision === 1
          ? 'La NASA confirme que 12 équipements ont terminé la phase de validation le 29 août 2026. L’agence annonce le lancement de la prochaine étape après cette décision technique.'
          : 'La NASA confirme que 15 équipements ont terminé la phase de validation le 29 août 2026. L’agence annonce le lancement de la prochaine étape après cette décision technique.',
        source: 'Source Science',
        sources: ['Source Science', 'Agence Test'],
        category: 'Science',
        publishedAt,
        url: 'https://example.test/artemis',
        score: 81,
        editorialImportance: 82,
        image: ''
      },
      {
        id: 'politics',
        title: 'Le Parlement adopte une réforme après le vote final',
        summary: 'Le Parlement adopte la réforme après un vote final de 318 voix. Le texte entrera en application le 1er septembre après sa publication officielle.',
        source: 'Source Politique',
        category: 'Politique',
        publishedAt,
        url: 'https://example.test/reforme',
        score: 77,
        editorialImportance: 86,
        image: ''
      },
      {
        id: 'energy',
        title: 'Une centrale solaire ouvre avec une capacité accrue',
        summary: 'La nouvelle centrale solaire ouvre avec 240 mégawatts de capacité et doit alimenter plusieurs dizaines de milliers de foyers dès cette semaine.',
        source: 'Source Énergie',
        category: 'Énergie',
        publishedAt,
        url: 'https://example.test/solaire',
        score: 73,
        editorialImportance: 72,
        image: ''
      }
    ]
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});

await context.route('**/api/news**', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(newsPayload()) });
});

await context.route('**/api/article-summary-groq**', async route => {
  const method = route.request().method();
  if (method === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'test-groq' }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Résumé de test suffisamment détaillé pour valider l’ouverture rapide de l’article.', unavailable: false, ai: true }) });
});

await context.route('**/api/article-summary-multisource**', async route => {
  const method = route.request().method();
  if (method === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'test-multisource' }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, summary: 'Synthèse croisée de test avec des faits présents dans plusieurs sources distinctes.', unavailable: false, corroborated: true, sourceCount: 2, sources: ['Source Science', 'Agence Test'] }) });
});

await context.route('**/api/article-story-intelligence**', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'test-story', contradictions: [], sourceCount: 2, sources: ['Source Science', 'Agence Test'] }) });
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="100%" height="100%" fill="#ddd"/></svg>';
for (const pattern of ['**/api/article-thumbnail**', '**/api/article-photo-fast**', '**/api/article-image**', '**/api/article-photo**']) {
  await context.route(pattern, route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
}

await context.route('https://oxdrhwveuctrorrkuurw.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const page = await context.newPage();
page.on('console', message => {
  if (message.type() === 'error') console.error('browser console:', message.text());
});

function cachePair() {
  const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
  const articles = cache.articles || [];
  const reaction = articles.find(article => String(article.url || '').includes('/reaction'));
  const factual = articles.find(article => String(article.url || '').includes('/artemis'));
  return { articles, reaction, factual };
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.pipelineVersion === '89', null, { timeout: 15000 });
  await page.waitForSelector('.article-card[data-article]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    const articles = cache.articles || [];
    const reaction = articles.find(article => String(article.url || '').includes('/reaction'));
    const factual = articles.find(article => String(article.url || '').includes('/artemis'));
    return Number.isFinite(Number(reaction?.informationValueV89)) && Number.isFinite(Number(factual?.informationValueV89));
  }, null, { timeout: 10000 });

  const initial = await page.evaluate(() => {
    const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    const articles = cache.articles || [];
    const reaction = articles.find(article => String(article.url || '').includes('/reaction'));
    const factual = articles.find(article => String(article.url || '').includes('/artemis'));
    return {
      ids: articles.map(article => ({ id: article.id, url: article.url, value: article.informationValueV89, essential: article.essential, novelty: article.noveltyStateV78 })),
      reaction,
      factual,
      cardCount: document.querySelectorAll('.article-card[data-article]').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  console.log('v89 information values:', JSON.stringify(initial.ids));
  assert.ok(initial.cardCount >= 3, `expected at least 3 cards, got ${initial.cardCount}`);
  assert.ok(initial.factual && initial.reaction, `expected factual and reaction articles in cache; got ${JSON.stringify(initial.ids)}`);
  assert.ok(Number(initial.factual.informationValueV89) > Number(initial.reaction.informationValueV89), `factual value ${initial.factual.informationValueV89} should exceed reaction value ${initial.reaction.informationValueV89}`);
  assert.ok(Number(initial.reaction.informationValueV89) <= 40, `pure reaction article should stay low-value, got ${initial.reaction.informationValueV89}`);
  assert.ok(initial.overflow <= 2, `mobile layout overflows horizontally by ${initial.overflow}px`);

  await page.locator('.bottom-nav [data-view="brief"]').click();
  await page.waitForSelector('.bottom-nav [data-view="brief"].active', { timeout: 5000 });
  await page.waitForSelector('.brief-smart-v87', { timeout: 7000 });

  await page.locator('.bottom-nav [data-view="home"]').click();
  await page.waitForSelector('.bottom-nav [data-view="home"].active', { timeout: 5000 });

  const factualId = String(initial.factual.id || 'factual');
  const factualCard = page.locator(`.article-card[data-article="${factualId}"]`);
  await factualCard.scrollIntoViewIfNeeded();
  await factualCard.click();
  await page.waitForTimeout(250);

  const storedRead = await page.evaluate(() => JSON.parse(localStorage.getItem('news-read-revisions-v89') || '{}'));
  assert.ok(Object.keys(storedRead).some(key => key.includes('example.test/artemis')), 'reading snapshot was not stored');

  revision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => {
    const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return (cache.articles || []).some(article => String(article.url || '').includes('/artemis') && article.revisionSinceReadV89 === true);
  }, null, { timeout: 10000 });

  const revisionState = await page.evaluate(() => {
    const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return (cache.articles || []).find(article => String(article.url || '').includes('/artemis'))?.revisionTypeV89 || '';
  });
  assert.ok(['correction', 'updated'].includes(revisionState), `unexpected revision state: ${revisionState}`);

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active);
  }, null, { timeout: 15000 });

  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  }

  await context.unroute('**/api/news**');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.bottom-nav [data-view="home"]', { timeout: 10000 });
  await page.waitForSelector('.article-card[data-article]', { timeout: 10000 });
  const offlineState = await page.evaluate(() => ({
    online: navigator.onLine,
    cached: (JSON.parse(localStorage.getItem('news-live-cache') || '{}').articles || []).length,
    overflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  assert.equal(offlineState.online, false, 'browser should report offline mode');
  assert.ok(offlineState.cached >= 3, 'cached feed should survive offline reload');
  assert.ok(offlineState.overflow <= 2, `offline mobile layout overflows by ${offlineState.overflow}px`);

  console.log('All v89 mobile/PWA browser checks passed.');
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
}
