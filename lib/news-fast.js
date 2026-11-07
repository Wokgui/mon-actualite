'use strict';

const FAST_TIMEOUT_MS = 2200;
const ARTICLE_LIMIT = 120;
const MAX_FEEDS = 12;
const MAX_ITEMS_PER_FEED = 60;

const NEWS_LOCALES = {
  fr: { language: 'fr', country: 'FR' }, en: { language: 'en', country: 'GB' },
  de: { language: 'de', country: 'DE' }, es: { language: 'es', country: 'ES' },
  it: { language: 'it', country: 'IT' }, pt: { language: 'pt', country: 'PT' },
  nl: { language: 'nl', country: 'NL' }, pl: { language: 'pl', country: 'PL' },
  ro: { language: 'ro', country: 'RO' }, sv: { language: 'sv', country: 'SE' },
  no: { language: 'no', country: 'NO' }, da: { language: 'da', country: 'DK' },
  fi: { language: 'fi', country: 'FI' }, cs: { language: 'cs', country: 'CZ' },
  el: { language: 'el', country: 'GR' }, tr: { language: 'tr', country: 'TR' },
  uk: { language: 'uk', country: 'UA' }, ja: { language: 'ja', country: 'JP' },
  ko: { language: 'ko', country: 'KR' }, hi: { language: 'hi', country: 'IN' },
  id: { language: 'id', country: 'ID' }
};

function requestedLocale(req) {
  const language = String(req.query?.language || '').toLowerCase().split('-')[0];
  return NEWS_LOCALES[language] || NEWS_LOCALES.fr;
}

function googleSearchUrl(query, newsLocale = NEWS_LOCALES.fr) {
  const timed = /\bwhen:\d+[dhmy]\b/i.test(query) ? query : `${query} when:10d`;
  const params = new URLSearchParams({ q: timed, hl: newsLocale.language, gl: newsLocale.country, ceid: `${newsLocale.country}:${newsLocale.language}` });
  return `https://news.google.com/rss/search?${params}`;
}

function baseFeeds(newsLocale) {
  const params = new URLSearchParams({ hl: newsLocale.language, gl: newsLocale.country, ceid: `${newsLocale.country}:${newsLocale.language}` });
  const url = path => `https://news.google.com/rss${path}?${params}`;
  return [
    { title: 'Google Actualités', url: url(''), category: '' },
    { title: 'International', url: url('/headlines/section/topic/WORLD'), category: 'International' },
    { title: 'Économie', url: url('/headlines/section/topic/BUSINESS'), category: 'Économie' },
    { title: 'Science', url: url('/headlines/section/topic/SCIENCE'), category: 'Science' },
    { title: 'Santé', url: url('/headlines/section/topic/HEALTH'), category: 'Santé' },
    { title: 'Tech', url: url('/headlines/section/topic/TECHNOLOGY'), category: 'Tech' }
  ];
}

const INTEREST_QUERIES = {
  IA: 'intelligence artificielle OpenAI Anthropic Gemini',
  Tech: 'technologie informatique cybersécurité',
  Smartphones: 'smartphone Android iPhone Samsung Oppo Xiaomi',
  VR: 'réalité virtuelle VR Quest PCVR',
  Automobile: 'automobile voiture électrique mobilité',
  Énergie: 'énergie nucléaire solaire éolien hydrogène'
};

