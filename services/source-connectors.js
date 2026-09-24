/**
 * Sources et synchronisation de Mon actualité.
 * Les préférences restent sur l'appareil ; le serveur ne reçoit que la liste
 * nécessaire pour récupérer les flux demandés au moment d'une synchronisation.
 */

export async function importOpmlPreview(file) {
  const xml = await file.text();
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('Invalid OPML');

  const feeds = [...documentXml.querySelectorAll('outline[xmlUrl]')].map(node => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `feed-${Date.now()}-${Math.random()}`,
    title: cleanText(node.getAttribute('title') || node.getAttribute('text') || 'Source sans nom'),
    url: node.getAttribute('xmlUrl'),
    htmlUrl: node.getAttribute('htmlUrl') || '',
    category: '',
    enabled: true
  }));

  return { feeds, importedAt: new Date().toISOString() };
}

const MOJIBAKE = new Map([
  ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'], ['â€ž', '„'],
  ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'], ['Â ', ' '], ['Â«', '«'], ['Â»', '»'],
  ['Ã€', 'À'], ['Ã‚', 'Â'], ['Ã‡', 'Ç'], ['Ãˆ', 'È'], ['Ã‰', 'É'], ['ÃŠ', 'Ê'], ['Ã‹', 'Ë'],
  ['ÃŽ', 'Î'], ['ÃÏ', 'Ï'], ['Ã”', 'Ô'], ['Ã™', 'Ù'], ['Ã›', 'Û'], ['Ãœ', 'Ü'],
  ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã§', 'ç'], ['Ã¨', 'è'], ['Ã©', 'é'], ['Ãª', 'ê'], ['Ã«', 'ë'],
  ['Ã®', 'î'], ['Ã¯', 'ï'], ['Ã´', 'ô'], ['Ã¹', 'ù'], ['Ã»', 'û'], ['Ã¼', 'ü'], ['Å“', 'œ'], ['Å’', 'Œ']
]);

const CATEGORY_REPAIR_RULES = [
  ['IA', ['intelligence artificielle', 'openai', 'chatgpt', 'anthropic', 'gemini', 'llm', 'agent ia']],
  ['VR', ['réalité virtuelle', 'casque vr', 'quest 3', 'quest 4', 'steamvr', 'pcvr', 'virtual reality', 'réalité mixte']],
  ['Smartphones', ['smartphone', 'android', 'iphone', 'galaxy s', 'pixel ', 'oppo ', 'xiaomi ', 'oneplus']],
  ['Automobile', ['voiture', 'automobile', 'véhicule électrique', 'tesla', 'renault', 'peugeot', 'bmw', 'mercedes', 'audi', 'porsche', 'suv']],
  ['Énergie', ['énergie', 'électricité', 'nucléaire', 'solaire', 'éolien', 'hydrogène', 'gaz naturel']],
  ['Culture', ['livre', 'littérature', 'roman', 'écrivain', 'auteur', 'édition', 'cinéma', 'film', 'série', 'musique', 'musée', 'artiste']],
  ['Éducation', ['éducation', 'école', 'collège', 'lycée', 'université', 'enseignant', 'élève', 'étudiant']],
  ['Santé', ['santé', 'médecine', 'hôpital', 'maladie', 'vaccin', 'cancer', 'traitement', 'épidémie', 'médicament']],
  ['Science', ['science', 'chercheur', 'recherche', 'espace', 'astronomie', 'physique', 'biologie', 'archéologie', 'nasa', 'esa']],
  ['Environnement', ['climat', 'environnement', 'biodiversité', 'pollution', 'réchauffement', 'écologie']],
  ['Politique', ['politique', 'gouvernement', 'assemblée nationale', 'sénat', 'élysée', 'ministre', 'élection', 'président', 'matignon']],
  ['Économie', ['économie', 'inflation', 'croissance', 'bce', 'banque centrale', 'bourse', 'emploi', 'chômage', 'entreprise']],
  ['International', ['guerre', 'ukraine', 'russie', 'chine', 'états-unis', 'gaza', 'israël', 'iran', 'otan', 'onu', 'international']],
  ['Europe', ['union européenne', 'commission européenne', 'parlement européen', 'bruxelles', 'europe']],
  ['Société', ['société', 'justice', 'police', 'logement', 'transport', 'démographie', 'famille']],
  ['Tech', ['technologie', 'tech', 'informatique', 'logiciel', 'windows', 'linux', 'cybersécurité', 'ordinateur', 'semi-conducteur', 'puce']]
];

