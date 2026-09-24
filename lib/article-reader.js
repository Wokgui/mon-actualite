'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const GOOGLE_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const FETCH_TIMEOUT_MS = 5200;
const MAX_HTML_BYTES = 2_800_000;
const MAX_TEXT_CHARS = 22_000;

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

function cleanText(value = '') {
  return decode(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(value = '') {
  return cleanText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    const v = address.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:');
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
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_UA, 'Accept': 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' }
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
    const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"FR:fr",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
    const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

function paywallSignal(html = '', finalUrl = '') {
  const urlText = String(finalUrl || '').toLowerCase();
  if (/\/(?:login|connexion|subscribe|subscription|abonnement|paywall)(?:\/|\?|$)/i.test(urlText)) return 'restricted-url';
  const probe = String(html || '').slice(0, 1_600_000);
  const strong = [
    /article\s+(?:est\s+)?r[eé]serv[eé]\s+aux\s+abonn[eé]s/i,
    /contenu\s+r[eé]serv[eé]\s+aux\s+abonn[eé]s/i,
    /abonnez[- ]vous\s+pour\s+(?:lire|acc[eé]der|continuer)/i,
    /(?:continuez|poursuivez)\s+(?:votre\s+)?lecture\s+en\s+vous\s+abonnant/i,
    /class=["'][^"']*\bpaywall\b[^"']*["']/i,
    /data-(?:paywall|subscription|subscriber-only)=/i,
    /id=["'][^"']*\bpaywall\b[^"']*["']/i
  ];
  return strong.some(rx => rx.test(probe)) ? 'paywall-marker' : '';
}

function stripNoise(html = '') {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(?:nav|footer|header|aside)\b[\s\S]*?<\/(?:nav|footer|header|aside)>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');
}

function collectArticleBodies(value, out, depth = 0) {
  if (depth > 8 || value == null || out.length >= 12) return;
  if (Array.isArray(value)) {
    value.forEach(item => collectArticleBodies(item, out, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const type = Array.isArray(value['@type']) ? value['@type'].join(' ') : String(value['@type'] || '');
  const body = typeof value.articleBody === 'string' ? cleanText(value.articleBody) : '';
  if (body && /Article|NewsArticle|ReportageNewsArticle|AnalysisNewsArticle/i.test(type || 'Article')) out.push(body);
  for (const child of Object.values(value)) collectArticleBodies(child, out, depth + 1);
}

function jsonLdBodies(html = '') {
  const out = [];
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectArticleBodies(JSON.parse(decode(match[1]).trim()), out); } catch {}
    if (out.length >= 12) break;
  }
  return out;
}

function paragraphCandidates(html = '') {
  const cleaned = stripNoise(html);
  const blocks = [];
  for (const match of cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) blocks.push(match[1]);
  if (!blocks.length) {
    for (const match of cleaned.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)) blocks.push(match[1]);
  }
  if (!blocks.length) blocks.push(cleaned);

  const candidates = [];
  for (const block of blocks.sort((a, b) => b.length - a.length).slice(0, 3)) {
    const paragraphs = [];
    for (const match of block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = cleanText(match[1]);
      if (text.length < 45) continue;
      if (/^(?:publicit[eé]|newsletter|abonnez-vous|lire aussi|voir aussi|partager|suivez-nous)\b/i.test(text)) continue;
      if (/cookies?|conditions g[eé]n[eé]rales|politique de confidentialit[eé]/i.test(text) && text.length < 220) continue;
      paragraphs.push(text);
    }
    if (paragraphs.length) candidates.push(paragraphs);
  }
  return candidates;
}

function titleTokens(value = '') {
  const stop = new Set('avec dans pour plus apres avant cette sont etre leur leurs tout mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous article direct video'.split(' '));
  return [...new Set(normalize(value).split(/\s+/).filter(word => word.length >= 4 && !stop.has(word)))].slice(0, 20);
}

function relevance(text = '', title = '') {
  const wanted = titleTokens(title);
  if (!wanted.length) return 1;
  const hay = new Set(normalize(text).split(/\s+/));
  return wanted.filter(word => hay.has(word)).length / wanted.length;
}

function dedupeParagraphs(paragraphs = []) {
  const out = [];
  const seen = new Set();
  for (const raw of paragraphs) {
    const text = cleanText(raw);
    if (!text) continue;
    const key = normalize(text).slice(0, 240);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.join('\n\n').length >= MAX_TEXT_CHARS) break;
  }
  return out;
}

function bestExtractedText(html = '', title = '') {
  const bodyCandidates = jsonLdBodies(html)
    .map(text => ({ text: cleanText(text), source: 'jsonld' }))
    .filter(item => item.text.length >= 700);

  const paragraphSets = paragraphCandidates(html).map(paragraphs => ({
    paragraphs: dedupeParagraphs(paragraphs),
    source: 'html'
  })).filter(item => item.paragraphs.length >= 3);

  const candidates = [
    ...bodyCandidates.map(item => ({ text: item.text, paragraphs: dedupeParagraphs(item.text.split(/\n\n+/)), source: item.source })),
    ...paragraphSets.map(item => ({ text: item.paragraphs.join('\n\n'), paragraphs: item.paragraphs, source: item.source }))
  ].filter(item => item.text.length >= 700);

  candidates.sort((a, b) => {
    const ar = relevance(a.text.slice(0, 3500), title);
    const br = relevance(b.text.slice(0, 3500), title);
    return (br - ar) || (b.text.length - a.text.length);
  });

  const best = candidates[0];
  if (!best) return null;
  const score = relevance(best.text.slice(0, 3500), title);
  if (titleTokens(title).length >= 4 && score < 0.12) return null;
  const paragraphs = best.paragraphs.length > 1
    ? best.paragraphs
    : dedupeParagraphs(best.text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [best.text]);
  const text = paragraphs.join('\n\n').slice(0, MAX_TEXT_CHARS);
  return { text, paragraphs: paragraphs.filter(Boolean).slice(0, 80), source: best.source };
}

async function readHtml(rawUrl) {
  const decodedUrl = await decodeGoogleNewsUrl(rawUrl);
  const { response, finalUrl } = await fetchWithRedirects(decodedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
  });
  if ([401, 402, 403].includes(response.status)) return { restricted: true, reason: `HTTP ${response.status}`, finalUrl };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = String(response.headers.get('content-type') || '');
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not html');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_HTML_BYTES) throw new Error('page too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
  return { html: buffer.toString('utf8'), finalUrl };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=7200' : 'no-store');
  return res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' });
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse(await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > 16_000) reject(new Error('body too large')); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    })); } catch { body = {}; }
  }

  const url = String(body?.url || '').trim().slice(0, 2200);
  const title = String(body?.title || '').trim().slice(0, 320);
  if (!/^https?:\/\//i.test(url)) return send(res, 400, { ok: false, error: 'invalid-url' });

  try {
    const page = await readHtml(url);
    if (page.restricted) return send(res, 200, { ok: false, restricted: true, reason: page.reason, finalUrl: page.finalUrl });
    const paywall = paywallSignal(page.html, page.finalUrl);
    if (paywall) return send(res, 200, { ok: false, restricted: true, reason: paywall, finalUrl: page.finalUrl });

    const extracted = bestExtractedText(page.html, title);
    if (!extracted || extracted.text.length < 700) {
      return send(res, 200, { ok: false, unavailable: true, finalUrl: page.finalUrl });
    }

    return send(res, 200, {
      ok: true,
      free: true,
      finalUrl: page.finalUrl,
      text: extracted.text,
      paragraphs: extracted.paragraphs,
      source: extracted.source
    });
  } catch (error) {
    return send(res, 200, { ok: false, unavailable: true, error: String(error?.message || error).slice(0, 120) });
  }
};
