const dns = require('node:dns').promises;
const net = require('node:net');

const PAGE_TIMEOUT_MS = 4200;
const IMAGE_TIMEOUT_MS = 3600;
const COMMONS_TIMEOUT_MS = 4200;
const MAX_HTML_BYTES = 1_800_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

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

async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('local host blocked');
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error('private address blocked');
  } else {
    const records = await dns.lookup(url.hostname, { all: true });
    if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('private address blocked');
  }
  return url;
}

function decode(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
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
  for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'text/html' }
      });
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
  if (/^https?:\/\//i.test(legacy)) return legacy;

  const { signature, timestamp } = await fetchGoogleParams(id);
  const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"FR:fr",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': UA,
      'Referer': 'https://news.google.com/'
    },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', innerRequest]]]))
  });
  if (!response.ok) throw new Error(`Google decode HTTP ${response.status}`);
  const decoded = extractDecodedUrl(await response.text());
  if (!decoded) throw new Error('Google decode result missing');
  return decoded;
}

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6'
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`page HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (type && !/html|xhtml/i.test(type)) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.byteLength > MAX_HTML_BYTES) throw new Error('bad page size');
    return { html: buffer.toString('utf8'), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (a) return decode(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
  return b ? decode(b[1]) : '';
}

function jsonLdImages(html) {
  const out = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const image = item.image;
        if (typeof image === 'string') out.push(image);
        else if (Array.isArray(image)) out.push(...image.filter(value => typeof value === 'string'));
        else if (image && typeof image.url === 'string') out.push(image.url);
        if (typeof item.thumbnailUrl === 'string') out.push(item.thumbnailUrl);
      }
    } catch {}
  }
  return out;
}

function isGenericImageUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    const text = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    if (/logo|avatar|icon|sprite|tracking|pixel|wordmark|favicon|site-logo|google-news|googlenews|google_actualites|google-actualites/i.test(text)) return true;
    if (/^(news\.google\.com|www\.google\.com)$/i.test(url.hostname)) return true;
    return false;
  } catch { return true; }
}

function isGoogleFeedImage(rawUrl = '') {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com');
  } catch { return true; }
}

function sourceImage(html, finalUrl) {
  const candidates = [
    metaContent(html, 'og:image:secure_url'),
    metaContent(html, 'og:image'),
    metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'),
    metaContent(html, 'twitter:image:src'),
    ...jsonLdImages(html)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(decode(candidate), finalUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (isGenericImageUrl(url.href)) continue;
      return url.href;
    } catch {}
  }
  return '';
}

async function fetchImage(rawUrl, referer = '') {
  let current = rawUrl;
  for (let i = 0; i < 4; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {})
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not image');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('bad image size');
    return { buffer, type };
  }
  throw new Error('too many image redirects');
}

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const STOP = new Set([
  'avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','tous','toute','mais','sans','vers','entre','dont','selon','comme','fait','faits','aux','une','des','les','par','sur','qui','que','quoi','comment','nouveau','nouvelle','plusieurs','sujets','sujet','table','visite','accord','accords','seront','signe','signes','france','francais','francaise','aujourd','hui','hier','demain','annonce','contre','autour','encore','voici','pourquoi','quand','direct','infos','info','derniere','dernieres','derniers','est','ce','de','du','la','le','un','en','au','et'
]);

function titleQuery(title = '') {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const aliases = { MBS: 'Mohammed bin Salman', UE: 'European Union', USA: 'United States', OTAN: 'NATO', IA: 'artificial intelligence' };
  const acronyms = raw.match(/\b[A-Z]{2,7}\b/g) || [];
  const alias = acronyms.find(value => aliases[value]);

  const words = normalize(raw)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !STOP.has(word));

  const important = [];
  const hints = ['ukraine','russie','iran','israel','gaza','liban','chine','trump','macron','zelensky','poutine','pelikan','radar','drones','missiles','anthropic','openai','nvidia','europe','canada','douane'];
  for (const hint of hints) if (words.includes(hint) && !important.includes(hint)) important.push(hint);
  for (const word of words) if (!important.includes(word)) important.push(word);

  const query = important.slice(0, 5).join(' ');
  if (alias && query) return `${aliases[alias]} ${query}`.slice(0, 120);
  if (alias) return aliases[alias];
  return query;
}

const CATEGORY_QUERY = {
  politique: 'French government parliament politics',
  international: 'international diplomacy world leaders',
  economie: 'economy finance business market',
  societe: 'France society public life',
  sante: 'medicine health hospital',
  environnement: 'climate environment nature',
  science: 'science research laboratory',
  culture: 'arts culture museum',
  education: 'school education university',
  europe: 'European Union Brussels',
  ia: 'artificial intelligence computing',
  tech: 'technology computer datacenter',
  smartphones: 'smartphone mobile phone',
  vr: 'virtual reality headset',
  automobile: 'car road transport',
  energie: 'energy electricity power plant'
};

function candidateScore(label = '', query = '') {
  const haystack = normalize(label).replace(/[^a-z0-9]+/g, ' ');
  const words = normalize(query).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !['the','and','with','from'].includes(word));
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

async function commonsSearch(query, requireOverlap) {
  if (!query) return '';
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
    iiurlwidth: '720',
    format: 'json'
  }).toString();
  const response = await fetch(api, {
    signal: AbortSignal.timeout(COMMONS_TIMEOUT_MS),
    headers: { 'User-Agent': 'MonActualite/5.0 (+https://mon-actualite.vercel.app)' }
  });
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  const candidates = [];
  for (const page of Object.values(data?.query?.pages || {})) {
    const info = page?.imageinfo?.[0];
    const url = info?.thumburl || info?.url || '';
    if (!url || !/^image\/(jpeg|png|webp)$/i.test(info?.mime || '')) continue;
    const width = Number(info?.thumbwidth || info?.width || 0);
    const height = Number(info?.thumbheight || info?.height || 0);
    if (width && width < 320) continue;
    if (height && height < 180) continue;
    const label = `${page.title || ''} ${url}`;
    if (/logo|icon|coat_of_arms|flag_of|map_of|diagram|symbol|wordmark|emblem/i.test(label)) continue;
    candidates.push({ url, score: candidateScore(page.title || '', query) });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return '';
  if (requireOverlap && candidates[0].score < 1) return '';
  return candidates[0].url;
}

async function commonsImage(title, category) {
  const query = titleQuery(title);
  const specific = await commonsSearch(query, true).catch(() => '');
  if (specific) return specific;

  const shortened = query.split(/\s+/).slice(0, 2).join(' ');
  if (shortened && shortened !== query) {
    const broad = await commonsSearch(shortened, true).catch(() => '');
    if (broad) return broad;
  }

  const categoryQuery = CATEGORY_QUERY[normalize(category).trim()] || 'current events world news';
  return commonsSearch(categoryQuery, false).catch(() => '');
}

function sendImage(res, image, source, maxAge) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=604800`);
  res.setHeader('X-Photo-Source', source);
  res.end(image.buffer);
}

