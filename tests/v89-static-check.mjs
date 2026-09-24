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
if (scripts.length > 6) fail(`startup script budget exceeded: ${scripts.length}/6`);
else ok(`startup script budget ${scripts.length}/6`);

const requiredRuntimeScripts = [
  'release-watch.js',
  'startup-news-prefetch-v91.83.js',
  'app.js',
  'image-sequence-v91.82.js',
  'nav-solid-hardfix-v91.89.js'
];
for (const file of requiredRuntimeScripts) {
  if (!scripts.some(src => src.includes(file))) fail(`critical runtime script missing: ${file}`);
  else ok(`critical runtime script present: ${file}`);
}

const retiredRuntime = [
  'feed-editorial-polish-v77.js',
  'content-intelligence-v78.js',
  'novelty-detection-v91.js',
  'content-trust-v83.js',
  'feed-experience-v79.js',
  'diagnostic-metrics-v91.js',
  'feed-intelligence-v81.js',
  'news-pipeline-v88.js',
  'article-ui-v91.38.3.js',
  'quality-signals-v89.js',
  'personalization-learning-v91.js',
  'semantic-origin-v87.js',
  'story-boundary-pre-v86.js',
  'story-boundary-clean-v86.js',
  'summary-supplement-v86.js',
  'feed-balance-v87.js'
];
for (const file of retiredRuntime) {
  if (scripts.some(src => src.includes(file))) fail(`retired runtime layer still loaded: ${file}`);
}
if (!process.exitCode) ok('legacy runtime layers remain retired from startup');

const codeRelease = String(version.codeRelease || '').trim();
const cacheSlug = codeRelease.replace(/\./g, '-');
if (!codeRelease || !new RegExp(`mon-actualite-v${cacheSlug}-core-r\\d+`).test(sw)) fail(`service worker cache does not match codeRelease ${codeRelease || '(missing)'}`);
else ok(`service worker cache matches codeRelease ${codeRelease}`);

for (const src of scripts) {
  if (!sw.includes(`./${src}`)) fail(`service worker does not precache runtime script ${src}`);
  else ok(`service worker precaches runtime script ${src}`);
}

for (const asset of [
  'theme-periwinkle-v91.90.css?v=2',
  'top-continuity-v91.92.css?v=1',
  'nav-stability-separator-v91.93.css?v=2'
]) {
  if (!index.includes(asset)) fail(`final visual layer missing from index: ${asset}`);
  if (!sw.includes(asset)) fail(`service worker does not precache final visual layer: ${asset}`);
  else ok(`service worker precaches final visual layer: ${asset}`);
}

const apiDir = path.join(root, 'api');
const apiFiles = fs.readdirSync(apiDir).filter(name => name.endsWith('.js'));
if (apiFiles.length > 12) fail(`Vercel Hobby function count exceeded: ${apiFiles.length}/12`);
else ok(`Vercel function count ${apiFiles.length}/12`);

const appVersion = app.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!appVersion) fail('APP_VERSION not found in app.js');
else if (String(version.version) !== String(appVersion)) fail(`version.json (${version.version}) != APP_VERSION (${appVersion})`);
else ok(`version.json matches APP_VERSION ${appVersion}`);

if (!String(version.label || '').includes(codeRelease)) fail(`version label does not mention current release ${codeRelease}`);
else ok(`version label mentions current release ${codeRelease}`);

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

if (!workflow.includes('v9193-current-ui-browser.mjs') || !workflow.includes('playwright')) fail('current mobile Playwright UI job missing from regression workflow');
else ok('current mobile Playwright UI regression job configured');

if (process.exitCode) process.exit(process.exitCode);
console.log('Current static regression checks passed.');
