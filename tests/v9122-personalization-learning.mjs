import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../personalization-learning-v91.js', import.meta.url), 'utf8');
const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const context = { window: {}, localStorage };
vm.runInNewContext(source, context);
const learning = context.window.NewsPersonalizationV91;

const article = (id, category, score = 70, extra = {}) => ({
  id,
  category,
  score,
  tags: [category, `${category} pratique`],
  matches: [],
  ...extra
});

const tech = article('tech', 'Tech');
learning.recordFeedback(tech, 'follow', '');
const followed = learning.learnedSignal(tech);
assert.ok(followed > 0, 'suivre doit renforcer progressivement les sujets associés');
learning.recordFeedback(tech, '', 'follow');
assert.ok(Math.abs(learning.learnedSignal(tech)) < 0.01, 'retirer un suivi doit annuler son apprentissage');

learning.recordFeedback(tech, 'more', '');
learning.recordFeedback(tech, 'less', 'more');
assert.ok(learning.learnedSignal(tech) < 0, 'remplacer plus par moins doit remplacer, et non cumuler, le signal');

learning.reset();
for (let index = 0; index < 20; index += 1) {
  learning.recordFeedback(article(`tech-${index}`, 'Tech'), 'more', '');
}
assert.equal(
  learning.rankingContribution(tech, {}, []),
  12,
  'l’apprentissage implicite positif doit rester plafonné'
);
assert.equal(learning.createRanker({}, [])(tech), 12, 'un classement doit pouvoir réutiliser un instantané unique des préférences');

learning.reset();
const major = article('major', 'International', 118, { essential: true });
for (let index = 0; index < 20; index += 1) {
  learning.recordFeedback(article(`international-${index}`, 'International'), 'not', '');
}
assert.equal(
  learning.rankingContribution(major, { International: -1 }, ['International']),
  -6,
  'les préférences négatives ne doivent pas évincer une actualité générale importante'
);
assert.ok(
  learning.rankingContribution(article('niche', 'Loisirs', 55), { Loisirs: -1 }, []) >= -22,
  'le cumul explicite et implicite négatif doit rester borné'
);

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const quickview = fs.readFileSync(new URL('../article-quickview.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../news-pipeline-v88.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(app, /recordFeedback\(article, next, previous\)/, 'les quatre choix de la fiche article doivent alimenter l’apprentissage');
assert.match(quickview, /recordFeedback\(article, next, previous\)/, 'suivre et ignorer depuis le résumé rapide doivent alimenter l’apprentissage');
assert.match(app, /updateWatchTopic\(value, remove = false\)[\s\S]*state\.settings\.briefWatchTopics = remove/, 'retirer une veille doit être traité par le propriétaire unique');
assert.match(pipeline, /NewsPersonalizationV91\?\.learnedSignal/, 'l’ouverture éditoriale doit tenir compte de l’apprentissage plafonné');
assert.ok(index.indexOf('personalization-learning-v91.js') < index.indexOf('news-pipeline-v88.js'), 'l’apprentissage doit être chargé avant le rééquilibrage');
assert.match(sw, /personalization-learning-v91\.js\?v=91\.22/, 'le service worker doit précacher le moteur d’apprentissage');

console.log('v91.22 bounded personalization learning passed.');
