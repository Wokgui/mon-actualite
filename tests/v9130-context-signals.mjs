import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { homeSignalScore } = require('../lib/news-significance.js');

const score = title => homeSignalScore({ title }).score;

assert.equal(score('IA, drones, missiles : le Japon réclame 48 milliards d’euros pour sa défense - Boursorama'), 0,
  'bare missile procurement must not look like an attack');
assert.ok(score('Ukraine : une salve de missiles frappe plusieurs infrastructures énergétiques') >= 15,
  'contextual missile strikes must stay major');
assert.ok(score("L'une des plus grandes raffineries russes prend feu après une attaque de drones ukrainiens, Moscou prépare sa riposte") >= 15,
  'plural drone attacks must stay major');
assert.ok(score('Un calvaire, des larmes et un séisme : Novak Djokovic éliminé à l’US Open - Eurosport') <= -15,
  'sports earthquake metaphors must not look like disasters');

console.log('v91.30 contextual significance signals passed.');
