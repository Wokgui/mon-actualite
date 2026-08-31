'use strict';

const CATEGORY_RULES = [
  ['IA', ['intelligence artificielle', ' ia ', 'openai', 'chatgpt', 'anthropic', 'claude', 'gemini', 'llm', 'modèle de langage', 'agent ia', 'machine learning', 'deepseek', 'ai factory']],
  ['VR', ['réalité virtuelle', 'casque vr', 'quest 3', 'quest 4', 'steamvr', 'pcvr', 'virtual reality', 'mixed reality', 'réalité mixte']],
  ['Smartphones', ['smartphone', 'android', 'iphone', 'galaxy s', 'pixel ', 'oppo ', 'xiaomi ', 'oneplus', 'téléphone mobile']],
  ['Automobile', ['voiture', 'automobile', 'véhicule électrique', 'véhicule', 'tesla', 'renault', 'peugeot', 'bmw', 'mercedes', 'audi', 'porsche', 'suv', 'batterie automobile']],
  ['Énergie', ['énergie', 'électricité', 'énergie nucléaire', 'centrale nucléaire', 'réacteur nucléaire', 'nucléaire civil', 'epr', 'solaire', 'éolien', 'batterie stationnaire', 'hydrogène', 'gaz', 'gaz naturel']],
  ['Politique', ['politique', 'gouvernement', 'assemblée nationale', 'sénat', 'élysée', 'ministre', 'élection', 'président', 'matignon']],
  ['Économie', ['économie', 'inflation', 'croissance', 'bce', 'banque centrale', 'taux directeur', 'bourse', 'marché financier', 'emploi', 'chômage', 'entreprise', 'facturation électronique']],
  ['International', ['guerre', 'ukraine', 'russie', 'chine', 'états-unis', 'gaza', 'israël', 'iran', 'corée du nord', 'corée du sud', 'pyongyang', 'otan', 'onu', 'international']],
  ['Europe', ['union européenne', ' ue ', 'commission européenne', 'parlement européen', 'bruxelles', 'europe', 'européen', 'européenne']],
  ['Santé', ['santé', 'médecine', 'hôpital', 'maladie', 'vaccin', 'cancer', 'traitement', 'épidémie', 'médicament', 'rhume', 'vitamine', 'tension artérielle', 'hypertension', 'paludisme', 'infection', 'virus', 'bactérie', 'cardiopathie', 'soins dentaires', 'dentaire', 'dentiste', 'nutrition', 'nutritionniste', 'syndrome', 'coeur artificiel', 'carmat']],
  ['Environnement', ['climat', 'environnement', 'biodiversité', 'pollution', 'réchauffement', 'écologie', 'météo', 'canicule', 'vague de chaleur', 'inondation', 'crue']],
  ['Science', ['science', 'scientifique', 'chercheur', 'recherche', 'espace', 'astronomie', 'astrophys', 'physique', 'biologie', 'archéologie', 'nasa', 'esa', 'spacex', 'fusée', 'télescope', 'spatial', 'satellite', 'cosmos']],
  ['Culture', ['culture', 'cinéma', 'film', 'série', 'musique', 'livre', 'littérature', 'musée', 'artiste', 'festival', 'concert']],
  ['Éducation', ['éducation', 'école', 'collège', 'lycée', 'université', 'enseignant', 'professeur', 'rentrée scolaire', 'élève', 'étudiant']],
  ['Société', ['société', 'justice', 'police', 'logement', 'transport', 'démographie', 'famille']],
  ['Tech', ['technologie', 'tech', 'informatique', 'logiciel', 'windows', 'linux', 'cybersécurité', 'cyberattaque', 'piratage', 'fuite de données', 'données volées', 'ordinateur', 'semi-conducteur', 'puce', 'dlss', 'nvidia', 'geforce', 'gpu', 'gaming', 'jeu vidéo', 'jeux vidéo', 'playstation', 'xbox', 'nintendo', 'vidéoprojecteur', 'projecteur', 'téléviseur', 'apple', 'supercalculateur']]
];

const WEAK_INTERNATIONAL_TERMS = new Set(['ukraine', 'russie', 'chine', 'etats unis', 'gaza', 'israel', 'iran']);
const PREFIX_STEMS = new Set(['astrophys']);
const SAFE_TERM_SUFFIXES = new Set(['s', 'es', 'e', 'ee', 'ees', 'er', 'ers', 'ere', 'eres', 'ien', 'iens', 'ienne', 'iennes', 'iel', 'iels', 'ielle', 'ielles', 'ique', 'iques', 'al', 'ale', 'aux', 'ales', 'l', 'ls', 'lle', 'lles']);
const SPORTS_TITLE_RX = /\b(pogacar|marquez|motogp|ligue 1|ligue des champions|champions league|football|tennis|cyclisme|grand prix|formule 1|mercato|utmb|ultra trail|match|but|score|retraite internationale|met (?:un )?terme a sa carriere internationale|fin de (?:sa )?carriere internationale)\b/i;
const CYBER_TITLE_RX = /\b(cyberattaque|cybercrimin\w*|hack(?:er|e|é|ers?)?|rancongiciel|zerobytes)\b|\bpirat\w*\b.*\b(donnees|site|plateforme|fisc|ministere)\b/i;
const INCIDENT_TITLE_RX = /\b(fusillade|coups? de feu|tirs? mortels?|naufrage|chavir\w*|accident|grievement blesse\w*|portes? disparus?)\b/i;
const GAMING_TITLE_RX = /\b(playstation|xbox|nintendo|steam deck|gta\s*\d*|grand theft auto)\b/i;
const FOOD_HEALTH_TITLE_RX = /\b(?:salmonell\w*|listeri\w*|contamin\w*)\b.*\b(?:rappel\w*|consomm\w*|aliment\w*|produit\w*)\b|\b(?:rappel\w*)\b.*\b(?:salmonell\w*|listeri\w*|contamin\w*)\b/i;
const CORPORATE_ECONOMY_TITLE_RX = /\brapprochement strategique\b.*\b(?:cooperative|entreprise|groupe|societe|compagnie|decathlon|sport 2000)\b|\b(?:acquerir|acquisition)\b.*\b(?:entreprise|societe|groupe|compagnie|capital|actions?|tap air portugal)\b|\b(?:prend|prendre|nomme|nommee|devient)\b.{0,45}\b(?:direction des ressources humaines|drh)\b/i;
const SOVEREIGN_ECONOMY_TITLE_RX = /\b(?:fitch|moody s|standard poor s|agence de notation|note souveraine|notation souveraine)\b/i;
const WORK_SOCIETY_TITLE_RX = /\b(?:licencie\w*|licenciement)\b.*\b(?:teletravail\w*|salarie\w*|employeur\w*|anciennete)\b|\bteletravail\w*\b.*\b(?:licencie\w*|licenciement)\b/i;
const HERITAGE_CULTURE_TITLE_RX = /\b(?:loto du patrimoine|monument historique|site patrimonial|patrimoine culturel)\b/i;
const INCIDENTAL_WAR_AI_TITLE_RX = /\b(?:guerre|frappe\w*|attaque\w*|hostilite\w*)\b.*\b(?:video|image\w*|contenu\w*)\b.{0,35}\b(?:genere\w* par ia|ia generative)\b/i;

