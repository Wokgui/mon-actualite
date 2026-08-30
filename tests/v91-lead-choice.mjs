import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('lead-choice-v91.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const sourcePos = index.indexOf('source-quality-v82.js?v=82');
const leadPos = index.indexOf('lead-choice-v91.js?v=91.2');
const mergePos = index.indexOf('feed-experience-v79.js?v=79');
assert.ok(sourcePos >= 0 && leadPos > sourcePos && mergePos > leadPos, 'v91 must load after source quality and before v79 fusion');
assert.ok(String(version.label || '').includes('v91'), 'version label must mention v91');

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
    }
  ],
  stats: {}
};

const transformed = api.transformPayload(payload);
const aggregator = transformed.articles.find(article => article.id === 'aggregator');
const publisher = transformed.articles.find(article => article.id === 'publisher');
const unrelated = transformed.articles.find(article => article.id === 'unrelated');
const rave = transformed.articles.find(article => article.id === 'rave');
const einstein = transformed.articles.find(article => article.id === 'einstein');

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
assert.equal(rave.categoryOriginalV912, 'Science', 'corrected category should retain provenance');
assert.equal(einstein.category, 'Science', 'obvious physics story must not remain in Énergie');
assert.equal(transformed.stats.categoryGuardV912, true, 'v91.2 category guard marker missing');
assert.equal(transformed.stats.categoryCorrectionsV912, 2, 'expected two targeted category corrections');

console.log('All v91/v91.2 lead-choice checks passed.');
