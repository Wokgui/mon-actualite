const dns = require('node:dns').promises;
const net = require('node:net');

const HTML_TIMEOUT_MS = 3200;
const IMAGE_TIMEOUT_MS = 3000;
const PUBLISHER_TIMEOUT_MS = 3200;
const MAX_SEARCH_HTML_BYTES = 2_400_000;
const MAX_PUBLISHER_HTML_BYTES = 2_200_000;
const MAX_IMAGE_BYTES = 7_000_000;
const GOOGLE_NEWS_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function plainText(value = '') {
  return decode(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleWords(value = '') {
  const stop = new Set(['avec', 'dans', 'pour', 'plus', 'apres', 'avant', 'cette', 'sont', 'etre', 'leur', 'leurs', 'tout', 'mais', 'sans', 'vers', 'entre', 'une', 'des', 'les', 'sur', 'qui', 'que', 'aux', 'par', 'ses', 'son', 'ont', 'est', 'etats', 'unis']);
  return [...new Set(plainText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate, expected) {
  const wanted = titleWords(expected);
  const found = titleWords(candidate);
  if (!wanted.length || !found.length) return { score: 0, hits: 0, shorterCoverage: 0 };
  const foundSet = new Set(found);
  const hits = wanted.filter(word => foundSet.has(word)).length;
  return { score: hits / wanted.length, hits, shorterCoverage: hits / Math.max(1, Math.min(wanted.length, found.length)) };
}

function sameEvent(candidate, expected) {
  const agreement = titleAgreement(candidate, expected);
  return (agreement.score >= 0.68 && agreement.hits >= Math.min(4, titleWords(expected).length))
    || (agreement.hits >= 5 && agreement.shorterCoverage >= 0.52)
    || (agreement.hits >= 4 && agreement.shorterCoverage >= 0.66);
}

function queryVariants(title = '') {
  const clean = plainText(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const variants = [clean];
  const afterColon = clean.split(/\s*[:：]\s*/).filter(Boolean).pop();
  if (afterColon && afterColon !== clean && titleWords(afterColon).length >= 4) variants.push(afterColon);
  const words = titleWords(clean).filter(word => word.length >= 4);
  if (words.length >= 4) {
    variants.push(words.slice(-10).join(' '));
    variants.push(words.slice(Math.max(0, words.length - 8)).join(' '));
  }
  return [...new Set(variants.filter(Boolean))];
}

function decodeBuffer(buffer, contentType = '') {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i) || [])[1]
    || (probe.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i) || [])[1]
    || 'utf-8';
  const charset = /^(iso-8859-1|latin1|windows-1252|cp1252)$/i.test(declared) ? 'windows-1252' : 'utf-8';
  try { return new TextDecoder(charset).decode(buffer); }
  catch { return buffer.toString('utf8'); }
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
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

function googleNewsArticleId(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'news.google.com') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = Math.max(parts.lastIndexOf('articles'), parts.lastIndexOf('read'));
    return marker >= 0 && parts[marker + 1] ? parts[marker + 1] : '';
  } catch { return ''; }
}

function tryLegacyGoogleDecode(id = '') {
  try {
    const text = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return (text.match(/https?:\/\/[^\u0000-\u001f\s]+/i) || [])[0] || '';
  } catch { return ''; }
}

async function fetchGoogleParams(id) {
  for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const response = await fetch(url, {
        redirect: 'follow', signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'text/html' }
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

function extractDecodedUrl(text = '') {
  for (const chunk of text.split('\n\n')) {
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
  const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST', signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': GOOGLE_NEWS_UA, 'Referer': 'https://news.google.com/' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', innerRequest]]]))
  });
  if (!response.ok) throw new Error(`Google decode HTTP ${response.status}`);
  const decoded = extractDecodedUrl(await response.text());
  if (!decoded) throw new Error('Google decode result missing');
  return decoded;
}

async function searchGoogleNewsThumbnail(searchQuery, expectedTitle, source) {
  const wantedWords = titleWords(expectedTitle);
  if (wantedWords.length < 3) return null;
  const searchUrl = new URL('https://news.google.com/search');
  searchUrl.search = new URLSearchParams({ q: searchQuery, hl: 'fr', gl: 'FR', ceid: 'FR:fr', ucbcb: '1' }).toString();
  const response = await fetch(searchUrl, {
    redirect: 'follow', signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
  });
  if (!response.ok) throw new Error(`Google search HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > MAX_SEARCH_HTML_BYTES) throw new Error('Google search page too large');
  const html = decodeBuffer(buffer, type);
  const resultPattern = /<a\b[^>]*class=["'][^"']*\bJtKRv\b[^"']*["'][^>]*>([\s\S]{1,2200}?)<\/a>/gi;
  const results = [...html.matchAll(resultPattern)];
  let best = null;
  for (let index = 0; index < results.length; index += 1) {
    const match = results[index];
    const label = plainText(match[1]);
    if (!sameEvent(label, expectedTitle)) continue;
    const agreement = titleAgreement(label, expectedTitle);
    const previous = results[index - 1]?.index;
    const next = results[index + 1]?.index;
    const start = previous == null ? Math.max(0, match.index - 12_000) : Math.floor((previous + match.index) / 2);
    const end = next == null ? Math.min(html.length, match.index + 12_000) : Math.floor((match.index + next) / 2);
    const resultHtml = html.slice(start, end);
    const sourceText = plainText(resultHtml).toLowerCase();
    const sourceNeedle = plainText(source).toLowerCase();
    const sourceBonus = sourceNeedle && sourceText.includes(sourceNeedle) ? 0.08 : 0;
    const attachments = [...resultHtml.matchAll(/\/api\/attachments\/[^"'\s,]+/g)].map(item => decode(item[0]));
    if (!attachments.length) continue;
    const rawAttachment = attachments.find(value => /-w400-h224-/i.test(value)) || attachments[attachments.length - 1];
    const attachment = rawAttachment.replace(/-w\d+-h\d+-p-df(?:-rw)?$/i, '-w400-h224-p-df');
    const confidence = Math.min(1, Math.max(agreement.score, agreement.shorterCoverage * 0.88) + sourceBonus);
    if (!best || confidence > best.score) best = { score: confidence, url: new URL(attachment, searchUrl).href };
  }
  return best;
}

async function googleNewsThumbnail(title, source) {
  for (const query of queryVariants(title)) {
    try {
      const best = await searchGoogleNewsThumbnail(query, title, source);
      if (best?.url) return best.url;
    } catch {}
  }
  return '';
}

function xmlTag(block = '', name = '') {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? plainText(match[1]) : '';
}

async function relatedGoogleNewsItems(title, source) {
  const seen = new Set();
  const items = [];
  for (const query of queryVariants(title)) {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.search = new URLSearchParams({ q: query, hl: 'fr', gl: 'FR', ceid: 'FR:fr' }).toString();
      const response = await fetch(url, {
        redirect: 'follow', signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'application/rss+xml,application/xml,text/xml' }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const block of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 30)) {
        const headline = xmlTag(block, 'title');
        const link = xmlTag(block, 'link') || xmlTag(block, 'guid');
        const publisher = xmlTag(block, 'source');
        if (!headline || !/^https?:\/\//i.test(link) || !sameEvent(headline, title)) continue;
        const key = headline.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const agreement = titleAgreement(headline, title);
        const differentSource = publisher && source && publisher.toLowerCase() !== source.toLowerCase();
        items.push({ headline, link, publisher, confidence: Math.max(agreement.score, agreement.shorterCoverage) + (differentSource ? 0.06 : 0) });
      }
      if (items.length >= 5) break;
    } catch {}
  }
  return items.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
  if (first) return decode(first[1]);
  const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'));
  return second ? decode(second[1]) : '';
}

function genericImage(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    const haystack = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    return /(favicon|logo|icon|avatar|sprite|wordmark|brandmark|site-logo|tracking|pixel)/i.test(haystack);
  } catch { return true; }
}

async function fetchPublisherHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(PUBLISHER_TIMEOUT_MS),
      headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7' }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`publisher HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('publisher not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.byteLength > MAX_PUBLISHER_HTML_BYTES) throw new Error('publisher page too large');
    return { html: decodeBuffer(buffer, type), finalUrl: url.href };
  }
  throw new Error('publisher redirects');
}

async function fetchPublisherImage(rawUrl, referer) {
  let current = rawUrl;
  for (let i = 0; i < 5; i += 1) {
    const url = await assertPublicUrl(current);
    if (genericImage(url.href)) throw new Error('generic publisher image');
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8', 'Referer': referer || `${url.origin}/` }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`publisher image HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/') || /svg/i.test(type)) throw new Error('publisher response not photo');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('bad publisher image size');
    return { buffer, type };
  }
  throw new Error('publisher image redirects');
}

async function imageFromRelatedItem(item) {
  const decoded = await decodeGoogleNewsUrl(item.link);
  const { html, finalUrl } = await fetchPublisherHtml(decoded);
  const candidates = [
    metaContent(html, 'og:image:secure_url'), metaContent(html, 'og:image'), metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'), metaContent(html, 'twitter:image:src')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const imageUrl = new URL(candidate, finalUrl).href;
      const image = await fetchPublisherImage(imageUrl, finalUrl);
      return image;
    } catch {}
  }
  throw new Error('no publisher image');
}

