import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { collect, imageState, summaryState } = require('../diagnostic-metrics-v91.js');

const articles = [
  { id: 'ready', title: 'Un accord européen entre en vigueur', summary: 'Le texte entre en vigueur lundi et modifie plusieurs règles pour les entreprises concernées.', sources: ['A', 'B'], mergedCount: 2, visualStatus: 'ready', noveltyStateV78: 'development', catalogSignalV915: 8, categoryConfidenceLevel: 'high' },
  { id: 'candidate', title: 'Une nouvelle mesure est annoncée', summary: 'Une nouvelle mesure est annoncée', sources: ['C'], image: 'https://example.test/candidate.jpg', noveltyStateV78: 'repeat', catalogSignalV915: -4, lowInformationV89: true, categoryConfidenceLevel: 'low' },
  { id: 'missing', title: 'Information sans détails disponibles', summary: 'Ouvrez l’article pour consulter les détails publiés par la source.', sources: ['D'], noveltyStateV78: 'new', catalogSignalV915: 0, categoryConfidenceLevel: 'none' },
  { id: 'empty', title: 'Résumé absent', summary: '', sources: ['E'], noveltyStateV78: 'minor-update', catalogSignalV915: 2, categoryConfidenceLevel: 'medium' }
];
const metrics = collect({
  cache: { articles, stats: { rawItems: 7, deduplicatedItems: 4, catalogPositiveSignals: 2, catalogNegativeSignals: 1 } },
  errors: [{ kind: 'error', at: 10 }, { kind: 'rejection', at: 20 }],
  imageErrors: 3
});

assert.deepEqual(metrics.dedup, { collapsed: 3, mergedArticles: 1, largestCluster: 2 });
assert.equal(metrics.ranking.positiveSignals, 2);
assert.equal(metrics.ranking.negativeSignals, 1);
assert.equal(metrics.ranking.lowInformation, 1);
assert.equal(metrics.ranking.lowCategoryConfidence, 2);
assert.deepEqual(metrics.ranking.novelty, { new: 1, development: 1, 'minor-update': 1, repeat: 1 });
assert.deepEqual(metrics.images, { ready: 1, candidate: 1, missing: 2, sessionErrors: 3 });
assert.deepEqual(metrics.summaries, { usable: 1, missing: 1, generic: 1, titleLike: 1 });
assert.deepEqual(metrics.errors, { total: 2, script: 1, rejections: 1, latestAt: 20 });
assert.equal(imageState(articles[0]), 'ready');
assert.equal(summaryState(articles[1]), 'titleLike');

const feed = fs.readFileSync(new URL('../feed-intelligence-v81.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(feed, /NewsDiagnosticsV91\?\.collect/, 'le panneau interne doit consommer les métriques structurées');
for (const label of ['Déduplication', 'Classement', 'Images', 'Résumés', 'Erreurs client', 'API et latence']) assert.ok(feed.includes(label), `${label} doit apparaître dans le diagnostic`);
assert.ok(index.indexOf('diagnostic-metrics-v91.js') < index.indexOf('feed-intelligence-v81.js'), 'les métriques doivent être chargées avant le panneau');
assert.match(sw, /diagnostic-metrics-v91\.js\?v=91\.25/, 'les métriques doivent être précachées');

console.log('v91.25 internal diagnostic metrics passed.');