function decodeEntities(value = '') {
  return String(value)
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

function normalize(value = '') {
  return stripHtml(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeDate(raw = '') {
  const time = Date.parse(stripHtml(raw));
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function sourceName(block, fallback = 'Source') {
  const source = stripHtml(tag(block, ['source', 'dc:creator', 'author']));
  return source || fallback;
}

function inferCategory(title = '', summary = '') {
  const text = ` ${normalize(`${title} ${summary}`)} `;
  const rules = [
    ['IA', [' intelligence artificielle ', ' openai ', ' chatgpt ', ' anthropic ', ' gemini ']],
    ['VR', [' realite virtuelle ', ' casque vr ', ' quest ', ' pcvr ', ' steamvr ']],
    ['Smartphones', [' smartphone ', ' android ', ' iphone ', ' galaxy s', ' oppo ', ' xiaomi ']],
    ['Automobile', [' automobile ', ' voiture ', ' vehicule electrique ', ' tesla ', ' porsche ', ' bmw ', ' mercedes ', ' audi ']],
    ['Énergie', [' energie ', ' nucleaire ', ' solaire ', ' eolien ', ' hydrogene ']],
    ['Santé', [' sante ', ' medecin ', ' maladie ', ' vaccin ', ' cancer ', ' medicament ']],
    ['Science', [' science ', ' recherche ', ' chercheur ', ' nasa ', ' espace ', ' astronomie ']],
    ['Économie', [' economie ', ' inflation ', ' bourse ', ' emploi ', ' banque ', ' taux ']],
    ['International', [' ukraine ', ' russie ', ' chine ', ' etats unis ', ' israel ', ' iran ', ' guerre ']],
    ['Politique', [' gouvernement ', ' ministre ', ' election ', ' president ', ' assemblee nationale ']],
    ['Europe', [' union europeenne ', ' commission europeenne ', ' parlement europeen ', ' bruxelles ']],
    ['Environnement', [' climat ', ' biodiversite ', ' pollution ', ' environnement ']]
  ];
  let best = { category: 'Société', hits: 0 };
  for (const [category, terms] of rules) {
    const hits = terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
    if (hits > best.hits) best = { category, hits };
  }
  return best.category;
}

function parseFeed(xml, feed) {
  const rssItems = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const atomItems = rssItems.length ? [] : (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []);
  const blocks = [...rssItems, ...atomItems].slice(0, MAX_ITEMS_PER_FEED);
  const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;

  return blocks.map(block => {
    const title = stripHtml(tag(block, ['title']));
    if (!title) return null;
    let url = stripHtml(tag(block, ['link']));
    if (!/^https?:\/\//i.test(url)) url = attrTag(block, 'link', 'href');
    if (!/^https?:\/\//i.test(url)) url = stripHtml(tag(block, ['guid', 'id']));
    if (!/^https?:\/\//i.test(url)) return null;
    const publishedAt = safeDate(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    if (!publishedAt || Date.parse(publishedAt) < cutoff) return null;
    const summary = stripHtml(tag(block, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 650);
    return {
      title,
      url,
      summary,
      detail: summary,
      publishedAt,
      source: sourceName(block, feed.title),
      category: feed.category || inferCategory(title, summary),
      customSource: false,
      image: '',
      visualStatus: 'unavailable',
      visual: { status: 'unavailable', url: '', width: 0, height: 0, contentType: '', source: '' }
    };
  }).filter(Boolean);
}

function dedupe(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const result = [];
  for (const item of items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const urlKey = String(item.url || '').replace(/[?#].*$/, '');
    const titleKey = normalize(item.title).replace(/\s+/g, ' ').slice(0, 180);
    if ((urlKey && seenUrls.has(urlKey)) || (titleKey && seenTitles.has(titleKey))) continue;
    if (urlKey) seenUrls.add(urlKey);
    if (titleKey) seenTitles.add(titleKey);
    result.push(item);
  }
  return result;
}

function rank(items, interests) {
  const preferred = new Set(interests);
  return items.map(item => {
    const ageHours = Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 3600000);
    const score = 120 - Math.min(ageHours, 96) + (preferred.has(item.category) ? 16 : 0);
    return { ...item, score: Math.round(score), tags: [item.category] };
  }).sort((a, b) => (b.score - a.score) || (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)));
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    signal: AbortSignal.timeout(FAST_TIMEOUT_MS),
    headers: {
      'User-Agent': 'MonActualite-Fast/1.0',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text || text.length > 1_500_000) throw new Error('Flux invalide');
  return parseFeed(text, feed);
}

module.exports = async function fastNewsHandler(req, res) {
  const newsLocale = requestedLocale(req);
  const interests = [...new Set(String(req.query?.interests || '')
    .split(',').map(value => value.trim()).filter(Boolean))].slice(0, 8);
  const interestFeeds = interests
    .filter(interest => INTEREST_QUERIES[interest])
    .map(interest => ({ title: `Recherche · ${interest}`, url: googleSearchUrl(INTEREST_QUERIES[interest], newsLocale), category: interest }));
  const feeds = [...baseFeeds(newsLocale), ...interestFeeds].slice(0, MAX_FEEDS);
  const settled = await Promise.allSettled(feeds.map(fetchFeed));
  const raw = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') raw.push(...result.value);
    else errors.push({ source: feeds[index].title, message: String(result.reason?.message || result.reason).slice(0, 100) });
  });

  const articles = rank(dedupe(raw), interests).slice(0, ARTICLE_LIMIT).map((article, index) => ({
    ...article,
    id: `fast-${Date.parse(article.publishedAt) || 0}-${index}`
  }));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'public, s-maxage=120, stale-while-revalidate=900');
  return res.end(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    articles,
    stats: {
      mode: 'fast-startup',
      feedsRequested: feeds.length,
      feedsSucceeded: settled.filter(result => result.status === 'fulfilled').length,
      rawItems: raw.length,
      deduplicatedItems: articles.length
    },
    errors: errors.slice(0, 6)
  }));
};
