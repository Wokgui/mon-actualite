const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36';

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

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
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

function sourceImage(html, finalUrl) {
  const candidates = [
    metaContent(html, 'og:image:secure_url'),
    metaContent(html, 'og:image'),
    metaContent(html, 'twitter:image'),
    ...jsonLdImages(html)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(decode(candidate), finalUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (/logo|avatar|icon|sprite|tracking|pixel/i.test(url.pathname)) continue;
      return url.href;
    } catch {}
  }
  return '';
}

async function fetchImage(rawUrl, referer = '') {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

function normalizeWords(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const CATEGORY_QUERIES = {
  'politique': 'French politics government parliament',
  'international': 'international diplomacy world leaders',
  'economie': 'economy finance business France',
  'societe': 'France society public life',
  'sante': 'health medicine hospital research',
  'environnement': 'climate environment nature',
  'science': 'science research laboratory',
  'culture': 'arts culture museum theatre',
  'education': 'education school classroom university',
  'europe': 'European Union Europe institutions',
  'ia': 'artificial intelligence computing',
  'tech': 'technology computing electronics',
  'smartphones': 'smartphone mobile technology',
  'vr': 'virtual reality headset',
  'automobile': 'automobile car transport',
  'energie': 'renewable energy electricity infrastructure'
};

const ACRONYM_QUERIES = {
  'MBS': 'Mohammed bin Salman',
  'UE': 'European Union',
  'USA': 'United States',
  'OTAN': 'NATO',
  'IA': 'artificial intelligence'
};

const TITLE_STOP = new Set([
  'avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','tous','toute','mais','sans','vers','entre','dont','selon','comme','fait','faits','aux','une','des','les','par','sur','qui','que','quoi','comment','nouveau','nouvelle','plusieurs','sujets','sujet','table','visite','accord','accords','seront','signe','signes','transport','transports','energie','france','francais','francaise','aujourd','hui','hier','demain','annonce','annoncee','annoncees','apres','contre','autour','encore','voici','pourquoi','quand','comment']
);

function titleTerms(title = '') {
  return normalizeWords(title)
    .replace(/\s+[-–—|]\s+[^-–—|]{2,45}$/u, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !TITLE_STOP.has(word));
}

function entityQueries(title = '') {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const queries = [];

  for (const acronym of raw.match(/\b[A-Z]{2,7}\b/g) || []) {
    if (ACRONYM_QUERIES[acronym]) queries.push(`${ACRONYM_QUERIES[acronym]} France`);
    else if (!['TV','AFP','BFM','RMC'].includes(acronym)) queries.push(acronym);
  }

  const properSequences = raw.match(/\b[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]{2,}(?:\s+(?:[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’.-]{2,}|de|du|des|la|le|les|bin|ben)){0,2}/g) || [];
  for (const sequence of properSequences) {
    const cleaned = sequence.trim();
    if (/^(Parc|France|Europe|International|Politique|Economie|Économie|Société|Societe|Santé|Sante|Science|Culture|Education|Éducation)$/i.test(cleaned)) continue;
    if (cleaned.length >= 4) queries.push(cleaned);
  }

  const terms = [...new Set(titleTerms(raw))];
  if (terms.length >= 2) queries.push(terms.slice(0, 4).join(' '));
  else if (terms.length === 1) queries.push(terms[0]);

  return [...new Set(queries.map(q => q.trim()).filter(Boolean))].slice(0, 4);
}

function categoryQuery(category = '') {
  return CATEGORY_QUERIES[normalizeWords(category).trim()] || 'current events news illustration';
}

function scoreCandidate(pageTitle = '', query = '') {
  const haystack = normalizeWords(pageTitle).replace(/[^a-z0-9]+/g, ' ');
  const important = normalizeWords(query).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !['the','and','with','from','france'].includes(word));
  if (!important.length) return 0;
  return important.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

async function commonsSearch(query, requireOverlap = true) {
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
  const response = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'MonActualite/3.1' } });
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  const pages = Object.values(data?.query?.pages || {});
  const candidates = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info) continue;
    if (!/^image\/(jpeg|png|webp)$/i.test(info.mime || '')) continue;
    const width = Number(info.thumbwidth || info.width || 0);
    const height = Number(info.thumbheight || info.height || 0);
    if (width && width < 320) continue;
    if (height && height < 180) continue;
    const url = info.thumburl || info.url;
    const label = `${page.title || ''} ${url || ''}`;
    if (/logo|icon|coat_of_arms|flag_of|map_of|diagram|symbol|wordmark/i.test(label)) continue;
    if (!url) continue;
    candidates.push({ url, score: scoreCandidate(page.title || '', query) });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return '';
  if (requireOverlap && candidates[0].score < 1) return '';
  return candidates[0].url;
}

async function commonsImage(title, category) {
  for (const query of entityQueries(title)) {
    const url = await commonsSearch(query, true);
    if (url) return url;
  }
  return commonsSearch(categoryQuery(category), false);
}

function fallbackSvg(res, category = '') {
  const label = String(category || 'Actualité').replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eee9ff"/><stop offset="1" stop-color="#ddd4ff"/></linearGradient></defs><rect width="720" height="480" fill="url(#g)"/><circle cx="360" cy="205" r="78" fill="#8065e8" opacity=".22"/><path d="M305 205h110M360 150v110" stroke="#7057d7" stroke-width="18" stroke-linecap="round" opacity=".7"/><text x="360" y="350" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#665790">${label}</text></svg>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('X-Illustration-Source', 'category-fallback');
  res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const articleUrl = String(req.query?.url || '').slice(0, 2000);
  const feedImage = String(req.query?.image || '').slice(0, 2000);
  const title = String(req.query?.title || '').slice(0, 300);
  const category = String(req.query?.category || '').slice(0, 80);

  const tries = [];
  if (/^https?:\/\//i.test(feedImage)) tries.push({ url: feedImage, referer: articleUrl || '' });
  if (/^https?:\/\//i.test(articleUrl)) {
    try {
      const { html, finalUrl } = await fetchHtml(articleUrl);
      const found = sourceImage(html, finalUrl);
      if (found) tries.push({ url: found, referer: finalUrl });
    } catch (error) {
      console.error('illustration source page:', String(error?.message || error).slice(0, 160));
    }
  }

  for (const candidate of tries) {
    try {
      const image = await fetchImage(candidate.url, candidate.referer);
      res.statusCode = 200;
      res.setHeader('Content-Type', image.type);
      res.setHeader('Content-Length', String(image.buffer.byteLength));
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800');
      res.setHeader('X-Illustration-Source', 'publisher');
      return res.end(image.buffer);
    } catch {}
  }

  try {
    const commons = await commonsImage(title, category);
    if (commons) {
      const image = await fetchImage(commons, 'https://commons.wikimedia.org/');
      res.statusCode = 200;
      res.setHeader('Content-Type', image.type);
      res.setHeader('Content-Length', String(image.buffer.byteLength));
      res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
      res.setHeader('X-Illustration-Source', 'wikimedia-commons');
      return res.end(image.buffer);
    }
  } catch (error) {
    console.error('illustration commons:', String(error?.message || error).slice(0, 160));
  }

  return fallbackSvg(res, category);
};
