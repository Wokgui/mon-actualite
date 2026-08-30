import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const watcher = fs.readFileSync('release-watch.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

assert.equal(version.codeRelease, '91.4', 'version.json must expose the v91.4 code release');
assert.ok(index.includes('release-watch.js?v=91.4'), 'index must load the independent release watcher');
assert.ok(index.indexOf('release-watch.js?v=91.4') < index.indexOf('app.js?v=61'), 'release watcher must load before app.js');
assert.ok(index.includes('manifest.webmanifest?v=91.4'), 'manifest cache buster must track v91.4');
assert.equal(manifest.start_url, '/?code-release=91.4', 'installed PWA start URL must identify v91.4');
assert.ok(watcher.includes("const PAGE_RELEASE = '91.4'"), 'release watcher page identity must match version.json');
assert.ok(watcher.includes("window.addEventListener('focus'"), 'release watcher must check when the PWA regains focus');
assert.ok(watcher.includes("document.addEventListener('visibilitychange'"), 'release watcher must check when the PWA becomes visible');
assert.ok(watcher.includes('location.replace(next.href)'), 'release watcher must reload when a newer code release is published');
assert.ok(sw.includes("const CACHE = 'mon-actualite-v91-4-core-r1'"), 'service worker core cache must rotate for v91.4');
for (const asset of [
  './release-watch.js?v=91.4',
  './lead-choice-v91.js?v=91.3',
  './ai-request-control-v91.1.js?v=91.1',
  './brief-smart-v87.js?v=90.1',
  './manifest.webmanifest?v=91.4'
]) {
  assert.ok(sw.includes(asset), `service worker must precache ${asset}`);
}

console.log('v91.4 PWA release wiring checks passed.');
