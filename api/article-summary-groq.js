const legacyHandler = require('./article-summary.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const RETIRED_MODELS = new Set(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
const GROQ_MODELS = [...new Set([
  process.env.GROQ_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
].filter(Boolean).map(value => String(value).trim()).filter(value => value && !RETIRED_MODELS.has(value)))];
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
    /pour\s+(?:sauvegarder|enregistrer|mémoriser|partager|commenter|lire)\s+(?:(?:cet|cette|un|une|l[’']?)\s*)?article/,
    /partager\s+(?:la\s+)?publication|partager\s+cet(?:te)?\s+(?:publication|article)/,
    /connectez[- ]?vous|se connecter|identifiez[- ]?vous|connexion à votre compte/,
    /créez (?:votre|un) compte|créer (?:votre|un) compte/,
    /abonnez[- ]?vous|déjà abonné|offre d[’']abonnement|nos offres|accès abonnés?/,
    /newsletter|recevez (?:nos|les) actualités|inscrivez[- ]?vous à/,
    /acceptez les cookies|gestion des cookies|préférences de confidentialité|consentement/,
    /activez les notifications|notifications? pour ne rien manquer/,
    /partager sur|suivez[- ]?nous|retrouvez[- ]?nous sur/,
    /lire aussi|à lire aussi|voir aussi|à découvrir|sur le même sujet/,
    /ajouter (?:cet|l[’']?)?\s*article (?:à|dans) (?:vos|mes) favoris/,
    /ouvrez?\s+l[’']article|consultez?\s+(?:les?\s+)?détails|détails publiés par la source/,
    /résumé indisponible(?: pour cet article)?/
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
  return result.slice(0, 4200).trim();
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
    const factualReq = Object.create(req || null);
    factualReq.method = 'POST';
    factualReq.query = req?.query || {};
    factualReq.body = { ...(req?.body && typeof req.body === 'object' ? req.body : {}), factualOnly: true };
    Promise.resolve(legacyHandler(factualReq, capture)).catch(reject);
  });
}

function normalizeSupport(value = '') {
  return decodeEntities(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function meaningfulTokens(value = '') {
  const stop = new Set(['alors','après','avant','avec','avoir','cette','comme','dans','depuis','devrait','elles','entre','étaient','faire','leurs','mais','même','moins','notamment','nous','plus','pour','sans','selon','sont','sous','tout','toute','toutes','tous','très','vers','votre','ainsi','cela','celui','celle','être','fait','faits']);
  return normalizeSupport(value).match(/[a-z0-9]{5,}/g)?.filter(t => !stop.has(t)) || [];
}

function fuzzyToken(token = '') {
  if (/^\d+$/.test(token)) return token;
  if (token.length <= 6) return token;
  return token.slice(0, token.length >= 10 ? 6 : 5);
}

function numericClaims(value = '') {
  const text = normalizeSupport(value).replace(/[\u202f\u00a0]/g, ' ');
  const claims = text.match(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?\b|\b\d{4}\b/g) || [];
  return [...new Set(claims.map(number => number.replace(/[ .]/g, '').replace(',', '.')))];
}

const SMALL_NUMBER_WORDS = new Map([
  ['deux','2'], ['trois','3'], ['quatre','4'], ['cinq','5'], ['six','6'], ['sept','7'], ['huit','8'], ['neuf','9'],
  ['dix','10'], ['onze','11'], ['douze','12'], ['treize','13'], ['quatorze','14'], ['quinze','15'], ['seize','16'],
  ['vingt','20'], ['trente','30'], ['quarante','40'], ['cinquante','50'], ['soixante','60'], ['cent','100'], ['mille','1000']
]);

function unsupportedNumberWords(summary = '', source = '') {
  const generated = normalizeSupport(summary);
  const original = normalizeSupport(source);
  const sourceNumbers = new Set(numericClaims(source));
  for (const [word, numeric] of SMALL_NUMBER_WORDS) {
    const rx = new RegExp(`(?<!-)\\b${word}\\b(?!-)`, 'g');
    if (!rx.test(generated)) continue;
    rx.lastIndex = 0;
    if (rx.test(original) || sourceNumbers.has(numeric)) continue;
    return true;
  }
  return false;
}

const DATE_TERMS = new Set([
  'lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
  'janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre',
  'hier','aujourdhui','demain'
]);

function dateClaims(value = '') {
  const words = normalizeSupport(value).match(/[a-z]{3,}/g) || [];
  return [...new Set(words.filter(word => DATE_TERMS.has(word)))];
}

const ENTITY_STOP = new Set([
  'Le','La','Les','Un','Une','Des','Ce','Cet','Cette','Ces','Il','Ils','Elle','Elles','On','Nous','Vous',
  'Son','Sa','Ses','Selon','Apres','Avant','Dans','Pour','Par','En','Au','Aux','De','Du','Mais','Plus','Lors',
  'Alors','Pourtant','Ainsi','Cette','Comme','Quand','Si','Or','Et','A','À'
]);

function entityClaims(value = '') {
  const decoded = decodeEntities(value);
  const matches = decoded.match(/\b\p{Lu}[\p{L}’'-]{2,}\b/gu) || [];
  return [...new Set(matches
    .filter(token => !ENTITY_STOP.has(token))
    .map(token => normalizeSupport(token).replace(/\s+/g, ''))
    .filter(token => token.length >= 3))];
}

function summarySupported(summary, source) {
  const generated = meaningfulTokens(summary);
  const sourceTokens = meaningfulTokens(source);
  if (generated.length < 5 || sourceTokens.length < 2) return false;

  const normalizedSource = normalizeSupport(source);

  // Numeric and calendar claims are high-risk facts: every one introduced in
  // the summary must already exist in the verified material.
  const sourceNumbers = new Set(numericClaims(source));
  if (numericClaims(summary).some(number => !sourceNumbers.has(number))) return false;
  if (unsupportedNumberWords(summary, source)) return false;
  if (dateClaims(summary).some(term => !normalizedSource.includes(term))) return false;

  // Proper nouns are checked independently from ordinary lexical overlap so a
  // fluent paraphrase is accepted, while an invented person or place is not.
  if (entityClaims(summary).some(entity => !normalizedSource.includes(entity))) return false;

  const sourceExact = new Set(sourceTokens);
  const sourceFuzzy = new Set(sourceTokens.map(fuzzyToken));
  const exact = generated.filter(token => sourceExact.has(token)).length;
  const fuzzy = generated.filter(token => sourceFuzzy.has(fuzzyToken(token))).length;
  const exactRatio = exact / generated.length;
  const fuzzyRatio = fuzzy / generated.length;

  // The old validator required 12% exact word identity. That rejected valid
  // journalistic reformulations. Keep a small semantic anchor instead.
  return exact >= 2 || fuzzy >= 3 || exactRatio >= 0.06 || fuzzyRatio >= 0.12;
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
  if (factual.length < 250) {
    return `Résume cet article en français en 1 ou 2 phrases très factuelles. Le texte disponible est court : n'ajoute aucun contexte, détail, lieu, nom, date, nombre, cause ou conséquence qui n'y figure pas explicitement. Si le texte ne permet qu'une phrase, fais une seule phrase. Reformule sans développer artificiellement.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
  }
  if (factual.length < 650) {
    return `Résume cet article en français en 2 à 4 phrases, environ 45 à 85 mots. Commence par le fait principal. Utilise uniquement les informations explicitement présentes ci-dessous et n'ajoute aucun contexte extérieur. Ne recopie pas de longues citations : reformule.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
  }
  return `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots, en exactement 2 paragraphes courts. Commence directement par le fait principal et son contexte immédiat. Le second paragraphe donne les précisions, chiffres ou conséquences présents dans le texte. Supprime mentalement toute phrase de connexion, abonnement, sauvegarde d'article, cookies, partage ou navigation si elle subsiste. Ne complète avec aucune connaissance extérieure. Ne recopie pas de longues citations : reformule.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
}

async function generateWithGroq(model, key, prompt, minLength = 60) {
  const isGptOss = model.startsWith('openai/gpt-oss-');
  const body = {
    model,
    messages: isGptOss
      ? [{ role: 'user', content: `${SYSTEM}\n\n${prompt}` }]
      : [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    temperature: isGptOss ? 0.5 : 0.1,
    max_completion_tokens: isGptOss ? 1400 : 620
  };
  if (isGptOss) {
    body.include_reasoning = false;
    body.reasoning_effort = 'low';
  }

  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${model}: ${message}`);
  }
  const text = decodeEntities(payload?.choices?.[0]?.message?.content || '');
  if (text.length < minLength) throw new Error(`${model}: réponse trop courte`);
  return text;
}

async function generateWithFallback(key, prompt, factual = '', minLength = 60) {
  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const text = await generateWithGroq(model, key, prompt, minLength);
      if (factual && !summarySupported(text, factual)) throw new Error(`${model}: résumé insuffisamment étayé par la source`);
      return { text, model };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 360);
    }
  }
  throw new Error(lastError || 'Aucun modèle Groq disponible');
}

async function probeGroq(key) {
  const sample = `Résume en 4 phrases factuelles et naturelles ce texte, sans rien inventer : La ville a ouvert une nouvelle médiathèque mardi. Le bâtiment comprend 45 000 ouvrages, un espace numérique et une salle de travail. Le projet a coûté 8 millions d'euros. La fréquentation sera gratuite pour les habitants.`;
  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const text = await generateWithGroq(model, key, sample, 60);
      return { ok: true, model, length: text.length };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 360);
    }
  }
  return { ok: false, error: lastError.replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 420) };
}

