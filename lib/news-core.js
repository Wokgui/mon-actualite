const dns = require('node:dns').promises;
const net = require('node:net');
const { createHash } = require('node:crypto');
const { classifyArticleDetailed } = require('../lib/news-category');

const MAX_CUSTOM_SOURCES = 12;
const MAX_KEYWORDS = 8;
const MAX_FEEDS = 24;
const MAX_XML_BYTES = 1_500_000;
const MAX_VISUAL_HTML_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 8000;
const VISUAL_TIMEOUT_MS = 5000;
const PREWARM_LIMIT = 16;
const PREWARM_CONCURRENCY = 4;
const PREWARM_TIMEOUT_MS = 6000;
const GOOGLE_NEWS_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

const NEWS_LOCALES = {
  fr: { language: 'fr', locale: 'fr-FR', country: 'FR', countryName: 'France' },
  en: { language: 'en', locale: 'en-GB', country: 'GB', countryName: 'United Kingdom' },
  de: { language: 'de', locale: 'de-DE', country: 'DE', countryName: 'Deutschland' },
  es: { language: 'es', locale: 'es-ES', country: 'ES', countryName: 'España' },
  it: { language: 'it', locale: 'it-IT', country: 'IT', countryName: 'Italia' },
  pt: { language: 'pt', locale: 'pt-PT', country: 'PT', countryName: 'Portugal' },
  nl: { language: 'nl', locale: 'nl-NL', country: 'NL', countryName: 'Nederland' },
  pl: { language: 'pl', locale: 'pl-PL', country: 'PL', countryName: 'Polska' },
  ro: { language: 'ro', locale: 'ro-RO', country: 'RO', countryName: 'România' },
  sv: { language: 'sv', locale: 'sv-SE', country: 'SE', countryName: 'Sverige' },
  no: { language: 'no', locale: 'nb-NO', country: 'NO', countryName: 'Norge' },
  da: { language: 'da', locale: 'da-DK', country: 'DK', countryName: 'Danmark' },
  fi: { language: 'fi', locale: 'fi-FI', country: 'FI', countryName: 'Suomi' },
  cs: { language: 'cs', locale: 'cs-CZ', country: 'CZ', countryName: 'Česko' },
  el: { language: 'el', locale: 'el-GR', country: 'GR', countryName: 'Ελλάδα' },
  tr: { language: 'tr', locale: 'tr-TR', country: 'TR', countryName: 'Türkiye' },
  uk: { language: 'uk', locale: 'uk-UA', country: 'UA', countryName: 'Україна' },
  ja: { language: 'ja', locale: 'ja-JP', country: 'JP', countryName: '日本' },
  ko: { language: 'ko', locale: 'ko-KR', country: 'KR', countryName: '대한민국' },
  hi: { language: 'hi', locale: 'hi-IN', country: 'IN', countryName: 'भारत' },
  id: { language: 'id', locale: 'id-ID', country: 'ID', countryName: 'Indonesia' }
};

function resolveNewsLocale(req, body = {}) {
  const requested = String(body.language || req.query?.language || '').toLowerCase().split('-')[0];
  const preset = NEWS_LOCALES[requested] || NEWS_LOCALES.fr;
  return { ...preset };
}

function googleNewsUrl(path, newsLocale) {
  const locale = newsLocale || NEWS_LOCALES.fr;
  const params = new URLSearchParams({ hl: locale.language, gl: locale.country, ceid: `${locale.country}:${locale.language}` });
  return `https://news.google.com/rss${path}?${params}`;
}

