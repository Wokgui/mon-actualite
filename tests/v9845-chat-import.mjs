import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const storage = new Map([['news-brief-ai-settings-v1', JSON.stringify({ prompt: 'Mon prompt personnel', autoAtOpen: true, model: 'old-model' })]]);
globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
globalThis.window = { MonActualiteAI: { postMessage() { throw Error('Forbidden subscription request'); } } };
globalThis.fetch = () => { throw Error('Forbidden network request'); };
const ai = await import('../services/brief-chat.js?unit=1');
const sources = Array.from({ length: 4 }, (_, i) => ({ id: 'source-' + i, title: 'Innovation ' + i, url: 'https://example.test/news/' + i, source: 'Source ' + i, summary: 'Faits vérifiés ' + i, image: 'https://example.test/photo/' + i + '.jpg', publishedAt: '2026-10-02T08:00:00Z' }));
assert.equal(ai.briefAI.prompt, 'Mon prompt personnel');
assert.equal(JSON.parse(storage.get('news-brief-ai-settings-v1')).autoAtOpen, false);
assert.equal(JSON.parse(storage.get('news-brief-ai-settings-v1')).model, undefined);
assert.equal(ai.prepareChatRequest([]), null);
ai.setAISettings({ prompt: '   ' });
assert.equal(ai.prepareChatRequest(sources), null);
ai.setAISettings({ prompt: 'Mon prompt personnel' });
const draft = ai.prepareChatRequest(sources.concat(sources[0], { url: 'javascript:alert(1)' }));
assert.equal(draft.articles.length, 4);
assert.ok(draft.text.startsWith('Mon prompt personnel'));
assert.match(draft.text, /sourceId/);
assert.match(draft.text, /extraits, pas articles complets/);
const response = { summary: 'Résumé [source](https://example.test/news/0)', cards: [
  { sourceId: 'A1', title: 'Innovation choisie', summary: 'Analyse', image: 'https://evil.test/photo', url: 'https://evil.test/news' },
  { sourceId: 'A1', title: 'Doublon', summary: 'À ignorer' },
  { sourceId: 'A999', title: 'Inventé', summary: 'À ignorer' }
] };
assert.equal(ai.importChatResponse(JSON.stringify(response)), true);
assert.equal(ai.briefAI.result.cards.length, 1);
assert.equal(ai.briefAI.result.cards[0].article.url, sources[0].url);
assert.equal(ai.briefAI.result.cards[0].article.image, sources[0].image);
const previous = storage.get('news-brief-ai-results-v1');
for (const invalid of ['', '{"summary":', '{"summary":1,"cards":[]}', '{"summary":"","cards":[]}', '{"summary":"Texte","cards":[{"sourceId":"A999","title":"Inventé","summary":"Faux"}]}', 'x'.repeat(100001)]) {
  assert.equal(ai.importChatResponse(invalid), false);
  assert.equal(storage.get('news-brief-ai-results-v1'), previous);
}
assert.equal(ai.importChatResponse('Voici le résultat :\n\n```json\n' + JSON.stringify(response) + '\n```'), true);
assert.equal(ai.importChatResponse('Un paragraphe sur [cette innovation](https://example.test/news/2). Et https://evil.test/invente.'), true);
assert.equal(ai.briefAI.result.cards.length, 1);
assert.equal(ai.briefAI.result.cards[0].article.url, sources[2].url);
assert.equal(ai.importChatResponse('Un résumé sans lien, uniquement du texte.'), true);
assert.equal(ai.briefAI.result.cards.length, 0);
const restored = await import('../services/brief-chat.js?unit=2');
assert.equal(restored.briefAI.result.summary, 'Un résumé sans lien, uniquement du texte.');
assert.equal(restored.currentChatDraft().articles.length, 4);
assert.equal(restored.importChatResponse(JSON.stringify(response)), true);
assert.equal(restored.briefAI.result.cards[0].article.url, sources[0].url);
restored.setAISettings({ provider: 'claude' });
assert.equal(restored.currentChatDraft(), null);
assert.equal(restored.importChatResponse(JSON.stringify(response)), false);
restored.setAISettings({ provider: 'chatgpt', prompt: 'Un autre prompt' });
assert.equal(restored.currentChatDraft(), null);
restored.setAISettings({ prompt: 'Mon prompt personnel' });
const validPrevious = storage.get('news-brief-ai-results-v1'), validObject = restored.briefAI.result;
const save = localStorage.setItem;
localStorage.setItem = () => { throw Error('Storage unavailable'); };
assert.equal(restored.importChatResponse(JSON.stringify({ summary: 'Nouveau résumé', cards: [] })), false);
assert.equal(restored.briefAI.result, validObject);
assert.equal(storage.get('news-brief-ai-results-v1'), validPrevious);
localStorage.setItem = save;
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../android-app/app/src/main/java/com/wokgui/monactualite/MainActivity.java', import.meta.url), 'utf8');
const service = await readFile(new URL('../services/brief-chat.js', import.meta.url), 'utf8');
assert.doesNotMatch(app, /maybeGenerateStartupBrief|refreshAIAccount|generateAIBrief|data-ai-auto|MonActualiteAI/);
assert.doesNotMatch(main, /new SubscriptionAiBridge|subscriptionAI/);
assert.match(main, /ChatHandoffBridge.install/);
assert.doesNotMatch(service, /fetch\(|api\.openai\.com|auth\.openai\.com|MonActualiteAI/);
console.log('PASS: manual chat, migration, frozen catalogue, JSON/prose import, rejected fabricated cards, atomic persistence, no inference wiring.');
