const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = [...new Set([
  process.env.GROQ_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
].filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
const SEARCH_TIMEOUT_MS = 6500;
const GROQ_TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store');
  res.end(JSON.stringify(payload));
}

function decode(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } });
}

function clean(value = '') {
  return decode(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\uFFFD+/g, '').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

const STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux article'.split(' '));

function titleTokens(value = '') {
  return [...new Set(normalize(value).split(' ').filter(word => word && !STOP.has(word) && (word.length >= 4 || /\d/.test(word))))];
}

function titleAgreement(candidate = '', expected = '') {
  const wanted = titleTokens(expected);
  const found = new Set(titleTokens(candidate));
  if (!wanted.length || !found.size) return 0;
  const hits = wanted.filter(word => found.has(word)).length;
  return hits / Math.max(1, Math.min(wanted.length, found.size));
}

function queryVariants(title = '') {
  const stripped = clean(title).replace(/\s+[-–—|]\s+[^-–—|]{2,60}$/, '').slice(0, 220);
  const words = stripped.split(/\s+/).filter(Boolean);
  return [...new Set([
    `"${stripped}"`,
    stripped,
    words.length > 10 ? words.slice(0, 9).join(' ') : '',
    titleTokens(stripped).slice(0, 8).join(' ')
  ].filter(Boolean))];
}

async function fetchEvidence(title = '') {
  const evidence = [];
  const seen = new Set();
  for (const query of queryVariants(title)) {
    if (evidence.length >= 8) break;
    try {
      const url = new URL('https://www.bing.com/news/search');
      url.search = new URLSearchParams({ q: query, format: 'RSS', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      for (const item of items.slice(0, 30)) {
        const itemTitle = clean(xmlTag(item, 'title'));
        const agreement = titleAgreement(itemTitle, title);
        if (agreement < .56) continue;
        const text = clean(xmlTag(item, 'description') || xmlTag(item, 'News:Description'));
        const source = clean(xmlTag(item, 'News:Source') || xmlTag(item, 'source')) || (() => {
          try { return new URL(clean(xmlTag(item, 'link'))).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        const link = clean(xmlTag(item, 'link'));
        const key = `${normalize(source)}|${normalize(itemTitle)}`;
        if (!source || seen.has(key)) continue;
        seen.add(key);
        evidence.push({ source, title: itemTitle, text: text.slice(0, 900), link, agreement });
        if (evidence.length >= 8) break;
      }
    } catch {}
  }
  return evidence;
}

function contextTokens(value = '') {
  return normalize(value).split(' ').filter(word => word && !STOP.has(word) && !/^\d/.test(word) && word.length >= 4);
}

function numericContexts(item = {}) {
  const raw = clean(`${item.title || ''} ${item.text || ''}`).replace(/[\u202f\u00a0]/g, ' ');
  const parts = raw.match(/[A-Za-zÀ-ÖØ-öø-ÿ’'-]+|\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?|\d{4}/g) || [];
  const claims = [];
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d/.test(parts[i])) continue;
    const value = parts[i].replace(/[ .]/g, '').replace(',', '.');
    const around = parts.slice(Math.max(0, i - 6), Math.min(parts.length, i + 7)).join(' ');
    const context = [...new Set(contextTokens(around))].slice(0, 10);
    if (context.length < 3) continue;
    claims.push({ value, context, source: item.source });
  }
  return claims;
}

function contextAgreement(a = [], b = []) {
  const bs = new Set(b);
  const common = a.filter(token => bs.has(token)).length;
  return { common, coverage: common / Math.max(1, Math.min(a.length, b.length)) };
}

function detectContradictions(evidence = []) {
  const contradictions = [];
  const all = evidence.flatMap(numericContexts);
  const seen = new Set();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (normalize(a.source) === normalize(b.source) || a.value === b.value) continue;
      const agreement = contextAgreement(a.context, b.context);
      if (agreement.common < 3 || agreement.coverage < .52) continue;
      const values = [a.value, b.value].sort();
      const key = `${values.join('|')}|${[...new Set([...a.context, ...b.context])].sort().slice(0, 6).join('-')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contradictions.push({
        type: 'number',
        label: 'Chiffres différents selon les sources',
        values,
        sources: [a.source, b.source]
      });
      if (contradictions.length >= 3) return contradictions;
    }
  }
  return contradictions;
}

function groqKey() {
  return String(process.env.GROQ_API_KEY || '').replace(/^GROQ_API_KEY\s*=\s*/i, '').replace(/^['"]|['"]$/g, '').trim();
}

async function generate(model, key, prompt) {
  const isGptOss = model.startsWith('openai/gpt-oss-');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: isGptOss ? .3 : .05,
    max_completion_tokens: isGptOss ? 900 : 420
  };
  if (isGptOss) { body.include_reasoning = false; body.reasoning_effort = 'low'; }
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return clean(payload?.choices?.[0]?.message?.content || '');
}

function numericClaims(value = '') {
  const claims = clean(value).replace(/[\u202f\u00a0]/g, ' ').match(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?\b|\b\d{4}\b/g) || [];
  return [...new Set(claims.map(number => number.replace(/[ .]/g, '').replace(',', '.')))];
}

function deltaSupported(delta = '', current = '', evidence = []) {
  const generated = titleTokens(delta);
  const support = titleTokens(`${current} ${evidence.map(item => `${item.title} ${item.text}`).join(' ')}`);
  if (generated.length < 5 || support.length < 5) return false;
  const supportSet = new Set(support);
  const hits = generated.filter(token => supportSet.has(token)).length;
  if (hits / generated.length < .28) return false;
  const supportedNumbers = new Set(numericClaims(`${current} ${evidence.map(item => `${item.title} ${item.text}`).join(' ')}`));
  if (numericClaims(delta).some(number => !supportedNumbers.has(number))) return false;
  return true;
}

async function createDelta(article = {}, previous = {}, evidence = []) {
  const currentText = clean([article.title, article.summary].filter(Boolean).join('\n'));
  const previousText = clean([previous.title, previous.summary].filter(Boolean).join('\n'));
  if (currentText.length < 60 || previousText.length < 40) return null;
  const key = groqKey();
  if (!key) return null;
  const evidenceText = evidence.slice(0, 5).map((item, index) => `SOURCE ${index + 1} — ${item.source}\n${item.title}\n${item.text || ''}`).join('\n\n');
  const prompt = `Compare deux états successifs du même sujet d'actualité. Rédige UNIQUEMENT ce qui est nouveau ou a réellement changé dans l'état actuel par rapport à l'état précédent.\n\nRègles :\n- 1 à 3 phrases, 45 à 95 mots.\n- N'ajoute aucune connaissance extérieure.\n- Tout fait cité doit être présent dans ETAT ACTUEL.\n- Les éléments des SOURCES servent seulement à vérifier, jamais à ajouter un fait absent de l'état actuel.\n- Si un point est contredit par les sources, omets-le.\n- Si rien de substantiel n'a changé, réponds exactement AUCUN_CHANGEMENT.\n- Ne répète pas le contexte déjà connu sauf quelques mots indispensables à la compréhension.\n\nETAT PRECEDENT :\n${previousText}\n\nETAT ACTUEL :\n${currentText}\n\nSOURCES DE VERIFICATION :\n${evidenceText || '(aucune source supplémentaire)'}`;
  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const text = await generate(model, key, prompt);
      if (!text || /^AUCUN_CHANGEMENT\.?$/i.test(text) || text.length < 45) return null;
      if (!deltaSupported(text, currentText, evidence)) throw new Error('delta insuffisamment étayé');
      return { text, model };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 240);
    }
  }
  if (lastError) console.error('Story delta unavailable:', lastError);
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return send(res, 200, { ok: true, provider: 'story-intelligence-v81', hasGroqKey: Boolean(groqKey()), models: GROQ_MODELS });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};
  const previous = body.previous && typeof body.previous === 'object' ? body.previous : {};
  const title = clean(article.title || '');
  if (!title) return send(res, 400, { error: 'Titre manquant' });

  const evidence = await fetchEvidence(title).catch(() => []);
  const contradictions = detectContradictions(evidence);
  const delta = previous?.title || previous?.summary ? await createDelta(article, previous, evidence).catch(() => null) : null;
  const sources = [...new Set(evidence.map(item => item.source).filter(Boolean))];

  return send(res, 200, {
    ok: true,
    provider: 'story-intelligence-v81',
    ai: Boolean(delta),
    model: delta?.model || '',
    deltaSummary: delta?.text || '',
    deltaAvailable: Boolean(delta?.text),
    contradictions,
    contradictionCount: contradictions.length,
    sourceCount: sources.length,
    sources,
    checkedAt: new Date().toISOString()
  });
};