function defaultFeeds(newsLocale) {
  const countryName = newsLocale.countryName;
  return [
    { title: 'Google Actualités', url: googleNewsUrl('', newsLocale), category: '' },
    { title: 'International', url: googleNewsUrl('/headlines/section/topic/WORLD', newsLocale), category: 'International', strictCategory: true },
    { title: 'Économie', url: googleNewsUrl('/headlines/section/topic/BUSINESS', newsLocale), category: 'Économie', strictCategory: true },
    { title: 'Science', url: googleNewsUrl('/headlines/section/topic/SCIENCE', newsLocale), category: 'Science', strictCategory: true },
    { title: 'Santé', url: googleNewsUrl('/headlines/section/topic/HEALTH', newsLocale), category: 'Santé', strictCategory: true },
    { title: 'Tech', url: googleNewsUrl('/headlines/section/topic/TECHNOLOGY', newsLocale), category: 'Tech', strictCategory: true },
    { title: `Politique ${countryName}`, url: googleSearchUrl(`politique ${countryName}`, newsLocale), category: 'Politique' },
    { title: 'Europe', url: googleSearchUrl('Europe', newsLocale), category: 'Europe' },
    { title: 'Culture', url: googleSearchUrl(`culture cinéma musique livres ${countryName}`, newsLocale), category: 'Culture' },
    { title: 'Éducation', url: googleSearchUrl(`éducation école université ${countryName}`, newsLocale), category: 'Éducation' },
    { title: 'Environnement', url: googleSearchUrl('environnement climat biodiversité énergie', newsLocale), category: 'Environnement' }
  ];
}

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

function googleSearchUrl(query, newsLocale = NEWS_LOCALES.fr) {
  const timed = /\bwhen:\d+[dhmy]\b/i.test(query) ? query : `${query} when:31d`;
  const params = new URLSearchParams({ q: timed, hl: newsLocale.language, gl: newsLocale.country, ceid: `${newsLocale.country}:${newsLocale.language}` });
  return `https://news.google.com/rss/search?${params}`;
}

function sendJson(res, status, payload, { shared = false } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (shared && status === 200) {
    // The browser always revalidates, while Vercel serves the common catalogue
    // from its regional CDN and refreshes an expired copy in the background.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
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

function googleVisualPageUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'news.google.com') return '';
    url.pathname = url.pathname.replace(/^\/rss(?=\/|$)/, '') || '/';
    url.searchParams.delete('oc');
    if (!url.searchParams.has('hl')) url.searchParams.set('hl', 'fr');
    if (!url.searchParams.has('gl')) url.searchParams.set('gl', 'FR');
    if (!url.searchParams.has('ceid')) url.searchParams.set('ceid', 'FR:fr');
    url.searchParams.set('ucbcb', '1');
    return url.href;
  } catch {
    return '';
  }
}

