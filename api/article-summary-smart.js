const dns = require('node:dns').promises;
const net = require('node:net');
const groqHandler = require('./article-summary-groq.js');

const TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 8_000_000;
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
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
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

  const { signature, timestamp } = await fetchGoogleParams(id);
  const innerRequest = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"FR:fr",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`;
  const response = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

function repairMojibake(value = '') {
  const replacements = [
    ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'], ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'],
    ['Â ', ' '], ['Â«', '«'], ['Â»', '»'], ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã«', 'ë'],
    ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã§', 'ç'], ['Ã®', 'î'], ['Ã¯', 'ï'], ['Ã´', 'ô'], ['Ã¹', 'ù'], ['Ã»', 'û'],
    ['Ã‰', 'É'], ['Å“', 'œ']
  ];
  let text = String(value || '');
  for (const [bad, good] of replacements) text = text.split(bad).join(good);
  return text.replace(/\uFFFD+/g, '');
}

function decodeBuffer(buffer, contentType = '') {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i) || [])[1]
    || (probe.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i) || [])[1]
    || (probe.match(/<meta[^>]+content=["'][^"']*charset=([^;"'\s]+)/i) || [])[1]
    || 'utf-8';
  const charset = String(declared).toLowerCase().replace(/^['"]|['"]$/g, '');
  const normalized = /^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(charset) ? 'windows-1252' : 'utf-8';
  try { return repairMojibake(new TextDecoder(normalized).decode(buffer)); }
  catch { return repairMojibake(buffer.toString('utf8')); }
}

function decode(value = '') {
  return repairMojibake(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’').replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”')
    .replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
    .replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»')
    .replace(/&eacute;/gi, 'é').replace(/&egrave;/gi, 'è').replace(/&agrave;/gi, 'à')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } }));
}

function cleanText(value = '') {
  return decode(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function boilerplate(value = '') {
  const text = cleanText(value).toLowerCase();
  return !text
    || /ouvrez?\s+l[’']article|consultez?\s+(?:les?\s+)?détails|détails publiés par la source/.test(text)
    || /résumé indisponible|flux ne fournit pas assez de texte/.test(text)
    || /connectez[- ]?vous|se connecter|abonnez[- ]?vous|newsletter|cookies?|partager cet article/.test(text)
    || /lire\s+(?:tous\s+)?nos\s+articles(?:,\s*analyses)?(?:\s+et\s+reportages)?/.test(text)
    || /retrouvez?\s+notre\s+(?:précédent|ancien|nouveau)\s+live|en cliquant sur ce lien/.test(text)
    || /ce live est fermé|basculer vers (?:notre|le) nouveau live/.test(text)
    || /pourquoi votre soutien est essentiel|pour faire vivre nos lives|soutenez (?:une|notre) rédaction/.test(text)
    || /accédez à tous nos contenus|articles les plus lus|lire plus tard|temps de lecture/.test(text);
}

function isLiveArticle(article = {}) {
  const title = cleanText(article.title || '').toLowerCase();
  const url = String(article.url || '').toLowerCase();
  return /\b(?:en direct|direct|live)\b/.test(title) || /\/(?:live|direct)\//.test(url);
}

async function readResponseBuffer(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const full = Buffer.from(await response.arrayBuffer());
    return full.byteLength > MAX_HTML_BYTES ? full.subarray(0, MAX_HTML_BYTES) : full;
  }
  const chunks = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value || []);
    if (!chunk.byteLength) continue;
    const remaining = MAX_HTML_BYTES - total;
    chunks.push(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
    total += Math.min(chunk.byteLength, remaining);
    if (chunk.byteLength > remaining) break;
  }
  try { await reader.cancel(); } catch {}
  return Buffer.concat(chunks, total);
}

async function fetchHtml(rawUrl) {
  let current = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
  for (let i = 0; i < 6; i++) {
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
    const buffer = await readResponseBuffer(response);
    return { html: decodeBuffer(buffer, type), finalUrl: url.href };
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

function parseJsonLd(html) {
  const documents = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try { documents.push(JSON.parse(raw)); continue; } catch {}
    try { documents.push(JSON.parse(decode(raw))); } catch {}
  }
  return documents;
}

function jsonLdMaterial(html) {
  const candidates = [];
  const visit = (node, depth = 0) => {
    if (depth > 10 || node == null) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    for (const key of ['articleBody', 'description', 'abstract', 'text']) {
      const value = cleanText(node[key] || '');
      if (value.length >= 45 && !boilerplate(value)) candidates.push(value);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  parseJsonLd(html).forEach(doc => visit(doc));
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function jsonLdLiveMaterial(html) {
  const candidates = [];
  const seen = new Set();

  const visit = (node, liveContext = false, depth = 0) => {
    if (depth > 12 || node == null) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, liveContext, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    const type = (Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '')).toLowerCase();
    const isLiveContainer = /liveblogposting/.test(type);
    const isUpdateType = /(?:blogposting|newsarticle|reportagenewsarticle)/.test(type) && !isLiveContainer;
    const isUpdate = liveContext || isUpdateType;

    if (isUpdate) {
      const parts = ['headline', 'articleBody', 'text', 'description', 'abstract']
        .map(key => cleanText(node[key] || ''))
        .filter(text => text.length >= 20 && !boilerplate(text));
      const text = [...new Set(parts)].join('. ').replace(/\.{2,}/g, '.').trim();
      if (text.length >= 45 && !boilerplate(text)) {
        const key = text.toLowerCase().slice(0, 180);
        if (!seen.has(key)) {
          seen.add(key);
          const rawDate = node.datePublished || node.dateModified || node.dateCreated || '';
          const parsed = Date.parse(rawDate);
          candidates.push({
            text,
            timestamp: Number.isFinite(parsed) ? parsed : 0,
            score: (liveContext ? 20 : 8) + (Number.isFinite(parsed) ? 5 : 0) + (node.headline ? 2 : 0)
          });
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      const nextLive = liveContext || isLiveContainer || /liveblogupdate|blogupdate|liveupdates?|updates?/i.test(key);
      visit(value, nextLive, depth + 1);
    }
  };

  parseJsonLd(html).forEach(doc => visit(doc));
  candidates.sort((a, b) => (b.score - a.score) || (b.timestamp - a.timestamp));

  const parts = [];
  let length = 0;
  for (const candidate of candidates) {
    if (length >= 7000 || parts.length >= 14) break;
    parts.push(candidate.text);
    length += candidate.text.length + 1;
  }
  return parts.join('\n').slice(0, 7000);
}

function stripNonContent(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi, ' ');
}

function liveDomMaterial(html) {
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [null, html])[1];
  const region = stripNonContent(main);
  const blocks = [];
  const seen = new Set();

  for (const match of region.matchAll(/<(h2|h3|h4|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const text = cleanText(match[2]);
    if (!text || boilerplate(text)) continue;
    if (tag === 'p' || tag === 'li') {
      if (text.length < 35) continue;
    } else if (text.length < 12) {
      continue;
    }
    if (/publicit|tous droits|sur le monde aujourd|nos services|voir plus|voir moins|réservé aux abonnés/i.test(text.toLowerCase())) continue;
    const key = text.toLowerCase().slice(0, 170);
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ tag, text });
    if (blocks.length >= 90) break;
  }

  const essentialIndex = blocks.findIndex(block =>
    /(?:l[’']essentiel|le point sur la situation|ce qu[’']il faut retenir|à retenir)/i.test(block.text)
  );

  const choose = (start, maxBlocks) => {
    const out = [];
    let length = 0;
    let heading = '';
    for (let i = start; i < blocks.length && out.length < maxBlocks && length < 7000; i++) {
      const block = blocks[i];
      if (/^h[234]$/.test(block.tag)) {
        heading = block.text;
        if (/l[’']essentiel|point sur la situation|à retenir|urgent/i.test(heading)) {
          out.push(heading);
          length += heading.length + 1;
        }
        continue;
      }
      const text = heading && block.text.length < 220 ? `${heading} — ${block.text}` : block.text;
      if (boilerplate(text)) continue;
      out.push(text);
      length += text.length + 1;
    }
    return out.join('\n').slice(0, 7000);
  };

  const latest = choose(0, 24);
  if (latest.length >= 220) return latest;

  if (essentialIndex >= 0) {
    const essential = choose(essentialIndex, 18);
    if (essential.length >= 220) return essential;
  }
  return latest;
}

function paragraphMaterial(html) {
  const region = ([...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .sort((a, b) => b[1].length - a[1].length)[0] || [null, html])[1];
  const parts = [];
  const seen = new Set();
  for (const match of stripNonContent(region).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
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

async function enrichFromPage(url, live = false) {
  if (!/^https?:\/\//i.test(url || '')) return '';
  const { html } = await fetchHtml(url);

  if (live) {
    const liveLd = jsonLdLiveMaterial(html);
    if (useful(liveLd, 180)) return liveLd.slice(0, 7000);

    const liveDom = liveDomMaterial(html);
    if (useful(liveDom, 180)) return liveDom.slice(0, 7000);
  }

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

function extractiveSummary(material) {
  const seen = new Set();
  const selected = [];
  for (const line of String(material || '').split(/\n+/)) {
    const clean = cleanText(line);
    if (!clean || boilerplate(clean)) continue;
    const parts = clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [clean];
    for (const part of parts) {
      const sentence = part.trim();
      if (sentence.length < 35 || boilerplate(sentence)) continue;
      const key = sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 150);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(sentence);
      if (selected.length >= 6) break;
    }
    if (selected.length >= 6) break;
  }
  const text = selected.join(' ').slice(0, 1100).trim();
  if (!text) return '';
  if (selected.length >= 4) {
    const cut = Math.ceil(selected.length / 2);
    return `${selected.slice(0, cut).join(' ')}\n\n${selected.slice(cut).join(' ')}`.slice(0, 1100);
  }
  return text;
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
  if (req.method === 'GET' && req.query?.status) {
    return send(res, 200, { ok: true, version: 'live-v2-latest-first', maxHtmlBytes: MAX_HTML_BYTES });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};
  const live = isLiveArticle(article);

  let first = null;
  try {
    const captured = await capture(groqHandler, req);
    first = JSON.parse(captured.body || '{}');
    if (!live && !first?.unavailable && first?.ai && useful(first.summary, 70)) return send(res, 200, first);
    if (!live && !first?.unavailable && useful(first?.summary, 70)) return send(res, 200, first);
  } catch (error) {
    console.error('smart summary first pass:', String(error?.message || error).slice(0, 180));
  }

  let material = '';
  try {
    material = await enrichFromPage(String(article.url || '').slice(0, 2000), live);
  } catch (error) {
    console.error(`smart summary enrichment${live ? ' live' : ''}:`, String(error?.message || error).slice(0, 220));
  }

  if (!useful(material, 55)) material = requestMaterial(article, first);

  if (useful(material, 55)) {
    try {
      const result = await retryWithMaterial(req, article, material);
      if (!result?.unavailable && useful(result?.summary, 55)) {
        return send(res, 200, {
          ...result,
          unavailable: false,
          enriched: true,
          live,
          extraction: live ? 'live-page' : 'article-page'
        });
      }
    } catch (error) {
      console.error('smart summary retry:', String(error?.message || error).slice(0, 180));
    }

    const extractive = extractiveSummary(material);
    if (extractive) {
      return send(res, 200, {
        ...(first || {}),
        summary: extractive,
        ai: false,
        unavailable: false,
        limited: extractive.length < 180,
        provider: live ? 'live-source' : 'source',
        enriched: true,
        live,
        extraction: live ? 'live-page' : 'article-page',
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
    live,
    model: ''
  });
};
