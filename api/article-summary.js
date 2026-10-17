const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 9000;
const SEARCH_TIMEOUT_MS = 5500;
const SEARCH_BUDGET_MS = 6500;
const GEMINI_TIMEOUT_MS = 18000;
const MAX_HTML_BYTES = 2_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const GEMINI_MODELS = [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite'
].filter(Boolean))];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const transientFailure = Boolean(payload?.unavailable)
    || /indisponible/i.test(String(payload?.summary || ''))
    || ['timeout', 'fetch-error', 'anti-bot-or-rate-limit'].includes(payload?.diagnostics?.failureType);
  res.setHeader('Cache-Control', status === 200 && !transientFailure
    ? 'private, max-age=0, s-maxage=900'
    : 'no-store');
  res.end(JSON.stringify(payload));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA, 'Referer': 'https://news.google.com/' },
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
    ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã§', 'ç'], ['Ã®', 'î'], ['Ã¯', 'ï'], ['Ã´', 'ô'], ['Ã¹', 'ù'], ['Ã»', 'û'], ['Ã‰', 'É'], ['Å“', 'œ']
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

async function fetchHtml(rawUrl) {
  const startedAt = Date.now();
  let current = rawUrl;
  let retryCount = 0;
  for (let i = 0; i < 6; i++) {
    const url = await assertPublicUrl(current);
    let response;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5' } });
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          retryCount += 1;
          const retryAfter = Number(response.headers.get('retry-after') || 0) * 1000;
          await wait(Math.min(900, Math.max(180, retryAfter || 260)));
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          retryCount += 1;
          await wait(220);
          continue;
        }
      }
    }
    if (!response) throw lastError || new Error('fetch unavailable');
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
    return {
      html: decodeBuffer(buffer, type),
      finalUrl: url.href,
      httpStatus: response.status,
      contentType: type,
      htmlBytes: buffer.byteLength,
      fetchMs: Date.now() - startedAt,
      retryCount
    };
  }
  throw new Error('too many redirects');
}

function decodeHtml(value = '') {
  return repairMojibake(value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&hellip;/gi, '…').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
    .replace(/&rsquo;/gi, '’').replace(/&lsquo;/gi, '‘').replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))));
}

function cleanText(value = '') {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function chooseArticleRegion(html) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1]);
  if (articles.length) return articles.sort((a, b) => b.length - a.length)[0];
  const mains = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)].map(m => m[1]);
  if (mains.length) return mains.sort((a, b) => b.length - a.length)[0];
  return html;
}

function cleanArticleRegion(region = '') {
  return region
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+(?:class|id)=["'][^"']*(?:related|recommend|newsletter|advert|promo|sidebar|share|social)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ');
}

function extractParagraphText(region = '') {
  const cleaned = cleanArticleRegion(region);
  const paragraphs = [];
  const seen = new Set();
  for (const match of cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(match[1]);
    if (text.length < 55) continue;
    if (/cookies?|abonnez|inscrivez|newsletter|publicit|©|tous droits|javascript|lire aussi|à lire aussi|articles? similaires?/i.test(text)) continue;
    const key = text.toLowerCase().slice(0, 140);
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(text);
    if (paragraphs.join(' ').length > 14000) break;
  }
  return paragraphs.join('\n').slice(0, 14000);
}

function jsonLdNodes(value) {
  const output = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    output.push(node);
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(child => {
      if (child && typeof child === 'object') visit(child);
    });
  };
  visit(value);
  return output;
}

function extractJsonLd(html = '') {
  let bestBody = '';
  let bestDescription = '';
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      try { parsed = JSON.parse(decodeHtml(raw)); } catch { continue; }
    }
    for (const node of jsonLdNodes(parsed)) {
      const body = cleanText(String(node.articleBody || node.text || ''));
      if (body.length > bestBody.length) bestBody = body;
      const description = cleanText(String(node.description || ''));
      if (description.length > bestDescription.length) bestDescription = description;
    }
  }
  return { body: bestBody.slice(0, 14000), description: bestDescription.slice(0, 1800) };
}

function metaContent(html = '', key = '') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const value = cleanText((html.match(pattern) || [])[1] || '');
    if (value) return value;
  }
  return '';
}

