const groqHandler = require('./article-summary-groq.js');

const BOILERPLATE = [
  /\b(?:connectez[- ]?vous|se connecter|identifiez[- ]?vous|créez (?:votre|un) compte)\b/i,
  /\b(?:abonnez[- ]?vous|déjà abonné|offre d[’']abonnement|nos offres|accès abonnés?)\b/i,
  /\b(?:acceptez les cookies|gestion des cookies|préférences de confidentialité|consentement)\b/i,
  /\b(?:activez les notifications|newsletter|inscrivez[- ]?vous)\b/i,
  /\b(?:partager|sauvegarder|enregistrer|ajouter aux favoris|lire aussi|voir aussi|à découvrir)\b/i,
  /\b(?:ouvrez? l[’']article|consultez? (?:les? )?détails|cliquez|en savoir plus)\b/i,
  /\b(?:résumé indisponible|résumé en cours de préparation)\b/i
];
const GENERIC_OPENING = /^(?:cet article|l[’']article|ce texte|cette publication)\s+(?:porte sur|parle de|évoque|présente|explique|concerne)\b/i;

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ').toLowerCase()
    .replace(/[^a-z0-9%€$]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function sentenceList(value = '') {
  return clean(value).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(clean).filter(Boolean) || [];
}

function usefulSentences(value = '') {
  const seen = [];
  const kept = [];
  for (const sentence of sentenceList(value)) {
    if (sentence.length < 18 || BOILERPLATE.some(rx => rx.test(sentence))) continue;
    const key = normalize(sentence);
    if (!key) continue;
    const duplicate = seen.some(previous => {
      if (previous === key) return true;
      const a = new Set(previous.split(' ').filter(word => word.length >= 4));
      const b = new Set(key.split(' ').filter(word => word.length >= 4));
      const common = [...a].filter(word => b.has(word)).length;
      return common / Math.max(1, Math.min(a.size, b.size)) >= 0.9;
    });
    if (duplicate) continue;
    seen.push(key);
    kept.push(sentence);
  }
  return kept;
}

function contentTokens(value = '') {
  const stop = new Set('avec dans pour plus cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas'.split(' '));
  return [...new Set(normalize(value).split(' ').filter(word => word.length >= 4 && !stop.has(word)))];
}

function titleRestatement(summary = '', title = '') {
  const s = clean(summary);
  const t = clean(title);
  if (!s || !t) return false;
  if (GENERIC_OPENING.test(s)) return true;
  const titleTokens = contentTokens(t);
  const summaryTokens = contentTokens(s);
  if (titleTokens.length < 4 || summaryTokens.length < 3) return false;
  const set = new Set(summaryTokens);
  const covered = titleTokens.filter(token => set.has(token)).length / titleTokens.length;
  const extra = summaryTokens.filter(token => !titleTokens.includes(token)).length;
  return covered >= 0.84 && extra <= 3 && s.length <= Math.max(190, t.length * 1.65);
}

function googleAggregateRisk(article = {}, payload = {}) {
  const source = normalize(article.source || '');
  let host = '';
  try { host = new URL(clean(article.url || '')).hostname.toLowerCase(); } catch {}
  const google = source === 'google news' || host === 'news.google.com' || host.endsWith('.news.google.com');
  if (!google) return false;
  const provider = clean(payload.provider || '').toLowerCase();
  if (provider !== 'factual') return false;
  const sources = [...new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(normalize).filter(Boolean))];
  return sources.length >= 2 || clean(article.summary || article.detail || '').length >= 180;
}

function assessSummary(summary = '', article = {}, payload = {}) {
  const sentences = usefulSentences(summary);
  const text = sentences.join(' ').replace(/^(?:résumé|synthèse)\s*:\s*/i, '').trim();
  if (!text || text.length < 55) return { ok: false, text: '', reason: 'too-short-or-boilerplate' };
  if (GENERIC_OPENING.test(text)) return { ok: false, text: '', reason: 'generic-opening' };
  if (titleRestatement(text, article.title || '')) return { ok: false, text: '', reason: 'title-restatement' };
  if (googleAggregateRisk(article, payload)) return { ok: false, text: '', reason: 'ambiguous-google-aggregate' };

  const summaryTokens = contentTokens(text);
  if (summaryTokens.length < 8 && text.length < 100) return { ok: false, text: '', reason: 'low-information' };
  return { ok: true, text, reason: '', sentenceCount: sentences.length };
}

function parseRequestBody(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function captureResponse() {
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const capture = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') {
      this.body += value == null ? '' : String(value);
      resolveDone();
    }
  };
  return { capture, done };
}

function forward(res, captured, bodyOverride = null) {
  res.statusCode = captured.statusCode || 200;
  for (const [name, value] of Object.entries(captured.headers || {})) {
    if (name === 'content-length' || name === 'content-encoding') continue;
    try { res.setHeader(name, value); } catch {}
  }
  res.setHeader('Cache-Control', 'no-store');
  const body = bodyOverride == null ? captured.body : JSON.stringify(bodyOverride);
  res.end(body);
}

async function handler(req, res) {
  const { capture, done } = captureResponse();
  await Promise.resolve(groqHandler(req, capture));
  await Promise.race([done, Promise.resolve()]);

  if (capture.statusCode !== 200) return forward(res, capture);
  let payload;
  try { payload = JSON.parse(capture.body || '{}'); } catch { return forward(res, capture); }
  if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'summary')) return forward(res, capture);

  const body = parseRequestBody(req);
  if (body?.mode !== 'article' || !body.article || typeof body.article !== 'object') return forward(res, capture);
  if (payload.unavailable) return forward(res, capture, { ...payload, summary: '', qualityV9112: 'unavailable' });

  const assessment = assessSummary(payload.summary || '', body.article, payload);
  if (!assessment.ok) {
    return forward(res, capture, {
      ...payload,
      summary: '',
      unavailable: true,
      qualityV9112: 'rejected',
      qualityReasonV9112: assessment.reason,
      providerOriginalV9112: clean(payload.provider || '')
    });
  }

  return forward(res, capture, {
    ...payload,
    summary: assessment.text,
    unavailable: false,
    qualityV9112: 'accepted',
    qualitySentenceCountV9112: assessment.sentenceCount
  });
}

module.exports = handler;
module.exports.assessSummary = assessSummary;
module.exports.titleRestatement = titleRestatement;
module.exports.googleAggregateRisk = googleAggregateRisk;
