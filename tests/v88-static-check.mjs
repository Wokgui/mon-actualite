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
order('story-boundary-pre-v86.js', 'feed-experience-v79.js');
order('feed-experience-v79.js', 'news-pipeline-v88.js');
order('experience-v85.js', 'news-pipeline-v88.js');
order('news-pipeline-v88.js', 'brief-smart-v87.js');

for (const retired of ['story-boundary-clean-v86.js', 'summary-supplement-v86.js', 'feed-balance-v87.js']) {
  if (index.includes(retired)) fail(`retired wrapper still loaded: ${retired}`);
  else ok(`retired wrapper removed from index: ${retired}`);
}

if (!sw.includes("mon-actualite-v84-v88-core-r1")) fail('service worker cache is not v88');
else ok('service worker cache is v88');
for (const asset of ['news-pipeline-v88.js?v=88', 'quality-v88.js?v=88', 'quality-v88.css?v=88']) {
  if (!sw.includes(asset)) fail(`service worker does not precache ${asset}`);
  else ok(`service worker precaches ${asset}`);
}
for (const retired of ['story-boundary-clean-v86.js', 'summary-supplement-v86.js', 'feed-balance-v87.js']) {
  if (sw.includes(retired)) fail(`service worker still precaches retired ${retired}`);
}

const apiDir = path.join(root, 'api');
const apiFiles = fs.readdirSync(apiDir).filter(name => name.endsWith('.js'));
if (apiFiles.length > 12) fail(`Vercel Hobby function count exceeded: ${apiFiles.length}/12`);
else ok(`Vercel function count ${apiFiles.length}/12`);

const appVersion = app.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!appVersion) fail('APP_VERSION not found in app.js');
else if (String(version.version) !== String(appVersion)) fail(`version.json (${version.version}) != APP_VERSION (${appVersion})`);
else ok(`version.json matches APP_VERSION ${appVersion}`);

if (!String(version.label || '').toLowerCase().includes('v88')) fail('version label does not mention v88');
else ok('version label mentions v88');

const pipeline = read('news-pipeline-v88.js');
if (!pipeline.includes('topicSignal(article) < -0.2')) fail('negative topic feedback guard missing');
else ok('negative topic feedback guard present');
if (!pipeline.includes('cleanBoundaryArticle')) fail('v86 boundary cleanup missing from v88 pipeline');
else ok('v86 boundary cleanup consolidated');

if (process.exitCode) process.exit(process.exitCode);
console.log('All v88 static regression checks passed.');