function extractArticleContent(html = '') {
  const structured = extractJsonLd(html);
  if (structured.body.length >= 180) return { text: structured.body, method: 'json-ld-articleBody', fullText: true };

  const preferred = extractParagraphText(chooseArticleRegion(html));
  if (preferred.length >= 180) return { text: preferred, method: 'article-paragraphs', fullText: true };

  const broad = extractParagraphText(html);
  if (broad.length >= 220) return { text: broad, method: 'document-paragraphs', fullText: true };

  const description = [
    structured.description,
    metaContent(html, 'og:description'),
    metaContent(html, 'twitter:description'),
    metaContent(html, 'description')
  ].map(cleanText).sort((a, b) => b.length - a.length)[0] || '';
  if (description.length >= 60) return { text: description, method: 'page-metadata', fullText: false };
  return { text: '', method: 'none', fullText: false };
}

function extractArticleText(html) {
  return extractArticleContent(html).text;
}

function sentences(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
}

function paragraphize(text = '', wanted = 2) {
  const clean = repairMojibake(String(text || '').trim()).replace(/\n{3,}/g, '\n\n');
  if (!clean) return '';
  const existing = clean.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (existing.length >= wanted) return existing.slice(0, Math.max(wanted, 3)).join('\n\n');
  const parts = sentences(clean);
  if (parts.length < 4) return clean.replace(/\s+/g, ' ');
  const cut = Math.ceil(parts.length / wanted);
  const groups = [];
  for (let i = 0; i < parts.length; i += cut) groups.push(parts.slice(i, i + cut).join(' '));
  return groups.join('\n\n');
}

function sentenceFallback(text, fallback = '') {
  const source = repairMojibake((text || fallback || '').replace(/\s+/g, ' ').trim());
  if (!source) return 'Résumé indisponible pour cet article.';
  const selected = sentences(source).filter(s => s.length > 35).slice(0, 5);
  const result = (selected.join(' ') || source).slice(0, 1000);
  return paragraphize(result, 2);
}

function meaningfulTokens(value = '') {
  const stop = new Set(['alors','après','avant','avec','avoir','cette','comme','dans','depuis','devrait','elles','entre','étaient','faire','leurs','mais','même','moins','notamment','nous','plus','pour','sans','selon','sont','sous','tout','toute','toutes','tous','très','vers','votre','ainsi','cela','celui','celle','être','fait','faits']);
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{5,}/g)?.filter(t => !stop.has(t)) || [];
}

function summarySupported(summary, source) {
  const generated = meaningfulTokens(summary);
  if (generated.length < 8) return false;
  const sourceSet = new Set(meaningfulTokens(source));
  if (!sourceSet.size) return false;
  const supported = generated.filter(token => sourceSet.has(token)).length;
  return supported / generated.length >= 0.28;
}

