import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { bingImageEntries, sourceAgreement, titleAgreement, sameEvent } = require('../api/article-photo-fast.js').__test;

const title = 'GO electric day 2026 : découvrez et testez la mobilité électrique';
const metadata = value => String(JSON.stringify(value)).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const html = [
  `<a class="iusc" m="${metadata({ t:'Logo mobilité électrique', purl:'https://unrelated.example/logo', murl:'https://cdn.example/logo.png' })}"></a>`,
  `<a class="iusc result" m="${metadata({ t:'GO electric day 2026 : découvrez et testez la mobilité électrique', purl:'https://www.klima-agence.lu/fr/go-electric-day-2026', murl:'https://cdn.example/event.jpg', turl:'https://cdn.example/event-thumb.jpg' })}"></a>`
].join('');

assert.equal(sourceAgreement('https://www.lessentiel.lu/fr/story/test', "L'essentiel"), true, 'source comparison must tolerate punctuation and country suffixes');
assert.ok(titleAgreement(title, `${title} | Agenda`).score > .8, 'title scoring must preserve the event identity');
assert.equal(sameEvent('GO electric day 2026 : découvrez la mobilité électrique', title), true, 'a distinctive shortened title must identify the same event');
const entries = bingImageEntries(html, title, 'Klima-Agence');
assert.equal(entries.length, 1, 'unrelated images must be rejected');
assert.equal(entries[0].urls[0], 'https://cdn.example/event.jpg');

console.log('v98.10 generic photo recovery ranking passed.');
