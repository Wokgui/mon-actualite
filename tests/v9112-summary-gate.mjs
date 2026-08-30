import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qualityModule = require('../api/article-summary-groq.js');
const { finalizeArticleSummary, titleRestatement, googleAggregateRisk } = qualityModule;

const article = {
  title: 'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches',
  source: 'France 24',
  url: 'https://www.france24.com/fr/asie-pacifique/nepal-inondations'
};
const body = { mode: 'article', article };

const valid = finalizeArticleSummary(body, {
  summary: 'Le bilan des inondations au Népal atteint 734 morts. Les équipes de secours poursuivent les recherches dans plusieurs zones encore difficiles d’accès.',
  provider: 'groq', unavailable: false
});
assert.equal(valid.unavailable, false, 'a concise factual summary with new information must be kept');
assert.equal(valid.qualityV9112, 'accepted');
assert.match(valid.summary, /734 morts/);

assert.equal(
  titleRestatement(
    'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches.',
    article.title
  ),
  true,
  'a near-copy of the title must not masquerade as a summary'
);

const restatement = finalizeArticleSummary(body, {
  summary: 'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches.',
  provider: 'factual', unavailable: false
});
assert.equal(restatement.unavailable, true);
assert.equal(restatement.qualityReasonV9112, 'title-restatement');
assert.equal(restatement.summary, '');

const boilerplate = finalizeArticleSummary(body, {
  summary: 'Connectez-vous pour sauvegarder cet article. Abonnez-vous pour lire la suite et activez les notifications.',
  provider: 'factual', unavailable: false
});
assert.equal(boilerplate.unavailable, true, 'service UI text must never be exposed as an article summary');
assert.equal(boilerplate.summary, '');

const repeated = finalizeArticleSummary(body, {
  summary: 'Le bilan atteint 734 morts au Népal après les inondations. Le bilan atteint 734 morts au Népal après les inondations. Les secours poursuivent leurs recherches dans des zones difficiles d’accès.',
  provider: 'groq', unavailable: false
});
assert.equal(repeated.unavailable, false);
assert.equal((repeated.summary.match(/Le bilan atteint/g) || []).length, 1, 'duplicate sentences must be removed');

const googleArticle = {
  title: 'Plusieurs médias suivent un scrutin européen',
  source: 'Google News',
  url: 'https://news.google.com/articles/example',
  sources: ['Reuters', 'France 24', 'Le Monde'],
  summary: 'Premier titre Reuters. Deuxième titre France 24. Troisième titre Le Monde.'
};
const corroborating = ['Titre Reuters', 'Titre France 24'];
assert.equal(googleAggregateRisk(googleArticle, { provider: 'factual' }, corroborating), true);
const aggregate = finalizeArticleSummary({ mode: 'article', article: googleArticle }, {
  summary: 'Reuters présente un résultat du scrutin tandis que France 24 évoque une autre séquence et Le Monde rapporte un troisième développement distinct.',
  provider: 'factual', unavailable: false
}, corroborating);
assert.equal(aggregate.unavailable, true, 'ambiguous factual Google News clusters must be suppressed instead of summarized deceptively');
assert.equal(aggregate.qualityReasonV9112, 'ambiguous-google-aggregate');

const groundedAggregate = finalizeArticleSummary({ mode: 'article', article: googleArticle }, {
  summary: 'Le référendum a rejeté la reprise immédiate des négociations d’adhésion à l’Union européenne. Le résultat officiel confirme le maintien de la position actuelle du pays.',
  provider: 'groq', unavailable: false
}, corroborating);
assert.equal(groundedAggregate.unavailable, false, 'a generated and validated synthesis must not be rejected merely because discovery came from Google News');
assert.equal(groundedAggregate.qualityV9112, 'accepted');

console.log('v91.12 integrated summary quality gate checks passed');
