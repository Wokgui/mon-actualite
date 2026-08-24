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

function normalizeArticle(article = {}) {
  const summary = cleanSummaryText(article.summary);
  const detail = cleanSummaryText(article.detail);
  const rawVisual = article.visual && typeof article.visual === 'object' ? article.visual : {};
  const visualUrl = cleanText(rawVisual.url || article.image || '');
  const visualStatus = cleanText(rawVisual.status || article.visualStatus || (visualUrl ? 'ready' : 'unavailable'));
  return {
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
  return cleanText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  return merged
    .filter(article => !article.publishedAt || Date.parse(article.publishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
    .slice(0, 400);
}

export async function fetchLiveNews({ sources = [], keywords = [], preferredCategories = [], webSearch = true, sourcePriority = true } = {}) {
  const useSharedCatalogue = !sources.length && !keywords.length && webSearch && sourcePriority;
  const interests = [...new Set(preferredCategories.map(cleanText).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const endpoint = useSharedCatalogue
    ? `/api/news?interests=${encodeURIComponent(interests.join(','))}`
    : '/api/news';
  const response = await fetch(endpoint, useSharedCatalogue ? {
    method: 'GET',
    cache: 'default'
  } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ sources, keywords, preferredCategories, webSearch, sourcePriority })
  });
  if (!response.ok) throw new Error(`Synchronisation impossible (${response.status})`);
  const payload = await response.json();
  if (Array.isArray(payload.articles)) {
    const fresh = payload.articles.map(rawArticle => {
      const article = normalizeArticle(rawArticle);
      return { ...article, id: stableArticleId(article) };
    });
    payload.articles = mergeArticleHistory(fresh);
  }
  return payload;
}
