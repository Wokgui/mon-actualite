import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classify } = require('../novelty-detection-v91.js');

const previous = {
  title: 'Naufrage à Chypre : sept morts et 12 disparus',
  publishedAt: '2026-08-30T10:00:00.000Z',
  facts: ['7', '12'],
  actions: ['bilan'],
  entities: ['Chypre'],
  markers: []
};

const rewrite = classify({
  title: 'Chypre : le bilan du naufrage fait état de 7 morts et 12 disparus',
  publishedAt: '2026-08-30T10:05:00.000Z',
  facts: ['7', '12'], actions: ['bilan'], entities: ['Chypre', 'Méditerranée']
}, previous);
assert.equal(rewrite.state, 'repeat', 'une reformulation simultanée doit rester une répétition');

const concurrent = classify({
  title: 'Naufrage à Chypre : huit morts et 11 disparus selon une autre source',
  publishedAt: '2026-08-30T10:08:00.000Z',
  facts: ['8', '11'], actions: ['bilan'], entities: ['Chypre']
}, previous);
assert.equal(concurrent.state, 'repeat', 'des chiffres concurrents simultanés ne sont pas une vraie mise à jour');
assert.equal(concurrent.reason, 'Réécriture ou version concurrente');

const laterToll = classify({
  title: 'Naufrage à Chypre : le bilan monte à douze morts et 8 disparus',
  publishedAt: '2026-08-30T14:00:00.000Z',
  facts: ['12', '8'], actions: ['bilan'], entities: ['Chypre']
}, previous);
assert.equal(laterToll.state, 'development', 'un bilan réellement postérieur doit être un développement');
assert.equal(laterToll.confidence, 'high');

const aid = classify({
  title: 'Après les inondations, la France débloque une aide humanitaire de 3,6 millions d’euros',
  publishedAt: '2026-08-30T12:00:00.000Z',
  facts: ['3,6 millions euros'], actions: ['annonce'], entities: ['France'],
}, { ...previous, title: 'Les inondations frappent le Népal', entities: ['Népal'] });
assert.equal(aid.state, 'development', 'une aide humanitaire identifiable doit rester un développement distinct');

const recap = classify({
  title: 'Naufrage à Chypre : ce que l’on sait',
  publishedAt: '2026-08-30T16:00:00.000Z', facts: ['7', '12'], actions: ['bilan'], entities: ['Chypre']
}, previous);
assert.equal(recap.state, 'repeat', 'un récapitulatif explicite doit rester une répétition');

const content = fs.readFileSync(new URL('../content-intelligence-v78.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(content, /NewsNoveltyV91\?\.classify/, 'le classifieur réel doit consommer le détecteur précis');
assert.match(content, /noveltyConfidenceV9124/, 'la confiance de nouveauté doit rester diagnostiquable');
assert.ok(index.indexOf('novelty-detection-v91.js') < index.indexOf('content-intelligence-v78.js'), 'le détecteur doit être chargé avant l’enrichissement');
assert.match(sw, /novelty-detection-v91\.js\?v=91\.24/, 'le détecteur doit être précaché');

console.log('v91.24 true novelty detection passed.');
