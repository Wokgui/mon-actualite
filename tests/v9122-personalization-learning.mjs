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
assert.ok(followed > 0, 'suivre doit renforcer progressivement les sujets associ�s');
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
  'l'apprentissage implicite positif doit rester plafonn�'
);
assert.equal(learning.createRanker({}, [])(tech), 12, 'un classement doit pouvoir r�utiliser un instantan� unique des pr�f�rences');

learning.reset();
const major = article('major', 'International', 118, { essential: true });
for (let index = 0; index < 20; index += 1) {
  learning.recordFeedback(article(`international-${index}`, 'International'), 'not', '');
}
assert.equal(
  learning.rankingContribution(major, { International: -1 }, ['International']),
  -6,
  'les pr�f�rences n�gatives ne doivent pas �vincer une actualit� g�n�rale importante'
);
assert.ok(
  learning.rankingContribution(article('niche', 'Loisirs', 55), { Loisirs: -1 }, []) >= -22,
  'le cumul explicite et implicite n�gatif doit rester born�'
);

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const quickview = fs.readFileSync(new URL('../article-quickview.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../feedly-runtime.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../news-pipeline-v88.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(app, /recordFeedback\(article, next, previous\)/, 'les quatre choix de la fiche article doivent alimenter l'apprentissage');
assert.match(quickview, /recordFeedback\(article, next, previous\)/, 'suivre et ignorer depuis le r�sum� rapide doivent alimenter l'apprentissage');
assert.match(runtime, /recordFeedback\(article, '', feedback\[id\]/, 'retirer un suivi doit annuler son signal appris');
assert.match(pipeline, /NewsPersonalizationV91\?\.learnedSignal/, 'l'ouverture �ditoriale doit tenir compte de l'apprentissage plafonn�');
assert.ok(index.indexOf('personalization-learning-v91.js') < index.indexOf('news-pipeline-v88.js'), 'l'apprentissage doit �tre charg� avant le r��quilibrage');
assert.match(sw, /personalization-learning-v91\.js\?v=91\.22/, 'le service worker doit pr�cacher le moteur d'apprentissage');

console.log('v91.22 bounded personalization learning passed.');

