import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { homeSignalScore, catalogRank, rankCatalogArticles } = require('../lib/news-significance.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}()`);
  assert.ok(start >= 0, `${name} doit rester d�fini dans app.js`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`impossible d'extraire ${name} depuis app.js`);
}

function runRealVisibleArticles(state) {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const personalizationSource = fs.readFileSync(new URL('../personalization-learning-v91.js', import.meta.url), 'utf8');
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const personalizationContext = { window: {}, localStorage };
  vm.runInNewContext(personalizationSource, personalizationContext);
  const functionSource = extractFunction(appSource, 'visibleArticles');
  const visibleArticles = vm.runInNewContext(`(${functionSource})`, { state, window: personalizationContext.window });
  return visibleArticles();
}

const iso = '2026-08-30T15:00:00.000Z';
const article = (id, title, score = 100, extra = {}) => ({ id, title, score, publishedAt: iso, source: 'Source', sources: ['Source'], ...extra });

const substantial = [
  article('nepal', 'DIRECT. Crue au N�pal: le bilan de la catastrophe passe � 781 morts et 2.502 disparus'),
  article('cyprus', 'Le ferry de croisi�re naufrag� au large de Chypre a coul�'),
  article('swiss', "Suisse : un mort et cinq bless�s apr�s des tirs lors d'une rave party"),
  article('ukraine', 'Guerre en Ukraine : incendie dans une raffinerie russe apr�s une attaque de drone'),
  article('cyber', 'Apr�s le fisc, les pirates de ZeroBytes revendiquent le vol de 149 millions de donn�es sur un site du minist�re du Logement'),
  article('policy', 'Ce qui change � partir du 1er septembre 2026 : ch�mage, arr�ts maladie, factures.'),
  article('roman', '�Un nouvel Atlas de l'Univers� : la Nasa lance le t�lescope Roman pour percer les secrets du cosmos')
];

const light = [
  article('paper', 'Le papier toilette au cour des pr�occupations des Am�ricains'),
  article('bread', 'Il manquait 10 grammes � son demi-pain : le client fait une r�clamation et l'inspection condamne le boulanger � d�bourser 15 000 euros'),
  article('food', 'La rentr�e vous met � plat ? Ces 5 aliments peuvent vous aider � retrouver de l'�nergie'),
  article('phone', 'Point vert sur le t�l�phone : ce qu'il signifie sur iPhone et Android'),
  article('keyboard', 'Pourquoi le meilleur clavier du monde est japonais (et n'est pas fait pour vous)'),
  article('sport', 'Tour d'Espagne : Tadej Pogacar rassure apr�s sa lourde chute et sera �probablement� op�r� ce lundi'),
  article('malformed', '- Revue Politique et Parlementaire - La Revue politique et Parlementaire')
];

assert.ok(homeSignalScore(substantial[0]).score >= 35, 'un bilan humain massif doit �tre fortement prioris�');
assert.ok(homeSignalScore(substantial[2]).score >= 20, 'un bilan humain en toutes lettres doit �tre prioris�');
assert.ok(homeSignalScore(substantial[4]).score >= 10, 'un piratage massif de donn�es doit �tre prioris�');
assert.ok(homeSignalScore(substantial[5]).score >= 10, 'un changement de politique publique doit �tre prioris�');
assert.ok(homeSignalScore(light[2]).score <= -15, 'un listicle pratique doit �tre p�nalis�');
assert.ok(homeSignalScore(light[3]).score <= -15, 'un guide de t�l�phone doit �tre p�nalis�');
assert.ok(homeSignalScore(light[5]).score <= -15, 'le sport l�ger ne doit pas remonter dans l'Accueil g�n�ral');
assert.ok(homeSignalScore(light[6]).score <= -30, 'un titre manifestement vide doit �tre fortement p�nalis�');

assert.equal(
  homeSignalScore(article('personal-sanction', '� Elle sera signal�e pour bl�me ou sanction � : Donald Trump cible une journaliste de NBC')).score,
  0,
  'une sanction personnelle ou disciplinaire ne doit pas �tre confondue avec un �v�nement g�opolitique majeur'
);
assert.ok(
  homeSignalScore(article('systemic-sanctions', 'Ukraine : de nouvelles sanctions europ�ennes contre la Russie entrent en vigueur')).score >= 15,
  'des sanctions internationales contextualis�es doivent rester un �v�nement majeur'
);
assert.ok(
  homeSignalScore(article('public-utility', 'Alerte m�t�o : vigilance rouge et fermeture des �coles dans trois d�partements')).score >= 6,
  'une information imm�diatement utile au public doit recevoir un bonus mesur�'
);

const contamination = homeSignalScore(article(
  'contamination',
  'Le papier toilette au cour des pr�occupations des Am�ricains',
  100,
  { summary: 'Guerre, r�f�rendum et catastrophe : 800 morts dans un autre sujet du cluster Google News.' }
));
assert.equal(contamination.score, 0, 'les titres voisins contenus dans une description Google News ne doivent pas contaminer le signal');

const equalBase = rankCatalogArticles([...light.slice(0, 6), ...substantial]);
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'nepal')) < equalBase.indexOf(equalBase.find(item => item.id === 'paper')), '� pertinence �gale, le N�pal doit pr�c�der le contenu l�ger');
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'cyprus')) < equalBase.indexOf(equalBase.find(item => item.id === 'keyboard')), '� pertinence �gale, Chypre doit pr�c�der un guide mat�riel');
assert.ok(equalBase.indexOf(equalBase.find(item => item.id === 'cyber')) < equalBase.indexOf(equalBase.find(item => item.id === 'sport')), 'une cyberattaque massive doit pr�c�der le sport l�ger');

