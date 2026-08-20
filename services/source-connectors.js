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
    category: node.parentElement?.getAttribute('text') || '',
    enabled: true
  }));

  return { feeds, importedAt: new Date().toISOString() };
}

export async function fetchLiveNews({ sources = [], keywords = [], preferredCategories = [], webSearch = true, sourcePriority = true } = {}) {
  const response = await fetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ sources, keywords, preferredCategories, webSearch, sourcePriority })
  });
  if (!response.ok) throw new Error(`Synchronisation impossible (${response.status})`);
  return response.json();
}
