const dns = require('node:dns').promises;
const net = require('node:net');
const groqHandler = require('./article-summary-groq.js');

const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 2_500_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function capture(handler, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const out = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(body = '') { resolve({ statusCode: this.statusCode || 200, headers, body: String(body || '') }); }
    };
    Promise.resolve(handler(req, out)).catch(reject);
  });
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
    if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('private address blocked');
  }
  return url;
}

function decode(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function cleanText(value = '') {
  return decode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function fetchHtml(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5'
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
    return buffer.toString('utf8');
  }
  throw new Error('too many redirects');
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (a) return cleanText(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
  return b ? cleanText(b[1]) : '';
}

function jsonLdMaterial(html) {
  const candidates = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        for (const key of ['articleBody', 'description']) {
          const value = cleanText(item[key] || '');
          if (value.length >= 80) candidates.push(value);
        }
      }
    } catch {}
  }
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function paragraphMaterial(html) {
  const region = ([...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .sort((a, b) => b[1].length - a[1].length)[0] || [null, html])[1];
  const parts = [];
  for (const match of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(match[1]);
    if (text.length < 55) continue;
    if (/cookies?|abonnez|newsletter|publicit|connexion|connectez|lire aussi|à lire aussi|partager/i.test(text)) continue;
    parts.push(text);
    if (parts.join(' ').length >= 7000) break;
  }
  return parts.join('\n').slice(0, 7000);
}

function useful(value = '') {
  const text = cleanText(value);
  return text.length >= 80 && !/^ouvrez l.article pour consulter les détails/i.test(text);
}

async function enrichFromPage(url) {
  if (!/^https?:\/\//i.test(url || '')) return '';
  const html = await fetchHtml(url);
  const ld = jsonLdMaterial(html);
  const paragraphs = paragraphMaterial(html);
  const description = metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description');
  const candidates = [ld, paragraphs, description].filter(useful).sort((a, b) => b.length - a.length);
  return (candidates[0] || '').slice(0, 7000);
}

function cloneRequest(req, article) {
  const copy = Object.create(req || null);
  copy.method = 'POST';
  copy.query = req.query || {};
  copy.body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    mode: 'article',
    article
  };
  return copy;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};

  let first = null;
  try {
    const captured = await capture(groqHandler, req);
    first = JSON.parse(captured.body || '{}');
    if (first?.ai && useful(first.summary)) return send(res, 200, first);
    if (useful(first?.summary) && !/^ouvrez l.article/i.test(cleanText(first.summary))) return send(res, 200, first);
  } catch (error) {
    console.error('smart summary first pass:', String(error?.message || error).slice(0, 180));
  }

  let material = '';
  try {
    material = await enrichFromPage(String(article.url || '').slice(0, 2000));
  } catch (error) {
    console.error('smart summary enrichment:', String(error?.message || error).slice(0, 180));
  }

  if (!useful(material)) {
    const fallback = useful(article.summary) ? cleanText(article.summary) : cleanText(first?.summary || '');
    return send(res, 200, {
      ...(first || {}),
      summary: fallback || 'Le flux ne fournit pas assez de texte pour produire un résumé fiable. Utilisez « Lire l’article complet » pour consulter la source.',
      ai: Boolean(first?.ai),
      enriched: false
    });
  }

  try {
    const retryReq = cloneRequest(req, {
      ...article,
      url: '',
      summary: material,
      detail: material
    });
    const retry = await capture(groqHandler, retryReq);
    const result = JSON.parse(retry.body || '{}');
    return send(res, 200, { ...result, enriched: true });
  } catch (error) {
    console.error('smart summary retry:', String(error?.message || error).slice(0, 180));
    return send(res, 200, {
      ...(first || {}),
      summary: material.slice(0, 1200),
      ai: false,
      provider: 'source',
      enriched: true
    });
  }
};
