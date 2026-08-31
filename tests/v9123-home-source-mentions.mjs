import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const app = read('app.js');
const trust = read('content-trust-v83.js');
const intelligence = read('content-intelligence-v78.js');
const feed = read('feed-intelligence-v81.js');
const index = read('index.html');
const sw = read('sw.js');

assert.doesNotMatch(app, /class="merged-count"/, 'l’Accueil ne doit plus afficher un compteur de sources sur les cartes');
assert.doesNotMatch(trust.match(/function ensureTrustLine[\s\S]*?\n  }/)?.[0] || '', /verify-chip-v83|verification\(article\)/, 'les cartes ne doivent plus afficher de statut de recoupement');
assert.doesNotMatch(intelligence.match(/function whyArticle[\s\S]*?\n  }/)?.[0] || '', /sources concordantes/, 'la raison affichée sur une carte ne doit plus être un compteur de sources');
assert.doesNotMatch(feed.match(/function decorateCards[\s\S]*?\n  }/)?.[0] || '', /Sources en désaccord|story-warning-v81[^']/, 'les désaccords restent dans le détail, pas sur l’Accueil');
for (const asset of ['content-intelligence-v78.js?v=78.3', 'content-trust-v83.js?v=83.2', 'feed-intelligence-v81.js?v=81.1']) {
  assert.ok(index.includes(asset), `${asset} doit être chargé par la page`);
  assert.ok(sw.includes(`./${asset}`), `${asset} doit être précaché`);
}

console.log('v91.23 Home source-status mentions removed.');
