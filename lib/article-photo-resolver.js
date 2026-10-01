const dns = require('node:dns').promises;
const net = require('node:net');
const { photoSignal } = require('./article-photo-cache.js');
const publisherPhotoCandidates = require('./publisher-photo-connectors.js');

const HTML_TIMEOUT_MS = 5200;
const IMAGE_TIMEOUT_MS = 4200;
const SEARCH_TIMEOUT_MS = 3200;
const METADATA_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 2_200_000;
const MAX_SEARCH_BYTES = 2_500_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const GOOGLE_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
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

function plain(value = '') {
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return true;
}

async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('local host blocked');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private address blocked');
  } else {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('private address blocked');
  }
  return url;
}

function isBadImageUrl(raw = '') {
  try {
    const url = new URL(raw);
    const text = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    if (/\/api\/(?:article-thumbnail|exact-news-thumbnail)(?:\?|$)/i.test(text)) return true;
    return /(favicon|(?:^|[\/_\-.])logo(?:[\/_\-.]|$)|avatar|sprite|wordmark|brandmark|site-logo|tracking|pixel|badge|emoji|author[-_]?photo|profile[-_]?photo)/i.test(text);
  } catch {
    return true;
  }
}

async function fetchWithRedirects(rawUrl, options = {}, maxRedirects = 5) {
  let current = rawUrl;
  for (let step = 0; step <= maxRedirects; step += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    return { response, finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function imageDimensions(buffer, type = '') {
  try {
    if (/png/i.test(type) && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (/gif/i.test(type) && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (/jpe?g/i.test(type) || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        if (offset + 4 >= buffer.length) break;
        const length = buffer.readUInt16BE(offset + 2);
        if (!length) break;
        offset += 2 + length;
      }
    }
  } catch {}
  return { width: 0, height: 0 };
}

function imageLooksUseful(buffer, type = '') {
  if (!type.startsWith('image/') || /svg/i.test(type)) return false;
  if (buffer.byteLength < 3500 || buffer.byteLength > MAX_IMAGE_BYTES) return false;
  const { width, height } = imageDimensions(buffer, type);
  if (width && height) {
    if (width < 180 || height < 100) return false;
    if (width * height < 45_000) return false;
    if (width <= 260 && height <= 260 && Math.abs(width - height) < 25) return false;
  }
  return true;
}

async function fetchImage(rawUrl, referer = '') {
  if (!rawUrl || isBadImageUrl(rawUrl)) throw new Error('bad image url');
  const { response } = await fetchWithRedirects(rawUrl, {
    signal: photoSignal(IMAGE_TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
      ...(referer ? { 'Referer': referer } : {})
    }
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!imageLooksUseful(buffer, type)) throw new Error('weak image');
  return { buffer, type };
}

function sendImage(res, image, status) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', status);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(image.buffer);
}

function neutral(res, exactOnly = false) {
  if (exactOnly) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" rx="22" fill="#f1f1f4"/><path d="M0 340 150 225l105 74 108-111 277 232H0Z" fill="#d7d7de"/><circle cx="490" cy="115" r="39" fill="#dedee4"/></svg>';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Thumbnail-Status', 'neutral-fallback');
  return res.end(svg);
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

async function fetchHtml(rawUrl) {
  const { response, finalUrl } = await fetchWithRedirects(rawUrl, {
    signal: photoSignal(HTML_TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`page HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not html');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_HTML_BYTES) throw new Error('page too large');
  const buffer = await readUsefulHtml(response);
  if (!buffer.length || buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
  return { html: decodeBuffer(buffer, type), finalUrl };
}

async function readUsefulHtml(response) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let probe = '';
  try {
    while (total <= MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total > MAX_HTML_BYTES) throw new Error('page too large');

      // Covers are normally declared in the document head. Once that head is
      // complete, do not wait for ads, trackers and the paywalled body.
      if (probe.length < 600_000) probe += chunk.toString('utf8');
      if (/<\/head\s*>/i.test(probe)
        && /<(?:meta|link)\b[^>]*(?:og:image|twitter:image|image_src|thumbnail)/i.test(probe)) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
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

  let signature = '';
  let timestamp = '';
  for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const { response } = await fetchWithRedirects(url, {
        signal: photoSignal(HTML_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_UA, 'Accept': 'text/html' }
      }, 3);
      if (!response.ok) continue;
      const html = await response.text();
      signature = (html.match(/data-n-a-sg=["']([^"']+)["']/i) || [])[1] || '';
      timestamp = (html.match(/data-n-a-ts=["']([^"']+)["']/i) || [])[1] || '';
      if (signature && timestamp) break;
    } catch {}
  }
  if (!signature || !timestamp) return rawUrl;

  try {
    const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
    const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: photoSignal(HTML_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': GOOGLE_UA,
        'Referer': 'https://news.google.com/'
      },
      body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', innerRequest]]]))
    });
    if (!response.ok) return rawUrl;
    return extractDecodedUrl(await response.text()) || rawUrl;
  } catch { return rawUrl; }
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
  if (first) return decode(first[1]);
  const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, 'i'));
  return second ? decode(second[1]) : '';
}

function linkImage(html) {
  const match = html.match(/<link[^>]+rel=["'][^"']*image_src[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*image_src[^"']*["']/i);
  return match ? decode(match[1]) : '';
}

function collectJsonLdImages(value, out, depth = 0) {
  if (depth > 7 || out.length >= 24 || value == null) return;
  if (typeof value === 'string') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonLdImages(item, out, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(image|thumbnailUrl|contentUrl)$/i.test(key)) {
      if (typeof item === 'string') out.push(item);
      else if (Array.isArray(item)) item.forEach(v => typeof v === 'string' && out.push(v));
      else if (item && typeof item === 'object') {
        if (typeof item.url === 'string') out.push(item.url);
        if (typeof item.contentUrl === 'string') out.push(item.contentUrl);
      }
    }
    collectJsonLdImages(item, out, depth + 1);
  }
}

function jsonLdImages(html) {
  const out = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectJsonLdImages(JSON.parse(match[1].trim()), out); } catch {}
    if (out.length >= 24) break;
  }
  return out;
}

function inlineImages(html) {
  const article = [...html.matchAll(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/gi)]
    .sort((a, b) => b[1].length - a[1].length)[0]?.[1] || html;
  const scored = [];
  for (const match of article.matchAll(/<(?:img|source)\b([^>]+)>/gi)) {
    const attrs = match[1];
    if (/logo|avatar|icon|emoji|badge|author|profil|pixel|tracking|advert|publicit|sprite|brand|wordmark|favicon/i.test(attrs)) continue;
    const width = Number((attrs.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0);
    const height = Number((attrs.match(/\bheight=["']?(\d+)/i) || [])[1] || 0);
    let score = 0;
    if (/hero|lead|main|featured|article|cover|story/i.test(attrs)) score += 8;
    if (width >= 500) score += 4;
    if (height >= 250) score += 3;
    const candidates = [];
    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-image']) {
      const value = (attrs.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i')) || [])[1] || '';
      if (value && !/^data:/i.test(value)) candidates.push(value);
    }
    const srcset = (attrs.match(/\bsrcset=["']([^"']+)["']/i) || [])[1] || '';
    if (srcset) {
      const values = srcset.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
      if (values.length) candidates.unshift(values[values.length - 1]);
    }
    candidates.forEach((url, i) => scored.push({ url: decode(url), score: score - i }));
    if (scored.length >= 36) break;
  }
  return scored.sort((a, b) => b.score - a.score).map(item => item.url);
}

function uniqueCandidates(values, baseUrl) {
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    try {
      const url = new URL(decode(String(raw || '')), baseUrl).href;
      if (isBadImageUrl(url) || seen.has(url)) continue;
      seen.add(url);
      result.push(url);
    } catch {}
  }
  return result.slice(0, 18);
}

async function firstValidImage(candidates, referer, status) {
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const settled = await Promise.allSettled(batch.map(url => fetchImage(url, referer)));
    for (let j = 0; j < settled.length; j += 1) {
      if (settled[j].status === 'fulfilled') return { image: settled[j].value, status };
    }
  }
  return null;
}

function needsRenderedMetadata(rawUrl = '', blocked = false) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (blocked && host !== 'news.google.com' && host !== 'consent.google.com' && host !== 'www.google.com')
      || host === 'leparisien.fr' || host.endsWith('.leparisien.fr');
  } catch {
    return false;
  }
}

async function renderedMetadataImage(rawUrl, blocked = false) {
  if (!needsRenderedMetadata(rawUrl, blocked)) return null;
  const endpoint = new URL('https://api.microlink.io/');
  endpoint.search = new URLSearchParams({ url: rawUrl, filter: 'image.url' }).toString();
  const { response } = await fetchWithRedirects(endpoint.href, {
    signal: photoSignal(METADATA_TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json'
    }
  }, 2);
  if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 200_000) throw new Error('metadata too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > 200_000) throw new Error('metadata too large');
  const payload = JSON.parse(buffer.toString('utf8'));
  const imageUrl = String(payload?.data?.image?.url || '');
  if (!imageUrl) return null;
  return fetchImage(imageUrl, rawUrl);
}

function titleWords(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','ses','son','ont','est','fait','article','parisien']);
  return [...new Set(normalize(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate = '', expected = '') {
  const wanted = titleWords(expected);
  const found = titleWords(candidate);
  if (!wanted.length || !found.length) return { score: 0, hits: 0, shorterCoverage: 0 };
  const set = new Set(found);
  const hits = wanted.filter(word => set.has(word)).length;
  return { score: hits / wanted.length, hits, shorterCoverage: hits / Math.max(1, Math.min(wanted.length, found.length)) };
}

function sameEvent(candidate = '', expected = '') {
  const a = titleAgreement(candidate, expected);
  const wantedLength = titleWords(expected).length;
  return (a.score >= 0.68 && a.hits >= Math.min(4, wantedLength))
    || (a.hits >= 5 && a.shorterCoverage >= 0.52)
    || (a.hits >= 4 && a.shorterCoverage >= 0.66);
}

function queryVariants(title = '') {
  const clean = plain(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const variants = [clean];
  // Live articles prepend the latest update to a stable trailing headline.
  // Search that stable clause before the rolling prefix makes it stale.
  const liveTail = clean.split(/\s*(?:\u2026|\.{3})\s*/).filter(Boolean).pop();
  if (liveTail && liveTail !== clean && titleWords(liveTail).length >= 4) variants.push(liveTail);
  const afterColon = clean.split(/\s*[:：]\s*/).filter(Boolean).pop();
  if (afterColon && afterColon !== clean && titleWords(afterColon).length >= 4) variants.push(afterColon);
  const words = titleWords(clean).filter(word => word.length >= 4);
  if (words.length >= 5) variants.push(words.slice(-10).join(' '));
  return [...new Set(variants.filter(Boolean))].slice(0, 3);
}

async function googleNewsImage(title) {
  for (const query of queryVariants(title)) {
    try {
      const searchUrl = new URL('https://news.google.com/search');
      searchUrl.search = new URLSearchParams({ q: query, hl: 'fr', gl: 'FR', ceid: 'FR:fr', ucbcb: '1' }).toString();
      const response = await fetch(searchUrl, {
        redirect: 'follow',
        signal: photoSignal(SEARCH_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.byteLength > MAX_SEARCH_BYTES) continue;
      const html = decodeBuffer(buffer, response.headers.get('content-type') || '');
      const titlePattern = /<a\b[^>]*class=["'][^"']*\bJtKRv\b[^"']*["'][^>]*>([\s\S]{1,2200}?)<\/a>/gi;
      const matches = [...html.matchAll(titlePattern)];
      let best = null;
      for (let index = 0; index < matches.length; index += 1) {
        const label = plain(matches[index][1]);
        if (!sameEvent(label, title)) continue;
        const agreement = titleAgreement(label, title);
        const previous = matches[index - 1]?.index;
        const next = matches[index + 1]?.index;
        const start = previous == null ? Math.max(0, matches[index].index - 12000) : Math.floor((previous + matches[index].index) / 2);
        const end = next == null ? Math.min(html.length, matches[index].index + 12000) : Math.floor((matches[index].index + next) / 2);
        const chunk = html.slice(start, end);
        const attachments = [...chunk.matchAll(/\/api\/attachments\/[^"'\s,]+/g)].map(item => decode(item[0]));
        if (!attachments.length) continue;
        const raw = attachments.find(value => /-w400-h224-/i.test(value)) || attachments[attachments.length - 1];
        const url = new URL(raw.replace(/-w\d+-h\d+-p-df(?:-rw)?$/i, '-w600-h338-p-df'), searchUrl).href;
        const confidence = Math.max(agreement.score, agreement.shorterCoverage);
        if (!best || confidence > best.confidence) best = { url, confidence };
      }
      if (best?.url) {
        try { return await fetchImage(best.url, 'https://news.google.com/'); } catch {}
      }
    } catch {}
  }
  return null;
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? plain(match[1]) : '';
}

async function bingNewsImage(title, source = '') {
  for (const query of queryVariants(title)) {
    try {
      const searchUrl = new URL('https://www.bing.com/news/search');
      searchUrl.search = new URLSearchParams({ q: query, format: 'RSS', setmkt: 'fr-FR', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(searchUrl, {
        redirect: 'follow',
        signal: photoSignal(SEARCH_TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.byteLength > MAX_SEARCH_BYTES) continue;
      const xml = buffer.toString('utf8');
      let best = null;
      for (const block of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 30)) {
        const headline = xmlTag(block, 'title');
        if (!headline || !sameEvent(headline, title)) continue;
        const image = xmlTag(block, 'News:Image');
        if (!/^https?:\/\//i.test(image) || isBadImageUrl(image)) continue;
        const publisher = xmlTag(block, 'News:Source');
        const agreement = titleAgreement(headline, title);
        const sameSource = publisher && source && normalize(publisher).includes(normalize(source));
        const confidence = Math.max(agreement.score, agreement.shorterCoverage) + (sameSource ? 0.08 : 0);
        if (!best || confidence > best.confidence) best = { url: image, confidence };
      }
      if (best?.url) {
        try { return await fetchImage(best.url, 'https://www.bing.com/news/'); } catch {}
      }
    } catch {}
  }
  return null;
}

module.exports = async function resolvePublisher(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }

  const rawUrl = String(req.query?.url || '').slice(0, 2000);
  const suppliedImage = String(req.query?.image || '').slice(0, 2000);
  const title = plain(String(req.query?.title || '')).slice(0, 300);
  const source = plain(String(req.query?.source || '')).slice(0, 120);
  const exactOnly = String(req.query?.exact || '') === '1';

  if (req.query?.searchOnly !== '1' && suppliedImage && !isBadImageUrl(suppliedImage)) {
    try { return sendImage(res, await fetchImage(suppliedImage, rawUrl || ''), 'feed-image'); }
    catch {}
  }

  let publisherUrl = req.photoPublisherUrl || rawUrl;
  if (req.query?.searchOnly !== '1' && /^https?:\/\//i.test(rawUrl)) {
    try { publisherUrl = await decodeGoogleNewsUrl(rawUrl); } catch {}
    req.photoPublisherUrl = publisherUrl;
    try {
      const structured = await publisherPhotoCandidates({ url: publisherUrl, title, source }, { fetchWithRedirects, photoSignal, decode });
      if (structured) {
        publisherUrl = structured.publisherUrl;
        req.photoPublisherUrl = publisherUrl;
        const cover = await firstValidImage(uniqueCandidates(structured.images, publisherUrl), publisherUrl, 'publisher-api');
        if (cover) return sendImage(res, cover.image, cover.status);
      }
    } catch (error) {
      console.warn('publisher structured metadata unavailable:', String(error?.message || error).slice(0, 120));
    }
    try {
      const { html, finalUrl } = await fetchHtml(publisherUrl);
      const metadata = uniqueCandidates([
        metaContent(html, 'og:image:secure_url'),
        metaContent(html, 'og:image'),
        metaContent(html, 'twitter:image:src'),
        metaContent(html, 'twitter:image'),
        metaContent(html, 'thumbnail'),
        metaContent(html, 'thumbnailUrl'),
        linkImage(html),
        ...jsonLdImages(html)
      ], finalUrl);
      const metaImage = await firstValidImage(metadata, finalUrl, 'publisher-metadata');
      if (metaImage) return sendImage(res, metaImage.image, metaImage.status);

      const content = uniqueCandidates(inlineImages(html), finalUrl);
      const contentImage = await firstValidImage(content, finalUrl, 'publisher-content');
      if (contentImage) return sendImage(res, contentImage.image, contentImage.status);
    } catch (error) {
      let host = ''; try { host = new URL(publisherUrl).hostname; } catch {}
      console.warn('publisher image extraction unavailable:', host, String(error?.message || error).slice(0, 120));
      // A publisher page denied to datacenter traffic is not a missing cover.
      // Read this exact public page's metadata through the existing renderer,
      // still within the publisher tier and before third-party news candidates.
      if (/page HTTP 403/.test(String(error?.message)) && needsRenderedMetadata(publisherUrl, true)) {
        try {
          const recovered = await renderedMetadataImage(publisherUrl, true);
          if (recovered) return sendImage(res, recovered, 'publisher-rendered-metadata');
        } catch (metadataError) {
          console.warn('blocked publisher metadata unavailable:', host, String(metadataError?.message || metadataError).slice(0, 120));
        }
      }
    }
  }

  if (req.query?.publisherOnly === '1') return neutral(res, true);

  if (title) {
    const [googleResult, bingResult] = await Promise.allSettled([
      googleNewsImage(title),
      bingNewsImage(title, source)
    ]);
    if (googleResult.status === 'fulfilled' && googleResult.value) return sendImage(res, googleResult.value, 'google-news-exact');
    if (bingResult.status === 'fulfilled' && bingResult.value) return sendImage(res, bingResult.value, 'bing-news-exact');
  }

  // Some publishers return 403 to datacenter requests even though their page
  // contains a real Open Graph cover. Use a rendered metadata service only for
  // those known hosts and only after the cheaper publisher/news paths failed.
  if (needsRenderedMetadata(publisherUrl)) {
    try {
      const recovered = await renderedMetadataImage(publisherUrl);
      if (recovered) return sendImage(res, recovered, 'publisher-rendered-metadata');
    } catch (error) {
      console.warn('rendered metadata image unavailable:', String(error?.message || error).slice(0, 120));
    }
  }

  return neutral(res, exactOnly);
};

