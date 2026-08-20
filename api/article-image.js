const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1_500_000;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'no-store');
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
    const marker = parts.lastIndexOf('articles');
    if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];
    const readMarker = parts.lastIndexOf('read');
    if (readMarker >= 0 && parts[readMarker + 1]) return parts[readMarker + 1];
    return '';
  } catch {
    return '';
  }
}

function tryLegacyGoogleDecode(id) {
  try {
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Buffer.from(normalized, 'base64');
    const text = bytes.toString('utf8');
    const match = text.match(/https?:\/\/[^\u0000-\u001f\s]+/i);
    return match ? match[0] : '';
  } catch {
    return '';
  }
}

function unescapeBatchUrl(value) {
  return String(value || '')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u0025/gi, '%')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

async function decodeGoogleNewsUrl(rawUrl) {
  const id = googleNewsArticleId(rawUrl);
  if (!id) return rawUrl;

  const legacy = tryLegacyGoogleDecode(id);
  if (/^https?:\/\//i.test(legacy)) return legacy;

  const request = '[[["Fbv4je","[\\"garturlreq\\",[[\\"fr-FR\\",\\"FR\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],null,null,1,1,\\"FR:fr\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],\\"fr-FR\\",\\"FR\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' + id + '\\"]",null,"generic"]]]';
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'Referer': 'https://news.google.com/'
    },
    body: 'f.req=' + encodeURIComponent(request)
  });
  if (!response.ok) throw new Error(`Google decode HTTP ${response.status}`);
  const text = await response.text();
  const marker = '[\\"garturlres\\",\\"';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('Google decode marker missing');
  const tail = text.slice(start + marker.length);
  const end = tail.indexOf('\\",');
  if (end < 0) throw new Error('Google decode terminator missing');
  const decoded = unescapeBatchUrl(tail.slice(0, end));
  if (!/^https?:\/\//i.test(decoded)) throw new Error('Google decode invalid URL');
  return decoded;
}

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 6; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
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
    metaContent(html, 'og:image'),
    metaContent(html, 'og:image:secure_url'),
    metaContent(html, 'og:image:url'),
    metaContent(html, 'twitter:image'),
    metaContent(html, 'twitter:image:src'),
    ((html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) || [])[1] || '')
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const resolved = new URL(candidate, finalUrl);
      if (['http:', 'https:'].includes(resolved.protocol)) return resolved.href;
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
    return send(res, 200, { image: findImage(html, finalUrl), articleUrl: finalUrl, decoded: articleUrl !== rawUrl });
  } catch (error) {
    return send(res, 200, { image: '', error: String(error?.message || 'unavailable').slice(0, 140) });
  }
};
