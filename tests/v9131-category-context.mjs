import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyArticle, classifyArticleDetailed } = require('../lib/news-category.js');

const liveCases = [
  ['Vitamine C', { title: 'Rhume : pourquoi la réputation de la vitamine C mérite d’être sérieusement réexaminée' }, 'Santé'],
  ['Tension artérielle', { title: 'Tension artérielle : l’erreur de position qui vous fait passer pour hypertendu' }, 'Santé'],
  ['Paludisme', { title: 'Un moustique peut-il vraiment prendre l’avion ? À Roissy, 32 cas de paludisme d’aéroport ont déjà été recensés' }, 'Santé'],
  ['PlayStation physique', { title: "Après l'arrêt des jeux Physique PlayStation, Sony tape encore où ça fait vraiment mal" }, 'Tech'],
  ['Vidéoprojecteur', { title: 'Xgimi lance un vidéoprojecteur à 200 € avec Google TV : fausse bonne affaire ou vraie pépite ?' }, 'Tech'],
  ['Arme nucléaire', { title: 'L’initiative diplomatique échouera si Kim Jong-un ne renonce pas à l’arme nucléaire', summary: 'Corée du Nord et Pyongyang' }, 'International'],
  ['Gaz ménages', { title: 'Les factures de gaz pèsent de plus en plus lourd dans le budget des ménages' }, 'Énergie'],
  ['Festival', { title: 'The Cure réunit les générations à Rock en Seine', summary: 'Le festival se clôture avec un concert' }, 'Culture'],
  ['Nutrition', { title: 'Des nutritionnistes alertent sur une boisson énergisante et sa composition' }, 'Santé']
];

for (const [label, item, expected] of liveCases) {
  const result = classifyArticleDetailed(item, []);
  assert.equal(result.category, expected, `${label} doit être classé ${expected}: ${JSON.stringify(result)}`);
}

assert.notEqual(
  classifyArticle({ title: 'Une méthode sérieusement réexaminée après plusieurs années' }, []),
  'Culture',
  '« sérieusement » ne doit jamais être interprété comme « série »'
);

assert.equal(
  classifyArticle({ title: 'Une centrale nucléaire modernise son réacteur EPR' }, []),
  'Énergie',
  'le nucléaire civil doit rester classé Énergie'
);

console.log(`v91.31 category-context checks passed (${liveCases.length + 2} assertions).`);
