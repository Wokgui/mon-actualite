const legacyHandler = require('./article-summary.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim();
const GROQ_TIMEOUT_MS = 18000;

const SYSTEM = `Tu es un rédacteur de presse factuel. Résume uniquement les informations fournies. N'invente aucun fait, nom, chiffre, contexte ou conséquence. Commence par le fait principal. Écris un français naturel, précis et neutre. Ignore entièrement les éléments d'interface, appels à se connecter, sauvegarder un article, s'abonner, accepter des cookies, partager, activer des notifications ou toute autre phrase de service du site. N'écris ni titre accrocheur, ni formule promotionnelle, ni invitation à cliquer.`;

const ENTITY_MAP = new Map([
  ['nbsp', ' '], ['amp', '&'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'],
  ['rsquo', '’'], ['lsquo', '‘'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…'],
  ['laquo', '«'], ['raquo', '»'], ['eacute', 'é'], ['egrave', 'è'], ['ecirc', 'ê'], ['euml', 'ë'], ['agrave', 'à'],
  ['acirc', 'â'], ['ccedil', 'ç'], ['icirc', 'î'], ['iuml', 'ï'], ['ocirc', 'ô'], ['ugrave', 'ù'], ['ucirc', 'û'],
  ['Eacute', 'É'], ['Agrave', 'À'], ['Ccedil', 'Ç'], ['oelig', 'œ'], ['OElig', 'Œ']
]);

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function decodeEntities(value = '') {
  let text = String(value ?? '');
  for (let pass = 0; pass < 4; pass++) {
    const before = text;
    text = text
      .replace(/&#(\d+);/g, (full, n) => {
        try { return String.fromCodePoint(Number(n)); } catch { return full; }
      })
      .replace(/&#x([0-9a-f]+);/gi, (full, n) => {
        try { return String.fromCodePoint(parseInt(n, 16)); } catch { return full; }
      })
      .replace(/&([A-Za-z]+);/g, (full, name) => ENTITY_MAP.has(name) ? ENTITY_MAP.get(name) : full);
    if (text === before) break;
  }
  return text.replace(/\uFFFD+/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function sentences(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
}

function isBoilerplate(text = '') {
  const value = decodeEntities(text).toLowerCase();
  if (!value) return true;
  return [
    /pour\s+(?:sauvegarder|enregistrer|mémoriser|partager|commenter|lire)\s+(?:cet|cette|l[’']?)?\s*article/,
    /connectez[- ]?vous|se connecter|identifiez[- ]?vous|connexion à votre compte/,
    /créez (?:votre|un) compte|créer (?:votre|un) compte/,
    /abonnez[- ]?vous|déjà abonné|offre d[’']abonnement|nos offres|accès abonnés?/,
    /newsletter|recevez (?:nos|les) actualités|inscrivez[- ]?vous à/,
    /acceptez les cookies|gestion des cookies|préférences de confidentialité|consentement/,
    /activez les notifications|notifications? pour ne rien manquer/,
    /partager sur|suivez[- ]?nous|retrouvez[- ]?nous sur/,
    /lire aussi|à lire aussi|voir aussi|à découvrir|sur le même sujet/,
    /ajouter (?:cet|l[’']?)?\s*article (?:à|dans) (?:vos|mes) favoris/
  ].some(pattern => pattern.test(value));
}

function sanitizeFactual(value = '') {
  const decoded = decodeEntities(value);
  if (!decoded) return '';
  const paragraphs = decoded.split(/\n\s*\n|\n+/).map(p => p.trim()).filter(Boolean);
  const kept = [];
  for (const paragraph of paragraphs) {
    const useful = sentences(paragraph)
      .filter(sentence => sentence.length >= 30)
      .filter(sentence => !isBoilerplate(sentence));
    if (useful.length) kept.push(useful.join(' '));
  }
  let result = kept.join('\n\n').trim();
  if (!result) {
    result = sentences(decoded).filter(sentence => sentence.length >= 30 && !isBoilerplate(sentence)).slice(0, 6).join(' ');
  }
  return result.slice(0, 3200).trim();
}

function groqKey() {
  let key = String(process.env.GROQ_API_KEY || '').trim();
  key = key.replace(/^GROQ_API_KEY\s*=\s*/i, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key;
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

function meaningfulTokens(value = '') {
  const stop = new Set(['alors','après','avant','avec','avoir','cette','comme','dans','depuis','devrait','elles','entre','étaient','faire','leurs','mais','même','moins','notamment','nous','plus','pour','sans','selon','sont','sous','tout','toute','toutes','tous','très','vers','votre','ainsi','cela','celui','celle','être','fait','faits']);
  return decodeEntities(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{5,}/g)?.filter(t => !stop.has(t)) || [];
}

function summarySupported(summary, source) {
  const generated = meaningfulTokens(summary);
  if (generated.length < 8) return false;
  const sourceSet = new Set(meaningfulTokens(source));
  if (!sourceSet.size) return false;
  const supported = generated.filter(token => sourceSet.has(token)).length;
  return supported / generated.length >= 0.18;
}

function paragraphize(value = '', wanted = 2) {
  const clean = decodeEntities(value).replace(/\n{3,}/g, '\n\n').trim();
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

function promptFor(body, factual) {
  const mode = body?.mode === 'category' ? 'category' : 'article';
  if (mode === 'category') {
    const category = decodeEntities(body?.category || 'cette rubrique').slice(0, 80);
    return `Synthétise l'actualité de la rubrique « ${category} » uniquement à partir du texte factuel ci-dessous. Fais 5 à 7 phrases, environ 120 à 180 mots, en 2 ou 3 paragraphes courts. Commence directement par les faits les plus importants. Supprime mentalement toute phrase de connexion, abonnement, sauvegarde d'article, cookies, partage ou navigation si elle subsiste. N'ajoute aucune information extérieure.\n\nTEXTE FACTUEL :\n${factual}`;
  }
  const title = decodeEntities(body?.article?.title || '');
  return `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots, en exactement 2 paragraphes courts. Commence directement par le fait principal et son contexte immédiat. Le second paragraphe donne les précisions, chiffres ou conséquences présents dans le texte. Supprime mentalement toute phrase de connexion, abonnement, sauvegarde d'article, cookies, partage ou navigation si elle subsiste. Ne complète avec aucune connaissance extérieure.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
}

async function generateWithGroq(key, prompt) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 460,
      include_reasoning: false
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${GROQ_MODEL}: ${message}`);
  }
  const text = decodeEntities(payload?.choices?.[0]?.message?.content || '');
  if (text.length < 60) throw new Error(`${GROQ_MODEL}: réponse trop courte`);
  return text;
}

async function probeGroq(key) {
  try {
    const text = await generateWithGroq(key, 'Réponds uniquement par : OK');
    return { ok: /ok/i.test(text), model: GROQ_MODEL };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 420) };
  }
}

module.exports = async function handler(req, res) {
  const key = groqKey();

  if (req.method === 'GET' && req.query?.status) {
    const payload = {
      ok: true,
      provider: 'groq',
      model: GROQ_MODEL,
      hasGroqKey: Boolean(key),
      gatewayDisabled: true
    };
    if (String(req.query?.probe || '') === '1' && key) payload.probe = await probeGroq(key);
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

  const factual = sanitizeFactual(base?.summary || '');
  const safeFallback = paragraphize(factual || 'Résumé indisponible pour cet article.', 2);

  if (!key || factual.length < 80) {
    return send(res, 200, {
      ...base,
      summary: safeFallback,
      ai: false,
      provider: 'factual',
      model: ''
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const prompt = promptFor(body, factual);

  try {
    const generated = await generateWithGroq(key, prompt);
    if (!summarySupported(generated, factual)) throw new Error('Résumé Groq insuffisamment étayé par la source');
    return send(res, 200, {
      ...base,
      summary: paragraphize(generated, body.mode === 'category' ? 2 : 2),
      ai: true,
      provider: 'groq',
      model: GROQ_MODEL
    });
  } catch (error) {
    const message = String(error?.message || error).replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 420);
    console.error('Groq summary unavailable:', message);
    return send(res, 200, {
      ...base,
      summary: safeFallback,
      ai: false,
      provider: 'factual',
      model: ''
    });
  }
};