function visualTitleWords(value = '') {
  const stop = new Set(['avec', 'dans', 'pour', 'plus', 'apres', 'avant', 'cette', 'sont', 'etre', 'leur', 'leurs', 'tout', 'mais', 'sans', 'vers', 'entre', 'une', 'des', 'les', 'sur', 'qui', 'que', 'aux']);
  return [...new Set(stripHtml(String(value || ''))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function visualTitleAgreement(candidate = '', expected = '') {
  const wanted = visualTitleWords(expected);
  const found = new Set(visualTitleWords(candidate));
  if (!wanted.length || !found.size) return { score: 0, hits: 0 };
  const hits = wanted.filter(word => found.has(word)).length;
  return { score: hits / Math.max(wanted.length, found.size), hits };
}

function stableServerArticleId(item = {}) {
  const key = `${String(item.url || '')}|${String(item.title || '')}`;
  return `a-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function parseGoogleVisuals(html = '', pageUrl = '') {
  const titlePattern = /<a\b[^>]*class=["'][^"']*\bJtKRv\b[^"']*["'][^>]*>([\s\S]{1,2200}?)<\/a>/gi;
  const matches = [...html.matchAll(titlePattern)];
  const visuals = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = stripHtml(match[1]);
    if (!title) continue;
    const previous = matches[index - 1]?.index;
    const next = matches[index + 1]?.index;
    const start = previous == null ? Math.max(0, match.index - 12_000) : Math.floor((previous + match.index) / 2);
    const end = next == null ? Math.min(html.length, match.index + 12_000) : Math.floor((match.index + next) / 2);
    const resultHtml = html.slice(start, end);
    const attachments = [...resultHtml.matchAll(/\/api\/attachments\/[^"'\s,]+/g)].map(item => decodeEntities(item[0]));
    if (!attachments.length) continue;
    const raw = attachments.find(value => /-w400-h224-/i.test(value)) || attachments[attachments.length - 1];
    const normalized = raw.replace(/-w\d+-h\d+-p-df(?:-rw)?$/i, '-w400-h224-p-df');
    try {
      visuals.push({
        title,
        url: new URL(normalized, pageUrl).href,
        width: 400,
        height: 224,
        contentType: 'image/jpeg'
      });
    } catch {}
  }
  return visuals;
}

function findGoogleVisual(title, visuals) {
  let best = null;
  for (const visual of visuals) {
    const agreement = visualTitleAgreement(visual.title, title);
    const minimumHits = Math.min(4, visualTitleWords(title).length);
    if (agreement.score < 0.72 || agreement.hits < minimumHits) continue;
    if (!best || agreement.score > best.score) best = { ...visual, score: agreement.score };
  }
  return best;
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
  const candidates = [
    attrTag(block, 'media:content', 'url'),
    attrTag(block, 'media:thumbnail', 'url'),
    attrTag(block, 'enclosure', 'url'),
    ((description || '').match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || ''
  ];
  for (const raw of candidates) {
    const value = decodeEntities(String(raw || '')).trim();
    if (!/^https?:\/\//i.test(value)) continue;
    try {
      const url = new URL(value);
      const haystack = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
      if (url.pathname === '/' && !url.search) continue;
      if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews)/i.test(haystack)) continue;
      if (url.hostname === 'news.google.com' || url.hostname.endsWith('.gstatic.com')) continue;
      return url.href;
    } catch {}
  }
  return '';
}

function sourceName(block, fallback) {
  const raw = tag(block, ['source', 'dc:creator', 'author']);
  const cleaned = stripHtml(raw).replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
  return cleaned || fallback || 'Source';
}

function parseFeed(xml, feed) {
  const rssItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const atomItems = rssItems.length ? [] : (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []);
  const blocks = [...rssItems, ...atomItems].slice(0, 60);

  return blocks.map((block, index) => {
    const rawTitle = stripHtml(tag(block, ['title']));
    if (!rawTitle) return null;
    let url = stripHtml(tag(block, ['link']));
    if (!/^https?:\/\//i.test(url)) url = attrTag(block, 'link', 'href');
    if (!/^https?:\/\//i.test(url)) url = stripHtml(tag(block, ['guid', 'id']));
    const rawDescription = tag(block, ['description', 'summary', 'content:encoded', 'content']);
    const rawFullContent = tag(block, ['content:encoded', 'content']);
    const summary = stripHtml(rawDescription).slice(0, 650);
    const fullText = feed.isCustom ? stripHtml(rawFullContent).slice(0, 14000) : '';
    const contentText = fullText.length >= Math.max(900, summary.length + 250) ? fullText : '';
    const publishedRaw = stripHtml(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const publishedAt = safeDate(publishedRaw);
    return {
      id: `${feed.title}-${index}-${publishedAt || ''}-${rawTitle}`,
      title: rawTitle,
      url,
      summary,
      detail: summary,
      contentText,
      publishedAt,
      source: sourceName(block, feed.title),
      feedTitle: feed.title,
      feedUrl: feed.url,
      categoryHint: feed.category || '',
      strictCategory: Boolean(feed.strictCategory),
      image: firstImage(block, rawDescription),
      visualStatus: 'pending',
      visualSource: ''
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
  return classifyArticleDetailed(item, keywords);
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
    if ((!existing.image || existing.visualStatus !== 'ready') && item.image && item.visualStatus === 'ready') {
      existing.image = item.image;
      existing.visualStatus = 'ready';
      existing.visualSource = item.visualSource;
      existing.visualWidth = item.visualWidth;
      existing.visualHeight = item.visualHeight;
      existing.visualContentType = item.visualContentType;
    }
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

async function safeFetchVisualPage(rawUrl) {
  const url = await assertPublicUrl(rawUrl);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(VISUAL_TIMEOUT_MS),
    headers: {
      'User-Agent': GOOGLE_NEWS_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`Visuels HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_VISUAL_HTML_BYTES) throw new Error('Page de visuels trop volumineuse');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > MAX_VISUAL_HTML_BYTES) throw new Error('Page de visuels trop volumineuse');
  return buffer.toString('utf8');
}

function googleVisualProxyUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'news.google.com' || !url.pathname.startsWith('/api/attachments/')) return '';
    return `/api/article-thumbnail?${new URLSearchParams({ v: '18', image: url.href, exact: '1' })}`;
  } catch {
    return '';
  }
}

