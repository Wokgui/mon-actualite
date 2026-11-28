import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('navigation-cache-v79.js', 'utf8');
let clock = 100;
let nativeWrites = 0;
const listeners = new Map();
const payload = {
  articles: [{ id: 'one', title: 'Titre', url: 'https://example.test/one', publishedAt: '2026-08-31T05:00:00Z' }]
};

class FakeElement {
  constructor() { this._html = ''; this.firstChild = null; }
  querySelector(selector) {
    if (selector === ':scope > .page') return {
      textContent: 'Mon actualité',
      querySelector: inner => inner === '.hero-header' ? {} : null
    };
    if (selector === '.bottom-nav .nav-item.active[data-view]') return { dataset: { view: 'home' } };
    return null;
  }
  querySelectorAll() { return []; }
  appendChild() {}
}

Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  configurable: true,
  get() { return this._html; },
  set(value) { if (this === app) nativeWrites += 1; this._html = String(value); }
});

const app = new FakeElement();
const storage = new Map([['news-live-cache', JSON.stringify(payload)]]);
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value))
};
const document = {
  documentElement: { dataset: {} },
  getElementById: id => id === 'app' ? app : null,
  createElement: tag => {
    assert.equal(tag, 'template');
    return {
      content: { querySelector: () => ({ dataset: { view: 'home' } }) },
      _html: ''
    };
  },
  addEventListener: (type, listener) => listeners.set(type, listener)
};
const window = {
  fetch: async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }),
  addEventListener() {}
};

const context = vm.createContext({
  console,
  URL,
  Response,
  Headers,
  Element: FakeElement,
  document,
  window,
  localStorage,
  location: { href: 'https://app.test/', origin: 'https://app.test' },
  performance: { now: () => clock }
});
vm.runInContext(source, context, { filename: 'navigation-cache-v79.js' });

const markup = '<main><button class="nav-item active" data-view="home"></button></main>';
await window.fetch('/api/news');
assert.equal(window.__navigationPerformanceV9111.unchangedResponses, 1, 'fixture must produce an unchanged response');
app.innerHTML = markup;
assert.equal(nativeWrites, 0, 'unchanged silent refresh should still preserve the current DOM');

clock += 1000;
listeners.get('click')({ target: { closest: selector => selector === '[data-refresh]' ? {} : null } });
await window.fetch('/api/news');
app.innerHTML = markup;
assert.equal(nativeWrites, 1, 'manual refresh must render even when the sync strip is absent');
assert.equal(window.__navigationPerformanceV9111.manualRefreshesPreserved, 1);

console.log('v91.26 manual refresh bridge tests passed');
