const legacyHandler = require('./article-summary.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const RETIRED_MODELS = new Set(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
const GROQ_TIMEOUT_MS = 14000;
const MAX_FACTUAL_CHARS = 2400;
const MAX_COMPLETION_TOKENS = 320;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function decodeEntities(value = '') {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value = '') {
  return decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function sentences(value = '') {
  return clean(value).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(item => item.trim()).filter(Boolean) || [];
}

function isBoilerplate(value = '') {
  const text = normalize(value);
  if (!text) return true;
  return [
    'connectez vous','abonnez vous','newsletter','acceptez les cookies','gestion des cookies',
    'partager cet article','partager la publication','lire aussi','voir aussi','en savoir plus',
    'ajouter cet article','activer les notifications','retrouvez nous sur'
  ].some(term => text.includes(term));
}

function sanitizeFactual(value = '') {
  return sentences(value)
    .filter(sentence => sentence.length >= 28 && !isBoilerplate(sentence))
    .slice(0, 16)
    .join(' ')
    .slice(0, 5200)
    .trim();
}

function trimFactual(value = '', limit = MAX_FACTUAL_CHARS) {
  const list = sentences(value);
  const kept = [];
  let length = 0;
  for (const sentence of list) {
    if (length + sentence.length + 1 > limit && kept.length >= 2) break;
    kept.push(sentence);
    length += sentence.length + 1;
    if (length >= limit) break;
  }
  const result = kept.join(' ').trim();
  return result || clean(value).slice(0, limit);
}

function groqKey() {
  let key = String(process.env.GROQ_API_KEY || '').trim();
  key = key.replace(/^GROQ_API_KEY\s*=\s*/i, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key;
}

function groqModel() {
  const configured = String(process.env.GROQ_MODEL || '').trim();
  if (configured && !RETIRED_MODELS.has(configured) && configured.startsWith('openai/gpt-oss-')) return configured;
  return DEFAULT_MODEL;
}

function captureLegacy(req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const capture = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(body = '') { resolve({ statusCode: this.statusCode || 200, headers, body: String(body || '') }); }
    };
    const factualReq = Object.create(req || null);
    factualReq.method = 'POST';
    factualReq.query = req?.query || {};
    factualReq.body = { ...(req?.body && typeof req.body === 'object' ? req.body : {}), factualOnly: true };
    Promise.resolve(legacyHandler(factualReq, capture)).catch(reject);
  });
}

function meaningfulTokens(value = '') {
  const stop = new Set(['alors','apres','avant','avec','avoir','cette','comme','dans','depuis','devrait','elles','entre','faire','leurs','mais','meme','moins','notamment','nous','plus','pour','sans','selon','sont','sous','tout','toute','toutes','tous','tres','vers','votre','ainsi','cela','celui','celle','etre','fait','faits','article']);
  return normalize(value).split(' ').filter(token => token.length >= 4 && !stop.has(token));
}

function fuzzyToken(token = '') {
  if (/^\d+$/.test(token)) return token;
  if (token.length <= 6) return token;
  return token.slice(0, token.length >= 10 ? 6 : 5);
}

function numericClaims(value = '') {
  const text = normalize(value).replace(/[\u202f\u00a0]/g, ' ');
  const claims = text.match(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?\b|\b\d{4}\b/g) || [];
  return [...new Set(claims.map(number => number.replace(/[ .]/g, '').replace(',', '.')))];
}

function supportedSummary(summary = '', source = '', title = '') {
  const text = clean(summary);
  if (text.length < 55 || isBoilerplate(text)) return false;
  const sourceText = `${source}\n${title}`;
  const sourceNumbers = new Set(numericClaims(sourceText));
  if (numericClaims(text).some(number => !sourceNumbers.has(number))) return false;

  const generated = meaningfulTokens(text);
  const original = meaningfulTokens(sourceText);
  if (generated.length < 7 || original.length < 4) return false;
  const exactSet = new Set(original);
  const fuzzySet = new Set(original.map(fuzzyToken));
  const exact = generated.filter(token => exactSet.has(token)).length;
  const fuzzy = generated.filter(token => fuzzySet.has(fuzzyToken(token))).length;
  return exact >= 3 || fuzzy >= 5 || exact / generated.length >= 0.12 || fuzzy / generated.length >= 0.22;
}

