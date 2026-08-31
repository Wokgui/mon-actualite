import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { homeSignalScore } = require('../lib/news-significance.js');

function signal(title) {
  return homeSignalScore({ title });
}

const mercato = signal('DIRECT. Mercato: Liverpool officialise Barcola, la prolongation de Dembélé au PSG en bonne voie');
assert.equal(mercato.score, -16,
  'a sports transfer must not become a public decision merely because a club officialises it');
assert.ok(mercato.reasons.includes('sport léger'));

const gta = signal('GTA 6 bouleverse la conduite et le vol de voitures, voici tout ce qui change');
assert.equal(gta.score, 0,
  'generic wording such as “ce qui change” must not create a public-policy boost without policy context');

const euStats = signal("Le PIB par habitant des pays de l'Union européenne");
assert.equal(euStats.score, 0,
  'mentioning the European Union alone must not count as a public decision');

const euDebate = signal('État de l’Union européenne 2026: suivez le débat | Thèmes | Parlement européen');
assert.equal(euDebate.score, 0,
  'mentioning Parliament in a descriptive debate title must not count as a decision');

const fuelAid = signal('Carburants : le gouvernement assure que les aides ne seront pas suspendues');
assert.ok(fuelAid.score >= 10 && fuelAid.reasons.includes('décision publique'),
  'a government decision about public aid must keep its policy boost');

const retirement = signal('Retraite des femmes : les règles changent le 1er septembre, quelles conséquences pour les mères ?');
assert.ok(retirement.score >= 10 && retirement.reasons.includes('décision publique'),
  'rules entering into effect on a dated public-policy topic must keep their policy boost');

const dsa = signal('ChatGPT, Roblox et Reddit vont être soumis à des règles renforcées dans l’UE');
assert.ok(dsa.score >= 10 && dsa.reasons.includes('décision publique'),
  'strengthened EU platform rules are a real public-policy change');

const source = fs.readFileSync('summary-race-v78.js', 'utf8');

function install(fetchImpl) {
  const local = new Map();
  const localStorage = {
    getItem(key) { return local.has(key) ? local.get(key) : null; },
    setItem(key, value) { local.set(key, String(value)); }
  };
  const document = { addEventListener() {} };
  const window = { fetch: fetchImpl };
  const context = {
    window,
    document,
    localStorage,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    performance: { now: () => Date.now() },
    URL,
    Headers,
    Response,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context, { filename: 'summary-race-v78.js' });
  return { fetch: window.fetch, stats: window.__summaryLatencyV9133 };
}

const aggregate = 'Titre principal &nbsp;&nbsp; Le Monde.fr Autre titre voisin sans rapport direct &nbsp;&nbsp; BFM Troisième titre agrégé par Google Actualités avec des faits différents.';

{
  const article = {
    id: 'google-cluster',
    url: 'https://news.google.com/rss/articles/example',
    title: 'Titre principal',
    summary: aggregate,
    source: 'Le Monde.fr'
  };
  const { fetch, stats } = install(async () => Response.json({ unavailable: true, summary: '', provider: 'groq' }));
  const response = await fetch('/api/article-summary-groq', {
    method: 'POST',
    body: JSON.stringify({ article })
  });
  const data = await response.json();
  assert.equal(data.unavailable, true,
    'an unavailable Groq response must stay unavailable for a Google News article');
  assert.notEqual(data.summary, aggregate,
    'a Google News headline cluster must never be returned as the article summary fallback');
  assert.equal(stats.feedFallbackRejected, 1,
    'the rejected Google News fallback must be visible in diagnostics');
}

{
  const trustedFeed = 'Le conseil municipal a adopté la mesure lundi. Elle entrera en vigueur en septembre et concernera directement les habitants de la commune.';
  const article = {
    id: 'publisher-feed',
    url: 'https://publisher.example/article',
    title: 'Une mesure locale entre en vigueur',
    summary: trustedFeed,
    source: 'Publisher'
  };
  const { fetch } = install(async () => Response.json({ unavailable: true, summary: '', provider: 'groq' }));
  const response = await fetch('/api/article-summary-groq', {
    method: 'POST',
    body: JSON.stringify({ article })
  });
  const data = await response.json();
  assert.equal(data.unavailable, false,
    'a sufficiently detailed direct publisher summary may remain a fallback');
  assert.equal(data.summary, trustedFeed);
  assert.equal(data.provider, 'feed-fallback');
}

console.log('v91.36 ranking and safe summary fallback checks passed');
