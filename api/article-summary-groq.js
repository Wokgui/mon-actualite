const legacyHandler = require('./article-summary.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const RETIRED_MODELS = new Set(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
const GROQ_MODELS = [...new Set([
  process.env.GROQ_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
].filter(Boolean).map(value => String(value).trim()).filter(value => value && !RETIRED_MODELS.has(value)))];
const GROQ_TIMEOUT_MS = 18000;
const NEWS_TIMEOUT_MS = 5000;
const NEWS_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

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
      .replace(/&#(\d+);/g, (full, n) => { try { return String.fromCodePoint(Number(n)); } catch { return full; } })
      .replace(/&#x([0-9a-f]+);/gi, (full, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return full; } })
      .replace(/&([A-Za-z]+);/g, (full, name) => ENTITY_MAP.has(name) ? ENTITY_MAP.get(name) : full);
    if (text === before) break;
  }
  return text.replace(/\uFFFD+/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function stripHtml(value = '') {
  return decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
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
  if (!result) result = sentences(decoded).filter(sentence => sentence.length >= 30 && !isBoilerplate(sentence)).slice(0, 8).join(' ');
  return result.slice(0, 5200).trim();
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
  const sourceNumbers = new Set(numericClaims(source));
  if (numericClaims(summary).some(number => !sourceNumbers.has(number))) return false;
  if (unsupportedNumberWords(summary, source)) return false;
  if (dateClaims(summary).some(term => !normalizedSource.includes(term))) return false;
  if (entityClaims(summary).some(entity => !normalizedSource.includes(entity))) return false;

  const sourceExact = new Set(sourceTokens);
  const sourceFuzzy = new Set(sourceTokens.map(fuzzyToken));
  const exact = generated.filter(token => sourceExact.has(token)).length;
  const fuzzy = generated.filter(token => sourceFuzzy.has(fuzzyToken(token))).length;
  const exactRatio = exact / generated.length;
  const fuzzyRatio = fuzzy / generated.length;
  return exact >= 2 || fuzzy >= 3 || exactRatio >= 0.06 || fuzzyRatio >= 0.12;
}

function newsTokens(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','ses','son','ont','est','aux','etats','unis','article','direct']);
  return [...new Set(normalizeSupport(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(word => word.length >= 3 && !stop.has(word)))];
}

function headlineAgreement(candidate = '', expected = '') {
  const wanted = newsTokens(expected);
  const found = newsTokens(candidate);
  if (!wanted.length || !found.length) return { hits: 0, shorterCoverage: 0, expectedCoverage: 0 };
  const foundSet = new Set(found);
  const hits = wanted.filter(word => foundSet.has(word)).length;
  return {
    hits,
    shorterCoverage: hits / Math.max(1, Math.min(wanted.length, found.length)),
    expectedCoverage: hits / wanted.length
  };
}

function xmlTag(block = '', name = '') {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function summarySearchSubject(title = '') {
  const clean = stripHtml(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const parts = clean.split(/\s*[:：]\s*/).map(part => part.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : clean;
  return tail.split(/\s+/).filter(Boolean).length >= 6 ? tail : clean;
}

function summaryQueryVariants(title = '') {
  const subject = summarySearchSubject(title);
  const displayWords = subject.split(/\s+/).filter(Boolean);
  const tokens = newsTokens(subject).filter(word => word.length >= 4);
  return [...new Set([
    subject,
    displayWords.length >= 10 ? displayWords.slice(0, 7).join(' ') : '',
    displayWords.length >= 12 ? displayWords.slice(0, 9).join(' ') : '',
    tokens.slice(0, 8).join(' '),
    tokens.slice(0, 6).join(' ')
  ].filter(value => value && newsTokens(value).length >= 3))];
}

async function fetchGoogleNewsHeadlines(title = '', source = '') {
  const expected = summarySearchSubject(title);
  const words = newsTokens(expected);
  if (words.length < 3) return [];
  const queries = summaryQueryVariants(title);
  const seen = new Set();
  const results = [];

  for (const query of queries) {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.search = new URLSearchParams({ q: query, hl: 'fr', gl: 'FR', ceid: 'FR:fr' }).toString();
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
        headers: { 'User-Agent': NEWS_UA, 'Accept': 'application/rss+xml,application/xml,text/xml' }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      for (const item of items.slice(0, 30)) {
        const headline = xmlTag(item, 'title');
        if (!headline) continue;
        const normalized = normalizeSupport(headline).replace(/[^a-z0-9]+/g, ' ').trim();
        const expectedNormalized = normalizeSupport(expected).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized || normalized === expectedNormalized || seen.has(normalized)) continue;
        const agreement = headlineAgreement(headline, expected);
        const sameEvent = (agreement.hits >= 3 && agreement.shorterCoverage >= 0.5)
          || (agreement.hits >= 4 && agreement.shorterCoverage >= 0.42)
          || (agreement.hits >= 5 && agreement.expectedCoverage >= 0.28);
        if (!sameEvent) continue;
        const publisher = xmlTag(item, 'source');
        const sourcePenalty = publisher && source && normalizeSupport(publisher) === normalizeSupport(source) ? 0.04 : 0;
        const confidence = Math.max(agreement.shorterCoverage, agreement.expectedCoverage) - sourcePenalty;
        seen.add(normalized);
        results.push({ headline, confidence });
      }
      if (results.length >= 5) break;
    } catch {}
  }

  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6)
    .map(item => item.headline);
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

function titleRestatement(summary = '', title = '') {
  const summaryText = decodeEntities(summary).replace(/^(?:résumé|synthèse)\s*:\s*/i, '').trim();
  const titleText = decodeEntities(title).trim();
  if (!summaryText || !titleText) return false;
  if (/^(?:cet article|l[’']article|ce texte|cette publication)\s+(?:porte sur|parle de|évoque|présente|explique|concerne)\b/i.test(summaryText)) return true;
  const titleTokens = newsTokens(titleText).filter(token => token.length >= 4);
  const summaryTokens = newsTokens(summaryText).filter(token => token.length >= 4);
  if (titleTokens.length < 4 || summaryTokens.length < 3) return false;
  const summarySet = new Set(summaryTokens);
  const covered = titleTokens.filter(token => summarySet.has(token)).length / titleTokens.length;
  const titleSet = new Set(titleTokens);
  const extra = summaryTokens.filter(token => !titleSet.has(token)).length;
  return covered >= 0.84 && extra <= 3 && summaryText.length <= Math.max(190, titleText.length * 1.65);
}

function dedupeFinalSentences(value = '') {
  const kept = [];
  const tokenSets = [];
  for (const item of sentences(value)) {
    if (item.length < 18 || isBoilerplate(item)) continue;
    const normalized = normalizeSupport(item).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) continue;
    const tokens = new Set(newsTokens(item).filter(token => token.length >= 4));
    const duplicate = kept.some((previous, index) => {
      if (normalizeSupport(previous).replace(/[^a-z0-9]+/g, ' ').trim() === normalized) return true;
      const old = tokenSets[index];
      const common = [...tokens].filter(token => old.has(token)).length;
      return common / Math.max(1, Math.min(tokens.size, old.size)) >= 0.9;
    });
    if (duplicate) continue;
    kept.push(item);
    tokenSets.push(tokens);
  }
  return kept.join(' ').trim();
}

function googleAggregateRisk(article = {}, payload = {}, corroboratingHeadlines = []) {
  const source = normalizeSupport(article.source || '').replace(/[^a-z0-9]+/g, ' ').trim();
  let host = '';
  try { host = new URL(String(article.url || '')).hostname.toLowerCase(); } catch {}
  const google = source === 'google news' || host === 'news.google.com' || host.endsWith('.news.google.com');
  const materialSource = String(payload?.diagnostics?.materialSource || '');
  const unsafeMaterial = materialSource === 'rss'
    || String(payload?.diagnostics?.fallbackType || '').includes('google-news-aggregate')
    || (!materialSource && corroboratingHeadlines.length > 0);
  return google && String(payload.provider || '').toLowerCase() === 'factual' && unsafeMaterial;
}

function finalizeArticleSummary(body = {}, payload = {}, corroboratingHeadlines = []) {
  if (body?.mode === 'category' || !body?.article || payload?.unavailable) return payload;
  const cleaned = dedupeFinalSentences(payload.summary || '');
  let reason = '';
  if (!cleaned || cleaned.length < 55) reason = 'too-short-or-boilerplate';
  else if (titleRestatement(cleaned, body.article.title || '')) reason = 'title-restatement';
  else if (googleAggregateRisk(body.article, payload, corroboratingHeadlines)) reason = 'ambiguous-google-aggregate';
  else if (newsTokens(cleaned).filter(token => token.length >= 4).length < 8 && cleaned.length < 100) reason = 'low-information';

  if (reason) {
    return {
      ...payload,
      summary: '',
      unavailable: true,
      qualityV9112: 'rejected',
      qualityReasonV9112: reason,
      providerOriginalV9112: String(payload.provider || '')
    };
  }
  return {
    ...payload,
    summary: cleaned,
    unavailable: false,
    qualityV9112: 'accepted',
    qualitySentenceCountV9112: sentences(cleaned).length
  };
}

function promptFor(body, factual, corroborated = false) {
  const mode = body?.mode === 'category' ? 'category' : 'article';
  if (mode === 'category') {
    const category = decodeEntities(body?.category || 'cette rubrique').slice(0, 80);
    return `Synthétise l'actualité de la rubrique « ${category} » uniquement à partir du texte factuel ci-dessous. Fais 5 à 7 phrases, environ 120 à 180 mots, en 2 ou 3 paragraphes courts. Commence directement par les faits les plus importants. Supprime mentalement toute phrase de connexion, abonnement, sauvegarde d'article, cookies, partage ou navigation si elle subsiste. N'ajoute aucune information extérieure.\n\nTEXTE FACTUEL :\n${factual}`;
  }
  const title = decodeEntities(body?.article?.title || '');
  if (factual.length < 250) {
    return `Résume cet article en français en 1 ou 2 phrases très factuelles. Le texte disponible est court : n'ajoute aucun contexte, détail, lieu, nom, date, nombre, cause ou conséquence qui n'y figure pas explicitement. Si le texte ne permet qu'une phrase, fais une seule phrase. Reformule sans développer artificiellement.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
  }
  if (factual.length < 700) {
    return `Résume cet événement en français en 2 à 4 phrases, environ 55 à 95 mots. Commence par le fait principal. ${corroborated ? 'Une partie du matériau provient de titres concordants de plusieurs médias : ne retiens que les informations explicitement présentes dans ces titres et cohérentes entre elles.' : ''} N'ajoute aucun contexte extérieur et ne recopie pas de longues citations.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
  }
  return `Résume cet article en français en 4 à 6 phrases, environ 90 à 140 mots, en exactement 2 paragraphes courts. Commence directement par le fait principal et son contexte immédiat. Le second paragraphe donne les précisions, chiffres ou conséquences présents dans le texte. Supprime mentalement toute phrase de connexion, abonnement, sauvegarde d'article, cookies, partage ou navigation si elle subsiste. Ne complète avec aucune connaissance extérieure. Ne recopie pas de longues citations : reformule.\n\nTITRE : ${title}\n\nTEXTE FACTUEL :\n${factual}`;
}

async function generateWithGroq(model, key, prompt, minLength = 60) {
  const startedAt = Date.now();
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
  let response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    const error = new Error(`${model}: ${/timeout|abort/i.test(`${cause?.name || ''} ${cause?.message || ''}`) ? 'timeout' : 'network-error'}`);
    error.code = /timeout|abort/i.test(`${cause?.name || ''} ${cause?.message || ''}`) ? 'timeout' : 'network-error';
    error.retryable = true;
    error.elapsedMs = Date.now() - startedAt;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${model}: ${payload?.error?.message || `HTTP ${response.status}`}`);
    error.code = response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'groq-server-error' : 'groq-error';
    error.retryable = response.status === 429 || response.status >= 500;
    const header = Number(response.headers.get('retry-after') || 0);
    const match = String(payload?.error?.message || '').match(/try again in\s+([0-9.]+)s/i);
    error.retryAfterMs = header > 0 ? Math.ceil(header * 1000) : match ? Math.ceil(Number(match[1]) * 1000) : 0;
    error.elapsedMs = Date.now() - startedAt;
    throw error;
  }
  const text = decodeEntities(payload?.choices?.[0]?.message?.content || '');
  if (text.length < minLength) {
    const error = new Error(`${model}: réponse trop courte`);
    error.code = 'response-too-short';
    error.elapsedMs = Date.now() - startedAt;
    throw error;
  }
  return text;
}

async function generateWithFallback(key, prompt, factual = '', minLength = 60) {
  let lastError = '';
  const attempts = [];
  for (const model of GROQ_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = Date.now();
      try {
        const text = await generateWithGroq(model, key, prompt, minLength);
        if (factual && !summarySupported(text, factual)) {
          const error = new Error(`${model}: résumé insuffisamment étayé par la source`);
          error.code = 'support-check';
          throw error;
        }
        attempts.push({ model, attempt: attempt + 1, ok: true, elapsedMs: Date.now() - startedAt });
        return { text, model, attempts };
      } catch (error) {
        lastError = String(error?.message || error).slice(0, 360);
        attempts.push({ model, attempt: attempt + 1, ok: false, error: String(error?.code || 'groq-error'), retryAfterMs: Number(error?.retryAfterMs || 0), elapsedMs: Number(error?.elapsedMs || Date.now() - startedAt) });
        const shortRetry = attempt === 0 && error?.retryable && Number(error?.retryAfterMs || 0) <= 900 && error?.code !== 'timeout';
        if (shortRetry) {
          await new Promise(resolve => setTimeout(resolve, Math.max(180, Number(error?.retryAfterMs || 260))));
          continue;
        }
        break;
      }
    }
  }
  const error = new Error(lastError || 'Aucun modèle Groq disponible');
  error.attempts = attempts;
  throw error;
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

async function handler(req, res) {
  const key = groqKey();
  if (req.method === 'GET' && req.query?.status) {
    const payload = { ok: true, provider: 'groq', model: GROQ_MODELS[0], models: GROQ_MODELS, hasGroqKey: Boolean(key), gatewayDisabled: true, summaryQualityV9112: true };
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
  if (mode === 'article' && factual.length < 80) {
    factual = sanitizeFactual([body?.article?.summary, body?.article?.title].filter(Boolean).join('\n'));
  }
  const primaryFactual = factual;

  let corroboratingHeadlines = [];
  if (key && mode === 'article' && factual.length < 300 && body?.article?.title) {
    corroboratingHeadlines = await fetchGoogleNewsHeadlines(body.article.title, body.article.source).catch(() => []);
    if (corroboratingHeadlines.length) {
      const headlineFacts = corroboratingHeadlines.map(headline => /[.!?]$/.test(headline) ? headline : `${headline}.`).join('\n');
      factual = sanitizeFactual([factual, headlineFacts].filter(Boolean).join('\n'));
    }
  }

  if (factual.length < (mode === 'article' ? 30 : 80)) {
    return send(res, 200, {
      ...base,
      summary: '',
      ai: false,
      unavailable: true,
      provider: 'unavailable',
      model: '',
      corroborated: false,
      apiError: 'not-enough-source',
      diagnostics: {
        ...(base?.diagnostics || {}),
        fallbackQuality: 'unavailable',
        summaryStage: 'source-material'
      },
      qualityV9112: mode === 'article' ? 'unavailable' : undefined
    });
  }

  const safeFallback = paragraphize(primaryFactual, 2);
  if (!key) {
    const payload = {
      ...base,
      summary: safeFallback,
      ai: false,
      unavailable: false,
      provider: 'factual',
      model: '',
      grounded: true,
      fallbackQuality: base?.diagnostics?.fallbackQuality || 'trusted',
      apiError: 'groq-key-missing',
      corroborated: corroboratingHeadlines.length > 0,
      diagnostics: {
        ...(base?.diagnostics || {}),
        fallbackQuality: base?.diagnostics?.fallbackQuality || 'trusted',
        summaryStage: 'factual-fallback',
        groqError: 'key-missing',
        groqAttempts: []
      }
    };
    return send(res, 200, finalizeArticleSummary(body, payload, corroboratingHeadlines));
  }

  const prompt = promptFor(body, factual, corroboratingHeadlines.length > 0);
  const validationSource = [
    factual,
    mode === 'article' ? body?.article?.title : body?.category,
    mode === 'article' ? body?.article?.source : ''
  ].filter(Boolean).join('\n');
  const minLength = mode === 'article' && factual.length < 250 ? 35 : 60;

  try {
    const aiResult = await generateWithFallback(key, prompt, validationSource, minLength);
    const payload = {
      ...base,
      summary: paragraphize(aiResult.text, 2),
      ai: true,
      unavailable: false,
      provider: 'groq',
      model: aiResult.model,
      grounded: true,
      fallbackQuality: 'trusted',
      corroborated: corroboratingHeadlines.length > 0,
      diagnostics: {
        ...(base?.diagnostics || {}),
        fallbackQuality: 'trusted',
        summaryStage: 'groq',
        groqAttempts: aiResult.attempts || []
      }
    };
    return send(res, 200, finalizeArticleSummary(body, payload, corroboratingHeadlines));
  } catch (error) {
    const message = String(error?.message || error).replace(/gsk_[A-Za-z0-9_-]+/g, '[clé masquée]').slice(0, 420);
    console.error('Groq summary unavailable:', message);
    const payload = {
      ...base,
      summary: safeFallback,
      ai: false,
      unavailable: false,
      provider: 'factual',
      model: '',
      grounded: true,
      fallbackQuality: base?.diagnostics?.fallbackQuality || 'trusted',
      apiError: error?.attempts?.at(-1)?.error || 'groq-error',
      corroborated: corroboratingHeadlines.length > 0,
      diagnostics: {
        ...(base?.diagnostics || {}),
        fallbackQuality: base?.diagnostics?.fallbackQuality || 'trusted',
        summaryStage: 'factual-fallback',
        groqError: error?.attempts?.at(-1)?.error || 'groq-error',
        groqAttempts: error?.attempts || []
      }
    };
    return send(res, 200, finalizeArticleSummary(body, payload, corroboratingHeadlines));
  }
}

module.exports = handler;
module.exports.finalizeArticleSummary = finalizeArticleSummary;
module.exports.titleRestatement = titleRestatement;
module.exports.googleAggregateRisk = googleAggregateRisk;
