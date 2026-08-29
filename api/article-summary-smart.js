const TIMEOUT_MS = 7000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const PARISIEN_FEEDS = [
  'https://feeds.leparisien.fr/leparisien/rss',
  'https://feeds.leparisien.fr/leparisien/rss/societe',
  'https://feeds.leparisien.fr/leparisien/rss/futurs',
  'https://feeds.leparisien.fr/leparisien/rss/economie',
  'https://feeds.leparisien.fr/leparisien/rss/international'
];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store');
  res.end(JSON.stringify(payload));
}

function decodeEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function clean(value = '') {
  return decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/\s+[-–—]\s+le\s+parisien\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article','parisien']);
  return [...new Set(normalize(value).split(' ').filter(word => word.length >= 3 && !stop.has(word)))];
}

function sameTitle(candidate = '', expected = '') {
  const a = normalize(candidate);
  const b = normalize(expected);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wanted = titleTokens(expected);
  const found = new Set(titleTokens(candidate));
  if (!wanted.length || !found.size) return false;
  const hits = wanted.filter(word => found.has(word)).length;
  return hits >= Math.min(5, wanted.length)
    && hits / Math.max(1, Math.min(wanted.length, found.size)) >= 0.72;
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

function informativeText(raw = '', title = '') {
  const text = clean(raw);
  if (text.length < 60) return '';
  const textNorm = normalize(text);
  const titleNorm = normalize(title);
  if (!textNorm || textNorm === titleNorm) return '';
  const titleWords = titleTokens(title);
  const textWords = titleTokens(text);
  if (text.length < 180 && titleWords.length && textWords.length) {
    const found = new Set(textWords);
    const hits = titleWords.filter(word => found.has(word)).length;
    if (hits / Math.max(1, titleWords.length) > 0.85) return '';
  }
  return text;
}

async function fetchFeed(feedUrl, title) {
  const response = await fetch(feedUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
  });
  if (!response.ok) return null;
  const xml = await response.text();
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 60)) {
    const itemTitle = clean(xmlTag(item, 'title'));
    if (!sameTitle(itemTitle, title)) continue;
    const candidates = ['content:encoded', 'description', 'summary', 'content']
      .map(name => informativeText(xmlTag(item, name), title))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return {
      title: itemTitle,
      text: candidates[0] || '',
      url: clean(xmlTag(item, 'link')),
      publishedAt: clean(xmlTag(item, 'pubDate'))
    };
  }
  return null;
}

async function recover(title = '') {
  const results = await Promise.allSettled(PARISIEN_FEEDS.map(feed => fetchFeed(feed, title)));
  const matches = results
    .map(result => result.status === 'fulfilled' ? result.value : null)
    .filter(Boolean)
    .sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0));
  const best = matches[0];
  if (!best?.text) return { ok: false, text: '', origin: 'unavailable' };
  return {
    ok: true,
    text: best.text.slice(0, 3500),
    articleUrl: best.url || '',
    publishedAt: best.publishedAt || '',
    origin: 'publisher-rss'
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Méthode non autorisée' });
  const input = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const article = input.article && typeof input.article === 'object' ? input.article : input;
  const title = clean(article.title || '');
  const source = clean(article.source || 'Le Parisien');
  if (!title) return send(res, 400, { error: 'Titre manquant' });
  if (!/le\s+parisien/i.test(`${source} ${title}`)) return send(res, 400, { error: 'Source non prise en charge' });
  const result = await recover(title);
  return send(res, 200, result);
};