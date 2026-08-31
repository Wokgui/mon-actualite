import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('brief-smart-v87.js', 'utf8');
const indexSource = fs.readFileSync('index.html', 'utf8');
const workerSource = fs.readFileSync('sw.js', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
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
assert.match(indexSource, /brief-smart-v87\.js\?v=91\.34/,
  'the page must request the v91.34 Brief asset instead of a stale cached v91.30 copy');
assert.match(indexSource, /manifest\.webmanifest\?v=91\.34/,
  'the page must request the v91.34 manifest');
assert.match(workerSource, /mon-actualite-v91-34-core-r1/,
  'the service worker cache must rotate for the v91.34 client change');
assert.match(workerSource, /brief-smart-v87\.js\?v=91\.34/,
  'the service worker must precache the v91.34 Brief asset');
assert.match(workerSource, /manifest\.webmanifest\?v=91\.34/,
  'the service worker must precache the v91.34 manifest');
assert.equal(version.codeRelease, '91.34', 'version.json must publish code release 91.34');
assert.equal(manifest.start_url, '/?code-release=91.34', 'PWA start URL must publish code release 91.34');

const now = Date.now();
// Captured from the real 2026-08-31 feed. Google News descriptions are
// deliberately marked as headline-cluster so the disaster shortcut must
// succeed from trustworthy title evidence rather than aggregate snippets.
const nepalEvacuation = {
  id: 'nepal-school',
  title: 'Ce directeur d’école raconte comment il a évacué 900 élèves avant la crue éclair au Népal',
  summary: 'Ce directeur d’école raconte comment il a évacué 900 élèves avant la crue éclair au Népal Le HuffPost Au Népal, après les inondations, les glaciologues sidérés par l’ampleur de la catastrophe Le Monde.fr',
  summaryQualityV919: 'headline-cluster',
  publishedAt: new Date(now).toISOString()
};
const nepalGlaciers = {
  id: 'nepal-glaciers',
  title: 'Au Népal, après les inondations, les glaciologues sidérés par l’ampleur de la catastrophe',
  summary: 'Au Népal, après les inondations, les glaciologues sidérés par l’ampleur de la catastrophe Le Monde.fr Après les crues meurtrières au Népal, plusieurs médias suivent les opérations de secours.',
  summaryQualityV919: 'headline-cluster',
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
  'the two captured Nepal flood angles must occupy only one Brief slot');
assert.equal(api.sameEvent(nepalEvacuation, indiaFlood), false,
  'different floods in different countries must remain separate events');
assert.equal(api.sameEvent(nepalEvacuation, nepalQuake), false,
  'different disaster types in the same country must remain separate events');
assert.equal(api.sameEvent(nepalEvacuation, oldNepalFlood), false,
  'the disaster shortcut must not merge coverage more than 24 hours apart');
assert.equal(api.sameEvent(nepalEvacuation, rejectedClusterNoise), false,
  'a rejected Google News aggregate summary must not create a false disaster duplicate');

console.log('v91.34 Brief disaster dedup, captured-feed and PWA release checks passed');
