const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 6_000_000;
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
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
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
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA, 'Referer': 'https://news.google.com/' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', innerRequest]]]))
  });
  if (!response.ok) throw new Error(`Google decode HTTP ${response.status}`);
  const decoded = extractDecodedUrl(await response.text());
  if (!decoded) throw new Error('Google decode result missing');
  return decoded;
}

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 6; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
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

function decode(value = '') {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'));
  if (a) return decode(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'));
  return b ? decode(b[1]) : '';
}

function findImage(html, finalUrl) {
  const candidates = [
    metaContent(html, 'og:image'), metaContent(html, 'og:image:secure_url'), metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'), metaContent(html, 'twitter:image:src'),
    ((html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) || [])[1] || '')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, finalUrl);
      if (['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch {}
  }
  return '';
}

async function fetchImage(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'Referer': url.origin + '/' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not image');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('image too large');
    return { buffer, type };
  }
  throw new Error('too many image redirects');
}

function fallback(res) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="184" height="136" viewBox="0 0 184 136"><rect width="184" height="136" fill="#f1f1f1"/></svg>';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, s-maxage=1800');
  res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const rawUrl = String(req.query?.url || '').slice(0, 2000);
  if (!rawUrl) return fallback(res);
  try {
    const articleUrl = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
    const { html, finalUrl } = await fetchHtml(articleUrl);
    const imageUrl = findImage(html, finalUrl);
    if (!imageUrl) return fallback(res);
    const image = await fetchImage(imageUrl);
    res.statusCode = 200;
    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', String(image.buffer.byteLength));
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.end(image.buffer);
  } catch (error) {
    console.error('thumbnail unavailable:', String(error?.message || error).slice(0, 180));
    return fallback(res);
  }
};
