import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('brief-smart-v87.js', 'utf8');
const local = new Map();
const document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
const window = {
  fetch: async () => new Response('{}'),
  addEventListener() {}
};
const context = {
  window,
  document,
  localStorage: {
    getItem(key) { return local.get(key) ?? null; },
    setItem(key, value) { local.set(key, String(value)); }
  },
  location: { href: 'https://example.test/', origin: 'https://example.test' },
  URL,
  Response,
  Promise,
  setTimeout,
  requestAnimationFrame() {}
};
vm.runInNewContext(source, context, { filename: 'brief-smart-v87.js' });

const api = window.__briefSmartV9112;
assert.ok(api, 'Brief public API must be available');

const now = Date.now();
const nepalEvacuation = {
  id: 'nepal-school',
  title: 'Népal : plus de 900 élèves évacués après les fortes inondations',
  summary: 'Les inondations qui frappent le Népal ont forcé les autorités à évacuer des écoles et plusieurs villages dans les zones touchées.',
  summaryQualityV919: 'source-grounded',
  publishedAt: new Date(now).toISOString()
};
const nepalGlaciers = {
  id: 'nepal-glaciers',
  title: 'Après les inondations au Népal, les glaciologues alertent sur les risques dans l’Himalaya',
  summary: 'Après les crues au Népal, des scientifiques analysent les glaciers et les risques de nouvelles montées des eaux dans les régions sinistrées.',
  summaryQualityV919: 'source-grounded',
  publishedAt: new Date(now - 30 * 60 * 1000).toISOString()
};
const indiaFlood = {
  id: 'india-flood',
  title: 'Inde : de fortes inondations provoquent des évacuations dans le nord du pays',
  summary: 'Les crues en Inde ont entraîné des évacuations après plusieurs jours de fortes pluies dans plusieurs districts.',
  summaryQualityV919: 'source-grounded',
  publishedAt: new Date(now - 20 * 60 * 1000).toISOString()
};
const nepalQuake = {
  id: 'nepal-quake',
  title: 'Népal : un séisme secoue l’ouest du pays sans lien avec les inondations',
  summary: 'Un tremblement de terre distinct a été enregistré dans l’ouest du Népal, sans rapport avec les crues suivies ailleurs dans le pays.',
  summaryQualityV919: 'source-grounded',
  publishedAt: new Date(now - 10 * 60 * 1000).toISOString()
};
const oldNepalFlood = {
  ...nepalGlaciers,
  id: 'nepal-old',
  publishedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString()
};
const rejectedClusterNoise = {
  id: 'cluster-noise',
  title: 'Une université publie son calendrier de rentrée',
  summary: 'Inondations au Népal : des centaines de personnes évacuées dans un autre titre agrégé par Google News.',
  summaryQualityV919: 'headline-cluster',
  publishedAt: new Date(now - 5 * 60 * 1000).toISOString()
};

assert.equal(api.sameEvent(nepalEvacuation, nepalGlaciers), true,
  'two angles of the same Nepal flood event must occupy only one Brief slot');
assert.equal(api.sameEvent(nepalEvacuation, indiaFlood), false,
  'different floods in different countries must remain separate events');
assert.equal(api.sameEvent(nepalEvacuation, nepalQuake), false,
  'different disaster types in the same country must remain separate events');
assert.equal(api.sameEvent(nepalEvacuation, oldNepalFlood), false,
  'the disaster shortcut must not merge coverage more than 24 hours apart');
assert.equal(api.sameEvent(nepalEvacuation, rejectedClusterNoise), false,
  'a rejected Google News aggregate summary must not create a false disaster duplicate');

console.log('v91.34 Brief disaster dedup checks passed');
