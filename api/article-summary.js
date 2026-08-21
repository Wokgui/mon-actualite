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
    return { html: decodeBuffer(buffer, type), finalUrl: url.href };
  }
  throw new Error('too many redirects');
}

function decodeHtml(value = '') {
  return repairMojibake(value
    .replace(/&nbsp;/gi, ' ')
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

function extractArticleText(html) {
  const region = chooseArticleRegion(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+(?:class|id)=["'][^"']*(?:related|recommend|newsletter|advert|promo|sidebar|share|social)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ');
  const paragraphs = [];
  const seen = new Set();
  for (const match of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
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

async function getArticleMaterial(article) {
  const rawUrl = String(article?.url || '').slice(0, 2000);
  const fallback = repairMojibake(String(article?.summary || ''));
  const title = repairMojibake(String(article?.title || ''));
  if (!rawUrl) return { title, text: '', fallback, finalUrl: '' };
  try {
    const decoded = googleNewsArticleId(rawUrl) ? await decodeGoogleNewsUrl(rawUrl) : rawUrl;
    const { html, finalUrl } = await fetchHtml(decoded);
    return { title, text: extractArticleText(html), fallback, finalUrl };
  } catch {
    return { title, text: '', fallback, finalUrl: rawUrl };
  }
}

async function aiGenerate(system, prompt) {
  try {
    const { generateText } = await import('ai');
    const { text } = await generateText({ model: 'openai/gpt-5.6-sol', system, prompt, maxOutputTokens: 460 });
    const clean = repairMojibake(String(text || '').trim());
    return clean.length >= 80 ? clean : '';
  } catch (error) {
    console.error('AI summary unavailable:', String(error?.message || error).slice(0, 220));
    return '';
  }
}

const SYSTEM = `Tu es un rédacteur de presse factuel. Tu dois résumer EXCLUSIVEMENT le contenu source fourni pour l'article demandé. Ignore toute navigation, recommandation, publicité, lien « à lire aussi », contenu d'un autre article ou texte sans rapport qui aurait été extrait de la page. N'ajoute aucun fait, nom, chiffre, contexte externe, opinion, conseil ou connaissance générale qui n'apparaît pas dans la source. Si une information n'est pas suffisamment étayée par le texte, ne l'écris pas. Commence par le fait principal. Utilise un français naturel et précis.`;

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && req.query?.status) {
    return send(res, 200, { ok: true, aiSdk: true, hasOidc: Boolean(process.env.VERCEL_OIDC_TOKEN), hasGatewayKey: Boolean(process.env.AI_GATEWAY_API_KEY) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = body.mode === 'category' ? 'category' : 'article';

  if (mode === 'category') {
    const category = repairMojibake(String(body.category || 'cette rubrique')).slice(0, 80);
    const articles = Array.isArray(body.articles) ? body.articles.slice(0, 4) : [];
    const materials = await Promise.all(articles.map(getArticleMaterial));
    const source = materials.map((item, i) => `ARTICLE ${i + 1} — ${item.title}\n${item.text || item.fallback}`).join('\n\n').slice(0, 30000);
    const prompt = `Synthétise l'actualité de la rubrique « ${category} » uniquement à partir des articles ci-dessous. Fais 5 à 7 phrases, environ 120 à 180 mots, réparties en 2 ou 3 paragraphes courts séparés par une ligne vide. Regroupe seulement les informations qui concernent réellement le même sujet. N'introduis aucun élément extérieur aux textes.\n\n${source}`;
    let generated = source.length >= 120 ? await aiGenerate(SYSTEM, prompt) : '';
    if (generated && !summarySupported(generated, source)) generated = '';
    const fallback = materials.map(item => sentenceFallback(item.text, item.fallback)).filter(Boolean).slice(0, 3).join('\n\n');
    return send(res, 200, { summary: paragraphize(generated || fallback || `Aucun résumé disponible pour ${category}.`, 2), ai: Boolean(generated) });
  }

  const article = body.article || {};
  const material = await getArticleMaterial(article);
  const source = material.text || material.fallback;
  const prompt = `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots. Fais exactement 2 paragraphes courts séparés par une ligne vide. Le premier paragraphe donne le fait principal et son contexte immédiat. Le second donne les précisions, conséquences ou chiffres présents dans le texte. Ne parle d'aucun autre sujet, même s'il apparaît dans des recommandations de la page.\n\nTITRE : ${material.title}\n\nTEXTE SOURCE :\n${source}`;
  let generated = source.length >= 120 ? await aiGenerate(SYSTEM, prompt) : '';
  if (generated && !summarySupported(generated, `${material.title}\n${source}`)) generated = '';
  const summary = paragraphize(generated || sentenceFallback(material.text, material.fallback), 2);
  return send(res, 200, { summary, ai: Boolean(generated), articleUrl: material.finalUrl || String(article?.url || '') });
};
