import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { classifyArticle, classifyArticleDetailed } = require('../lib/news-category.js');

const cases = [
  ['IA gratuite', { title: 'ChatGPT, Claude, Gemini : ce que vous pouvez vraiment faire sans débourser un centime', categoryHint: 'Économie', strictCategory: true }, 'IA'],
  ['Pogacar', { title: 'S’il est bien amoché par sa chute, Pogacar n’a pas perdu son sens de l’humour', categoryHint: 'Politique' }, 'Société'],
  ['ZeroBytes', { title: 'Après le fisc, les pirates de ZeroBytes revendiquent le vol de 149 millions de données sur un site du ministère du Logement', summary: 'Un site du ministère du Logement piraté, des millions de données dans la nature', categoryHint: 'Économie', strictCategory: true }, 'Tech'],
  ['SpaceX', { title: "Sur un terrain marécageux de Louisiane, SpaceX veut faire décoller ses fusées à un rythme que personne n'a jamais tenu", categoryHint: 'Économie', strictCategory: true }, 'Science'],
  ['Paris FC', { title: 'DIRECT. Paris FC-Nice : le PFC déjà devant grâce à Sinayoko, suivez la suite de la 2e journée de Ligue 1 en live' }, 'Société'],
  ['Marc Márquez', { title: "Marc Márquez pas parfait mais invincible au GP d'Aragón", summary: 'MotoGP' }, 'Société'],
  ['Télescope Roman', { title: '«Un nouvel Atlas de l’Univers» : la Nasa lance le télescope Roman pour percer les secrets du cosmos', summary: 'Le mystère de l’énergie sombre', categoryHint: 'Énergie' }, 'Science'],
  ['DLSS 5', { title: 'La fuite du DLSS 5 provoque aussi un revirement chez beaucoup de joueurs PC : on a compris pourquoi', summary: 'Le DLSS 5 de Nvidia a fuité, GeForce RTX 40', categoryHint: 'Smartphones' }, 'Tech'],
  ['Fusillade suisse', { title: 'En Suisse, des coups de feu font un mort et plusieurs victimes en marge d’une rave party', summary: 'Une femme tuée, cinq blessés', categoryHint: 'Science', strictCategory: true }, 'Société'],
  ['Durian', { title: 'Sur les hauts plateaux du Vietnam, le lucratif durian remplace le café', summary: "J'ai acheté une voiture, des maisons pour mes enfants", categoryHint: 'Économie', strictCategory: true }, 'Économie'],
  ['École en Chine', { title: 'Chine : que faire quand les enfants ne veulent plus aller à l’école ?', categoryHint: 'Science', strictCategory: true }, 'Éducation'],
  ['Référendum islandais', { title: "Référendum islandais sur l'UE : le non s'impose avec 52,5 % des voix", categoryHint: 'Société' }, 'Europe'],
  ['Xiaomi Fold', { title: "Le Xiaomi 18 Fold écrase déjà l'iPhone Ultra au niveau de l'autonomie", categoryHint: 'Tech', strictCategory: true }, 'Smartphones'],
  ['Prix smartphones', { title: 'Smartphones : les prix vont exploser, et 2026 pourrait signer la fin des modèles bon marché', categoryHint: 'Tech', strictCategory: true }, 'Smartphones'],
  ['Netflix IA', { title: "Netflix a glissé une séquence IA dans un k-drama et le phénomène s'aggrave", categoryHint: 'Tech', strictCategory: true }, 'IA'],
  ['Normes auto Chine', { title: 'La Chine va aussi régner sur les normes de sécurité', summary: "Un méga-rappel en Chine : poignées de Tesla et d'autres voitures électriques, millions de véhicules", categoryHint: 'Économie', strictCategory: true }, 'Automobile'],
  ['Source Sciencepost', { title: "Dans un laboratoire de Pune s'est allumée en 1991 une machine de 64 puces dont l'équivalent américain avait été refusé à l'Inde - Sciencepost", categoryHint: 'International', strictCategory: true }, 'International'],
  ['MaPrimeRénov', { title: 'MaPrimeRénov’: il y a du changement à partir du 1er septembre', summary: 'Isolation, chaudière, aides', categoryHint: 'Économie', strictCategory: true }, 'Économie']
];

for (const [label, item, expected] of cases) {
  assert.equal(classifyArticle(item, []), expected, `${label} doit être classé ${expected}`);
}
assert.equal(classifyArticle({ title: 'Un article sans indice thématique', categoryHint: 'Santé', strictCategory: true }, []), 'Santé');
assert.equal(classifyArticle({ title: 'Une entreprise coule après plusieurs années de pertes', categoryHint: 'Économie', strictCategory: true }, []), 'Économie');
assert.equal(classifyArticle({ title: 'Une découverte historique inattendue - Sciencepost', categoryHint: 'International', strictCategory: true }, []), 'International');
const roman = classifyArticleDetailed(cases[6][1], []);
assert.equal(roman.reason, 'content');
assert.ok(roman.confidence >= 20, 'les indices du titre doivent dominer le simple indice du flux');
assert.equal(roman.confidenceLevel, 'high');

const ambiguous = classifyArticleDetailed({
  title: 'Un smartphone mise sur une nouvelle intelligence artificielle',
  categoryHint: 'Tech'
}, []);
assert.equal(ambiguous.confidenceLevel, 'low', 'deux catégories thématiques au coude-à-coude doivent rester signalées comme ambiguës');
assert.equal(ambiguous.margin, 0);
assert.ok(ambiguous.alternatives.some(item => item.category === 'Smartphones'));

const countryOnly = classifyArticleDetailed({
  title: 'La Chine publie son calendrier pour les prochains mois',
  categoryHint: 'Science',
  strictCategory: true
}, []);
assert.equal(countryOnly.category, 'Science', 'un simple nom de pays ne doit plus écraser à lui seul une rubrique stricte');
assert.equal(countryOnly.reason, 'feed-hint');
assert.equal(countryOnly.confidenceLevel, 'low');

const coreSource = fs.readFileSync(new URL('../lib/news-core.js', import.meta.url), 'utf8');
for (const field of ['categoryConfidence', 'categoryConfidenceLevel', 'categoryConfidenceMargin', 'categoryAlternatives']) {
  assert.match(coreSource, new RegExp(`${field}:`), `${field} must be exposed on API articles`);
}
console.log(`v91.13 category classifier passed (${cases.length + 3} assertions).`);
