import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyArticle } = require('../lib/news-category.js');

const cases = [
  ['météo', { title: 'Fin de la pluie, retour de la chaleur… Cette semaine s’annonce chaude', summary: 'Météo : risque-t-on une nouvelle canicule ?' }, 'Environnement'],
  ['syndrome', { title: 'C’est quoi le syndrome de la queue-de-cheval dont souffre Mimie Mathy ?' }, 'Santé'],
  ['Apple', { title: "Il pourrait apporter plus de changement qu'attendu : chez Apple, les enjeux de l'arrivée aux commandes de John Ternus" }, 'Tech'],
  ['rentrée scolaire', { title: 'DIRECT. Rentrée scolaire J-1 : une pré-rentrée pleine d’émotion' }, 'Éducation'],
  ['inondations', { title: 'Au Népal, après les inondations, les glaciologues sidérés par l’ampleur de la catastrophe' }, 'Environnement']
];

for (const [label, article, expected] of cases) {
  assert.equal(classifyArticle(article, []), expected, `${label} doit être classé ${expected}`);
}

console.log(`v91.32 category-gap checks passed (${cases.length} assertions).`);
