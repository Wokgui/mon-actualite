const dns = require('node:dns').promises;
const net = require('node:net');

const TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 2_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'private, max-age=0, s-maxage=21600' : 'no-store');
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
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('not html');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('page too large');
    return { html: buffer.toString('utf8'), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function decodeHtml(value = '') {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanText(value = '') {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractArticleText(html) {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const paragraphs = [];
  const seen = new Set();
  for (const match of cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(match[1]);
    if (text.length < 55) continue;
    if (/cookies?|abonnez|inscrivez|newsletter|publicit|©|tous droits|javascript/i.test(text)) continue;
    const key = text.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(text);
    if (paragraphs.join(' ').length > 14000) break;
  }
  return paragraphs.join('\n').slice(0, 14000);
}

function sentenceFallback(text, fallback = '') {
  const source = (text || fallback || '').replace(/\s+/g, ' ').trim();
  if (!source) return 'Résumé indisponible pour cet article.';
  const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [source];
  const selected = sentences.map(s => s.trim()).filter(s => s.length > 35).slice(0, 5);
  const result = selected.join(' ');
  return (result || source).slice(0, 900);
}

async function getArticleMaterial(article) {
  const rawUrl = String(article?.url || '').slice(0, 2000);
  if (!rawUrl) return { title: String(article?.title || ''), text: '', fallback: String(article?.summary || ''), finalUrl: '' };
  try {
    const decoded = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
    const { html, finalUrl } = await fetchHtml(decoded);
    return { title: String(article?.title || ''), text: extractArticleText(html), fallback: String(article?.summary || ''), finalUrl };
  } catch {
    return { title: String(article?.title || ''), text: '', fallback: String(article?.summary || ''), finalUrl: rawUrl };
  }
}

async function aiGenerate(system, prompt) {
  try {
    const { generateText } = await import('ai');
    const { text } = await generateText({
      model: 'openai/gpt-5.6-sol',
      system,
      prompt,
      maxOutputTokens: 420
    });
    const clean = String(text || '').trim();
    return clean.length >= 80 ? clean : '';
  } catch (error) {
    console.error('AI summary unavailable:', String(error?.message || error).slice(0, 220));
    return '';
  }
}

const SYSTEM = `Tu es un rédacteur de presse factuel. Résume uniquement les informations présentes dans le texte fourni. N'écris ni accroche, ni formule promotionnelle, ni opinion, ni conseil. Commence directement par les faits. Donne le contexte nécessaire, les éléments importants et les conséquences concrètes lorsqu'elles sont indiquées. N'invente rien et signale implicitement l'incertitude du texte source.`;

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && req.query?.status) {
    return send(res, 200, { ok: true, aiSdk: true, hasOidc: Boolean(process.env.VERCEL_OIDC_TOKEN), hasGatewayKey: Boolean(process.env.AI_GATEWAY_API_KEY) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = body.mode === 'category' ? 'category' : 'article';

  if (mode === 'category') {
    const category = String(body.category || 'cette rubrique').slice(0, 80);
    const articles = Array.isArray(body.articles) ? body.articles.slice(0, 4) : [];
    const materials = await Promise.all(articles.map(getArticleMaterial));
    const source = materials.map((item, i) => `ARTICLE ${i + 1} — ${item.title}\n${item.text || item.fallback}`).join('\n\n').slice(0, 30000);
    const prompt = `Fais un résumé cohérent de l'actualité de la rubrique « ${category} » à partir des articles ci-dessous. 5 à 7 phrases, environ 120 à 180 mots. Fusionne les informations qui parlent du même sujet et privilégie les faits réellement importants.\n\n${source}`;
    const generated = source ? await aiGenerate(SYSTEM, prompt) : '';
    const fallback = materials.map(item => sentenceFallback(item.text, item.fallback)).filter(Boolean).slice(0, 3).join(' ');
    return send(res, 200, { summary: generated || fallback || `Aucun résumé disponible pour ${category}.`, ai: Boolean(generated) });
  }

  const article = body.article || {};
  const material = await getArticleMaterial(article);
  const source = material.text || material.fallback;
  const prompt = `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots. Le résumé doit permettre de comprendre l'information sans lire l'article et doit commencer par le fait principal.\n\nTITRE : ${material.title}\n\nTEXTE :\n${source}`;
  const generated = source ? await aiGenerate(SYSTEM, prompt) : '';
  return send(res, 200, {
    summary: generated || sentenceFallback(material.text, material.fallback),
    ai: Boolean(generated),
    articleUrl: material.finalUrl || String(article?.url || '')
  });
};