function normalizedWords(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article','direct']);
  return [...new Set(repairMojibake(String(value || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate = '', expected = '') {
  const wanted = normalizedWords(expected);
  const found = new Set(normalizedWords(candidate));
  if (!wanted.length || !found.size) return 0;
  return wanted.filter(word => found.has(word)).length / Math.max(1, Math.min(wanted.length, found.size));
}

function xmlValue(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? cleanText(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
}

function googleNewsUrl(rawUrl = '') {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'news.google.com' || host.endsWith('.news.google.com');
  } catch { return false; }
}

function trustedFeedFallback(article = {}, fallback = '') {
  const text = cleanText(fallback);
  if (text.length < 55 || googleNewsUrl(article?.url || '')) return '';
  return text;
}

function searchQueries(title = '') {
  const stripped = cleanText(title).replace(/\s+[-–—|]\s+[^-–—|]{2,70}$/, '').slice(0, 220);
  const words = stripped.split(/\s+/).filter(Boolean);
  const tokens = normalizedWords(stripped).filter(word => word.length >= 4);
  return [...new Set([
    `"${stripped}"`,
    words.length > 10 ? words.slice(0, 9).join(' ') : stripped,
    tokens.slice(0, 8).join(' '),
    tokens.slice(0, 6).join(' ')
  ].filter(value => value && normalizedWords(value).length >= 3))];
}

function cleanSearchSnippet(value = '', title = '') {
  let text = cleanText(value)
    .replace(/^.{0,40}\b(?:lire la suite|read full story)\b\s*[:–—-]?\s*/i, '')
    .replace(/\s+(?:lire la suite|read full story)\s*$/i, '')
    .trim();
  const normalizedTitle = cleanText(title).replace(/\s+[-–—|]\s+[^-–—|]{2,70}$/, '').trim();
  if (normalizedTitle && text.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    text = text.slice(normalizedTitle.length).replace(/^[\s:–—-]+/, '').trim();
  }
  const relatedCut = text.search(/\s*(?:\.{3}|…|&hellip;|·)\s*/i);
  if (relatedCut >= 70) {
    const prefix = text.slice(0, relatedCut).trim();
    const complete = prefix.match(/^[\s\S]*[.!?](?=\s|$)/)?.[0]?.trim() || '';
    if (complete.length >= 55) text = complete;
    else return '';
  }
  const selected = [];
  for (const sentence of sentences(text)) {
    if (selected.length && titleAgreement(sentence, title) >= 0.72) break;
    selected.push(sentence);
    if (selected.length >= 2 || selected.join(' ').length >= 520) break;
  }
  if (selected.join(' ').length >= 55) text = selected.join(' ');
  return text.slice(0, 1800);
}

function googleAggregateHeadlines(value = '') {
  const parts = decodeHtml(String(value || '')).split(/\s{2,}/).map(cleanText).filter(Boolean);
  if (parts.length < 4) return [];
  return parts.filter((_, index) => index % 2 === 0).slice(0, 5);
}

async function fetchSearchFallback(article = {}) {
  const title = cleanText(article.title || '');
  if (normalizedWords(title).length < 3) return { text: '', evidenceCount: 0, source: '', error: 'search-title-too-short' };
  const expectedSource = cleanText(article.source || '').toLowerCase();
  const candidates = [];
  let lastError = '';
  const searchStartedAt = Date.now();
  const subjects = [title, ...(googleNewsUrl(article.url || '') ? googleAggregateHeadlines(article.summary || article.detail || '').slice(1, 4) : [])];
  const searches = subjects.flatMap(subject => searchQueries(subject).map(query => ({ query, subject }))).slice(0, 10);
  for (const { query, subject } of searches) {
    const remainingMs = SEARCH_BUDGET_MS - (Date.now() - searchStartedAt);
    if (remainingMs < 300) {
      lastError = lastError || 'search-budget-exhausted';
      break;
    }
    try {
      const url = new URL('https://www.bing.com/news/search');
      url.search = new URLSearchParams({ q: query, format: 'RSS', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(SEARCH_TIMEOUT_MS, remainingMs)),
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      if (!response.ok) { lastError = `search HTTP ${response.status}`; continue; }
      const xml = await response.text();
      for (const item of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 30)) {
        const itemTitle = xmlValue(item, 'title');
        const agreement = titleAgreement(itemTitle, subject);
        if (agreement < 0.56) continue;
        const snippet = cleanSearchSnippet(xmlValue(item, 'News:Description') || xmlValue(item, 'description'), itemTitle);
        if (snippet.length < 55
          || /^(?:découvrez|voici|comment|tout savoir|ce qu[’']il faut savoir)\b/i.test(snippet)
          || /\b(?:fait le point pour vous|cet article explore|pourraient? influencer votre santé)\b/i.test(snippet)
          || titleAgreement(snippet, title) > 0.96 && snippet.length < 120) continue;
        const source = xmlValue(item, 'News:Source') || xmlValue(item, 'source');
        const sourceBonus = expectedSource && source.toLowerCase().includes(expectedSource) ? 0.18 : 0;
        candidates.push({ text: snippet, source, score: agreement + sourceBonus, subject });
      }
      if (candidates.length) break;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 160);
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = candidates[0];
  return best
    ? { text: best.text, evidenceCount: candidates.length, source: best.source, queryTitle: best.subject, error: '' }
    : { text: '', evidenceCount: 0, source: '', error: lastError || 'search-no-match' };
}

async function getArticleMaterial(article) {
  const startedAt = Date.now();
  const rawUrl = String(article?.url || '').slice(0, 2000);
  const rawFallback = repairMojibake(String(article?.summary || article?.detail || ''));
  const feedFallback = trustedFeedFallback(article, rawFallback);
  const title = repairMojibake(String(article?.title || ''));
  const searchOrFeed = async () => {
    if (feedFallback) return {
      fallback: feedFallback,
      materialSource: 'rss',
      fallbackType: 'rss',
      fallbackQuality: 'trusted',
      search: { text: '', evidenceCount: 0, source: '', error: '' }
    };
    const search = await fetchSearchFallback(article).catch(error => ({ text: '', evidenceCount: 0, source: '', error: String(error?.message || error).slice(0, 160) }));
    if (search.text) return { fallback: search.text, materialSource: 'search-snippet', fallbackType: 'search-snippet', fallbackQuality: 'trusted', search };
    return { fallback: '', materialSource: 'none', fallbackType: googleNewsUrl(rawUrl) && rawFallback ? 'google-news-aggregate-rejected' : 'none', fallbackQuality: 'unavailable', search };
  };
  if (!rawUrl) {
    const recovered = await searchOrFeed();
    return {
      title,
      text: '',
      fallback: recovered.fallback,
      finalUrl: '',
      diagnostics: {
        materialSource: recovered.materialSource,
        contentChars: 0,
        sourceChars: recovered.fallback.length,
        fallbackChars: recovered.fallback.length,
        rawFallbackChars: rawFallback.length,
        fallbackType: recovered.fallbackType,
        fallbackQuality: recovered.fallbackQuality,
        searchEvidenceCount: recovered.search.evidenceCount,
        searchSource: recovered.search.source,
        searchError: recovered.search.error,
        failureType: 'url-missing',
        elapsedMs: Date.now() - startedAt
      }
    };
  }
  try {
    const decoded = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
    const page = await fetchHtml(decoded);
    const extracted = extractArticleContent(page.html);
    const recovered = extracted.text ? null : await searchOrFeed();
    const text = extracted.text;
    const fallback = recovered?.fallback || feedFallback;
    const materialSource = text
      ? (extracted.fullText ? 'full-text' : 'page-snippet')
      : recovered.materialSource;
    return {
      title,
      text,
      fallback,
      finalUrl: page.finalUrl,
      diagnostics: {
        materialSource,
        contentChars: text.length,
        sourceChars: (text || fallback).length,
        fallbackChars: fallback.length,
        rawFallbackChars: rawFallback.length,
        extractionMethod: extracted.method,
        fallbackType: text ? (extracted.fullText ? 'none' : 'page-metadata') : recovered.fallbackType,
        fallbackQuality: text || fallback ? 'trusted' : 'unavailable',
        googleNewsDecoded: decoded !== rawUrl,
        httpStatus: page.httpStatus,
        contentType: page.contentType,
        htmlBytes: page.htmlBytes,
        retryCount: page.retryCount,
        searchEvidenceCount: recovered?.search?.evidenceCount || 0,
        searchSource: recovered?.search?.source || '',
        searchError: recovered?.search?.error || '',
        failureType: text ? '' : 'extraction-empty',
        fetchMs: page.fetchMs,
        elapsedMs: Date.now() - startedAt
      }
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 180);
    const failureType = /timeout|abort/i.test(`${error?.name || ''} ${message}`) ? 'timeout'
      : /HTTP\s+401|HTTP\s+403|HTTP\s+429/i.test(message) ? 'anti-bot-or-rate-limit'
        : /Google (?:params|decode)/i.test(message) ? 'google-news-decode'
          : /not html/i.test(message) ? 'non-html'
            : /too large/i.test(message) ? 'page-too-large'
              : /private address|local host|unsupported protocol/i.test(message) ? 'blocked-url'
                : 'fetch-error';
    const recovered = await searchOrFeed();
    return {
      title,
      text: '',
      fallback: recovered.fallback,
      finalUrl: rawUrl,
      diagnostics: {
        materialSource: recovered.materialSource,
        contentChars: 0,
        sourceChars: recovered.fallback.length,
        fallbackChars: recovered.fallback.length,
        rawFallbackChars: rawFallback.length,
        extractionMethod: 'none',
        fallbackType: recovered.fallbackType,
        fallbackQuality: recovered.fallbackQuality,
        googleNewsDecoded: false,
        searchEvidenceCount: recovered.search.evidenceCount,
        searchSource: recovered.search.source,
        searchError: recovered.search.error,
        failureType,
        error: message,
        elapsedMs: Date.now() - startedAt
      }
    };
  }
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
}

async function callGemini(model, key, system, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 460 }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${model}: ${message}`);
  }
  const text = (payload?.candidates?.[0]?.content?.parts || []).map(part => part?.text || '').join('').trim();
  return repairMojibake(text);
}

async function aiGenerate(system, prompt) {
  const key = geminiKey();
  if (!key) {
    console.error('Gemini summary unavailable: GEMINI_API_KEY missing');
    return { text: '', model: '' };
  }
  let lastError = '';
  for (const model of GEMINI_MODELS) {
    try {
      const text = await callGemini(model, key, system, prompt);
      if (text.length >= 80) return { text, model };
      lastError = `${model}: réponse trop courte`;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 300);
    }
  }
  console.error('Gemini summary unavailable:', lastError || 'unknown error');
  return { text: '', model: '' };
}

const SYSTEM = `Tu es un rédacteur de presse factuel. Tu dois résumer EXCLUSIVEMENT le contenu source fourni pour l'article demandé. Ignore toute navigation, recommandation, publicité, lien « à lire aussi », contenu d'un autre article ou texte sans rapport qui aurait été extrait de la page. N'ajoute aucun fait, nom, chiffre, contexte externe, opinion, conseil ou connaissance générale qui n'apparaît pas dans la source. Si une information n'est pas suffisamment étayée par le texte, ne l'écris pas. Commence par le fait principal. Utilise un français naturel et précis. N'écris jamais un titre accrocheur, une introduction promotionnelle ou une formule destinée à donner envie de cliquer.`;

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && req.query?.status) {
    return send(res, 200, {
      ok: true,
      provider: 'gemini',
      model: GEMINI_MODELS[0],
      hasGeminiKey: Boolean(geminiKey()),
      gatewayDisabled: true
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = body.mode === 'category' ? 'category' : 'article';

  if (mode === 'category') {
    const category = repairMojibake(String(body.category || 'cette rubrique')).slice(0, 80);
    const articles = Array.isArray(body.articles) ? body.articles.slice(0, 4) : [];
    const materials = await Promise.all(articles.map(getArticleMaterial));
    const source = materials.map((item, i) => `ARTICLE ${i + 1} — ${item.title}\n${item.text || item.fallback}`).join('\n\n').slice(0, 30000);
    const prompt = `Fais un vrai résumé journalistique de l'actualité de la rubrique « ${category} » uniquement à partir des articles ci-dessous. Fais 5 à 7 phrases, environ 120 à 180 mots, réparties en 2 ou 3 paragraphes courts séparés par une ligne vide. Commence directement par les faits les plus importants. Regroupe seulement les informations qui concernent réellement le même sujet. Ne rédige ni accroche, ni slogan, ni conseil, ni phrase du type « à retenir ». N'introduis aucun élément extérieur aux textes.\n\n${source}`;
    const aiResult = !body.factualOnly && source.length >= 120 ? await aiGenerate(SYSTEM, prompt) : { text: '', model: '' };
    let generated = aiResult.text;
    if (generated && !summarySupported(generated, source)) generated = '';
    const fallback = materials.map(item => sentenceFallback(item.text, item.fallback)).filter(Boolean).slice(0, 3).join('\n\n');
    return send(res, 200, {
      summary: paragraphize(generated || fallback || `Aucun résumé disponible pour ${category}.`, 2),
      ai: Boolean(generated),
      provider: generated ? 'gemini' : 'extractif',
      model: generated ? aiResult.model : ''
    });
  }

  const article = body.article || {};
  const material = await getArticleMaterial(article);
  const source = material.text || material.fallback;
  const prompt = `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots. Fais exactement 2 paragraphes courts séparés par une ligne vide. Commence directement par le fait principal et son contexte immédiat. Le second paragraphe donne uniquement les précisions, conséquences ou chiffres présents dans le texte. Le résultat doit ressembler à un résumé de dépêche ou de journal, pas à une accroche destinée à faire cliquer. Ne parle d'aucun autre sujet, même s'il apparaît dans des recommandations de la page.\n\nTITRE : ${material.title}\n\nTEXTE SOURCE :\n${source}`;
  const aiResult = !body.factualOnly && source.length >= 120 ? await aiGenerate(SYSTEM, prompt) : { text: '', model: '' };
  let generated = aiResult.text;
  if (generated && !summarySupported(generated, `${material.title}\n${source}`)) generated = '';
  const summary = paragraphize(generated || sentenceFallback(material.text, material.fallback), 2);
  const unavailable = !summary || /résumé indisponible/i.test(summary);
  return send(res, 200, {
    summary,
    ai: Boolean(generated),
    grounded: !unavailable && source.length >= 55,
    unavailable,
    provider: generated ? 'gemini' : 'extractif',
    model: generated ? aiResult.model : '',
    articleUrl: material.finalUrl || String(article?.url || ''),
    diagnostics: {
      ...(material.diagnostics || {}),
      fallbackUsed: material.diagnostics?.materialSource !== 'full-text',
      fallbackQuality: unavailable ? 'unavailable' : (material.diagnostics?.fallbackQuality || 'trusted'),
      generatedByAi: Boolean(generated),
      summaryChars: summary.length
    }
  });
};

module.exports.getArticleMaterial = getArticleMaterial;
module.exports.extractArticleText = extractArticleText;
module.exports.extractArticleContent = extractArticleContent;
module.exports.sentenceFallback = sentenceFallback;
module.exports.trustedFeedFallback = trustedFeedFallback;
module.exports.cleanSearchSnippet = cleanSearchSnippet;
