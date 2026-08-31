import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('app.js', 'utf8');
const experience = fs.readFileSync('feed-experience-v80.js', 'utf8');

assert.match(app, /function applyDownloadedNews\(payload\)/, 'app must accept an already downloaded news payload');
assert.match(app, /Array\.isArray\(payload\.articles\)/, 'payload application must reject malformed article lists');
assert.match(app, /window\.__applyNewsPayloadV9128 = applyDownloadedNews/, 'the pending-update bridge must be exposed after app startup');
assert.match(app, /state\.articles = payload\.articles\.map\(applyRememberedVisual\)/, 'the bridge must update live app state and preserve recovered visuals');
assert.match(app, /persistCache\(\);\s*render\(\);\s*scheduleVisualBackfill\(\);/, 'the applied payload must persist and render immediately');

const directApply = experience.indexOf('window.__applyNewsPayloadV9128?.(payload)');
const refreshFallback = experience.indexOf("document.querySelector('[data-refresh]')");
assert.ok(directApply >= 0 && refreshFallback > directApply, 'direct payload application must run before refresh or reload fallback');
assert.match(experience, /deliverPayload = null;[\s\S]{0,500}?return;/, 'successful direct application must not replay the same payload through fetch');

console.log('v91.28 pending payload application checks passed');