function prepareGoogleVisuals(items) {
  for (const item of items) {
    if (item.visualSource !== 'google-news' || !item.image) continue;
    const proxy = googleVisualProxyUrl(item.image);
    if (proxy) {
      // Keep the exact attachment found while reading the feed page and let
      // our cached same-origin endpoint fetch it only when the card is near
      // the viewport. Resolving every attachment here produced bursts of up
      // to 90 Google requests and made later Parisien images hit HTTP 429.
      item.image = proxy;
      item.visualSource = 'google-news-proxy';
      item.visualStatus = 'ready';
    } else {
      item.image = '';
      item.visualStatus = 'unavailable';
      item.visualSource = '';
    }
  }
  return items;
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

function requestOrigin(req) {
  const rawHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  if (!rawHost || !/^[a-z0-9.-]+(?::\d+)?$/i.test(rawHost)) return '';
  const rawProto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim().toLowerCase();
  const protocol = rawProto === 'http' ? 'http' : 'https';
  return `${protocol}://${rawHost}`;
}

function unwrapPreparedVisual(raw = '', origin = '') {
  if (!raw || !origin) return '';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return ['http:', 'https:'].includes(url.protocol) ? url.href : '';

    if (['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) {
      const nested = String(url.searchParams.get('image') || '').trim();
      if (/^https?:\/\//i.test(nested)) return nested.slice(0, 1900);
      return '';
    }
    if (url.pathname === '/api/image-proxy') {
      const nested = String(url.searchParams.get('url') || '').trim();
      if (/^https?:\/\//i.test(nested)) return nested.slice(0, 1900);
    }
  } catch {}
  return '';
}

function prewarmPhotoUrl(origin, article = {}) {
  if (!origin || !article?.title) return '';
  const suppliedImage = unwrapPreparedVisual(article.visual?.url || article.image || '', origin);
  const params = new URLSearchParams({
    v: '74',
    url: String(article.url || '').slice(0, 1900),
    image: suppliedImage.slice(0, 1900),
    title: String(article.title || '').slice(0, 280),
    category: String(article.category || '').slice(0, 70),
    source: String(article.source || '').slice(0, 100)
  });
  return `${origin}/api/article-photo-fast?${params}`;
}

async function warmPhoto(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
      headers: {
        'User-Agent': 'MonActualite-ImagePrewarm/1.0',
        'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.6'
      }
    });
    if (!response.ok) return false;
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/') || type.includes('svg')) return false;
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function prewarmTopArticleImages(req, articles) {
  const origin = requestOrigin(req);
  if (!origin || !Array.isArray(articles) || !articles.length) return 0;
  const urls = [...new Set(articles.slice(0, PREWARM_LIMIT).map(article => prewarmPhotoUrl(origin, article)).filter(Boolean))];
  let cursor = 0;
  let warmed = 0;

  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      if (await warmPhoto(urls[index])) warmed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(PREWARM_CONCURRENCY, urls.length) }, () => worker()));
  if (warmed) console.log(`image prewarm: ${warmed}/${urls.length}`);
  return warmed;
}

