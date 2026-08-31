import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyArticleDetailed } = require('../lib/news-category.js');

const cases = [
  [
    'rappel salmonelle',
    { title: '« Il ne faut plus le consommer » : du saucisson sec contaminé à la salmonelle rappelé partout en France' },
    'Santé',
    'food-health-title'
  ],
  [
    'rapprochement Decathlon',
    { title: 'Rapprochement stratégique entre Decathlon et Céraclès Coopérative' },
    'Économie',
    'corporate-economy-title'
  ],
  [
    'ancienne ministre chez AXA',
    { title: "Une ancienne ministre prend la direction des ressources humaines d'AXA" },
    'Économie',
    'corporate-economy-title'
  ],
  [
    'note Fitch',
    { title: "L'agence Fitch ne dégrade pas la France et maintient notre A+ alors que la dette pourrait être LE sujet des présidentielles." },
    'Économie',
    'sovereign-economy-title'
  ],
  [
    'licenciement télétravail',
    {
      title: "Une salariée se fait licencier après 26 ans d’ancienneté pour avoir télétravaillé neuf jours d'affilée sans autorisation",
      categoryHint: 'International'
    },
    'Société',
    'work-society-title'
  ],
  [
    'Loto du patrimoine',
    { title: 'On connaît les sites qui bénéficieront du coup de pouce financier du Loto du patrimoine 2026 : voici l’unique lieu « en péril » retenu dans le Var' },
    'Culture',
    'heritage-culture-title'
  ],
  [
    'rachat TAP',
    { title: 'Lufthansa contre Air France‑KLM : le grand duel du ciel européen pour acquérir TAP Air Portugal' },
    'Économie',
    'corporate-economy-title'
  ],
  [
    'IA incidente dans une guerre',
    { title: 'Guerre au Moyen-Orient : Donald Trump publie une vidéo générée par IA de l’armée américaine «réduisant en miettes» l’île de Kharg' },
    'International',
    'war-ai-incidental-title'
  ],
  [
    'déploiement militaire après mutinerie',
    { title: 'L’Algérie envoie quatre avions de combat Su-30 au Niger après une mutinerie survenue à Niamey' },
    'International',
    'military-crisis-title'
  ]
];

for (const [label, article, expectedCategory, expectedReason] of cases) {
  const result = classifyArticleDetailed(article, []);
  assert.equal(result.category, expectedCategory,
    `${label} doit être classé ${expectedCategory}: ${JSON.stringify(result)}`);
  assert.equal(result.reason, expectedReason,
    `${label} doit utiliser la règle contextuelle ${expectedReason}: ${JSON.stringify(result)}`);
}

const militaryProcurement = classifyArticleDetailed({
  title: 'La Suède signe un contrat de 4,3 milliards d’euros pour l’acquisition de quatre frégates françaises',
  categoryHint: 'International'
}, []);
assert.equal(militaryProcurement.category, 'International',
  `un achat militaire d'État ne doit pas être confondu avec une acquisition d'entreprise: ${JSON.stringify(militaryProcurement)}`);
assert.notEqual(militaryProcurement.reason, 'corporate-economy-title');
assert.notEqual(militaryProcurement.reason, 'military-crisis-title');

const aiFactory = classifyArticleDetailed({
  title: "Bull sélectionné par l’Europe pour fournir une AI Factory à 388 millions d’euros en Finlande"
}, []);
assert.equal(aiFactory.category, 'IA',
  'la correction corporate ne doit pas casser la règle AI Factory de v91.36');

const carmat = classifyArticleDetailed({
  title: 'Après des résultats favorables, le cœur artificiel Carmat bientôt remboursé ?'
}, []);
assert.equal(carmat.category, 'Santé',
  'la correction v91.36 Carmat doit rester stable');

const gta = classifyArticleDetailed({
  title: '« Ne plus tuer la police et les civils » GTA 6 a une nouvelle mécanique qui change tout'
}, []);
assert.equal(gta.category, 'Tech',
  'la correction v91.36 GTA doit rester stable');

const highDieselPrice = classifyArticleDetailed({
  title: 'Pourquoi le prix du gazole va rester élevé en France',
  categoryHint: 'Économie',
  strictCategory: true
}, []);
assert.equal(highDieselPrice.category, 'Économie',
  `« élevé » ne doit plus être confondu avec « élève »: ${JSON.stringify(highDieselPrice)}`);
assert.equal(highDieselPrice.reason, 'feed-hint',
  `sans signal thématique plus fort, le flux Économie doit être conservé: ${JSON.stringify(highDieselPrice)}`);

const realStudents = classifyArticleDetailed({
  title: 'Des élèves de lycée découvrent un nouveau laboratoire scientifique'
}, []);
assert.equal(realStudents.category, 'Éducation',
  `le vrai pluriel « élèves » doit rester un signal Éducation: ${JSON.stringify(realStudents)}`);

console.log(`v91.37 contextual category checks passed (${cases.length + 8} assertions).`);
