import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../feedly-runtime.js', import.meta.url), 'utf8');
const adaptive = fs.readFileSync(new URL('../adaptive-preload-v83.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(runtime, /warmPreparedVisuals|pendingVisuals|warmedVisuals/, 'feedly runtime must not duplicate the adaptive image preloader');
assert.match(index, /adaptive-preload-v83\.js\?v=83/, 'the single adaptive preloader must remain loaded');
assert.match(adaptive, /navigator\.connection[\s\S]*saveData[\s\S]*IMAGE_LIMIT/, 'preloading must stay connection-aware');
assert.match(adaptive, /document\.hidden/, 'preloading must pause while the app is hidden');
assert.match(app, /loading="\$\{index < 4 \? 'eager' : 'lazy'\}"/, 'Home must eagerly load only its first four images');
assert.match(runtime, /const priority = index < 4;/, 'Brief and alternate feeds must eagerly load only their first four images');

console.log('v91.20 mobile work-budget checks passed');
