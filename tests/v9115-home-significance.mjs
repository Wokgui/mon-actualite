import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { homeSignalScore, catalogRank, rankCatalogArticles } = require('../lib/news-significance.js');

const iso = '2026-08-30T15:00:00.000Z';
const article = (id, title, score = 100, extra = {}) => ({ id, title, score, publishedAt: iso, source: 'Source', sources: ['Source'], ...extra });

const substantial = [
  article('nepal', 'DIRECT. Crue au Népal: le bilan de la catastrophe passe à 781 morts et 2.502 disparus'),
  article('cyprus', 'Le ferry de croisière naufragé au large de Chypre a coulé'),
  article('swiss', "Suisse : un mort et cinq blessés après des tirs lors d'une rave party"),
  article('ukraine', 'Guerre en Ukraine : incendie dans une raffinerie russe après une attaque de drone'),
  article('cyber', 'Après le fisc, les pirates de ZeroBytes revendiquent le vol de 149 millions de données sur un site du ministère du Logement'),
  article('policy', 'Ce qui change à partir du 1er septembre 2026 : chômage, arrêts maladie, factures…'),
  article('roman', '«Un nouvel Atlas de l’Univers» : la Nasa lance le télescope Roman pour percer les secrets du cosmos')
];

const light = [
  article('paper', 'Le papier toilette au cœur des préoccupations des Américains'),
  article('bread', 'Il manquait 10 grammes à son demi-pain : le client fait une réclamation et l’inspection condamne le boulanger à débourser 15 000 euros'),
  article('food', 'La rentrée vous met à plat ? Ces 5 aliments peuvent vous aider à retrouver de l’énergie'),
  article('phone', 'Point vert sur le téléphone : ce qu’il signifie sur iPhone et Android'),
  article('keyboard', 'Pourquoi le meilleur clavier du monde est japonais (et n’est pas fait pour vous)'),
  article('sport', 'Tour d’Espagne : Tadej Pogacar rassure après sa lourde chute et sera «probablement» opéré ce lundi'),
  article('malformed', '- Revue Politique et Parlementaire - La Revue politique et Parlementaire')
];

assert.ok(homeSignalScore(substantial[0]).score >= 35, 'un bilan humain massif doit être fortement priorisé');
assert.ok(homeSignalScore(substantial[2]).score >= 20, 'un bilan humain en toutes lettres doit être priorisé');
assert.ok(homeSignalScore(substantial[4]).score >= 10, 'un piratage massif de données doit être priorisé');
assert.ok(homeSignalScore(substantial[5]).score >= 10, 'un changement de politique publique doit être priorisé');
assert.ok(homeSignalScore(light[2]).score <= -15, 'un listicle pratique doit être pénalisé');
assert.ok(homeSignalScore(light[3]).score <= -15, 'un guide de téléphone doit être pénalisé');
assert.ok(homeSignalScore(light[5]).score <= -15, 'le sport léger ne doit pas remonter dans l’Accueil général');
assert.ok(homeSignalScore(light[6]).score <= -30, 'un titre manifestement vide doit être fortement pénalisé');

const contamination = homeSignalScore(article(
  'contamination',
  'Le papier toilette au cœur des préoccupations des Américains',
  100,
  { summary: 'Guerre, référendum et catastrophe : 800 morts dans un autre sujet du cluster Google News.' }
));
assert.equal(contamination.score, 0, 'les titres voisins contenus dans une description Google News ne doivent pas contaminer le signal');

const equalBase = rankCatalogArticles([...light.slice(0, 6), ...substantial]);
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'nepal')) < equalBase.indexOf(equalBase.find(item => item.id === 'paper')), 'à pertinence égale, le Népal doit précéder le contenu léger');
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'cyprus')) < equalBase.indexOf(equalBase.find(item => item.id === 'keyboard')), 'à pertinence égale, Chypre doit précéder un guide matériel');
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'cyber')) < equalBase.indexOf(equalBase.find(item => item.id === 'sport')), 'une cyberattaque massive doit précéder le sport léger');

const personalized = article('personalized', 'Point vert sur le téléphone : ce qu’il signifie sur iPhone et Android', 135);
assert.ok(
  catalogRank(personalized).score > catalogRank(article('generic-major', 'Guerre en Ukraine : incendie dans une raffinerie russe après une attaque de drone', 100)).score,
  'le signal éditorial ne doit pas écraser un fort bonus de personnalisation explicite'
);

const corePath = require.resolve('../lib/news-core.js');
const wrapperPath = require.resolve('../api/news.js');
const originalCore = require.cache[corePath];
require.cache[corePath] = {
  id: corePath,
  filename: corePath,
  loaded: true,
  exports: async (_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      articles: [
        article('guide', 'Pourquoi le meilleur clavier du monde est japonais (et n’est pas fait pour vous)', 105),
        article('major', "Suisse : un mort et cinq blessés après des tirs lors d'une rave party", 100),
        article('policy-live', 'Ce qui change à partir du 1er septembre 2026 : chômage, arrêts maladie, factures…', 101)
      ],
      stats: { rawItems: 3, deduplicatedItems: 3 }
    }));
  }
};
delete require.cache[wrapperPath];
const wrapper = require(wrapperPath);
let responseBody = '';
await wrapper({ method: 'GET' }, {
  statusCode: 0,
  setHeader() {},
  end(value = '') { responseBody += value; }
});
const payload = JSON.parse(responseBody);
assert.equal(payload.articles[0].id, 'major', 'l’API doit appliquer le signal avant la coupe du catalogue');
assert.equal(payload.articles[1].id, 'policy-live', 'la décision publique doit remonter derrière l’événement majeur');
assert.equal(payload.articles[2].id, 'guide', 'le guide matériel doit descendre malgré un score brut légèrement supérieur');
assert.equal(payload.stats.catalogSignalV915, true, 'les diagnostics doivent annoncer le classement v91.15');
assert.ok(payload.stats.catalogPositiveSignals >= 2, 'les diagnostics doivent compter les signaux positifs');
assert.ok(payload.stats.catalogNegativeSignals >= 1, 'les diagnostics doivent compter les signaux négatifs');

if (originalCore) require.cache[corePath] = originalCore;
else delete require.cache[corePath];
delete require.cache[wrapperPath];

console.log('v91.15 Home significance ranking passed.');
