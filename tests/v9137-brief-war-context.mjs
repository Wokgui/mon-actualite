import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../brief-smart-v87.js', import.meta.url), 'utf8');
const storage = new Map();
const windowStub = {
  fetch: async () => ({ ok: true }),
  addEventListener() {}
};
const documentStub = {
  hidden: false,
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
const localStorageStub = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

const sandbox = {
  window: windowStub,
  document: documentStub,
  localStorage: localStorageStub,
  requestAnimationFrame() {},
  setTimeout() {},
  console
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'brief-smart-v87.js' });

const api = windowStub.__briefSmartV9112;
assert.ok(api, 'le Brief doit exposer son API de test v91.12');

assert.equal(
  api.impactScore({ title: 'Washington veut renforcer sa guerre économique contre l’Iran' }),
  0,
  '« guerre économique » ne doit pas devenir un événement majeur dans le Brief'
);
assert.equal(
  api.impactScore({ title: 'La Commission européenne condamne la glorification des criminels de guerre' }),
  0,
  '« criminels de guerre » ne doit pas devenir un conflit en cours dans le Brief'
);
assert.equal(
  api.impactScore({ title: 'Une enquête internationale documente un possible crime de guerre' }),
  0,
  '« crime de guerre » seul ne doit pas suffire au bonus majeur'
);
assert.ok(
  api.impactScore({ title: 'Guerre en Ukraine : de nouvelles frappes touchent Kiev' }) >= 15,
  'une vraie guerre et des frappes explicites doivent rester majeures'
);
assert.ok(
  api.impactScore({ title: 'Guerre en Ukraine : une enquête vise de nouveaux crimes de guerre' }) >= 15,
  'un conflit explicite reste majeur même avec la locution « crimes de guerre »'
);
assert.ok(
  api.impactScore({ title: 'Guerre économique et frappes de missiles : plusieurs blessés après une attaque' }) >= 34,
  'les frappes et le bilan humain doivent rester prioritaires malgré une métaphore économique'
);

console.log('v91.37 Brief contextual war checks passed (6 assertions).');
