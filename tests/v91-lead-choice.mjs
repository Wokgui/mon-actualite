import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('lead-choice-v91.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
assert.ok(!index.includes('lead-choice-v91.js'), 'legacy v91 lead-choice layer must stay out of the lean startup path');
assert.ok(String(version.codeRelease || '').startsWith('91.'), 'current codeRelease must remain in the v91 family');

const context = vm.createContext({ console, URL, Date, globalThis: {} });
vm.runInContext(code, context, { filename: 'lead-choice-v91.js' });
const api = context.globalThis.__leadChoiceV91;
assert.ok(api, 'lead choice API was not exposed');

const now = new Date().toISOString();
const strongSummary = 'La NASA confirme la nouvelle étape de la mission Artemis après la validation de 15 équipements. Le calendrier technique est maintenu et la prochaine phase débutera après la revue officielle des équipes.';
const payload = {
  articles: [
    {
      id: 'aggregator',
      title: 'La NASA confirme une nouvelle étape de la mission Artemis',
      summary: 'La mission Artemis avance selon de nouvelles informations.',
      source: 'Google News',
      category: 'Science',
      publishedAt: now,
      url: 'https://news.google.com/articles/test-artemis',
      eventKeyV78: 'artemis:v86b100',
      score: 125,
      essential: true,
      noveltyStateV78: 'new',
      sourceQualityV82: -5,
      titleSupportV83: 'weak',
      titleSensationalV83: true
    },
    {
      id: 'publisher',
      title: 'La NASA confirme une nouvelle étape de la mission Artemis',
      summary: strongSummary,
      source: 'NASA',
      category: 'Science',
      publishedAt: now,
      url: 'https://www.nasa.gov/artemis/test',
      eventKeyV78: 'artemis:v86b100',
      score: 87,
      essential: false,
      noveltyStateV78: 'development',
      sourceQualityV82: 25,
      titleSupportV83: 'strong',
      titleSensationalV83: false
    },
    {
      id: 'unrelated',
      title: 'Une centrale solaire ouvre dans le sud',
      summary: strongSummary,
      source: 'Source énergie',
      category: 'Énergie',
      publishedAt: now,
      url: 'https://example.test/energy',
      eventKeyV78: 'energy:v86b100',
      score: 91,
      noveltyStateV78: 'new',
      sourceQualityV82: 20,
      titleSupportV83: 'strong'
    },
    {
      id: 'rave',
      title: 'En Suisse, des coups de feu en marge d’une rave-party',
      summary: 'Plusieurs personnes ont été prises en charge après des tirs survenus en marge du rassemblement.',
      source: 'Source locale',
      category: 'Science',
      publishedAt: now,
      url: 'https://example.test/rave',
      eventKeyV78: 'rave:v86b100',
      score: 70
    },
    {
      id: 'einstein',
      title: 'Nous sommes peut-être le jour d’après Einstein : une nouvelle piste en physique',
      summary: 'Des chercheurs discutent une hypothèse sur les lois fondamentales de la physique.',
      source: 'Source science',
      category: 'Énergie',
      publishedAt: now,
      url: 'https://example.test/einstein',
      eventKeyV78: 'einstein:v86b100',
      score: 72
    },
    {
      id: 'iceland',
      title: 'Référendum sur l’UE en Islande : le non en passe de l’emporter',
      summary: 'Le dépouillement du référendum islandais sur les discussions d’adhésion à l’Union européenne se poursuit.',
      source: 'Source Europe',
      category: 'Société',
      publishedAt: now,
      url: 'https://example.test/iceland',
      eventKeyV78: 'iceland-eu:v86b100',
      score: 73
    },
    {
      id: 'movie',
      title: 'Chez nous sur France 4 : une infirmière happée par la politique dans le film de Lucas Belvaux',
      summary: 'France 4 diffuse le film de Lucas Belvaux avec Émilie Dequenne.',
      source: 'Source TV',
      category: 'Politique',
      publishedAt: now,
      url: 'https://example.test/movie',
      eventKeyV78: 'movie:v86b100',
      score: 68
    },
    {
      id: 'printer',
      title: 'Cette imprimante sans cartouches veut changer la donne',
      summary: 'Le constructeur présente une nouvelle imprimante destinée au grand public.',
      source: 'Source Tech',
      category: 'Société',
      publishedAt: now,
      url: 'https://example.test/printer',
      eventKeyV78: 'printer:v86b100',
      score: 67
    },
    {
      id: 'economy-safe',
      title: 'Le prix des légumes progresse après la canicule',
      summary: 'Les distributeurs constatent une hausse des prix de plusieurs légumes.',
      source: 'Source Économie',
      category: 'Économie',
      publishedAt: now,
      url: 'https://example.test/economy-safe',
      eventKeyV78: 'economy-safe:v86b100',
      score: 66
    }
  ],
  stats: {}
};

const transformed = api.transformPayload(payload);
const byId = id => transformed.articles.find(article => article.id === id);
const aggregator = byId('aggregator');
const publisher = byId('publisher');
const unrelated = byId('unrelated');
const rave = byId('rave');
const einstein = byId('einstein');
const iceland = byId('iceland');
const movie = byId('movie');
const printer = byId('printer');
const economySafe = byId('economy-safe');

assert.equal(transformed.stats.leadChoiceV91, true, 'v91 stats marker missing');
assert.equal(transformed.stats.leadComparedGroupsV91, 1, 'expected exactly one duplicate group');
assert.equal(publisher.preferredLeadV91, true, 'direct complete publisher should be preferred');
assert.equal(aggregator.preferredLeadV91, false, 'aggregator should not be preferred');
assert.ok(publisher.leadQualityV91 > aggregator.leadQualityV91, 'publisher quality should exceed aggregator quality');
assert.ok(publisher.score > aggregator.score, 'preferred publisher must win v79 score tie-break');
assert.ok(publisher.score < 125.01, 'lead selection must not materially inflate story ranking');
assert.equal(publisher.essential, true, 'essential status should be propagated across the duplicate story');
assert.equal(aggregator.noveltyStateV78, 'development', 'strongest novelty should be propagated before v79 lead selection');
assert.equal(publisher.noveltyStateV78, 'development', 'publisher should keep strongest novelty');
assert.equal(unrelated.score, 91, 'unrelated story score must not be changed');
assert.equal(unrelated.category, 'Énergie', 'clear energy story must stay in Énergie');
assert.equal(rave.category, 'Société', 'obvious shooting story must not remain in Science');
assert.equal(rave.categoryOriginalV913, 'Science', 'corrected category should retain provenance');
assert.equal(einstein.category, 'Science', 'obvious physics story must not remain in Énergie');
assert.equal(iceland.category, 'Europe', 'EU referendum in Iceland must not remain in Société');
assert.equal(movie.category, 'Culture', 'an explicit film story must not remain in Politique');
assert.equal(printer.category, 'Tech', 'an explicit printer story must not remain in Société');
assert.equal(economySafe.category, 'Économie', 'ordinary economic story must not be over-corrected');
assert.equal(transformed.stats.categoryGuardV913, true, 'v91.3 category guard marker missing');
assert.equal(transformed.stats.categoryCorrectionsV913, 5, 'expected five targeted category corrections');

console.log('All v91/v91.3 lead-choice checks passed.');