const DISCOVERY_QUERIES = {
  IA: 'intelligence artificielle IA OpenAI Anthropic Gemini',
  Tech: 'technologie informatique logiciel cybersécurité',
  Smartphones: 'smartphone Android iPhone Samsung Oppo Xiaomi',
  VR: 'réalité virtuelle VR Quest PCVR',
  Automobile: 'automobile voiture électrique mobilité',
  Énergie: 'énergie nucléaire solaire éolien hydrogène',
  Culture: 'culture livres littérature cinéma musique',
  Science: 'science recherche innovation espace',
  Santé: 'santé médecine recherche médicale',
  Environnement: 'environnement climat biodiversité énergie',
  Éducation: 'éducation école université enseignement',
  Politique: 'politique France gouvernement élections',
  International: 'actualité internationale monde diplomatie',
  Europe: 'Union européenne Europe Bruxelles',
  Économie: 'économie France inflation emploi entreprises',
  Société: 'société France justice logement transports'
};

function decodeEntities(value = '') {
  if (!/[&][a-z#0-9]+;/i.test(value)) return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function repairMojibake(value = '') {
  let text = String(value ?? '');
  for (const [broken, fixed] of MOJIBAKE) text = text.split(broken).join(fixed);
  return text.replace(/\uFFFD+/g, '').replace(/\s+([,.;:!?])/g, '$1');
}

function cleanText(value = '') {
  return repairMojibake(decodeEntities(String(value ?? ''))).trim();
}

function normalizeText(value = '') {
  return cleanText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSummaryText(value = '') {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (!text) return '';
  if (/ouvrez?\s+l[’']article/.test(lower)) return '';
  if (/consultez?\s+(?:les?\s+)?détails/.test(lower)) return '';
  if (/détails publiés par la source/.test(lower)) return '';
  if (/résumé indisponible/.test(lower)) return '';
  return text;
}

function categoryEvidence(text, terms) {
  const haystack = ` ${normalizeText(text)} `;
  let score = 0;
  for (const term of terms) {
    const needle = normalizeText(term);
    if (needle && haystack.includes(needle)) score += 1;
  }
  return score;
}

function repairCategory(article = {}) {
  const current = cleanText(article.category || '');
  let best = { category: current || 'Société', score: 0, titleHits: 0 };
  for (const [category, terms] of CATEGORY_REPAIR_RULES) {
    const titleHits = categoryEvidence(article.title, terms);
    const summaryHits = categoryEvidence(`${article.summary || ''} ${article.detail || ''}`, terms);
    const score = titleHits * 6 + Math.min(summaryHits, 3);
    if (score > best.score) best = { category, score, titleHits };
  }
  // A strong signal in the headline outranks an incidental word in a summary.
  // This fixes cases such as a books selection incorrectly labelled Politique.
  if (best.titleHits > 0 && best.score >= 6) return best.category;
  return current || best.category || 'Société';
}

function normalizeArticle(article = {}) {
  const summary = cleanSummaryText(article.summary);
  const detail = cleanSummaryText(article.detail);
  const rawVisual = article.visual && typeof article.visual === 'object' ? article.visual : {};
  const visualUrl = cleanText(rawVisual.url || article.image || '');
  const visualStatus = cleanText(rawVisual.status || article.visualStatus || (visualUrl ? 'ready' : 'unavailable'));
  const normalized = {
    ...article,
    title: cleanText(article.title),
    summary,
    detail: detail || summary,
    source: cleanText(article.source),
    feedTitle: cleanText(article.feedTitle),
    category: cleanText(article.category),
    tags: Array.isArray(article.tags) ? article.tags.map(cleanText) : article.tags,
    sources: Array.isArray(article.sources) ? article.sources.map(cleanText) : article.sources,
    image: visualUrl,
    visualStatus,
    visual: {
      ...rawVisual,
      status: visualStatus,
      url: visualUrl,
      source: cleanText(rawVisual.source || article.visualSource || '')
    }
  };
  normalized.category = repairCategory(normalized);
  if (Array.isArray(normalized.tags)) {
    normalized.tags = [...new Set([normalized.category, ...normalized.tags.filter(tag => tag !== article.category)])].slice(0, 5);
  }
  return normalized;
}

function hash32(text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalArticleUrl(raw = '') {
  try {
    const url = new URL(String(raw || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch {
    return String(raw || '').trim();
  }
}

function fingerprintText(value = '') {
  return normalizeText(value);
}

function articleTitleKey(article = {}) {
  const title = fingerprintText(article.title);
  const source = fingerprintText(article.source || article.feedTitle);
  return title ? `${source}|${title}` : '';
}

function stableArticleId(article) {
  const key = `${canonicalArticleUrl(article?.url || '')}|${fingerprintText(article?.title || '')}`;
  return `a-${hash32(key, 2166136261)}${hash32(key, 0x9e3779b1)}`;
}

function readArticleHistory() {
  try {
    const cache = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(cache.articles)
      ? cache.articles.filter(article => String(article?.id || '').startsWith('a-')).map(normalizeArticle)
      : [];
  } catch {
    return [];
  }
}

function capSourceFlood(articles) {
  const result = [];
  const customPerSource = new Map();
  const allPerSource = new Map();
  let customTotal = 0;
  for (const article of articles) {
    const source = fingerprintText(article.source || article.feedTitle || 'source') || 'source';
    const current = Number(allPerSource.get(source) || 0);
    if (current >= 20) continue;
    if (article.customSource) {
      const customCount = Number(customPerSource.get(source) || 0);
      // An added feed is a discovery signal, not a subscription that floods
      // the home page. Keep a small sample; matching themes are found globally
      // through the discovery searches built below.
      if (customCount >= 4 || customTotal >= 10) continue;
      customPerSource.set(source, customCount + 1);
      customTotal += 1;
    }
    allPerSource.set(source, current + 1);
    result.push(article);
  }
  return result;
}

function mergeArticleHistory(fresh) {
  const merged = [];
  const seenUrls = new Set();
  const recentTitles = new Map();
  const articlesByUrl = new Map();
  const articlesByTitle = new Map();
  const MAX_SAME_TITLE_AGE = 48 * 60 * 60 * 1000;

  const keepPreparedVisual = (target, candidate) => {
    if (!target || !candidate) return;
    const targetReady = target.visual?.status === 'ready' && target.visual?.url;
    const candidateReady = candidate.visual?.status === 'ready' && candidate.visual?.url;
    if (!targetReady && candidateReady) {
      target.image = candidate.visual.url;
      target.visualStatus = 'ready';
      target.visual = { ...candidate.visual };
    }
  };

  for (const rawArticle of [...fresh, ...readArticleHistory()]) {
    const article = normalizeArticle(rawArticle);
    if (!article?.id) continue;

    const urlKey = canonicalArticleUrl(article.url);
    if (urlKey && seenUrls.has(urlKey)) {
      keepPreparedVisual(articlesByUrl.get(urlKey), article);
      continue;
    }

    const titleKey = articleTitleKey(article);
    const published = Date.parse(article.publishedAt || 0);
    const previousPublished = titleKey ? recentTitles.get(titleKey) : null;
    if (titleKey && Number.isFinite(published) && Number.isFinite(previousPublished) && Math.abs(published - previousPublished) <= MAX_SAME_TITLE_AGE) {
      keepPreparedVisual(articlesByTitle.get(titleKey), article);
      continue;
    }

    merged.push(article);
    if (urlKey) { seenUrls.add(urlKey); articlesByUrl.set(urlKey, article); }
    if (titleKey && Number.isFinite(published)) { recentTitles.set(titleKey, published); articlesByTitle.set(titleKey, article); }
  }

  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const recent = merged
    .filter(article => !article.publishedAt || Date.parse(article.publishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  return capSourceFlood(recent).slice(0, 600);
}

function positiveLearnedTopics() {
  try {
    const preferences = JSON.parse(localStorage.getItem('news-topic-preferences-v1') || '{}');
    return Object.entries(preferences)
      .filter(([, value]) => Number(value) > 0)
      .map(([topic]) => cleanText(topic))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function discoveryQuery(topic) {
  const clean = cleanText(topic);
  return DISCOVERY_QUERIES[clean] || clean;
}

function buildDiscoveryKeywords(keywords, preferredCategories) {
  const explicit = keywords.map(cleanText).filter(Boolean);
  const learned = positiveLearnedTopics().map(discoveryQuery);
  const interests = preferredCategories.map(discoveryQuery);
  // Explicit keywords and + feedback are strongest. The server creates Google
  // News searches from the first entries, so put those before default themes.
  return [...new Set([...explicit, ...learned, ...interests].filter(value => value.length >= 2))].slice(0, 8);
}

export async function fetchLiveNews({ sources = [], keywords = [], preferredCategories = [], webSearch = true, sourcePriority = true } = {}) {
  const interests = [...new Set(preferredCategories.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const discoveryKeywords = webSearch ? buildDiscoveryKeywords(keywords, interests) : keywords.map(cleanText).filter(Boolean);
  // Added sources are deliberately never given a blanket ranking bonus. They
  // contribute candidate stories, while interests/+ feedback drive searches
  // across Google Actualités and therefore across many publishers.
  const effectiveSourcePriority = false;
  const useSharedCatalogue = !sources.length && !discoveryKeywords.length && webSearch;
  const endpoint = useSharedCatalogue
    ? `/api/news?interests=${encodeURIComponent(interests.join(','))}&fresh=${Date.now()}`
    : '/api/news';
  const response = await fetch(endpoint, useSharedCatalogue ? {
    method: 'GET',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    body: JSON.stringify({
      sources,
      keywords: discoveryKeywords,
      preferredCategories: interests,
      webSearch,
      sourcePriority: effectiveSourcePriority
    })
  });
  if (!response.ok) throw new Error(`Synchronisation impossible (${response.status})`);
  const payload = await response.json();
  if (Array.isArray(payload.articles)) {
    const fresh = capSourceFlood(payload.articles.map(rawArticle => {
      const article = normalizeArticle(rawArticle);
      return { ...article, id: stableArticleId(article) };
    }));
    payload.articles = mergeArticleHistory(fresh);
    payload.discoveryTopics = discoveryKeywords;
  }
  return payload;
}
