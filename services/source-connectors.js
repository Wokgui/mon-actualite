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
    title: node.getAttribute('title') || node.getAttribute('text') || 'Source sans nom',
    url: node.getAttribute('xmlUrl'),
    htmlUrl: node.getAttribute('htmlUrl') || '',
    category: '',
    enabled: true
  }));

  return { feeds, importedAt: new Date().toISOString() };
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

function stableArticleId(article, index) {
  const key = `${article?.url || ''}|${article?.title || ''}|${article?.publishedAt || ''}|${index}`;
  return `a-${hash32(key, 2166136261)}${hash32(key, 0x9e3779b1)}`;
}

export async function fetchLiveNews({ sources = [], keywords = [], preferredCategories = [], webSearch = true, sourcePriority = true } = {}) {
  const response = await fetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ sources, keywords, preferredCategories, webSearch, sourcePriority })
  });
  if (!response.ok) throw new Error(`Synchronisation impossible (${response.status})`);
  const payload = await response.json();
  if (Array.isArray(payload.articles)) {
    payload.articles = payload.articles.map((article, index) => ({ ...article, id: stableArticleId(article, index) }));
  }
  return payload;
}