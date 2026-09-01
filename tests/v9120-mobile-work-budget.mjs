import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const stability = fs.readFileSync(new URL('../feed-stability-v91.38.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(index, /adaptive-preload-v83\.js/, 'the former parallel image preloader must remain retired');
assert.match(index, /feed-stability-v91\.38\.js\?v=91\.39/, 'one image and idle-summary scheduler must remain loaded');
assert.match(stability, /navigator\.connection[\s\S]*saveData[\s\S]*SUMMARY_CONCURRENCY/, 'idle work must stay connection-aware');
assert.match(stability, /document\.hidden/, 'idle work must pause while the app is hidden');
assert.match(app, /loading="\$\{index < 4 \? 'eager' : 'lazy'\}"/, 'Home must eagerly load only its first four images');
assert.match(app, /compactArticleRow[\s\S]*articleVisual\(article, index\)/, 'Brief and alternate feeds must share the same image budget');
assert.match(stability, /fetchPriority=rank<12\?'high':'auto'/, 'only the twelve nearby photos may receive high priority');

console.log('v91.20 mobile work-budget checks passed');
