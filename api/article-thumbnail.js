const dns = require('node:dns').promises;
const net = require('node:net');
const photoFast = require('./article-photo-fast.js');

const HTML_TIMEOUT_MS = 4200;
const IMAGE_TIMEOUT_MS = 3800;
const MAX_HTML_BYTES = 1_800_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

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
    if (!records.length || records.some(r => isPrivateIp(r.address))) throw new Error('private address blocked');
  }
  return url;
}

function googleNewsArticleId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'news.google.com') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = Math.max(parts.lastIndexOf('articles'), parts.lastIndexOf('read'));
    return marker >= 0 && parts[marker + 1] ? parts[marker + 1] : '';
  } catch {
    return '';
  }
}

function tryLegacyGoogleDecode(id) {
  try {
    const text = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return (text.match(/https?:\/\/[^\u0000-\u001f\s]+/i) || [])[0] || '';
  } catch {
    return '';
  }
}

async function fetchGoogleParams(id) {
  for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
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
    method: 'POST',
    signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
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
  let current = rawUrl;
  for (let i = 0; i < 6; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
    return { html: decodeBuffer(buffer, type), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function decode(value = '') {
  return value
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
  if (a) return decode(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'));
  return b ? decode(b[1]) : '';
}

function inlineImageCandidates(html) {
  const articleMatch = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].sort((a, b) => b[1].length - a[1].length)[0];
  const region = articleMatch?.[1] || html;
  const candidates = [];
  for (const match of region.matchAll(/<img\b([^>]+)>/gi)) {
    const attrs = match[1];
    const descriptive = `${attrs} ${(attrs.match(/\balt=["']([^"']*)["']/i) || [])[1] || ''}`;
    if (/logo|avatar|icon|emoji|badge|author|profil|pixel|tracking|advert|publicit|sprite|brand|wordmark|favicon/i.test(descriptive)) continue;
    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-image']) {
      const value = (attrs.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i')) || [])[1] || '';
      if (value && !/^data:/i.test(value)) candidates.push(value);
    }
    const srcset = (attrs.match(/\bsrcset=["']([^"']+)["']/i) || [])[1] || '';
    if (srcset) {
      const values = srcset.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
      if (values.length) candidates.push(values[values.length - 1]);
    }
    if (candidates.length >= 18) break;
  }
  return candidates;
}

function jsonLdCandidates(html) {
  const out = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      for (const item of queue) {
        const image = item?.image;
        if (typeof image === 'string') out.push(image);
        else if (Array.isArray(image)) out.push(...image.filter(v => typeof v === 'string'));
        else if (image?.url) out.push(image.url);
        if (item?.thumbnailUrl) out.push(item.thumbnailUrl);
      }
    } catch {}
    if (out.length >= 10) break;
  }
  return out;
}

function isGenericImageUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews|google_actualites|google-actualites)/i.test(haystack)) return true;
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return true;
    return false;
  } catch { return true; }
}

function findImage(html, finalUrl) {
  const candidates = [
    metaContent(html, 'og:image:secure_url'),
    metaContent(html, 'og:image'),
    metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'),
    metaContent(html, 'twitter:image:src'),
    ((html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) || [])[1] || ''),
    ...jsonLdCandidates(html),
    ...inlineImageCandidates(html)
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

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const size = buffer.readUInt16BE(offset + 2);
    if (!size || size < 2) break;
    offset += 2 + size;
  }
  return null;
}

function imageLooksUseful(buffer, type) {
  if (/svg/i.test(type)) return false;
  const dimensions = pngDimensions(buffer) || jpegDimensions(buffer);
  if (!dimensions) return true;
  return dimensions.width >= 240 && dimensions.height >= 120;
}

async function fetchImage(rawUrl, referer) {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    if (isGenericImageUrl(url.href)) throw new Error('generic image blocked');
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        'Referer': referer || url.origin + '/'
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
    if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('image too large');
    if (!imageLooksUseful(buffer, type)) throw new Error('generic or too small image');
    return { buffer, type };
  }
  throw new Error('too many image redirects');
}

function sendImage(res, image, source) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', source);
  return res.end(image.buffer);
}

function fallback(res) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eeeeF1"/><stop offset="1" stop-color="#ddddE3"/></linearGradient></defs><rect width="640" height="420" rx="22" fill="url(#g)"/><path d="M0 330L155 220l105 70 104-105 276 235H0Z" fill="#c9c9d1"/><circle cx="470" cy="120" r="42" fill="#d2d2d9"/></svg>';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=180, s-maxage=300, stale-while-revalidate=1200');
  res.setHeader('X-Thumbnail-Status', 'fallback');
  res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }

  const rawUrl = String(req.query?.url || '').slice(0, 2000);
  const suppliedImage = String(req.query?.image || '').slice(0, 2000);
  const title = String(req.query?.title || '').slice(0, 300);
  const category = String(req.query?.category || '').slice(0, 80);

  if (suppliedImage && !isGenericImageUrl(suppliedImage)) {
    try {
      const image = await fetchImage(suppliedImage, rawUrl || undefined);
      return sendImage(res, image, 'feed');
    } catch (error) {
      console.warn('feed image unavailable:', String(error?.message || error).slice(0, 120));
    }
  }

  if (rawUrl) {
    try {
      const articleUrl = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
      const decodedHost = new URL(articleUrl).hostname.toLowerCase();
      if (decodedHost === 'news.google.com' || decodedHost.endsWith('.google.com')) throw new Error('Google wrapper not decoded');
      const { html, finalUrl } = await fetchHtml(articleUrl);
      const imageUrl = findImage(html, finalUrl);
      if (imageUrl) {
        const image = await fetchImage(imageUrl, finalUrl);
        return sendImage(res, image, 'publisher');
      }
    } catch (error) {
      console.warn('publisher image unavailable:', String(error?.message || error).slice(0, 140));
    }
  }

  try {
    const fallbackUrl = await photoFast.chooseImage(title, category);
    if (fallbackUrl) {
      const image = await photoFast.fetchImage(fallbackUrl);
      return sendImage(res, image, 'illustration');
    }
  } catch (error) {
    console.warn('illustration unavailable:', String(error?.message || error).slice(0, 120));
  }

  return fallback(res);
};