async function firstRelatedPublisherImage(items) {
  const attempts = items.slice(0, 3).map(item => imageFromRelatedItem(item).then(image => ({ image, item })).catch(() => null));
  const results = await Promise.all(attempts);
  return results.find(Boolean) || null;
}

function googleImageHost(hostname = '') {
  const host = hostname.toLowerCase();
  return host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.googleusercontent.com') || host.endsWith('.gstatic.com');
}

async function fetchGoogleImage(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i += 1) {
    const url = new URL(current);
    if (!googleImageHost(url.hostname)) throw new Error('unexpected image host');
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8', 'Referer': 'https://news.google.com/' }
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

function sendImage(res, image, status) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', status);
  return res.end(image.buffer);
}

function xmlText(value = '') {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function sourceTile(res, source) {
  const label = String(source || 'Source suivie').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Source suivie';
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'S';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e7f4ff"/><stop offset="1" stop-color="#b9c9ff"/></linearGradient></defs><rect width="640" height="420" rx="22" fill="url(#g)"/><circle cx="320" cy="178" r="92" fill="#fff" fill-opacity=".82"/><text x="320" y="198" text-anchor="middle" font-family="Arial,sans-serif" font-size="62" font-weight="800" fill="#3156a8">${xmlText(initials)}</text><text x="320" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#294789">${xmlText(label)}</text></svg>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300');
  res.setHeader('X-Thumbnail-Status', 'publisher-tile');
  return res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const title = String(req.query?.title || '').slice(0, 300);
  const source = String(req.query?.source || 'Le Parisien').slice(0, 100);

  try {
    const [thumbnail, relatedItems] = await Promise.all([
      googleNewsThumbnail(title, source).catch(() => ''),
      relatedGoogleNewsItems(title, source).catch(() => [])
    ]);
    if (thumbnail) {
      try { return sendImage(res, await fetchGoogleImage(thumbnail), 'google-news-related'); }
      catch {}
    }
    if (relatedItems.length) {
      const related = await firstRelatedPublisherImage(relatedItems);
      if (related?.image) return sendImage(res, related.image, 'same-event-publisher');
    }
  } catch (error) {
    console.warn('exact Google News thumbnail unavailable:', String(error?.message || error).slice(0, 140));
  }
  return sourceTile(res, source);
};