const personalized = article('personalized', 'Point vert sur le t�l�phone : ce qu'il signifie sur iPhone et Android', 135);
assert.ok(
  catalogRank(personalized).score > catalogRank(article('generic-major', 'Guerre en Ukraine : incendie dans une raffinerie russe apr�s une attaque de drone', 100)).score,
  'le signal �ditorial ne doit pas �craser un fort bonus de personnalisation explicite'
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
        article('guide', 'Pourquoi le meilleur clavier du monde est japonais (et n'est pas fait pour vous)', 105, { category: 'Tech', tags: ['Tech'] }),
        article('major', "Suisse : un mort et cinq bless�s apr�s des tirs lors d'une rave party", 100, { category: 'International', tags: ['International'] }),
        article('policy-live', 'Ce qui change � partir du 1er septembre 2026 : ch�mage, arr�ts maladie, factures.', 101, { category: 'Politique', tags: ['Politique'] })
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
assert.equal(payload.articles[0].id, 'major', 'l'API doit appliquer le signal avant la coupe du catalogue');
assert.equal(payload.articles[1].id, 'policy-live', 'la d�cision publique doit remonter derri�re l'�v�nement majeur');
assert.equal(payload.articles[2].id, 'guide', 'le guide mat�riel doit descendre malgr� un score brut l�g�rement sup�rieur');
assert.deepEqual(
  payload.articles.map(item => item.scoreV915Base),
  [100, 101, 105],
  'le score serveur ant�rieur doit rester disponible pour le diagnostic'
);
assert.ok(
  payload.articles.every(item => item.score === item.catalogScoreV915),
  'article.score doit transmettre le classement v91.15 r�ellement consomm� par le client'
);
assert.equal(payload.stats.catalogSignalV915, true, 'les diagnostics doivent annoncer le classement v91.15');
assert.ok(payload.stats.catalogPositiveSignals >= 2, 'les diagnostics doivent compter les signaux positifs');
assert.ok(payload.stats.catalogNegativeSignals >= 1, 'les diagnostics doivent compter les signaux n�gatifs');

const clientState = {
  articles: payload.articles,
  feedback: {},
  topicPreferences: {},
  settings: {
    interests: ['Tech'],
    generalCategories: ['International', 'Politique']
  }
};
assert.deepEqual(
  runRealVisibleArticles(clientState).map(item => item.id),
  ['major', 'policy-live', 'guide'],
  'le tri r�el de visibleArticles() doit conserver les �v�nements importants devant le contenu l�ger'
);

clientState.feedback.guide = 'follow';
clientState.topicPreferences.Tech = 2;
assert.equal(
  runRealVisibleArticles(clientState)[0].id,
  'guide',
  'le pont de score ne doit pas neutraliser un suivi et un apprentissage explicites c�t� client'
);

clientState.feedback.major = 'not';
assert.ok(
  !runRealVisibleArticles(clientState).some(item => item.id === 'major'),
  'visibleArticles() doit toujours retirer un article explicitement ignor�'
);

if (originalCore) require.cache[corePath] = originalCore;
else delete require.cache[corePath];
delete require.cache[wrapperPath];

console.log('v91.15 Home significance ranking passed.');

