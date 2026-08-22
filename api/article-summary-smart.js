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

function boilerplate(value = '') {
  const text = cleanText(value).toLowerCase();
  return !text
    || /ouvrez?\s+l[’']article|consultez?\s+(?:les?\s+)?détails|détails publiés par la source/.test(text)
    || /résumé indisponible|flux ne fournit pas assez de texte/.test(text)
    || /connectez[- ]?vous|abonnez[- ]?vous|newsletter|cookies?|partager cet article/.test(text);
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
        for (const key of ['articleBody', 'description', 'abstract']) {
          const value = cleanText(item[key] || '');
          if (value.length >= 45 && !boilerplate(value)) candidates.push(value);
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
  const seen = new Set();
  for (const match of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(match[1]);
    if (text.length < 45 || boilerplate(text)) continue;
    if (/publicit|lire aussi|à lire aussi|articles? similaires?|tous droits|©/.test(text.toLowerCase())) continue;
    const key = text.toLowerCase().slice(0, 150);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(text);
    if (parts.join(' ').length >= 7000) break;
  }
  return parts.join('\n').slice(0, 7000);
}

function useful(value = '', minimum = 55) {
  const text = cleanText(value);
  return text.length >= minimum && !boilerplate(text);
}

async function enrichFromPage(url) {
  if (!/^https?:\/\//i.test(url || '')) return '';
  const html = await fetchHtml(url);
  const paragraphs = paragraphMaterial(html);
  const ld = jsonLdMaterial(html);
  const description = metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description');
  if (paragraphs.length >= 220) return paragraphs.slice(0, 7000);
  const combined = [...new Set([description, ld, paragraphs].map(cleanText).filter(text => useful(text, 45)))].join('\n');
  return combined.slice(0, 7000);
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

function requestMaterial(article, first) {
  const pieces = [article?.detail, article?.summary, first?.summary]
    .map(cleanText)
    .filter(text => useful(text, 35));
  return [...new Set(pieces)].join('\n').slice(0, 5000);
}

function shortTitleSummary(article) {
  const title = cleanText(article?.title || '').replace(/\s+-\s+[^-]{2,45}$/u, '').trim();
  if (!title) return 'Les informations essentielles sont disponibles dans l’article source.';
  const punctuation = /[.!?…]$/.test(title) ? '' : '.';
  return `L’article porte sur le sujet suivant : ${title}${punctuation}`;
}

async function retryWithMaterial(req, article, material) {
  const retryReq = cloneRequest(req, {
    ...article,
    url: '',
    summary: material,
    detail: material
  });
  const retry = await capture(groqHandler, retryReq);
  return JSON.parse(retry.body || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};

  let first = null;
  try {
    const captured = await capture(groqHandler, req);
    first = JSON.parse(captured.body || '{}');
    if (!first?.unavailable && first?.ai && useful(first.summary, 70)) return send(res, 200, first);
    if (!first?.unavailable && useful(first?.summary, 70)) return send(res, 200, first);
  } catch (error) {
    console.error('smart summary first pass:', String(error?.message || error).slice(0, 180));
  }

  let material = '';
  try {
    material = await enrichFromPage(String(article.url || '').slice(0, 2000));
  } catch (error) {
    console.error('smart summary enrichment:', String(error?.message || error).slice(0, 180));
  }

  if (!useful(material, 55)) material = requestMaterial(article, first);

  if (useful(material, 55)) {
    try {
      const result = await retryWithMaterial(req, article, material);
      if (!result?.unavailable && useful(result?.summary, 55)) {
        return send(res, 200, { ...result, unavailable: false, enriched: true });
      }
    } catch (error) {
      console.error('smart summary retry:', String(error?.message || error).slice(0, 180));
    }

    const extractive = cleanText(material).slice(0, 1200);
    if (extractive) {
      return send(res, 200, {
        ...(first || {}),
        summary: extractive,
        ai: false,
        unavailable: false,
        limited: extractive.length < 180,
        provider: 'source',
        enriched: true,
        model: ''
      });
    }
  }

  return send(res, 200, {
    ...(first || {}),
    summary: shortTitleSummary(article),
    ai: false,
    unavailable: false,
    limited: true,
    provider: 'title',
    enriched: false,
    model: ''
  });
};
