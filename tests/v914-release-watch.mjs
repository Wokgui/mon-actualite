import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const watcher = fs.readFileSync('release-watch.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

const release = String(version.codeRelease || '').trim();
assert.match(release, /^\d+\.\d+$/, 'version.json must expose a semantic codeRelease');
const slug = release.replace(/\./g, '-');
const watcherAsset = `release-watch.js?v=${release}`;
const manifestAsset = `manifest.webmanifest?v=${release}`;

assert.ok(index.includes(watcherAsset), 'index must load the independent release watcher for the published release');
assert.ok(index.indexOf(watcherAsset) < index.indexOf('app.js?v=61'), 'release watcher must load before app.js');
assert.ok(index.includes(manifestAsset), 'manifest cache buster must track the published release');
assert.equal(manifest.start_url, `/?code-release=${release}`, 'installed PWA start URL must identify the published release');
assert.ok(watcher.includes(`const PAGE_RELEASE = '${release}'`), 'release watcher page identity must match version.json');
assert.ok(watcher.includes("window.addEventListener('focus'"), 'release watcher must check when the PWA regains focus');
assert.ok(watcher.includes("document.addEventListener('visibilitychange'"), 'release watcher must check when the PWA becomes visible');
assert.ok(watcher.includes('location.replace(next.href)'), 'release watcher must reload when a newer code release is published');
assert.ok(sw.includes(`const CACHE = 'mon-actualite-v${slug}-core-r1'`), 'service worker core cache must rotate with codeRelease');

const criticalScripts = [...index.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(match => match[1])
  .filter(src => /(?:release-watch|lead-choice|ai-request-control|brief-smart)/.test(src));
for (const asset of [...criticalScripts, manifestAsset]) {
  assert.ok(sw.includes(`./${asset}`), `service worker must precache ${asset}`);
}

console.log(`PWA release wiring checks passed for v${release}.`);
