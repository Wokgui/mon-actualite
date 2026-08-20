const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 7000;
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
    const { html, finalUrl } = await fetchHtml(rawUrl);
    return send(res, 200, { image: findImage(html, finalUrl), articleUrl: finalUrl });
  } catch (error) {
    return send(res, 200, { image: '', error: String(error?.message || 'unavailable').slice(0, 100) });
  }
};
