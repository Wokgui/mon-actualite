const smartHandler = require('./article-summary-smart.js');
const groqHandler = require('./article-summary-groq.js');
const multisourceHandler = require('./article-summary-multisource.js');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function clean(value = '') {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&hellip;/gi, '…')
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
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

function words(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article']);
  return normalize(value).split(' ').filter(word => word.length >= 4 && !stop.has(word));
}

function titleRestatement(summary = '', title = '') {
  const text = clean(summary);
  const wanted = [...new Set(words(title))];
  const found = new Set(words(text));
  if (wanted.length < 4 || found.size < 4) return false;
  const hits = wanted.filter(word => found.has(word)).length;
  return hits / wanted.length >= 0.88 && text.length <= Math.max(190, clean(title).length * 1.65);
}

function truncationReason(value = '') {
  const text = clean(value);
  if (!text || text.length < 55) return 'too-short';
  if (/(?:\.{3}|…|\.\.\.)\s*[»”"']?\s*$/.test(text)) return 'trailing-ellipsis';
  if (/[-–—,:;\/(]\s*$/.test(text)) return 'dangling-ending';
  if (/\b(?:lire la suite|read more|en savoir plus)\s*[.!…]*$/i.test(text)) return 'read-more-ending';
  if (/résumé (?:ia )?(?:momentanément )?indisponible/i.test(text)) return 'unavailable-placeholder';
  return '';
}

function candidate(data = {}, article = {}, { requireAi = true } = {}) {
  const text = clean(data?.summary || data?.text || '');
  const reason = truncationReason(text)
    || (titleRestatement(text, article?.title || '') ? 'title-restatement' : '')
    || (data?.unavailable ? 'upstream-unavailable' : '')
    || (requireAi && data?.ai !== true ? 'not-ai-summary' : '');
  if (reason) return { ok: false, reason, text, data };
  return { ok: true, reason: '', text, data };
}

function capture(handler, req, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      end(raw = '') {
        let data = {};
        try { data = JSON.parse(String(raw || '{}')); } catch {}
        resolve({ statusCode: this.statusCode || 200, headers, data });
      }
    };
    const nextReq = Object.create(req || null);
    nextReq.method = 'POST';
    nextReq.query = req?.query || {};
    nextReq.body = body;
    Promise.resolve(handler(nextReq, response)).catch(reject);
  });
}

function normalizedPayload(result, source, attempts) {
  const data = result.data || {};
  return {
    ...data,
    summary: result.text,
    text: result.text,
    ok: true,
    ai: true,
    grounded: true,
    unavailable: false,
    provider: clean(data.provider || data.origin || source),
    origin: clean(data.origin || data.provider || source),
    reliableSummaryV9146: true,
    reliableSourceV9146: source,
    diagnostics: {
      ...(data.diagnostics || {}),
      reliableSummaryV9146: true,
      reliableSourceV9146: source,
      reliableAttemptsV9146: attempts
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      provider: 'reliable-summary-v91.46',
      order: ['groq-light', 'groq-full', 'groq-multisource']
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};
  if (!clean(article.title || '')) return send(res, 400, { error: 'Titre manquant' });

  const attempts = [];

  try {
    const smart = await capture(smartHandler, req, { ...body, article, lightweight: true, intent: 'foreground' });
    const checked = candidate(smart.data, article, { requireAi: true });
    attempts.push({ stage: 'groq-light', ok: checked.ok, reason: checked.reason, provider: clean(smart.data?.provider || smart.data?.origin || '') });
    if (checked.ok) return send(res, 200, normalizedPayload(checked, 'groq-light', attempts));
  } catch (error) {
    attempts.push({ stage: 'groq-light', ok: false, reason: 'exception', error: String(error?.message || error).slice(0, 180) });
  }

  try {
    const full = await capture(groqHandler, req, { ...body, mode: 'article', article });
    const checked = candidate(full.data, article, { requireAi: true });
    attempts.push({ stage: 'groq-full', ok: checked.ok, reason: checked.reason, provider: clean(full.data?.provider || full.data?.origin || '') });
    if (checked.ok) return send(res, 200, normalizedPayload(checked, 'groq-full', attempts));
  } catch (error) {
    attempts.push({ stage: 'groq-full', ok: false, reason: 'exception', error: String(error?.message || error).slice(0, 180) });
  }

  try {
    const multi = await capture(multisourceHandler, req, { ...body, article });
    const checked = candidate(multi.data, article, { requireAi: true });
    attempts.push({ stage: 'groq-multisource', ok: checked.ok, reason: checked.reason, provider: clean(multi.data?.provider || '') });
    if (checked.ok) return send(res, 200, normalizedPayload(checked, 'groq-multisource', attempts));
  } catch (error) {
    attempts.push({ stage: 'groq-multisource', ok: false, reason: 'exception', error: String(error?.message || error).slice(0, 180) });
  }

  return send(res, 200, {
    ok: false,
    summary: '',
    text: '',
    ai: false,
    grounded: false,
    unavailable: true,
    provider: 'reliable-summary-unavailable',
    reliableSummaryV9146: true,
    diagnostics: { reliableAttemptsV9146: attempts }
  });
};
