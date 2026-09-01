const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = String(process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b').trim();
const TIMEOUT_MS = 12000;

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
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function clean(value = '') {
  return decodeEntities(String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const STOP = new Set([
  'avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','tous','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','font','comme','dont','elle','elles','ils','nous','vous','notre','votre','aussi','encore','deja','tres','moins','depuis','alors','chez','contre','lors','peut','peuvent','avait','avoir','sera','article','direct','video'
]);

function tokens(value = '') {
  return normalize(value).split(' ').filter(token => token.length >= 4 && !STOP.has(token));
}

function fuzzy(token = '') {
  if (/^\d+$/.test(token)) return token;
  if (token.length <= 6) return token;
  return token.slice(0, token.length >= 10 ? 6 : 5);
}

function numberClaims(value = '') {
  const text = normalize(value).replace(/[\u202f\u00a0]/g, ' ');
  const values = text.match(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?\b|\b\d{4}\b/g) || [];
  return [...new Set(values.map(value => value.replace(/[ .]/g, '').replace(',', '.')))];
}

function titleRestatement(summary = '', title = '') {
  const text = clean(summary);
  const heading = clean(title);
  if (!text || !heading) return false;
  if (/^(?:cet article|l[’']article|ce texte|cette publication)\s+(?:porte sur|parle de|évoque|présente|explique|concerne)\b/i.test(text)) return true;
  const wanted = tokens(heading);
  const found = new Set(tokens(text));
  if (wanted.length < 4 || !found.size) return false;
  const coverage = wanted.filter(token => found.has(token)).length / wanted.length;
  return coverage >= 0.88 && text.length <= Math.max(190, heading.length * 1.65);
}

function supported(summary = '', source = '', title = '') {
  const text = clean(summary);
  if (text.length < 55 || text.length > 900) return false;
  if (/résumé indisponible|aucune information|ouvrez? l[’']article|abonnez[- ]?vous|connectez[- ]?vous/i.test(text)) return false;
  if (titleRestatement(text, title)) return false;

  const support = `${clean(source)} ${clean(title)}`;
  const sourceNumbers = new Set(numberClaims(support));
  if (numberClaims(text).some(value => !sourceNumbers.has(value))) return false;

  const generated = tokens(text);
  const sourceTokens = tokens(support);
  if (generated.length < 6 || sourceTokens.length < 3) return false;
  const exactSet = new Set(sourceTokens);
  const fuzzySet = new Set(sourceTokens.map(fuzzy));
  const exact = generated.filter(token => exactSet.has(token)).length;
  const fuzzyHits = generated.filter(token => fuzzySet.has(fuzzy(token))).length;
  return exact >= 3 || fuzzyHits >= 4 || exact / generated.length >= 0.08 || fuzzyHits / generated.length >= 0.18;
}

function groqKey() {
  let key = String(process.env.GROQ_API_KEY || '').trim();
  key = key.replace(/^GROQ_API_KEY\s*=\s*/i, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key;
}

function promptFor(article = {}, source = '', strict = false) {
  const title = clean(article.title || '').slice(0, 300);
  const publisher = clean(article.source || '').slice(0, 100);
  const rule = strict
    ? 'Reste encore plus près des formulations du texte fourni. N’introduis aucun terme factuel important qui n’y figure pas.'
    : 'Reformule naturellement sans recopier le début du texte.';
  return `Rédige un vrai résumé journalistique en français de 2 ou 3 phrases, environ 45 à 80 mots. Commence directement par l'information principale. Utilise UNIQUEMENT les faits explicitement présents dans le TITRE et le TEXTE ci-dessous. N'ajoute aucun nom, chiffre, date, lieu, version, cause, conséquence ou contexte extérieur. Ne dis pas « cet article ». ${rule}\n\nSOURCE : ${publisher}\nTITRE : ${title}\nTEXTE : ${source}`;
}

async function callGroq(key, prompt, temperature = 0.1, maxTokens = 300) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_completion_tokens: maxTokens,
      include_reasoning: false,
      reasoning_effort: 'low'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      rateLimited: response.status === 429,
      retryAfter: clean(response.headers.get('retry-after') || ''),
      error: clean(payload?.error?.message || `HTTP ${response.status}`).slice(0, 320)
    };
  }
  const text = clean(payload?.choices?.[0]?.message?.content || '');
  return text ? { ok: true, text } : { ok: false, error: 'Réponse vide' };
}

async function summarize(article = {}) {
  const title = clean(article.title || '');
  const source = clean(article.summary || article.detail || article.description || '').slice(0, 2600);
  if (!title) return { ok: false, reason: 'title-missing' };
  if (source.length < 60) return { ok: false, reason: 'source-too-short' };

  const key = groqKey();
  if (!key) return { ok: false, reason: 'groq-key-missing' };

  const first = await callGroq(key, promptFor(article, source, false), 0.1, 300);
  if (first.ok && supported(first.text, source, title)) {
    return { ok: true, text: first.text, ai: true, grounded: true, origin: 'groq-fast', model: GROQ_MODEL };
  }
  if (first.rateLimited) return { ok: false, rateLimited: true, retryAfter: first.retryAfter || '', reason: 'rate-limit' };

  const second = await callGroq(key, promptFor(article, source, true), 0, 240);
  if (second.ok && supported(second.text, source, title)) {
    return { ok: true, text: second.text, ai: true, grounded: true, origin: 'groq-fast-retry', model: GROQ_MODEL };
  }
  if (second.rateLimited) return { ok: false, rateLimited: true, retryAfter: second.retryAfter || '', reason: 'rate-limit' };
  return { ok: false, reason: 'validation', error: clean(second.error || first.error || '').slice(0, 240) };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return send(res, 200, {
      ok: true,
      provider: 'groq-fast',
      model: GROQ_MODEL,
      hasGroqKey: Boolean(groqKey()),
      maxCompletionTokens: 300,
      onDemandOnly: true,
      version: '91.43'
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
  const input = req.body && typeof req.body === 'object' ? req.body : {};
  const article = input.article && typeof input.article === 'object' ? input.article : input;
  try {
    const result = await summarize(article);
    return send(res, 200, result);
  } catch (error) {
    console.error('Fast Groq summary failed:', clean(error?.message || error).slice(0, 240));
    return send(res, 200, { ok: false, reason: 'exception' });
  }
};
