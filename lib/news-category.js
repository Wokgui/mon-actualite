'use strict';

const CATEGORY_RULES = [
  ['IA', ['intelligence artificielle', ' ia ', 'openai', 'chatgpt', 'anthropic', 'claude', 'gemini', 'llm', 'modèle de langage', 'agent ia', 'machine learning', 'deepseek']],
  ['VR', ['réalité virtuelle', 'casque vr', 'quest 3', 'quest 4', 'steamvr', 'pcvr', 'virtual reality', 'mixed reality', 'réalité mixte']],
  ['Smartphones', ['smartphone', 'android', 'iphone', 'galaxy s', 'pixel ', 'oppo ', 'xiaomi ', 'oneplus', 'téléphone mobile']],
  ['Automobile', ['voiture', 'automobile', 'véhicule électrique', 'véhicule', 'tesla', 'renault', 'peugeot', 'bmw', 'mercedes', 'audi', 'porsche', 'suv', 'batterie automobile']],
  ['Énergie', ['énergie', 'électricité', 'nucléaire', 'solaire', 'éolien', 'batterie stationnaire', 'hydrogène', 'gaz naturel']],
  ['Politique', ['politique', 'gouvernement', 'assemblée nationale', 'sénat', 'élysée', 'ministre', 'élection', 'président', 'matignon']],
  ['Économie', ['économie', 'inflation', 'croissance', 'bce', 'banque centrale', 'taux directeur', 'bourse', 'marché financier', 'emploi', 'chômage', 'entreprise', 'facturation électronique']],
  ['International', ['guerre', 'ukraine', 'russie', 'chine', 'états-unis', 'gaza', 'israël', 'iran', 'otan', 'onu', 'international']],
  ['Europe', ['union européenne', ' ue ', 'commission européenne', 'parlement européen', 'bruxelles', 'europe', 'européen', 'européenne']],
  ['Santé', ['santé', 'médecine', 'hôpital', 'maladie', 'vaccin', 'cancer', 'traitement', 'épidémie', 'médicament']],
  ['Environnement', ['climat', 'environnement', 'biodiversité', 'pollution', 'réchauffement', 'écologie']],
  ['Science', ['science', 'scientifique', 'chercheur', 'recherche', 'espace', 'astronomie', 'astrophys', 'physique', 'biologie', 'archéologie', 'nasa', 'esa', 'spacex', 'fusée', 'télescope', 'spatial', 'satellite', 'cosmos']],
  ['Culture', ['culture', 'cinéma', 'film', 'série', 'musique', 'livre', 'littérature', 'musée', 'artiste']],
  ['Éducation', ['éducation', 'école', 'collège', 'lycée', 'université', 'enseignant', 'élève', 'étudiant']],
  ['Société', ['société', 'justice', 'police', 'logement', 'transport', 'démographie', 'famille']],
  ['Tech', ['technologie', 'tech', 'informatique', 'logiciel', 'windows', 'linux', 'cybersécurité', 'cyberattaque', 'piratage', 'fuite de données', 'données volées', 'ordinateur', 'semi-conducteur', 'puce', 'dlss', 'nvidia', 'geforce', 'gpu', 'gaming', 'jeu vidéo', 'jeux vidéo']]
];

const WEAK_INTERNATIONAL_TERMS = new Set(['ukraine', 'russie', 'chine', 'etats unis', 'gaza', 'israel', 'iran']);
const SPORTS_TITLE_RX = /\b(pogacar|marquez|motogp|ligue 1|ligue des champions|champions league|football|tennis|cyclisme|grand prix|formule 1|mercato|utmb|ultra trail|match|but|score)\b/i;
const CYBER_TITLE_RX = /\b(cyberattaque|cybercrimin\w*|hack(?:er|e|é|ers?)?|rancongiciel|zerobytes)\b|\bpirat\w*\b.*\b(donnees|site|plateforme|fisc|ministere)\b/i;
const INCIDENT_TITLE_RX = /\b(fusillade|coups? de feu|tirs? mortels?|naufrage|chavir\w*|accident|grievement blesse\w*|portes? disparus?)\b/i;

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHeadline(value = '') {
  return String(value || '').replace(/\s+-\s+[^-]{2,45}$/u, '').trim();
}

function padded(value = '') {
  return ` ${normalize(value)} `;
}

function hasTerm(haystack, term) {
  const needle = normalize(term);
  if (!needle) return false;
  if (needle.includes(' ')) return haystack.includes(` ${needle} `);
  return haystack.trim().split(/\s+/).some(token => token === needle || (needle.length >= 5 && token.startsWith(needle)));
}

function termWeight(category, term, titleScope) {
  if (category === 'International' && WEAK_INTERNATIONAL_TERMS.has(normalize(term))) return titleScope ? 5 : 1;
  return titleScope ? 10 : 3;
}

function classifyArticleDetailed(item = {}, keywords = []) {
  const title = padded(cleanHeadline(item.title || ''));
  const summary = padded(item.summary || '');
  const categoryHint = String(item.categoryHint || '').trim();

  if (SPORTS_TITLE_RX.test(title)) return { category: 'Société', confidence: 14, reason: 'sports-title' };
  if (CYBER_TITLE_RX.test(title)) return { category: 'Tech', confidence: 14, reason: 'cyber-title' };
  if (INCIDENT_TITLE_RX.test(title) && categoryHint !== 'International') {
    return { category: 'Société', confidence: 13, reason: 'incident-title' };
  }

  const scored = CATEGORY_RULES.map(([category, terms], index) => {
    let titleHits = 0;
    let summaryHits = 0;
    let evidence = 0;
    for (const term of terms) {
      if (hasTerm(title, term)) {
        titleHits += 1;
        evidence += termWeight(category, term, true);
      } else if (hasTerm(summary, term)) {
        summaryHits += 1;
        evidence += termWeight(category, term, false);
      }
    }
    const hint = categoryHint === category ? (item.strictCategory ? 4 : 2) : 0;
    return { category, score: evidence + hint, titleHits, summaryHits, index };
  }).sort((a, b) => b.score - a.score || b.titleHits - a.titleHits || a.index - b.index);

  const best = scored[0];
  if (best && (best.titleHits > 0 || best.score >= 6)) {
    return { category: best.category, confidence: best.score, reason: 'content', evidence: best };
  }

  if (categoryHint) return { category: categoryHint, confidence: item.strictCategory ? 4 : 2, reason: 'feed-hint' };

  const combined = `${title}${summary}`;
  const matchingKeyword = (Array.isArray(keywords) ? keywords : []).find(keyword => combined.includes(normalize(keyword)));
  return matchingKeyword
    ? { category: 'À suivre', confidence: 2, reason: 'keyword' }
    : { category: 'Société', confidence: 0, reason: 'fallback' };
}

function classifyArticle(item = {}, keywords = []) {
  return classifyArticleDetailed(item, keywords).category;
}

module.exports = { classifyArticle, classifyArticleDetailed, normalizeCategoryText: normalize };
