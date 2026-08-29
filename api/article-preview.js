const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 7000;
const MAX_HTML_BYTES = 2_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const PARISIEN_FEEDS = [
  'https://feeds.leparisien.fr/leparisien/rss',
  'https://feeds.leparisien.fr/leparisien/rss/societe',
  'https://feeds.leparisien.fr/leparisien/rss/futurs'
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
  return decodeEntities(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/\s+[-–—]\s+le\s+parisien\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article','parisien']);
  return [...new Set(normalized(value).split(' ').filter(word => word.length >= 3 && !stop.has(word)))];
}

function sameTitle(candidate = '', expected = '') {
  const a = normalized(candidate);
  const b = normalized(expected);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wanted = tokens(expected);
  const found = new Set(tokens(candidate));
  if (!wanted.length || !found.size) return false;
  const hits = wanted.filter(word => found.has(word)).length;
  return hits >= Math.min(5, wanted.length) && hits / Math.max(1, Math.min(wanted.length, found.size)) >= 0.72;
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIP(address) === 6) {
    const n = address.toLowerCase();
    return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80:');
  }
  return true;
}

function allowedHost(host = '') {
  const value = String(host || '').toLowerCase();
  return value === 'news.google.com' || value === 'leparisien.fr' || value.endsWith('.leparisien.fr');
}

async function assertAllowedPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !allowedHost(url.hostname)) throw new Error('host blocked');
  const records = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('private address blocked');
  return url;
}

function googleNewsArticleId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'news.google.com') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = Math.max(parts.lastIndexOf('articles'), parts.lastIndexOf('read'));
    return marker >= 0 && parts[marker + 1] ? parts[marker + 1] : '';
  } catch { return ''; }
}

function tryLegacyGoogleDecode(id) {
  try {
    const text = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return (text.match(/https?:\/\/[^\u0000-\u001f\s]+/i) || [])[0] || '';
  } catch { return ''; }
}

async function fetchGoogleParams(id) {
  for (const raw of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const response = await fetch(raw, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (!response.ok) continue;
      const html = await response.text();
      const signature = (html.match(/data-n-a-sg=["']([^"']+)["']/i) || [])[1] || '';
      const timestamp = (html.match(/data-n-a-ts=["']([^"']+)["']/i) || [])[1] || '';
      if (signature && timestamp) return { signature, timestamp };
    } catch {}
  }
  throw new Error('Google params unavailable');
}

function extractDecodedUrl(text) {
  for (const chunk of String(text || '').split('\n\n')) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const rows = JSON.parse(trimmed);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!Array.isArray(row) || typeof row[2] !== 'string') continue;
        try {
          const inner = JSON.parse(row[2]);
          if (Array.isArray(inner) && inner[0] === 'garturlres' && /^https?:\/\//i.test(inner[1] || '')) return inner[1];
        } catch {}
      }
    } catch {}
  }
  return '';
}

async function decodeGoogleNewsUrl(rawUrl) {
  const id = googleNewsArticleId(rawUrl);
  if (!id) return rawUrl;
  const legacy = tryLegacyGoogleDecode(id);
  if (/^https?:\/\//i.test(legacy) && allowedHost(new URL(legacy).hostname)) return legacy;
  const { signature, timestamp } = await fetchGoogleParams(id);
  const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA, 'Referer': 'https://news.google.com/' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', innerRequest]]]))
  });
  if (!response.ok) throw new Error(`Google decode HTTP ${response.status}`);
  const decoded = extractDecodedUrl(await response.text());
  if (!decoded || !allowedHost(new URL(decoded).hostname)) throw new Error('decoded host blocked');
  return decoded;
}

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let step = 0; step < 5; step += 1) {
    const url = await assertAllowedPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7'
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
    return { html: buffer.toString('utf8'), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function metaContent(html = '', key = '') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const value = (html.match(pattern) || [])[1] || '';
    if (clean(value).length >= 60) return clean(value);
  }
  return '';
}

