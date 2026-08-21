const legacyHandler = require('./article-summary.js');

const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const SYSTEM = `Tu es un rédacteur de presse factuel. Résume uniquement les informations fournies. N'invente aucun fait, nom, chiffre, contexte ou conséquence. Commence par le fait principal. Écris un français naturel, précis et neutre, sans titre accrocheur, sans formule promotionnelle et sans invitation à cliquer.`;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function geminiKey() {
  let key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
  key = key.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key;
}

function keyType(key) {
  if (/^AQ\./.test(key)) return 'auth';
  if (/^AIza/.test(key)) return 'standard';
  return key ? 'unknown' : 'missing';
}

const ENTITY_MAP = new Map([
  ['nbsp', ' '], ['amp', '&'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'],
  ['rsquo', '’'], ['lsquo', '‘'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…'],
  ['laquo', '«'], ['raquo', '»'], ['eacute', 'é'], ['egrave', 'è'], ['ecirc', 'ê'], ['euml', 'ë'], ['agrave', 'à'],
  ['acirc', 'â'], ['ccedil', 'ç'], ['icirc', 'î'], ['iuml', 'ï'], ['ocirc', 'ô'], ['ugrave', 'ù'], ['ucirc', 'û'],
  ['Eacute', 'É'], ['Agrave', 'À'], ['Ccedil', 'Ç'], ['oelig', 'œ'], ['OElig', 'Œ']
]);

function decodeEntities(value = '') {
  let text = String(value || '');
  for (let pass = 0; pass < 3; pass++) {
    const before = text;
    text = text
      .replace(/&#(\d+);/g, (_, n) => {
        try { return String.fromCodePoint(Number(n)); } catch { return _; }
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
        try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; }
      })
      .replace(/&([A-Za-z]+);/g, (full, name) => ENTITY_MAP.has(name) ? ENTITY_MAP.get(name) : full);
    if (text === before) break;
  }
  return text.replace(/\uFFFD+/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

function captureLegacy(req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const capture = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(body = '') { resolve({ statusCode: this.statusCode || 200, headers, body: String(body || '') }); }
    };
    Promise.resolve(legacyHandler(req, capture)).catch(reject);
  });
}

async function generateWithSdk(key, prompt) {
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey: key });
  let lastError = '';
  for (const model of GEMINI_MODELS) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM,
          maxOutputTokens: 460
        }
      });
      const text = decodeEntities(String(response?.text || '').trim());
      if (text.length >= 60) return { text, model };
      lastError = `${model}: réponse trop courte`;
    } catch (error) {
      const code = error?.status || error?.code || '';
      const message = String(error?.message || error).replace(/AQ\.[A-Za-z0-9._-]+|AIza[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 380);
      lastError = `${model}${code ? ` (${code})` : ''}: ${message}`;
    }
  }
  throw new Error(lastError || 'Gemini indisponible');
}

function articlePrompt(body, factual) {
  const title = decodeEntities(body?.article?.title || '');
  return `À partir du texte factuel ci-dessous, rédige un vrai résumé de l'article en français en 4 à 6 phrases, environ 90 à 140 mots, en exactement 2 paragraphes courts. Le premier paragraphe donne le fait principal et son contexte immédiat. Le second donne les précisions, chiffres ou conséquences présents dans le texte. Ne complète avec aucune connaissance extérieure.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
}

function categoryPrompt(body, factual) {
  const category = decodeEntities(body?.category || 'cette rubrique');
  return `À partir du texte factuel ci-dessous, synthétise l'actualité de la rubrique « ${category} » en français en 5 à 7 phrases, environ 120 à 180 mots, réparties en 2 ou 3 paragraphes courts. Regroupe uniquement les éléments qui concernent réellement le même sujet. N'ajoute aucune information extérieure.\n\nTEXTE FACTUEL :\n${factual}`;
}

async function probeGemini(key) {
  try {
    const result = await generateWithSdk(key, 'Réponds uniquement par : OK');
    return { ok: true, model: result.model };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 420) };
  }
}

module.exports = async function handler(req, res) {
  const key = geminiKey();

  if (req.method === 'GET' && req.query?.status) {
    const payload = {
      ok: true,
      provider: 'gemini-sdk',
      hasGeminiKey: Boolean(key),
      keyType: keyType(key),
      sdk: '@google/genai',
      gatewayDisabled: true
    };
    if (String(req.query?.probe || '') === '1' && key) payload.probe = await probeGemini(key);
    return send(res, 200, payload);
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  let legacy;
  try {
    legacy = await captureLegacy(req);
  } catch (error) {
    console.error('Legacy summary capture failed:', String(error?.message || error).slice(0, 240));
    return send(res, 500, { error: 'Résumé indisponible' });
  }

  let base;
  try { base = JSON.parse(legacy.body || '{}'); }
  catch { return send(res, legacy.statusCode || 500, { error: 'Réponse de résumé invalide' }); }

  if (base?.summary) base.summary = decodeEntities(base.summary);
  if (base?.ai) return send(res, 200, base);
  if (!base?.summary || !key) return send(res, 200, base);

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = body.mode === 'category' ? 'category' : 'article';
  const factual = decodeEntities(base.summary);
  const prompt = mode === 'category' ? categoryPrompt(body, factual) : articlePrompt(body, factual);

  try {
    const generated = await generateWithSdk(key, prompt);
    return send(res, 200, {
      ...base,
      summary: generated.text,
      ai: true,
      provider: 'gemini',
      model: generated.model
    });
  } catch (error) {
    console.error(`Gemini SDK summary unavailable [${keyType(key)}]:`, String(error?.message || error).slice(0, 420));
    return send(res, 200, { ...base, summary: factual, ai: false, provider: 'factual' });
  }
};
