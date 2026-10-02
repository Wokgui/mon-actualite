import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error(`FAIL: ${message}`); process.exitCode = 1; };
const ok = message => console.log(`OK: ${message}`);

const index = read('index.html');
const sw = read('sw-v98.js');
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
const runtimeFiles = new Set(['startup-stability-v98.15.js', 'release-watch.js', 'article-access-v91.48.js', 'startup-news-prefetch-v91.83.js', 'app.js', 'image-pipeline.js', 'nav-solid-hardfix-v91.89.js', 'ui-settings-fix-v98.11.js', 'brief-three-days-v98.14.js', 'brief-prefetch-v98.15.js']);
for (const src of scripts) if (!runtimeFiles.has(src.split('?')[0])) fail(`unexpected runtime owner: ${src}`);
if (scripts.length !== runtimeFiles.size) fail('runtime must contain exactly the current approved modules without duplicates');
else ok(`current runtime allowlist: ${scripts.length} scripts, no duplicate photo owner`);

const requiredRuntimeScripts = [
  'release-watch.js',
  'startup-news-prefetch-v91.83.js',
  'app.js',
  'image-pipeline.js',
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

for (const asset of ['app-controls.css?v=98.42']) {
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

for (const marker of ['function previousMonthStart', 'function historyWindowDays', 'function isInArticleHistory']) {
  if (!app.includes(marker)) fail(`previous-calendar-month history marker missing: ${marker}`);
}
if (app.includes('const BRIEF_DAYS = 10')) fail('legacy 10-day Brief/Watch limit is still active');
else ok('Home, Brief and watch use the previous-calendar-month window');
if (!app.includes('brief-history-day-v9138') || !app.includes('const pickDay = candidates')) fail('L’essentiel must enforce the requested count separately for every day');
else ok('L’essentiel enforces its count separately for every day');

if (!/function effectiveWatchRules\(\)\s*{\s*return activeWatchRules\(\);\s*}/.test(app)) fail('Veille must use only rules entered in Settings > Veille');
else ok('Veille uses only Settings > Veille rules');
if (app.match(/function effectiveWatchRules\(\)[\s\S]{0,500}briefWatchTopics/)) fail('legacy briefWatchTopics still influence Veille');
if (!app.includes('function fetchHistoryCoverage') || !app.includes('days = historyWindowDays()') || !app.includes('historyDays: days')) fail('calendar-month historical discovery is missing');
else ok('calendar-month historical discovery configured');
const imageSequence = read('image-pipeline.js');
const photos = read('services/article-photos.js');
if (app.includes('scheduleVisualBackfill') || app.includes('recoverArticleVisual') || scripts.some(src => /photo-single-owner|image-sequence|image-stability/.test(src)) || !imageSequence.includes('concurrency: 4')) fail('photo loading must have one bounded owner');
else ok('single bounded image pipeline owns photo loading');
if (!imageSequence.includes('record.attempts < 2') || !photos.includes('record.retryAt = Date.now() + 8000')) fail('failed photos must receive a bounded retry of the same URL');
else ok('failed photos receive one bounded retry without changing selection identity');
if (!photos.includes('preparedVisualUrl(article), articleVisualUrl(article)')) fail('validated exact same-origin images must stay ahead of refreshed generic recovery');
else ok('validated same-origin prepared images keep first priority');
const photoFast = read('api/article-photo-fast.js');
if (!photoFast.includes('fastBingImageSearch') || !photoFast.includes('bingImageEntries') || !photoFast.includes('sourceAgreement')) fail('generic title/source photo recovery is missing');
else ok('generic title/source photo recovery configured');
if (!sw.includes("THUMB_CACHE = 'mon-actualite-thumbnails-v11'") || !sw.includes('if (!positive(response)) return response') || !sw.includes('await createImageBitmap')) fail('negative or undecodable thumbnail responses must never be cached');
else ok('negative thumbnail fallbacks are purged instead of cached');
const androidGradle = read('android-app/app/build.gradle');
const androidActivity = read('android-app/app/src/main/java/com/wokgui/monactualite/MainActivity.java');
const androidManifest = read('android-app/app/src/main/AndroidManifest.xml');
if (!androidGradle.includes('prepareWebAssets') || !androidActivity.includes('WebViewAssetLoader')) fail('Android APK does not bundle the current frontend');
else ok('Android APK bundles current frontend independently of Vercel frontend deploys');
if (!androidGradle.includes("System.getenv('MON_ACTUALITE_KEYSTORE')") || !androidGradle.includes('signingConfig signingConfigs.stableDebug')) fail('Android CI must explicitly use the preserved stable install key');
else ok('Android CI explicitly uses the preserved stable install key');
if (androidActivity.includes('.hero-header h1{font-size:32px!important')) fail('Android still overrides the title-size preference');
else ok('Android preserves the user-selected title size');
if (!androidManifest.includes('@mipmap/ic_launcher') || !androidManifest.includes('@mipmap/ic_launcher_round')) fail('Android launcher does not use adaptive icons');
else ok('Android launcher uses adaptive icons');

const coreNews = read('lib/news-core.js');
const apiNews = read('api/news.js');
const rowFix = read('app-controls.css');
if (!coreNews.includes('bucket.length < 12') || !coreNews.includes('selected.splice(700)') || !coreNews.includes('historyDays')) fail('historical day coverage is not preserved in news-core');
else ok('historical day coverage preserved in news-core');
if (!apiNews.includes('bucket.length < 10') || !apiNews.includes('CATALOG_LIMIT = 620')) fail('historical day coverage is not preserved by API catalogue ranking');
else ok('historical day coverage preserved by API catalogue ranking');
if (!rowFix.includes('grid-template-rows:minmax(var(--article-image-height),auto)') || !rowFix.includes('height:var(--article-image-height)!important') || !rowFix.includes('display:none!important')) fail('stable adaptive image and compact metadata contract missing');
else ok('exact image/title centering contract configured');
if (!rowFix.includes('border:0!important')) fail('article separators are still allowed by the final visual layer');
else ok('article separators disabled globally');
if (!app.includes('const quota = dayIndex === 0 ? 24 : dayIndex === 1 ? 16 : 8')) fail('home day coverage quota missing');
else ok('home prioritizes multiple publication days before same-day overflow');

if (!app.includes('function resetReadStateFromNav(view)') || !app.includes("}, 620);")) fail('long-press reset contract missing');
else ok('long-press reset contract configured');
if (!app.includes('settingsOpenAccordions') || !app.includes('captureOpenSettingsAccordions')) fail('settings accordion persistence missing');
else ok('settings accordion persistence configured');
if (!app.includes('navLongPressTimer') || !app.includes('resetReadStateFromNav(view)')) fail('long press reset on Home/Brief missing');
else ok('long press reset on Home/Brief configured');
if (!app.includes('photoSnapshot(article)') || !app.includes('data-photo-final=') || !app.includes('fetchpriority=')) fail('shared renderer photo lock missing');
else ok('immediate high-priority article image loading configured');
if (!imageSequence.includes('Math.min(8,') || !imageSequence.includes('priorityCount: 12') || !imageSequence.includes('rootMarginPx: 1200') || !imageSequence.includes('intervalMs: 120') || !imageSequence.includes('function pump()')) fail('bounded paced image loading pipeline missing');
else ok('bounded image loading pipeline configured');
if (imageSequence.includes("localStorage.getItem('news-live-cache')") || !imageSequence.includes('photoRecordByKey(image?.dataset.photoKey)')) fail('photo queue must bind renderer records, never changing storage IDs');
else ok('photo queue identity is independent of catalogue storage');
if (androidActivity.includes('applyAndroidHeaderPolish') || androidActivity.includes('android-ui-polish')) fail('native typography must not mutate after first render');
else ok('native typography has no late injection');
if (!photos.includes('mon-actualite-photo-bodies-v1') || !photos.includes('MAX_BODIES = 160') || !photos.includes('cachedPhoto(record)')) fail('bounded durable validated photo-body cache missing');
else ok('native reopening reuses a bounded positive photo cache');

const visualService = read('services/article-visuals.js');
if (!visualService.includes('let suppliedImage = extractPreparedImage(rawVisual)') || !photos.includes('response.headers.get') || !photos.includes('image.decode()')) fail('external visuals are not decoded through the validated image proxy');
else ok('external visuals route through the validated bounded proxy');
if (!app.includes("app.addEventListener('toggle'") || !app.includes("settingsOpenAccordions.add(title)")) fail('settings accordion toggle persistence missing');
else ok('settings accordion toggle persistence configured');

const releaseWatch = read('release-watch.js');
if (!releaseWatch.includes('IS_NATIVE_ANDROID') || !releaseWatch.includes('if (IS_NATIVE_ANDROID)')) fail('native Android release watcher guard missing');
else ok('native Android release watcher guard configured');
if (!photos.includes('image.decode()') || !photos.includes("record.status = 'failed'")) fail('image decode and failure handling missing');
else ok('candidate decode happens before visible assignment');
if (app.includes('pinnedVisualV85 = remembered.url') || app.includes('visualBackfills')) fail('legacy unvalidated image pins must not bypass the shared registry');
else ok('legacy pins cannot overwrite the final photo');

if (!app.includes('if (IS_NATIVE_ANDROID) {') || !app.includes('publishedNumber > currentNumber') || !app.includes("if (!IS_NATIVE_ANDROID) window.setTimeout(() => checkAppUpdate(), 1400)")) fail('native app update guard missing');
else ok('native app update guard configured');
if (!app.includes("sessionStorage.setItem('news-active-view-v9204'") || !app.includes('view: INITIAL_VIEW')) fail('session view preservation missing');
else ok('session view preservation configured');
