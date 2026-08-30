import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qualityModule = require('../api/article-summary-groq-v9112.js');
const { assessSummary, titleRestatement, googleAggregateRisk } = qualityModule;

const article = {
  title: 'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches',
  source: 'France 24',
  url: 'https://www.france24.com/fr/asie-pacifique/nepal-inondations'
};

const valid = assessSummary(
  'Le bilan des inondations au Népal atteint 734 morts. Les équipes de secours poursuivent les recherches dans plusieurs zones encore difficiles d’accès.',
  article,
  { provider: 'groq' }
);
assert.equal(valid.ok, true, 'a concise factual summary with new information must be kept');
assert.match(valid.text, /734 morts/);

assert.equal(
  titleRestatement(
    'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches.',
    article.title
  ),
  true,
  'a near-copy of the title must not masquerade as a summary'
);

const restatement = assessSummary(
  'Le Népal porte le bilan des inondations à 734 morts après de nouvelles recherches.',
  article,
  { provider: 'factual' }
);
assert.equal(restatement.ok, false);
assert.equal(restatement.reason, 'title-restatement');

const boilerplate = assessSummary(
  'Connectez-vous pour sauvegarder cet article. Abonnez-vous pour lire la suite et activez les notifications.',
  article,
  { provider: 'factual' }
);
assert.equal(boilerplate.ok, false, 'service UI text must never be exposed as an article summary');

const repeated = assessSummary(
  'Le bilan atteint 734 morts au Népal après les inondations. Le bilan atteint 734 morts au Népal après les inondations. Les secours poursuivent leurs recherches dans des zones difficiles d’accès.',
  article,
  { provider: 'groq' }
);
assert.equal(repeated.ok, true);
assert.equal((repeated.text.match(/Le bilan atteint/g) || []).length, 1, 'duplicate sentences must be removed');

const googleArticle = {
  title: 'Plusieurs médias suivent un scrutin européen',
  source: 'Google News',
  url: 'https://news.google.com/articles/example',
  sources: ['Reuters', 'France 24', 'Le Monde'],
  summary: 'Premier titre Reuters. Deuxième titre France 24. Troisième titre Le Monde.'
};
assert.equal(googleAggregateRisk(googleArticle, { provider: 'factual' }), true);
const aggregate = assessSummary(
  'Reuters présente un résultat du scrutin tandis que France 24 évoque une autre séquence et Le Monde rapporte un troisième développement distinct.',
  googleArticle,
  { provider: 'factual' }
);
assert.equal(aggregate.ok, false, 'ambiguous factual Google News clusters must be suppressed instead of summarized deceptively');
assert.equal(aggregate.reason, 'ambiguous-google-aggregate');

const groundedAggregate = assessSummary(
  'Le référendum a rejeté la reprise immédiate des négociations d’adhésion à l’Union européenne. Le résultat officiel confirme le maintien de la position actuelle du pays.',
  googleArticle,
  { provider: 'groq' }
);
assert.equal(groundedAggregate.ok, true, 'a generated and validated synthesis must not be rejected merely because discovery came from Google News');

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.ok(
  vercel.rewrites?.some(rule => rule.source === '/api/article-summary-groq' && rule.destination === '/api/article-summary-groq-v9112'),
  'production Groq route must pass through the v91.12 final quality gate'
);

console.log('v91.12 summary quality gate checks passed');
