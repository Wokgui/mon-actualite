import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('feed-editorial-polish-v77.js', 'utf8');
const storage = new Map([['news-live-cache', JSON.stringify({ articles: [] })]]);
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value))
};
const sessionStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};
const document = {
  querySelector: () => null,
  addEventListener() {},
  getElementById: () => null
};
const window = {
  fetch: async () => new Response('{}', { status: 200 }),
  addEventListener() {},
  scrollBy() {}
};
const context = vm.createContext({
  console,
  URL,
  Response,
  Headers,
  document,
  window,
  localStorage,
  sessionStorage,
  requestAnimationFrame: callback => callback(),
  MutationObserver: class { observe() {} },
  setTimeout
});

vm.runInContext(source, context, { filename: 'feed-editorial-polish-v77.js' });
const api = window.__homeSeenFallbackV9127;
assert.ok(api, 'Home seen fallback diagnostics must be exposed');
assert.equal(api.minimumVisible, 12);
assert.equal(api.removalBudget(36), 24, 'a full Home batch must retain twelve cards');
assert.equal(api.removalBudget(12), 0, 'a twelve-card feed must never be emptied');
assert.equal(api.removalBudget(5), 0, 'a short feed must remain intact');
assert.match(source, /removed < removableBudget/, 'DOM cleanup must enforce the removal budget');

console.log('v91.27 Home seen fallback tests passed');