function normalize(value = '') {
  return String(value || '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
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

function tokenMatchesTerm(token, needle) {
  if (token === needle) return true;
  if (PREFIX_STEMS.has(needle)) return token.startsWith(needle);
  if (needle.length < 5 || !token.startsWith(needle)) return false;
  return SAFE_TERM_SUFFIXES.has(token.slice(needle.length));
}

function hasTerm(haystack, term) {
  const needle = normalize(term);
  if (!needle) return false;
  if (needle.includes(' ')) return haystack.includes(` ${needle} `);
  return haystack.trim().split(/\s+/).some(token => tokenMatchesTerm(token, needle));
}

function termWeight(category, term, titleScope) {
  if (category === 'International' && WEAK_INTERNATIONAL_TERMS.has(normalize(term))) return titleScope ? 5 : 1;
  return titleScope ? 10 : 3;
}

function confidenceLevel(best = {}, second = {}) {
  const margin = Math.max(0, Number(best.score || 0) - Number(second.score || 0));
  if ((Number(best.titleHits || 0) >= 2 && margin >= 4) || (Number(best.score || 0) >= 20 && margin >= 6)) return 'high';
  if (Number(best.score || 0) >= 10 && margin >= 4) return 'medium';
  return 'low';
}

function fixedClassification(category, confidence, reason, confidenceLevelValue = 'high') {
  return { category, confidence, confidenceLevel: confidenceLevelValue, margin: confidence, reason, alternatives: [] };
}

function classifyArticleDetailed(item = {}, keywords = []) {
  const title = padded(cleanHeadline(item.title || ''));
  const summary = padded(item.summary || '');
  const categoryHint = String(item.categoryHint || '').trim();

  if (SPORTS_TITLE_RX.test(title)) return fixedClassification('Société', 14, 'sports-title');
  if (CYBER_TITLE_RX.test(title)) return fixedClassification('Tech', 14, 'cyber-title');
  if (GAMING_TITLE_RX.test(title)) return fixedClassification('Tech', 14, 'gaming-title');
  if (FOOD_HEALTH_TITLE_RX.test(title)) return fixedClassification('Santé', 14, 'food-health-title');
  if (CORPORATE_ECONOMY_TITLE_RX.test(title)) return fixedClassification('Économie', 14, 'corporate-economy-title');
  if (SOVEREIGN_ECONOMY_TITLE_RX.test(title)) return fixedClassification('Économie', 14, 'sovereign-economy-title');
  if (WORK_SOCIETY_TITLE_RX.test(title)) return fixedClassification('Société', 13, 'work-society-title');
  if (HERITAGE_CULTURE_TITLE_RX.test(title)) return fixedClassification('Culture', 13, 'heritage-culture-title');
  if (INCIDENTAL_WAR_AI_TITLE_RX.test(title)) return fixedClassification('International', 14, 'war-ai-incidental-title');
  if (INCIDENT_TITLE_RX.test(title) && categoryHint !== 'International') {
    return fixedClassification('Société', 13, 'incident-title');
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
  const second = scored[1] || { score: 0 };
  if (best && best.score >= 6 && (best.titleHits > 0 || best.summaryHits > 0)) {
    const margin = Math.max(0, best.score - second.score);
    return {
      category: best.category,
      confidence: best.score,
      confidenceLevel: confidenceLevel(best, second),
      margin,
      reason: 'content',
      evidence: best,
      alternatives: scored.slice(1, 3).filter(item => item.score > 0).map(item => ({ category: item.category, score: item.score }))
    };
  }

  if (categoryHint) return fixedClassification(categoryHint, item.strictCategory ? 4 : 2, 'feed-hint', 'low');

  const combined = `${title}${summary}`;
  const matchingKeyword = (Array.isArray(keywords) ? keywords : []).find(keyword => combined.includes(normalize(keyword)));
  return matchingKeyword
    ? fixedClassification('À suivre', 2, 'keyword', 'low')
    : fixedClassification('Société', 0, 'fallback', 'none');
}

function classifyArticle(item = {}, keywords = []) {
  return classifyArticleDetailed(item, keywords).category;
}

module.exports = { classifyArticle, classifyArticleDetailed, normalizeCategoryText: normalize };
