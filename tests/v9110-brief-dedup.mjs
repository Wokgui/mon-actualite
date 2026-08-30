import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const now = Date.now();

function article(id, title, category, score, minutesAgo = 0) {
  return {
    id,
    title,
    category,
    score,
    editorialImportance: score,
    publishedAt: new Date(now - minutesAgo * 60000).toISOString(),
    noveltyStateV78: 'new',
    lowInformationV89: false,
    summary: ''
  };
}

const items = [
  article('ice-a', "L'Islande dit non à la reprise des négociations pour intégrer l'Union européenne", 'Europe', 100, 10),
  article('ice-b', "En Islande, les eurosceptiques l'emportent lors du référendum sur l'UE après une nuit sous tension", 'International', 98, 15),
  article('ice-c', "Référendum islandais sur l'UE : le non s'impose", 'Société', 96, 20),
  article('ua-a', 'Guerre en Ukraine : la Russie lance une attaque massive de drones sur Kiev', 'International', 95, 25),
  article('ua-b', 'Guerre en Ukraine : Zelensky rencontre Macron à Paris pour discuter des garanties de sécurité', 'International', 94, 30),
  article('amazon-a', 'Vous avez deux jours : attention à cette arnaque Amazon Prime qui circule', 'Tech', 93, 35),
  article('amazon-b', 'Vous avez deux jours pour annuler votre commande Amazon Prime : cette arnaque vise les abonnés', 'Tech', 92, 40),
  article('science-a', 'Une nouvelle observation précise la masse d’une exoplanète proche', 'Science', 85, 45)
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  serviceWorkers: 'block'
});

await context.route('**/api/news**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ fetchedAt: new Date().toISOString(), stats: {}, articles: [] })
}));
await context.route('https://oxdrhwveuctrorrkuurw.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__briefSmartV9110?.version === '91.10', null, { timeout: 10000 });

  const result = await page.evaluate(samples => {
    const api = window.__briefSmartV9110;
    return {
      iceAB: api.sameEvent(samples[0], samples[1]),
      iceAC: api.sameEvent(samples[0], samples[2]),
      ukraineDistinct: api.sameEvent(samples[3], samples[4]),
      amazonDuplicate: api.sameEvent(samples[5], samples[6]),
      ids: api.selectIds(samples),
      stats: { ...api.stats }
    };
  }, items);

  assert.equal(result.iceAB, true, 'two formulations of the Iceland EU referendum result should be the same Brief event');
  assert.equal(result.iceAC, true, 'Iceland / islandais wording should still deduplicate');
  assert.equal(result.ukraineDistinct, false, 'different Ukraine developments must remain distinct');
  assert.equal(result.amazonDuplicate, true, 'near-identical Amazon Prime scam headlines should deduplicate');

  assert.equal(result.ids.filter(id => id.startsWith('ice-')).length, 1, 'Brief should keep only one Iceland referendum fact');
  assert.equal(result.ids.filter(id => id.startsWith('ua-')).length, 2, 'Brief should preserve two distinct Ukraine developments');
  assert.equal(result.ids.filter(id => id.startsWith('amazon-')).length, 1, 'Brief should keep only one Amazon scam fact');
  assert.ok(result.ids.includes('science-a'), 'unrelated science fact should remain');
  assert.equal(result.ids.length, 5, 'deduplication must not refill the Brief with suppressed duplicates');
  assert.ok(result.stats.lastDeduped >= 3, `expected at least three suppressed duplicates, got ${result.stats.lastDeduped}`);

  console.log('v91.10 Brief semantic dedup check passed.', JSON.stringify(result));
} finally {
  await browser.close();
}
