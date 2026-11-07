import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../services/article-visuals.js', import.meta.url), 'utf8')
  .replace(/export function /g, 'function ')
  + '\nglobalThis.articleVisuals = { articleVisualUrl, hasPreparedVisual };';
const context = {
  location: { href: 'https://mon-actualite.vercel.app/', origin: 'https://mon-actualite.vercel.app' },
  URL,
  URLSearchParams
};
vm.createContext(context);
vm.runInContext(source, context);
const { articleVisualUrl, hasPreparedVisual } = context.articleVisuals;

const missing = {
  id: 'missing',
  title: 'Une actualité sans image fournie',
  source: 'Exemple',
  url: 'https://example.test/story',
  visualStatus: 'unavailable'
};
assert.match(articleVisualUrl(missing), /^\/api\/article-photo-fast\?/, 'an unresolved card must still try the same-origin discovery endpoint');
assert.equal(hasPreparedVisual(missing), false, 'a proxy candidate alone is not proof that a real image was found');

assert.equal(hasPreparedVisual({ ...missing, image: 'https://cdn.example.test/photo.jpg' }), true, 'a supplied publisher image is prepared');
assert.equal(hasPreparedVisual({
  ...missing,
  image: '/api/article-photo-fast?image=https%3A%2F%2Fcdn.example.test%2Fphoto.jpg'
}), true, 'a proxy carrying an exact publisher image is prepared');
assert.equal(hasPreparedVisual({
  ...missing,
  image: '/api/article-thumbnail?url=https%3A%2F%2Fexample.test%2Fstory',
  visualStatus: 'ready'
}), true, 'a previously verified same-origin recovery remains prepared');

console.log('v91.19 visual prepared-state checks passed');
