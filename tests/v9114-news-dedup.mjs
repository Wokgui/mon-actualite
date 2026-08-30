import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sameNewsEvent, mergeEventVariants, representativeQuality } = require('../lib/news-dedup.js');
const iso = '2026-08-30T12:00:00.000Z';
const art = (title, source = 'Source', score = 100) => ({ title, source, score, publishedAt: iso, sources: [source], summary: title });

const island = [
  'Les Islandais ont rejeté à 52,8% la reprise des négociations d’adhésion à l’Union européenne.',
  'L’Islande rejette la reprise des négociations avec l’UE, “un coup porté” à Bruxelles',
  'Adhésion à l’Union européenne : les Islandais disent non à la réouverture des négociations',
  "Référendum en Islande sur l'UE : le \"non\" l'emporte",
  "Adhésion à l'Union Européenne : l'Islande rejette un référendum sur une reprise des négociations",
  "Après le \"non\" de l’Islande à l’Europe : l’UE n’attire plus que les pauvres",
  'L’Islande dit massivement non à une éventuelle adhésion à l’Union européenne et douche froidement les espoirs de Bruxelles',
  'Adhésion à l’UE : en Islande, le «non» à la reprise des négociations l’emporte, «une victoire pour la démocratie», selon la Première ministre pro-oui',
  "L'Islande tourne le dos à l'Union européenne",
  "Islande : le rejet des négociations d'adhésion, un coup dur pour l'élargissement de l'UE",
  'En Islande, les eurosceptiques l’emportent lors du référendum sur l’UE après une nuit sous tension',
  "Référendum en Islande: les électeurs rejettent une reprise des négociations d'adhésion à l'UE",
  'Référendum islandais sur l’UE : le « non » s’impose avec 52,5 % des voix'
].map((title, i) => art(title, i === 0 ? 'facebook.com' : `Source ${i}`, 100 - i));

const islandMerged = mergeEventVariants(island);
assert.equal(islandMerged.length, 1, 'les 13 variantes Islande doivent former un seul événement');
assert.ok(!/facebook\.com/i.test(islandMerged[0].source), 'une source sociale ne doit pas devenir représentante si une source éditoriale existe');
assert.equal(islandMerged[0].mergedCount, 13, 'le nombre de formulations fusionnées doit être conservé');

const alreadyLexicalMerged = mergeEventVariants([{ ...art('Un événement déjà recoupé par trois médias'), sources: ['A', 'B', 'C'] }]);
assert.equal(alreadyLexicalMerged[0].mergedCount, 3, 'les sources déjà fusionnées lexicalement doivent compter dans mergedCount');

const cyprusA = art("Au moins six morts dans le naufrage d'un ferry avec environ 270 personnes à bord au large des côtes nord de Chypre", 'La Dépêche');
const cyprusB = art("Naufrage meurtrier d'un bateau de croisière au large de Chypre, sauvetage en cours", 'France 24');
assert.equal(sameNewsEvent(cyprusA, cyprusB), true, 'les deux formulations Chypre doivent fusionner');

const swissA = art('En Suisse, des coups de feu font un mort et plusieurs victimes en marge d’une rave party', 'Le HuffPost');
const swissB = art("Fusillade à Aarau : 1 mort et 5 blessés lors d'une rave party", 'RTS');
assert.equal(sameNewsEvent(swissA, swissB), true, 'les deux formulations de la fusillade suisse doivent fusionner');

const nepalA = art('Qui sont les quatre Français portés disparus après le drame au Népal ?', '20 Minutes');
const nepalB = art('Crue au Népal: les États-Unis débloquent une aide humanitaire supplémentaire de 3,6 millions de dollars', 'BFM');
assert.equal(sameNewsEvent(nepalA, nepalB), false, 'deux développements Népal distincts doivent rester séparés');

const ukraineA = art('Guerre en Ukraine : incendie dans une raffinerie russe après une attaque de drone', 'Ouest-France');
const ukraineB = art('Ukraine : de nouvelles sanctions européennes contre la Russie entrent en vigueur', 'Franceinfo');
assert.equal(sameNewsEvent(ukraineA, ukraineB), false, 'deux développements Ukraine distincts doivent rester séparés');

assert.ok(
  representativeQuality(art('Référendum islandais sur l’UE : le non s’impose avec 52,5 % des voix', 'Euronews'))
    > representativeQuality(art('Les Islandais ont rejeté la reprise des négociations', 'facebook.com')),
  'la carte représentante doit privilégier une source éditoriale informative'
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
        { id: 'a', ...art("Référendum en Islande sur l'UE : le non l'emporte", 'facebook.com', 100), visualStatus: 'unavailable' },
        { id: 'b', ...art('Référendum islandais sur l’UE : le non s’impose avec 52,5 % des voix', 'Euronews', 99), visualStatus: 'unavailable' },
        { id: 'c', ...art('Ukraine : de nouvelles sanctions européennes contre la Russie entrent en vigueur', 'Franceinfo', 98), visualStatus: 'unavailable' }
      ],
      stats: { rawItems: 3, deduplicatedItems: 3 }
    }));
  }
};
delete require.cache[wrapperPath];
const wrapper = require(wrapperPath);
const headers = {};
let responseBody = '';
const response = {
  statusCode: 0,
  setHeader(name, value) { headers[name] = value; },
  end(value = '') { responseBody += value; }
};
await wrapper({ method: 'GET' }, response);
const payload = JSON.parse(responseBody);
assert.equal(payload.articles.length, 2, 'l’adaptateur API doit appliquer la fusion sémantique');
assert.equal(payload.stats.eventDuplicatesRemoved, 1, 'les stats doivent indiquer le doublon retiré');
assert.equal(payload.articles[0].source, 'Euronews', 'la meilleure carte doit représenter le cluster');
assert.equal(payload.articles[0].mergedCount, 2, 'le recoupement multi-source doit parvenir au client');
if (originalCore) require.cache[corePath] = originalCore;
else delete require.cache[corePath];
delete require.cache[wrapperPath];

console.log('v91.14 server event dedup passed.');
