const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_CUSTOM_SOURCES = 12;
const MAX_KEYWORDS = 8;
const MAX_FEEDS = 24;
const MAX_XML_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 8000;

const DEFAULT_FEEDS = [
  { title: 'Google Actualités', url: 'https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr', category: '' },
  { title: 'International', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr', category: 'International' },
  { title: 'Économie', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr&gl=FR&ceid=FR:fr', category: 'Économie' },
  { title: 'Science', url: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=fr&gl=FR&ceid=FR:fr', category: 'Science' },
  { title: 'Santé', url: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=fr&gl=FR&ceid=FR:fr', category: 'Santé' },
  { title: 'Tech', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=fr&gl=FR&ceid=FR:fr', category: 'Tech' },
  { title: 'Politique France', url: googleSearchUrl('politique France'), category: 'Politique' },
  { title: 'Europe', url: googleSearchUrl('Union européenne Europe'), category: 'Europe' },
  { title: 'Culture', url: googleSearchUrl('culture cinéma musique livres France'), category: 'Culture' },
  { title: 'Éducation', url: googleSearchUrl('éducation école université France'), category: 'Éducation' },
  { title: 'Environnement', url: googleSearchUrl('environnement climat biodiversité énergie'), category: 'Environnement' }
];

const CATEGORY_RULES = [
  ['IA', ['intelligence artificielle', ' ia ', 'openai', 'chatgpt', 'anthropic', 'gemini', 'llm', 'modèle de langage', 'agent ia']],
  ['VR', ['réalité virtuelle', 'casque vr', 'quest 3', 'quest 4', 'steamvr', 'pcvr', 'virtual reality', 'mixed reality', 'réalité mixte']],
  ['Smartphones', ['smartphone', 'android', 'iphone', 'galaxy s', 'pixel ', 'oppo ', 'xiaomi ', 'oneplus', 'téléphone mobile']],
  ['Automobile', ['voiture', 'automobile', 'véhicule électrique', 'tesla', 'renault', 'peugeot', 'bmw', 'mercedes', 'audi', 'porsche', 'suv', 'batterie automobile']],
  ['Énergie', ['énergie', 'électricité', 'nucléaire', 'solaire', 'éolien', 'batterie stationnaire', 'hydrogène', 'gaz naturel']],
  ['Politique', ['politique', 'gouvernement', 'assemblée nationale', 'sénat', 'élysée', 'ministre', 'élection', 'président', 'matignon']],
  ['Économie', ['économie', 'inflation', 'croissance', 'bce', 'banque centrale', 'taux directeur', 'bourse', 'marché financier', 'emploi', 'chômage', 'entreprise']],
  ['International', ['guerre', 'ukraine', 'russie', 'chine', 'états-unis', 'gaza', 'israël', 'iran', 'otan', 'onu', 'international']],
  ['Europe', ['union européenne', 'commission européenne', 'parlement européen', 'bruxelles', 'europe']],
  ['Santé', ['santé', 'médecine', 'hôpital', 'maladie', 'vaccin', 'cancer', 'traitement', 'épidémie', 'médicament']],
  ['Environnement', ['climat', 'environnement', 'biodiversité', 'pollution', 'réchauffement', 'écologie']],
  ['Science', ['science', 'chercheur', 'recherche', 'espace', 'astronomie', 'physique', 'biologie', 'archéologie', 'nasa', 'esa']],
  ['Culture', ['culture', 'cinéma', 'film', 'série', 'musique', 'livre', 'littérature', 'musée', 'artiste']],
  ['Éducation', ['éducation', 'école', 'collège', 'lycée', 'université', 'enseignant', 'élève', 'étudiant']],
  ['Société', ['société', 'justice', 'police', 'logement', 'transport', 'démographie', 'famille']],
  ['Tech', ['technologie', 'tech', 'informatique', 'logiciel', 'windows', 'linux', 'cybersécurité', 'ordinateur', 'semi-conducteur', 'puce']]
];

function googleSearchUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function decodeEntities(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value = '') {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return match[1].trim();
  }
  return '';
}

function attrTag(block, name, attr) {
  const match = block.match(new RegExp(`<${name}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? match[1].trim() : '';
}

function firstImage(block, description) {
  return attrTag(block, 'media:content', 'url') || attrTag(block, 'media:thumbnail', 'url') || attrTag(block, 'enclosure', 'url') || ((description || '').match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';
}

function sourceName(block, fallback) {
  const raw = tag(block, ['source', 'dc:creator', 'author']);
  const cleaned = stripHtml(raw).replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
  return cleaned || fallback || 'Source';
}

function parseFeed(xml, feed) {
  const rssItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const atomItems = rssItems.length ? [] : (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []);
  const blocks = [...rssItems, ...atomItems].slice(0, 35);

  return blocks.map((block, index) => {
    const rawTitle = stripHtml(tag(block, ['title']));
    if (!rawTitle) return null;
    let url = stripHtml(tag(block, ['link']));
    if (!/^https?:\/\//i.test(url)) url = attrTag(block, 'link', 'href');
    if (!/^https?:\/\//i.test(url)) url = stripHtml(tag(block, ['guid', 'id']));
    const rawDescription = tag(block, ['description', 'summary', 'content:encoded', 'content']);
    const summary = stripHtml(rawDescription).slice(0, 650);
    const publishedRaw = stripHtml(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const publishedAt = safeDate(publishedRaw);
    return {
      id: `${feed.title}-${index}-${publishedAt || ''}-${rawTitle}`,
      title: rawTitle,
      url,
      summary,
      detail: summary,
      publishedAt,
      source: sourceName(block, feed.title),
      feedTitle: feed.title,
      categoryHint: feed.category || '',
      image: firstImage(block, rawDescription)
    };
  }).filter(item => item && item.url);
}

function safeDate(raw) {
  const parsed = Date.parse(raw || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokenize(value = '') {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !['avec', 'dans', 'pour', 'plus', 'apres', 'avant', 'cette', 'sont', 'etre', 'leur', 'leurs', 'tout', 'mais', 'sans', 'vers', 'entre'].includes(word));
}

function similarity(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size || !sb.size) return 0;
  let intersection = 0;
  for (const token of sa) if (sb.has(token)) intersection++;
  return intersection / Math.min(sa.size, sb.size);
}

function classify(item, keywords) {
  if (item.categoryHint) return item.categoryHint;
  const haystack = ` ${normalizeText(`${item.title} ${item.summary}`)} `;
  for (const [category, terms] of CATEGORY_RULES) {
    if (terms.some(term => haystack.includes(normalizeText(term)))) return category;
  }
  const matchingKeyword = keywords.find(keyword => haystack.includes(normalizeText(keyword)));
  return matchingKeyword ? 'À suivre' : 'Société';
}

function keywordMatches(item, keywords) {
  const haystack = normalizeText(`${item.title} ${item.summary}`);
  return keywords.filter(keyword => haystack.includes(normalizeText(keyword)));
}

function ageHours(dateString) {
  return Math.max(0, (Date.now() - Date.parse(dateString)) / 3_600_000);
}

function rank(item, preferredCategories, keywords, sourcePriority) {
  let score = 100 - Math.min(ageHours(item.publishedAt), 96);
  if (preferredCategories.includes(item.category)) score += 26;
  const matches = keywordMatches(item, keywords);
  score += matches.length * 28;
  if (sourcePriority && item.isCustomSource) score += 35;
  if (['Politique', 'International', 'Économie', 'Santé'].includes(item.category)) score += 6;
  return score;
}

function cleanTitle(title) {
  return title.replace(/\s+-\s+[^-]{2,45}$/u, '').trim();
}

function mergeDuplicates(items) {
  const merged = [];
  for (const item of items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const cleaned = cleanTitle(item.title);
    const existing = merged.find(candidate => similarity(cleaned, cleanTitle(candidate.title)) >= 0.8);
    if (!existing) {
      merged.push({ ...item, sources: [item.source] });
      continue;
    }
    existing.sources = [...new Set([...existing.sources, item.source])].slice(0, 5);
    if ((item.summary || '').length > (existing.summary || '').length) {
      existing.summary = item.summary;
      existing.detail = item.detail;
    }
    if (!existing.image && item.image) existing.image = item.image;
  }
  return merged;
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
  }
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized === '::';
  }
  return true;
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocole non autorisé');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('Adresse locale interdite');
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new Error('Adresse privée interdite');
  if (!net.isIP(hostname)) {
    const resolved = await dns.lookup(hostname, { all: true });
    if (!resolved.length || resolved.some(entry => isPrivateIp(entry.address))) throw new Error('Adresse non publique');
  }
  return url;
}

async function safeFetchText(rawUrl) {
  let current = rawUrl;
  for (let redirect = 0; redirect < 4; redirect++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'MonActualite/2.0 (+https://mon-actualite.vercel.app)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8' }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_XML_BYTES) throw new Error('Flux trop volumineux');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_XML_BYTES) throw new Error('Flux trop volumineux');
    return buffer.toString('utf8');
  }
  throw new Error('Trop de redirections');
}

function sanitizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, MAX_CUSTOM_SOURCES).map((source, index) => {
    const title = String(source?.title || `Source ${index + 1}`).trim().slice(0, 80);
    const url = String(source?.url || source?.xmlUrl || '').trim().slice(0, 600);
    const category = String(source?.category || '').trim().slice(0, 40);
    return { title, url, category, isCustom: true };
  }).filter(source => /^https?:\/\//i.test(source.url));
}

function sanitizeKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return [...new Set(keywords.map(value => String(value || '').trim()).filter(value => value.length >= 2 && value.length <= 70))].slice(0, MAX_KEYWORDS);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'mon-actualite-news', now: new Date().toISOString() });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const customSources = sanitizeSources(body.sources);
  const keywords = sanitizeKeywords(body.keywords);
  const preferredCategories = Array.isArray(body.preferredCategories) ? body.preferredCategories.map(String).slice(0, 30) : [];
  const webSearch = body.webSearch !== false;
  const sourcePriority = body.sourcePriority !== false;

  const keywordFeeds = webSearch ? keywords.slice(0, 6).map(keyword => ({ title: `Recherche · ${keyword}`, url: googleSearchUrl(keyword), category: '', keywordSearch: keyword })) : [];
  const feeds = [...DEFAULT_FEEDS, ...customSources, ...keywordFeeds].slice(0, MAX_FEEDS);
  const errors = [];

  const settled = await Promise.allSettled(feeds.map(async feed => {
    const xml = await safeFetchText(feed.url);
    return parseFeed(xml, feed).map(item => ({ ...item, isCustomSource: Boolean(feed.isCustom), keywordSearch: feed.keywordSearch || '' }));
  }));

  const rawItems = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') rawItems.push(...result.value);
    else errors.push({ source: feeds[index].title, message: String(result.reason?.message || 'Échec de lecture').slice(0, 120) });
  });

  const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const enriched = rawItems
    .filter(item => Date.parse(item.publishedAt) >= cutoff)
    .map(item => {
      const category = classify(item, keywords);
      const matches = keywordMatches(item, keywords);
      const score = rank({ ...item, category }, preferredCategories, keywords, sourcePriority);
      return { ...item, category, matches, score };
    });

  const articles = mergeDuplicates(enriched)
    .sort((a, b) => (b.score - a.score) || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)))
    .slice(0, 90)
    .map(item => ({
      id: Buffer.from(`${item.url}|${item.title}`).toString('base64url').slice(0, 48),
      title: item.title,
      url: item.url,
      summary: item.summary || 'Ouvrez l’article pour consulter les détails publiés par la source.',
      detail: item.detail || item.summary || '',
      publishedAt: item.publishedAt,
      source: item.source,
      sources: item.sources || [item.source],
      category: item.category,
      image: item.image || '',
      score: Math.round(item.score),
      tags: [...new Set([item.category, ...item.matches])].slice(0, 5),
      customSource: Boolean(item.isCustomSource)
    }));

  return sendJson(res, 200, {
    fetchedAt: new Date().toISOString(),
    articles,
    stats: { feedsRequested: feeds.length, feedsSucceeded: settled.filter(result => result.status === 'fulfilled').length, rawItems: rawItems.length, deduplicatedItems: articles.length },
    errors: errors.slice(0, 10)
  });
};