module.exports = async function handler(req, res) {
  const key = groqKey();

  if (req.method === 'GET' && req.query?.status) {
    const payload = {
      ok: true,
      provider: 'groq',
      model: GROQ_MODELS[0],
      models: GROQ_MODELS,
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

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = body?.mode === 'category' ? 'category' : 'article';
  let factual = sanitizeFactual(base?.summary || '');
  // Some publishers expose only a headline through Google News or block the
  // server-side article fetch. The verified title is still a factual fallback
  // and prevents an empty summary while keeping the response honest.
  if (mode === 'article' && factual.length < 80) {
    factual = sanitizeFactual([body?.article?.summary, body?.article?.title].filter(Boolean).join('\n'));
  }
  if (factual.length < (mode === 'article' ? 30 : 80)) {
    return send(res, 200, {
      ...base,
      summary: 'Résumé indisponible pour cet article.',
      ai: false,
      unavailable: true,
      provider: 'unavailable',
      model: ''
    });
  }

  const safeFallback = paragraphize(factual, 2);

  if (!key) {
    return send(res, 200, {
      ...base,
      summary: safeFallback,
      ai: false,
      unavailable: false,
      provider: 'factual',
      model: ''
    });
  }

  const prompt = promptFor(body, factual);
  const validationSource = [
    factual,
    mode === 'article' ? body?.article?.title : body?.category,
    mode === 'article' ? body?.article?.source : ''
  ].filter(Boolean).join('\n');
  const minLength = mode === 'article' && factual.length < 250 ? 35 : 60;

  try {
    const aiResult = await generateWithFallback(key, prompt, validationSource, minLength);
    return send(res, 200, {
      ...base,
      summary: paragraphize(aiResult.text, 2),
      ai: true,
      unavailable: false,
      provider: 'groq',
      model: aiResult.model
    });
  } catch (error) {
    const message = String(error?.message || error).replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 420);
    console.error('Groq summary unavailable:', message);
    return send(res, 200, {
      ...base,
      summary: safeFallback,
      ai: false,
      unavailable: false,
      provider: 'factual',
      model: ''
    });
  }
};
