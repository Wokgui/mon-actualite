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

const armedWar = homeSignalScore({
  title: 'Guerre en Ukraine : plusieurs morts après de nouvelles frappes russes'
});
assert.ok(armedWar.reasons.includes('événement majeur'),
  `une vraie guerre doit conserver le signal majeur: ${JSON.stringify(armedWar)}`);
assert.ok(armedWar.reasons.includes('bilan humain'),
  `un bilan humain doit rester prioritaire: ${JSON.stringify(armedWar)}`);
assert.ok(armedWar.score >= 30,
  `une vraie guerre avec victimes ne doit pas être déclassée: ${JSON.stringify(armedWar)}`);

const strikesDespiteMetaphor = homeSignalScore({
  title: 'Guerre économique et frappes de missiles : plusieurs blessés après une attaque'
});
assert.ok(strikesDespiteMetaphor.reasons.includes('événement majeur'),
  `les frappes explicites doivent rester majeures même si « guerre économique » apparaît aussi: ${JSON.stringify(strikesDespiteMetaphor)}`);

console.log('v91.37 significance-context checks passed (7 assertions).');
