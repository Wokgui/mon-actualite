import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const index = read('index.html');
const app = read('app.js');
const prefetch = read('feed-stability-v91.38.js');
const quickview = read('article-quickview.js');
const intelligence76 = read('content-intelligence-v76.js');
const personalization = read('personalization-learning-v91.js');
const release = read('release-watch.js');
const version = JSON.parse(read('version.json'));
const legacyDecorators = [
  'content-intelligence-v78.js',
  'content-trust-v83.js',
  'experience-v85.js',
  'feed-editorial-polish-v77.js',
  'feed-editorial-v77.js',
  'feed-editorial-v78.js',
  'feed-experience-v79.js',
  'feed-intelligence-v81.js',
  'feed-quality.js',
  'news-pipeline-v88.js',
  'quality-signals-v89.js',
  'source-discovery-ui.js'
];

for (const obsolete of [
  'stable-dom.js',
  'view-stability-v91.38.js',
  'feedly-runtime.js',
  'feedly-continuous-v91.38.js',
  'home-continuous-v91.38.12.js',
  'brief-smart-v87.js'
]) {
  assert.equal(index.includes(`src="${obsolete}`), false, `${obsolete} must not own or guard a visible render anymore`);
}

assert.match(app, /data-stable-home-feed/, 'Home must declare its single stable feed owner');
assert.match(app, /data-stable-brief-content/, 'Brief must be complete in the primary render');
assert.match(app, /feed\.append\(\.\.\.template\.content\.childNodes\)/, 'continuous Home must append nodes');
assert.match(app, /underlying|sheet-close|refreshSheet/, 'Personalize must update independently from the page below');
assert.equal(/new MutationObserver/.test(app), false, 'the primary renderer must not observe and rewrite itself');
assert.equal(/new MutationObserver/.test(prefetch), false, 'image/summary prefetch must consume render events');
assert.equal(/new MutationObserver/.test(quickview), false, 'quick view must consume render events');
for (const file of legacyDecorators) {
  assert.match(read(file), /stable-owned-list/, `${file} must not alter stable lists after paint`);
}
assert.match(prefetch, /news-article-summaries-v8/, 'idle prefetch must write the quick-view cache');
assert.match(quickview, /news-article-summaries-v8/, 'quick view must read the idle-prefetch cache');
assert.match(app, /Array\.isArray\(article\.tags\)/, 'old malformed tag fields must not break navigation');
assert.match(app, /try \{ learned = Number\(personalizationScore\(article\)/, 'old personalization data must not break ranking');
assert.match(intelligence76, /Array\.isArray\(article\.matches\)/, 'legacy matches must not interrupt background intelligence');
assert.match(personalization, /Array\.isArray\(article\.tags\)/, 'legacy tags must not interrupt personalization');
assert.match(release, /PAGE_RELEASE = '91\.40'/, 'release watcher must not reload 91.40 as if it were stale');
assert.equal(version.codeRelease, '91.40');
assert.equal(version.version, '67');

console.log('v91.40 structural single-render checks passed.');
