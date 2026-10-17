const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1_500_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const hasImage = status === 200 && Boolean(payload?.image);
  res.setHeader('Cache-Control', hasImage
    ? 'public, max-age=21600, s-maxage=86400, stale-while-revalidate=604800'
    : 'public, max-age=0, s-maxage=120, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
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
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
    const text = Buffer.from(normalized, 'base64').toString('utf8');
    const match = text.match(/https?:\/\/[^\u0000-\u001f\s]+/i);
    return match ? match[0] : '';
  } catch {
    return '';
  }
}

async function fetchGoogleParams(id) {
  const candidates = [
    `https://news.google.com/articles/${id}`,
    `https://news.google.com/rss/articles/${id}`
  ];
  let lastError = 'Google params unavailable';
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }
      });
      if (!response.ok) { lastError = `Google params HTTP ${response.status}`; continue; }
      const html = await response.text();
      const signature = (html.match(/data-n-a-sg=["']([^"']+)["']/i) || [])[1] || '';
      const timestamp = (html.match(/data-n-a-ts=["']([^"']+)["']/i) || [])[1] || '';
      if (signature && timestamp) return { signature, timestamp };
      lastError = 'Google params attributes missing';
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(lastError);
}

function extractDecodedUrl(text) {
  for (const chunk of text.split('\n\n')) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        if (!Array.isArray(row) || typeof row[2] !== 'string') continue;
        try {
          const inner = JSON.parse(row[2]);
          if (Array.isArray(inner) && inner[0] === 'garturlres' && /^https?:\/\//i.test(inner[1] || '')) return inner[1];
        } catch {}
      }
    } catch {}
  }
  const match = text.match(/garturlres\\?"\s*,\s*\\?"(https?:\\?\/\\?\/[^"\\]+)/i);
  return match ? match[1].replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\\//g, '/') : '';
}

async function decodeGoogleNewsUrl(rawUrl) {
  const id = googleNewsArticleId(rawUrl);
  if (!id) return rawUrl;

  const legacy = tryLegacyGoogleDecode(id);
  if (/^https?:\/\//i.test(legacy)) return legacy;

  const { signature, timestamp } = await fetchGoogleParams(id);
  const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
  const fReq = JSON.stringify([[['Fbv4je', innerRequest]]]);

  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': UA,
      'Referer': 'https://news.google.com/'
    },
    body: 'f.req=' + encodeURIComponent(fReq)
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
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
    return { html: buffer.toString('utf8'), finalUrl: url.href };
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

function isGenericImageUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews|google_actualites|google-actualites)/i.test(haystack)) return true;
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return true;
    return false;
  } catch {
    return true;
  }
}

function findImage(html, finalUrl) {
  const candidates = [
    metaContent(html, 'og:image:secure_url'),
    metaContent(html, 'og:image'),
    metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'),
    metaContent(html, 'twitter:image:src'),
    ((html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) || [])[1] || '')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = new URL(decode(candidate), finalUrl);
      if (!['http:', 'https:'].includes(resolved.protocol)) continue;
      if (isGenericImageUrl(resolved.href)) continue;
      return resolved.href;
    } catch {}
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { image: '' });
  const rawUrl = String(req.query?.url || '').slice(0, 2000);
  if (!rawUrl) return send(res, 400, { image: '' });
  try {
    let articleUrl = rawUrl;
    if (googleNewsArticleId(rawUrl)) articleUrl = await decodeGoogleNewsUrl(rawUrl);
    const { html, finalUrl } = await fetchHtml(articleUrl);
    const image = findImage(html, finalUrl);
    return send(res, 200, { image, articleUrl: finalUrl, decoded: articleUrl !== rawUrl });
  } catch (error) {
    return send(res, 200, { image: '', error: String(error?.message || 'unavailable').slice(0, 160) });
  }
};