function titleRestatement(summary = '', title = '') {
  const a = meaningfulTokens(summary);
  const b = meaningfulTokens(title);
  if (a.length < 4 || b.length < 4) return false;
  const set = new Set(a);
  const hits = b.filter(token => set.has(token)).length;
  return clean(summary).length < 180 && hits / b.length >= 0.86 && a.length <= b.length + 4;
}

function retryAfterMs(response, payload = {}) {
  const header = Number(response?.headers?.get?.('retry-after') || 0);
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);
  const message = String(payload?.error?.message || '');
  const match = message.match(/try again in\s+([0-9.]+)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : 0;
}

async function generateLightSummary({ key, model, title, factual }) {
  const prompt = `Résume l'article ci-dessous en français en 2 à 4 phrases, environ 55 à 90 mots. Commence directement par l'information principale. Reformule au lieu de recopier le début de l'article. Utilise uniquement les faits présents dans le texte fourni. N'ajoute aucun nom, chiffre, date, cause, conséquence ou contexte absent. Ignore les phrases d'abonnement, connexion, cookies, partage et navigation.\n\nTITRE : ${clean(title)}\n\nTEXTE FACTUEL :\n${trimFactual(factual)}`;
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: `Tu es un rédacteur de presse factuel. Ne complète jamais les informations manquantes.\n\n${prompt}` }],
      temperature: 0.2,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      include_reasoning: false,
      reasoning_effort: 'low'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 429 ? 'rate-limit' : 'groq-error',
      retryAfterMs: retryAfterMs(response, payload),
      detail: String(payload?.error?.message || `HTTP ${response.status}`).replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 240)
    };
  }
  const text = clean(payload?.choices?.[0]?.message?.content || '');
  return { ok: true, text, model };
}

async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return send(res, 200, {
      ok: true,
      provider: 'groq-light',
      model: groqModel(),
      hasGroqKey: Boolean(groqKey()),
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      progressiveReadyV9144: true
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : body;
  const title = clean(article.title || '');
  if (!title) return send(res, 200, { ok: false, text: '', ai: false, origin: 'unavailable', error: 'title-missing' });

  const key = groqKey();
  if (!key) return send(res, 200, { ok: false, text: '', ai: false, origin: 'unavailable', error: 'groq-key-missing' });

  let factual = '';
  try {
    const legacy = await captureLegacy(req);
    const base = JSON.parse(legacy.body || '{}');
    factual = sanitizeFactual(base?.summary || '');
  } catch {}
  if (factual.length < 80) factual = sanitizeFactual([article.summary, article.detail].filter(Boolean).join(' '));
  if (factual.length < 60) {
    return send(res, 200, { ok: false, text: '', ai: false, origin: 'unavailable', error: 'not-enough-source' });
  }

  const model = groqModel();
  let result;
  try {
    result = await generateLightSummary({ key, model, title, factual });
  } catch (error) {
    return send(res, 200, {
      ok: false,
      text: '',
      ai: false,
      origin: 'unavailable',
      error: 'timeout-or-network',
      detail: String(error?.message || error).slice(0, 180)
    });
  }

  if (!result.ok) return send(res, 200, { ...result, text: '', ai: false, origin: 'unavailable', model });
  if (titleRestatement(result.text, title) || !supportedSummary(result.text, factual, title)) {
    return send(res, 200, {
      ok: false,
      text: '',
      ai: false,
      origin: 'unavailable',
      model,
      error: titleRestatement(result.text, title) ? 'title-restatement' : 'support-check'
    });
  }

  return send(res, 200, {
    ok: true,
    text: result.text,
    ai: true,
    grounded: true,
    origin: 'groq-light',
    model,
    sourceChars: Math.min(clean(factual).length, MAX_FACTUAL_CHARS),
    progressiveV9144: true
  });
}

module.exports = handler;