function fallback(res, category = '') {
  const label = String(category || 'Actualité').replace(/[&<>"']/g, '').slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ebe7ff"/><stop offset="1" stop-color="#d9d0ff"/></linearGradient></defs><rect width="640" height="420" rx="28" fill="url(#g)"/><circle cx="320" cy="175" r="70" fill="#7556e8" opacity=".18"/><path d="M275 175h90M320 130v90" stroke="#6d50d7" stroke-width="16" stroke-linecap="round" opacity=".72"/><text x="320" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#62558a">${label}</text></svg>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.setHeader('X-Photo-Source', 'fallback');
  res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }

  const articleUrl = String(req.query?.url || '').slice(0, 2000);
  const feedImage = String(req.query?.image || '').slice(0, 2000);
  const title = String(req.query?.title || '').slice(0, 300);
  const category = String(req.query?.category || '').slice(0, 80);
  const isGoogleArticle = Boolean(googleNewsArticleId(articleUrl));

  let publisherUrl = articleUrl;
  if (isGoogleArticle) {
    try { publisherUrl = await decodeGoogleNewsUrl(articleUrl); }
    catch (error) {
      console.error('photo Google decode:', String(error?.message || error).slice(0, 140));
      publisherUrl = '';
    }
  }

  if (/^https?:\/\//i.test(feedImage) && !isGoogleArticle && !isGoogleFeedImage(feedImage) && !isGenericImageUrl(feedImage)) {
    try {
      const image = await fetchImage(feedImage, publisherUrl || articleUrl || '');
      return sendImage(res, image, 'feed', 86400);
    } catch {}
  }

  const commonsPromise = commonsImage(title, category).catch(() => '');

  if (/^https?:\/\//i.test(publisherUrl)) {
    try {
      const { html, finalUrl } = await fetchHtml(publisherUrl);
      const found = sourceImage(html, finalUrl);
      if (found) {
        const image = await fetchImage(found, finalUrl);
        return sendImage(res, image, 'publisher', 86400);
      }
    } catch (error) {
      console.error('photo publisher:', String(error?.message || error).slice(0, 140));
    }
  }

  try {
    const commons = await commonsPromise;
    if (commons) {
      const image = await fetchImage(commons, 'https://commons.wikimedia.org/');
      return sendImage(res, image, 'wikimedia', 604800);
    }
  } catch (error) {
    console.error('photo commons:', String(error?.message || error).slice(0, 140));
  }

  return fallback(res, category);
};