function jsonLdTexts(html = '') {
  const values = [];
  const visit = node => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== 'object') return;
    for (const key of ['articleBody', 'description']) {
      if (typeof node[key] === 'string') {
        const value = clean(node[key]);
        if (value.length >= 80) values.push(value);
      }
    }
    if (node['@graph']) visit(node['@graph']);
  };
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(decodeEntities(match[1]))); } catch {}
  }
  return values.sort((a, b) => b.length - a.length);
}

function paragraphText(html = '') {
  const candidates = [];
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const value = clean(match[1]);
    if (value.length < 60) continue;
    if (/cookies?|abonnez|newsletter|publicit|se connecter|déjà abonné|lire aussi|à lire aussi/i.test(value)) continue;
    candidates.push(value);
    if (candidates.join(' ').length > 3500) break;
  }
  return candidates.join(' ').slice(0, 3500);
}

function extractPublicText(html = '', title = '') {
  const titleNorm = normalized(title);
  const candidates = [
    ...jsonLdTexts(html),
    paragraphText(html),
    metaContent(html, 'description'),
    metaContent(html, 'og:description'),
    metaContent(html, 'twitter:description')
  ].map(clean).filter(value => value.length >= 60);
  return candidates.find(value => normalized(value) !== titleNorm && !normalized(value).includes(titleNorm)) || '';
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

async function fetchParisienRssText(title = '') {
  const results = await Promise.allSettled(PARISIEN_FEEDS.map(async feedUrl => {
    const response = await fetch(feedUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const item of items.slice(0, 50)) {
      const itemTitle = clean(xmlTag(item, 'title'));
      if (!sameTitle(itemTitle, title)) continue;
      const rawCandidates = ['content:encoded', 'description', 'summary', 'content']
        .map(name => xmlTag(item, name))
        .filter(Boolean);
      const texts = rawCandidates.map(clean)
        .filter(value => value.length >= 60)
        .filter(value => !sameTitle(value, title))
        .sort((a, b) => b.length - a.length);
      const link = clean(xmlTag(item, 'link'));
      return { text: texts[0] || '', link };
    }
    return null;
  }));
  return results.map(result => result.status === 'fulfilled' ? result.value : null)
    .filter(Boolean)
    .sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0] || null;
}

async function recover(article = {}) {
  const title = clean(article.title || '');
  const rawUrl = String(article.url || '').slice(0, 2200);
  let finalUrl = rawUrl;
  let pageError = '';

  if (rawUrl) {
    try {
      finalUrl = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
      const parsed = new URL(finalUrl);
      if (parsed.hostname === 'leparisien.fr' || parsed.hostname.endsWith('.leparisien.fr')) {
        const { html, finalUrl: fetchedUrl } = await fetchHtml(finalUrl);
        finalUrl = fetchedUrl;
        const text = extractPublicText(html, title);
        if (text) return { ok: true, text: text.slice(0, 3500), finalUrl, origin: 'publisher-page' };
      }
    } catch (error) {
      pageError = String(error?.message || error).slice(0, 120);
    }
  }

  const rss = await fetchParisienRssText(title).catch(() => null);
  if (rss?.text) return { ok: true, text: rss.text.slice(0, 3500), finalUrl: rss.link || finalUrl, origin: 'publisher-rss' };

  return { ok: false, text: '', finalUrl, origin: 'unavailable', error: pageError };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Méthode non autorisée' });
  const input = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const article = input.article && typeof input.article === 'object'
    ? input.article
    : { url: input.url || '', title: input.title || '', source: input.source || 'Le Parisien' };
  const source = clean(article.source || '');
  if (!/le\s+parisien/i.test(`${source} ${article.title || ''}`)) return send(res, 400, { error: 'Source non prise en charge' });
  const result = await recover(article);
  return send(res, 200, result);
};