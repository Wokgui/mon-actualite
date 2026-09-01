const legacyHandler = require('./article-summary-groq.js');

function clean(value = '') {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } })
    .replace(/\uFFFD+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentences(value = '') {
  return clean(value)
    .replace(/\n+/g, ' ')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => sentence.trim()).filter(Boolean) || [];
}

const STOP = new Set([
  'avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','tous','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','font','comme','dont','elle','elles','ils','nous','vous','notre','votre','aussi','encore','deja','tres','moins','depuis','alors','chez','contre','lors','peut','peuvent','avait','avoir','sera','un','le','la','du','de','au','en','et','ou','ce','se','sa','ne','pas','article','direct','video','selon'
]);

function tokens(value = '') {
  return normalize(value).split(' ').filter(word => word.length >= 3 && !STOP.has(word));
}

function boilerplate(value = '') {
  const text = normalize(value);
  return !text || [
    'connectez vous','abonnez vous','newsletter','acceptez les cookies','voir aussi','lire aussi',
    'voir plus de titres et de points de vue','partager cet article','retrouvez nous sur','en savoir plus'
  ].some(term => text.includes(term));
}

function jaccard(a = '', b = '') {
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / new Set([...aa, ...bb]).size;
}

function sentenceScore(sentence, title, index, total) {
  const words = tokens(sentence);
  if (words.length < 6 || boilerplate(sentence)) return -Infinity;
  const titleSet = new Set(tokens(title));
  const overlap = words.filter(word => titleSet.has(word)).length;
  const unique = new Set(words).size;
  let score = overlap * 7 + Math.min(unique, 18) * 0.45;
  if (/\d/.test(sentence)) score += 3;
  if (/\b(?:annonce|indique|confirme|prévoit|devrait|pourrait|entraîne|provoque|après|avant|depuis|contre|accord|décision|hausse|baisse|mort|morts|victime|victimes|million|milliard|pour cent|%)\b/i.test(sentence)) score += 2.5;
  if (/\b[A-ZÀ-ÖØ-Þ][\p{L}'’-]{2,}\b/u.test(sentence)) score += 1.5;
  const length = clean(sentence).length;
  if (length >= 70 && length <= 230) score += 2;
  if (length > 300) score -= 2;
  if (index === 0) score += 0.5;
  if (index >= Math.ceil(total / 2)) score += 0.75;
  return score;
}

function extractiveDigest(value = '', title = '') {
  const source = clean(value);
  const all = sentences(source)
    .map((sentence, index, list) => ({ sentence, index, score: sentenceScore(sentence, title, index, list.length) }))
    .filter(item => Number.isFinite(item.score));
  if (!all.length) return source.length <= 420 ? source : '';

  const ranked = all.slice().sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  let words = 0;
  for (const item of ranked) {
    if (chosen.some(previous => jaccard(previous.sentence, item.sentence) >= 0.72)) continue;
    const count = item.sentence.split(/\s+/).filter(Boolean).length;
    if (chosen.length >= 2 && words + count > 115) continue;
    chosen.push(item);
    words += count;
    if (chosen.length >= 3 || words >= 90) break;
  }

  if (chosen.length === 1 && all.length > 1) {
    const later = all
      .filter(item => item.index !== chosen[0].index && jaccard(item.sentence, chosen[0].sentence) < 0.72)
      .sort((a, b) => b.score - a.score)[0];
    if (later) chosen.push(later);
  }

  if (!chosen.length) return '';
  const lead = chosen.slice().sort((a, b) => b.score - a.score)[0];
  const rest = chosen.filter(item => item !== lead).sort((a, b) => a.index - b.index);
  return [lead, ...rest].map(item => clean(item.sentence)).join(' ').replace(/\s+/g, ' ').trim();
}

function looksLikeRawBeginning(summary = '', article = {}) {
  const text = clean(summary);
  if (!text) return false;
  const candidates = [article.detail, article.summary].map(clean).filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.length < 80) continue;
    const head = candidate.slice(0, Math.min(260, candidate.length));
    if (normalize(text.slice(0, head.length)).startsWith(normalize(head).slice(0, 90))) return true;
    if (jaccard(text.slice(0, 360), head) >= 0.78) return true;
  }
  return false;
}

function capture(req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let settled = false;
    const fake = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return headers[String(name).toLowerCase()]; },
      end(body = '') {
        if (settled) return;
        settled = true;
        resolve({ statusCode: this.statusCode || 200, headers, body: String(body || '') });
      }
    };
    Promise.resolve(legacyHandler(req, fake)).catch(reject);
  });
}

function sendCaptured(res, captured, payload = null) {
  res.statusCode = captured.statusCode || 200;
  for (const [name, value] of Object.entries(captured.headers || {})) {
    if (name === 'content-length' || name === 'content-encoding') continue;
    try { res.setHeader(name, value); } catch {}
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload === null ? captured.body : JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  let captured;
  try {
    captured = await capture(req);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'Résumé indisponible' }));
  }

  let payload;
  try { payload = JSON.parse(captured.body || '{}'); }
  catch { return sendCaptured(res, captured); }

  if (req.method === 'GET') {
    return sendCaptured(res, captured, { ...payload, finalSummaryV9141: true });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};
  const current = clean(payload.summary || '');
  const factualFallback = String(payload.provider || '').toLowerCase() === 'factual' || payload.ai === false;
  const shouldCondense = body.mode !== 'category' && current && !payload.unavailable && (factualFallback || looksLikeRawBeginning(current, article));

  if (!shouldCondense) return sendCaptured(res, captured, payload);

  const digest = extractiveDigest(current, article.title || '');
  const currentWords = current.split(/\s+/).filter(Boolean).length;
  const digestWords = digest.split(/\s+/).filter(Boolean).length;
  const meaningfullyShorter = digest && (currentWords < 55 || digestWords <= Math.max(42, Math.floor(currentWords * 0.72)));

  if (!meaningfullyShorter || digest.length < 55) return sendCaptured(res, captured, payload);

  return sendCaptured(res, captured, {
    ...payload,
    summary: digest,
    unavailable: false,
    finalSummaryV9141: true,
    summaryModeV9141: factualFallback ? 'extractive-fallback' : 'anti-copy-condense',
    provider: factualFallback ? 'factual-extractive' : payload.provider
  });
};

module.exports.extractiveDigest = extractiveDigest;
module.exports.looksLikeRawBeginning = looksLikeRawBeginning;
