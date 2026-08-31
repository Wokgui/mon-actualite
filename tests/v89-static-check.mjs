import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error(`FAIL: ${message}`); process.exitCode = 1; };
const ok = message => console.log(`OK: ${message}`);

const index = read('index.html');
const sw = read('sw.js');
const version = JSON.parse(read('version.json'));
const app = read('app.js');
const polish = read('feed-editorial-polish-v77.js');
const trust = read('content-trust-v83.js');
const pipeline = read('news-pipeline-v88.js');
const workflow = read('.github/workflows/regression.yml');

const refs = [...index.matchAll(/(?:src|href)="([^"#]+)"/g)]
  .map(match => match[1])
  .filter(ref => !/^(?:https?:|data:|#)/i.test(ref))
  .map(ref => ref.split('?')[0].replace(/^\.\//, ''));
for (const ref of new Set(refs)) {
  if (!fs.existsSync(path.join(root, ref))) fail(`asset referenced by index.html is missing: ${ref}`);
}
if (!process.exitCode) ok('all local index assets exist');

const scripts = [...index.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
function order(a, b) {
  const ai = scripts.findIndex(src => src.includes(a));
  const bi = scripts.findIndex(src => src.includes(b));
  if (ai < 0 || bi < 0 || ai >= bi) fail(`script order invalid: ${a} must load before ${b}`);
  else ok(`script order: ${a} before ${b}`);
}
order('feed-editorial-polish-v77.js', 'content-intelligence-v78.js');
order('novelty-detection-v91.js', 'content-intelligence-v78.js');
order('content-intelligence-v78.js', 'content-trust-v83.js');
order('content-trust-v83.js', 'feed-experience-v79.js');
order('diagnostic-metrics-v91.js', 'feed-intelligence-v81.js');
order('feed-experience-v79.js', 'news-pipeline-v88.js');
order('experience-v85.js', 'news-pipeline-v88.js');
order('personalization-learning-v91.js', 'news-pipeline-v88.js');
order('news-pipeline-v88.js', 'brief-smart-v87.js');
order('quality-v88.js', 'quality-signals-v89.js');

const retired = [
  'semantic-origin-v87.js',
  'story-boundary-pre-v86.js',
  'story-boundary-clean-v86.js',
  'summary-supplement-v86.js',
  'feed-balance-v87.js'
];
for (const file of retired) {
  if (index.includes(file)) fail(`retired wrapper still loaded: ${file}`);
  else ok(`retired wrapper removed from index: ${file}`);
  if (sw.includes(file)) fail(`service worker still precaches retired ${file}`);
}

const codeRelease = String(version.codeRelease || '').trim();
const cacheSlug = codeRelease.replace(/\./g, '-');
if (!codeRelease || !new RegExp(`mon-actualite-v${cacheSlug}-core-r\\d+`).test(sw)) fail(`service worker cache does not match codeRelease ${codeRelease || '(missing)'}`);
else ok(`service worker cache matches codeRelease ${codeRelease}`);
for (const asset of ['personalization-learning-v91.js?v=91.22', 'news-pipeline-v88.js?v=88.10', 'quality-signals-v89.js?v=89', 'quality-signals-v89.css?v=89']) {
  if (!sw.includes(asset)) fail(`service worker does not precache ${asset}`);
  else ok(`service worker precaches ${asset}`);
}
for (const src of scripts.filter(value => /(?:release-watch|lead-choice|ai-request-control|brief-smart)/.test(value))) {
  if (!sw.includes(`./${src}`)) fail(`service worker does not precache critical script ${src}`);
  else ok(`service worker precaches critical script ${src}`);
}

const apiDir = path.join(root, 'api');
const apiFiles = fs.readdirSync(apiDir).filter(name => name.endsWith('.js'));
if (apiFiles.length > 12) fail(`Vercel Hobby function count exceeded: ${apiFiles.length}/12`);
else ok(`Vercel function count ${apiFiles.length}/12`);

const appVersion = app.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!appVersion) fail('APP_VERSION not found in app.js');
else if (String(version.version) !== String(appVersion)) fail(`version.json (${version.version}) != APP_VERSION (${appVersion})`);
else ok(`version.json matches APP_VERSION ${appVersion}`);

if (!String(version.label || '').toLowerCase().includes('v89')) fail('version label does not mention v89');
else ok('version label mentions v89');

if (!polish.includes('semanticOriginalCategoryV87')) fail('semantic origin was not consolidated into v77 polish layer');
else ok('semantic origin consolidated into v77 polish layer');
if (!trust.includes('storyBoundaryPrepareV86') || !trust.includes('MAX_STORY_GAP')) fail('72h story boundary was not consolidated into v83 trust layer');
else ok('72h story boundary consolidated into v83 trust layer');
if (!pipeline.includes("__NEWS_PIPELINE_VERSION__ = '89'")) fail('v89 pipeline marker missing');
else ok('v89 pipeline marker present');
if (!pipeline.includes('informationValueV89') || !pipeline.includes('lowInformationV89')) fail('information-value scoring missing');
else ok('information-value scoring present');
if (!pipeline.includes('revisionSinceReadV89') || !pipeline.includes('revisionTypeV89')) fail('article revision detection missing');
else ok('article revision detection present');
if (!pipeline.includes('topicSignal(article) < -0.2')) fail('negative topic feedback guard missing');
else ok('negative topic feedback guard present');

if (!workflow.includes('v89-mobile-browser.mjs') || !workflow.includes('playwright')) fail('mobile Playwright job missing from regression workflow');
else ok('mobile Playwright regression job configured');

if (process.exitCode) process.exit(process.exitCode);
console.log('All v89 static regression checks passed.');
