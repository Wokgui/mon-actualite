import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { homeSignalScore } = require('../lib/news-significance.js');

const economicWar = homeSignalScore({
  title: 'G20: Washington veut obliger ses alliés à renforcer sa guerre économique contre l’Iran'
});
assert.equal(economicWar.reasons.includes('événement majeur'), false,
  `« guerre économique » ne doit pas être traitée comme un conflit armé: ${JSON.stringify(economicWar)}`);
assert.equal(economicWar.score, 0,
  `le titre observé ne doit pas recevoir artificiellement +15: ${JSON.stringify(economicWar)}`);

const tradeWar = homeSignalScore({
  title: 'La guerre commerciale entre deux groupes industriels s’intensifie sur les prix'
});
assert.equal(tradeWar.reasons.includes('événement majeur'), false,
  'une guerre commerciale ne doit pas déclencher le signal événement majeur');

const marketReaction = homeSignalScore({
  title: "Sur la réserve face aux frappes au Moyen-Orient, le Cac 40 termine le mois d'août dans le rouge"
});
assert.equal(marketReaction.reasons.includes('événement majeur'), false,
  `un article sur la réaction du CAC 40 ne doit pas être promu comme la frappe elle-même: ${JSON.stringify(marketReaction)}`);
assert.equal(marketReaction.score, 0,
  `le titre boursier observé ne doit plus recevoir le bonus conflit: ${JSON.stringify(marketReaction)}`);

const warCriminals = homeSignalScore({
  title: 'Obsèques nationales pour Ratko Mladic : la Commission européenne avertit que la glorification des criminels de guerre n’a pas sa place dans l’UE'
});
assert.equal(warCriminals.reasons.includes('événement majeur'), false,
  `« criminels de guerre » ne décrit pas à lui seul un conflit en cours: ${JSON.stringify(warCriminals)}`);

const warCrime = homeSignalScore({
  title: 'Une enquête internationale documente un possible crime de guerre'
});
assert.equal(warCrime.reasons.includes('événement majeur'), false,
  `« crime de guerre » ne doit pas suffire à déclencher le bonus conflit: ${JSON.stringify(warCrime)}`);

const armedWar = homeSignalScore({
  title: 'Guerre en Ukraine : plusieurs morts après de nouvelles frappes russes'
});
assert.ok(armedWar.reasons.includes('événement majeur'),
  `une vraie guerre doit conserver le signal majeur: ${JSON.stringify(armedWar)}`);
assert.ok(armedWar.reasons.includes('bilan humain'),
  `un bilan humain doit rester prioritaire: ${JSON.stringify(armedWar)}`);
assert.ok(armedWar.score >= 30,
  `une vraie guerre avec victimes ne doit pas être déclassée: ${JSON.stringify(armedWar)}`);

const armedWarWithCrimePhrase = homeSignalScore({
  title: 'Guerre en Ukraine : une enquête vise de nouveaux crimes de guerre'
});
assert.ok(armedWarWithCrimePhrase.reasons.includes('événement majeur'),
  `un vrai conflit reste majeur même si le titre contient aussi « crimes de guerre »: ${JSON.stringify(armedWarWithCrimePhrase)}`);

const strikesDespiteMetaphor = homeSignalScore({
  title: 'Guerre économique et frappes de missiles : plusieurs blessés après une attaque'
});
assert.ok(strikesDespiteMetaphor.reasons.includes('événement majeur'),
  `les frappes explicites doivent rester majeures même si « guerre économique » apparaît aussi: ${JSON.stringify(strikesDespiteMetaphor)}`);

console.log('v91.37 significance-context checks passed (12 assertions).');