async function scheduleImagePrewarm(req, articles) {
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(prewarmTopArticleImages(req, articles).catch(error => {
      console.warn('image prewarm unavailable:', String(error?.message || error).slice(0, 120));
    }));
    return Math.min(PREWARM_LIMIT, Array.isArray(articles) ? articles.length : 0);
  } catch (error) {
    console.warn('waitUntil unavailable:', String(error?.message || error).slice(0, 120));
    return 0;
  }
}

module.exports = async function handler(req, res) {
  const sharedRequest = req.method === 'GET';
  if (!sharedRequest && req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });

  const queryInterests = String(req.query?.interests || '')
    .split(',').map(value => value.trim()).filter(Boolean).slice(0, 30);
  const body = sharedRequest
    ? { sources: [], keywords: [], preferredCategories: queryInterests, webSearch: true, sourcePriority: true }
    : req.body && typeof req.body === 'object' ? req.body : {};
  const newsLocale = resolveNewsLocale(req, body);
  const customSources = sanitizeSources(body.sources);
  const keywords = sanitizeKeywords(body.keywords);
  const preferredCategories = Array.isArray(body.preferredCategories) ? body.preferredCategories.map(String).slice(0, 30) : [];
  const webSearch = body.webSearch !== false;
  const sourcePriority = body.sourcePriority !== false;
  const historyDays = Math.max(31, Math.min(62, Number(body.historyDays) || 31));

  const keywordFeeds = webSearch ? keywords.slice(0, 6).map(keyword => ({ title: `Recherche · ${keyword}`, url: googleSearchUrl(keyword, newsLocale), category: '', keywordSearch: keyword })) : [];
  const feeds = [...defaultFeeds(newsLocale), ...customSources, ...keywordFeeds].slice(0, MAX_FEEDS);
  const errors = [];

  const settled = await Promise.allSettled(feeds.map(async feed => {
    const pageUrl = googleVisualPageUrl(feed.url);
    const [xml, visualResult] = await Promise.all([
      safeFetchText(feed.url),
      pageUrl
        ? safeFetchVisualPage(pageUrl).then(html => ({ html, error: '' })).catch(error => ({ html: '', error: String(error?.message || error).slice(0, 100) }))
        : Promise.resolve({ html: '', error: '' })
    ]);
    const visuals = visualResult.html ? parseGoogleVisuals(visualResult.html, pageUrl) : [];
    const items = parseFeed(xml, feed).map(item => {
      const supplied = item.image ? { url: item.image, width: 0, height: 0, contentType: '' } : null;
      const prepared = supplied || findGoogleVisual(item.title, visuals);
      return {
        ...item,
        isCustomSource: Boolean(feed.isCustom),
        keywordSearch: feed.keywordSearch || '',
        image: prepared?.url || '',
        visualStatus: prepared?.url ? 'ready' : 'unavailable',
        visualSource: supplied ? 'rss' : prepared ? 'google-news' : '',
        visualWidth: Number(prepared?.width || 0),
        visualHeight: Number(prepared?.height || 0),
        visualContentType: prepared?.contentType || ''
      };
    });
    return { items, pageUrl, visualCount: visuals.length, visualError: visualResult.error };
  }));

  const rawItems = [];
  let visualPagesSucceeded = 0;
  let visualPagesFailed = 0;
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      rawItems.push(...result.value.items);
      if (result.value.pageUrl && result.value.visualCount) visualPagesSucceeded += 1;
      else if (result.value.pageUrl && result.value.visualError) visualPagesFailed += 1;
    }
    else errors.push({ source: feeds[index].title, message: String(result.reason?.message || 'Échec de lecture').slice(0, 120) });
  });

  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const enriched = rawItems
    .filter(item => Date.parse(item.publishedAt) >= cutoff)
    .map(item => {
      const classification = classify(item, keywords);
      const category = classification.category;
      const matches = keywordMatches(item, keywords);
      const score = rank({ ...item, category }, preferredCategories, keywords, sourcePriority);
      return {
        ...item,
        category,
        categoryConfidence: Number(classification.confidence || 0),
        categoryConfidenceLevel: classification.confidenceLevel || 'low',
        categoryConfidenceMargin: Number(classification.margin || 0),
        categoryReason: classification.reason || '',
        categoryAlternatives: Array.isArray(classification.alternatives) ? classification.alternatives : [],
        matches,
        score
      };
    });

  const deduplicated = mergeDuplicates(enriched);
  const ranked = deduplicated
    .slice()
    .sort((a, b) => (b.score - a.score) || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)));

  const selected = [];
  const selectedKeys = new Set();
  const addSelected = article => {
    if (!article) return;
    const key = `${article.url || ''}|${article.title || ''}|${article.publishedAt || ''}`;
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push(article);
  };

  ranked.slice(0, 160).forEach(addSelected);

  const perDay = new Map();
  for (const article of ranked) {
    const time = Date.parse(article.publishedAt || '');
    if (!Number.isFinite(time)) continue;
    const date = new Date(time);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!perDay.has(key)) perDay.set(key, []);
    const bucket = perDay.get(key);
    if (bucket.length < 12) bucket.push(article);
  }
  [...perDay.keys()].sort((a, b) => b.localeCompare(a)).forEach(key => {
    perDay.get(key).forEach(addSelected);
  });
  selected.splice(700);
  prepareGoogleVisuals(selected);

  const articles = selected.map(item => ({
      id: stableServerArticleId(item),
      title: item.title,
      url: item.url,
      summary: item.summary || 'Ouvrez l’article pour consulter les détails publiés par la source.',
      detail: item.detail || item.summary || '',
      publishedAt: item.publishedAt,
      source: item.source,
      sources: item.sources || [item.source],
      category: item.category,
      categoryConfidence: Number(item.categoryConfidence || 0),
      categoryConfidenceLevel: item.categoryConfidenceLevel || 'low',
      categoryConfidenceMargin: Number(item.categoryConfidenceMargin || 0),
      categoryReason: item.categoryReason || '',
      categoryAlternatives: Array.isArray(item.categoryAlternatives) ? item.categoryAlternatives.slice(0, 2) : [],
      image: item.image || '',
      visual: {
        status: item.visualStatus === 'ready' && item.image ? 'ready' : 'unavailable',
        url: item.image || '',
        width: Number(item.visualWidth || 0),
        height: Number(item.visualHeight || 0),
        contentType: item.visualContentType || '',
        source: item.visualSource || ''
      },
      visualStatus: item.visualStatus === 'ready' && item.image ? 'ready' : 'unavailable',
      score: Math.round(item.score),
      tags: [...new Set([item.category, ...item.matches])].slice(0, 5),
      customSource: Boolean(item.isCustomSource)
    }));

  const prewarmScheduled = await scheduleImagePrewarm(req, articles);

  return sendJson(res, 200, {
    fetchedAt: new Date().toISOString(),
    articles,
    stats: {
      feedsRequested: feeds.length,
      feedsSucceeded: settled.filter(result => result.status === 'fulfilled').length,
      rawItems: rawItems.length,
      deduplicatedItems: articles.length,
      visualsReady: articles.filter(article => article.visualStatus === 'ready').length,
      visualsUnavailable: articles.filter(article => article.visualStatus !== 'ready').length,
      visualPagesSucceeded,
      visualPagesFailed,
      prewarmScheduled
    },
    errors: errors.slice(0, 10)
  }, { shared: sharedRequest });
};
