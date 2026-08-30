import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Representative headlines captured from the production /api/news feed on 2026-08-30.
// Scores deliberately stay close to the raw production scores so the test verifies
// that consequence and information value outrank mere feed position/recency.
const captured = [
  {
    id: 'nepal-floods',
    title: 'Népal : le bilan des inondations atteint 734 morts, les secours restent difficiles',
    category: 'International', score: 105, noveltyStateV78: 'development', informationValueV89: 88,
    editorialImportanceV78: 93, corroboratedV79: true, mergedCount: 3, sources: ['France 24', 'Reuters', 'AP']
  },
  {
    id: 'cyprus-ferry',
    title: 'Naufrage au large de Chypre : un ferry transportant 267 personnes fait au moins 6 morts',
    category: 'International', score: 105, noveltyStateV78: 'new', informationValueV89: 86,
    editorialImportanceV78: 91, corroboratedV79: true, mergedCount: 2, sources: ['France 24', 'Reuters']
  },
  {
    id: 'swiss-shooting',
    title: 'Suisse : une fusillade lors d’une rave party fait 1 mort et 5 blessés',
    category: 'Société', score: 101, noveltyStateV78: 'new', informationValueV89: 82,
    editorialImportanceV78: 84, corroboratedV79: true, mergedCount: 2, sources: ['AFP', 'RTS']
  },
  {
    id: 'ukraine-drones',
    title: 'Guerre en Ukraine : une nouvelle attaque massive de drones vise Kiev',
    category: 'International', score: 103, noveltyStateV78: 'development', informationValueV89: 82,
    editorialImportanceV78: 89, corroboratedV79: true, mergedCount: 3, sources: ['Reuters', 'France 24']
  },
  {
    id: 'iceland-referendum',
    title: "Référendum en Islande : le non à la reprise des négociations d’adhésion à l’Union européenne s’impose",
    category: 'Europe', score: 103, noveltyStateV78: 'new', informationValueV89: 80,
    editorialImportanceV78: 86, corroboratedV79: true, mergedCount: 4, sources: ['Reuters', 'RFI', 'France 24']
  },
  {
    id: 'iceland-duplicate',
    title: "L’Islande rejette la reprise des négociations pour intégrer l’Union européenne après le référendum",
    category: 'International', score: 100, noveltyStateV78: 'new', informationValueV89: 78,
    editorialImportanceV78: 84, corroboratedV79: true, mergedCount: 2, sources: ['France 24', 'RFI']
  },
  {
    id: 'glucksmann-primary',
    title: 'Présidentielle 2027 : Raphaël Glucksmann se dit candidat à une primaire de la gauche',
    category: 'Politique', score: 106, noveltyStateV78: 'new', informationValueV89: 72,
    editorialImportanceV78: 72, corroboratedV79: false, sources: ['Le Parisien']
  },
  {
    id: 'free-ai',
    title: 'ChatGPT, Claude, Gemini : ce que vous pouvez vraiment faire gratuitement sans débourser un centime',
    category: 'IA', score: 105, noveltyStateV78: 'new', informationValueV89: 77,
    editorialImportanceV78: 48, corroboratedV79: false, sources: ['01net']
  },
  {
    id: 'pogacar',
    title: 'Pogacar chute à l’entraînement et pourrait subir une opération',
    category: 'Santé', score: 104, noveltyStateV78: 'new', informationValueV89: 74,
    editorialImportanceV78: 45, corroboratedV79: false, sources: ['Eurosport']
  },
  {
    id: 'kia-ev2',
    title: 'Kia EV2 : prix, autonomie et premières impressions sur le nouveau SUV électrique',
    category: 'Automobile', score: 104, noveltyStateV78: 'new', informationValueV89: 70,
    editorialImportanceV78: 44, corroboratedV79: false, sources: ['Automobile Propre']
  },
  {
    id: 'induction',
    title: 'Plaque à induction : comment choisir le meilleur modèle et payer moins cher',
    category: 'Tech', score: 103, noveltyStateV78: 'new', informationValueV89: 66,
    editorialImportanceV78: 34, corroboratedV79: false, sources: ['Selectra']
  },
  {
    id: 'history-machine',
    title: 'En 1991, une machine étonnante transformait déjà le quotidien dans cette région d’Inde',
    category: 'International', score: 104, noveltyStateV78: 'new', informationValueV89: 61,
    editorialImportanceV78: 32, corroboratedV79: false, sources: ['SciencePost']
  }
].map((item, index) => ({
  ...item,
  lowInformationV89: false,
  publishedAt: new Date(Date.now() - index * 2 * 60000).toISOString(),
  summary: ''
}));

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
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__briefSmartV9112?.version === '91.12', null, { timeout: 10000 });
  const result = await page.evaluate(items => {
    const api = window.__briefSmartV9112;
    return {
      ids: api.selectIds(items),
      ranks: Object.fromEntries(items.map(item => [item.id, api.rank(item)])),
      impact: Object.fromEntries(items.map(item => [item.id, api.impactScore(item)])),
      duplicate: api.sameEvent(items.find(item => item.id === 'iceland-referendum'), items.find(item => item.id === 'iceland-duplicate')),
      stats: { ...api.stats }
    };
  }, captured);

  assert.equal(result.ids.length, 5, 'the initial Brief must expose five events, not up to eight');
  assert.equal(result.duplicate, true, 'the two real Iceland referendum formulations must collapse into one event');
  assert.equal(result.ids.filter(id => id.startsWith('iceland-')).length, 1, 'only one Iceland referendum event should survive');
  for (const id of ['nepal-floods', 'cyprus-ferry', 'swiss-shooting', 'ukraine-drones']) {
    assert.ok(result.ids.includes(id), `${id} should outrank lighter high-score feed items`);
  }
  assert.ok(result.ids.includes('iceland-referendum') || result.ids.includes('iceland-duplicate'), 'the Iceland referendum should be represented');
  for (const id of ['free-ai', 'pogacar', 'kia-ev2', 'induction', 'history-machine']) {
    assert.ok(!result.ids.includes(id), `${id} should not displace a more consequential event merely because of raw feed score`);
  }
  assert.ok(result.ranks['nepal-floods'] > result.ranks['free-ai'], 'large human impact must outweigh a consumer AI guide');
  assert.ok(result.impact['free-ai'] < 0, 'consumer/how-to content should receive a Brief impact penalty');
  assert.equal(result.stats.lastChosen, 5);

  console.log('v91.12 Brief captured-real-feed ranking passed.', JSON.stringify(result));
} finally {
  await browser.close();
}
