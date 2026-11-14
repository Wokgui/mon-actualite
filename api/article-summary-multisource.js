const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = [...new Set([
  process.env.GROQ_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b'
].filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const SEARCH_TIMEOUT_MS = 6500;
const GROQ_TIMEOUT_MS = 16000;

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

function titleTokens(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article','direct','video','selon','nouveau','nouvelle']);
  return [...new Set(normalize(value).split(' ').filter(word => word.length >= 3 && !stop.has(word)))];
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

async function bingEvidence(title = '') {
  const evidence = [];
  const seen = new Set();
  for (const query of queryVariants(title)) {
    if (evidence.length >= 7) break;
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
        if (agreement < 0.58) continue;
        const description = clean(xmlTag(item, 'description') || xmlTag(item, 'News:Description'));
        const source = clean(xmlTag(item, 'News:Source') || xmlTag(item, 'source')) || (() => {
          try { return new URL(clean(xmlTag(item, 'link'))).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        const link = clean(xmlTag(item, 'link'));
        const key = `${normalize(source)}|${normalize(itemTitle)}`;
        if (!source || seen.has(key)) continue;
        seen.add(key);
        evidence.push({ source, title: itemTitle, text: description.slice(0, 900), link, agreement });
        if (evidence.length >= 7) break;
      }
    } catch {}
  }
  return evidence;
}

function numericClaims(value = '') {
  const matches = clean(value).replace(/[\u202f\u00a0]/g, ' ').match(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d+)?\b|\b\d{4}\b/g) || [];
  return [...new Set(matches.map(value => value.replace(/[ .]/g, '').replace(',', '.')))];
}

function normalizedNumberText(value = '') {
  return clean(value).replace(/[\u202f\u00a0]/g, ' ').replace(/(\d)[ .](?=\d{3}\b)/g, '$1').replace(/,/g, '.');
}

function numbersCorroborated(summary = '', evidence = []) {
  const claims = numericClaims(summary);
  if (!claims.length) return true;
  return claims.every(claim => evidence.filter(item => normalizedNumberText(`${item.title} ${item.text}`).includes(claim)).length >= 2);
}

function groqKey() {
  return String(process.env.GROQ_API_KEY || '').replace(/^GROQ_API_KEY\s*=\s*/i, '').replace(/^['"]|['"]$/g, '').trim();
}

async function generate(model, key, prompt) {
  const isGptOss = model.startsWith('openai/gpt-oss-');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: isGptOss ? 0.35 : 0.05,
    max_completion_tokens: isGptOss ? 1100 : 500
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

async function synthesize(title, evidence, expectedSources = []) {
  const key = groqKey();
  if (!key || evidence.length < 2) return null;
  const sourceList = [...new Set(evidence.map(item => item.source).filter(Boolean))];
  if (sourceList.length < 2) return null;
  const material = evidence.map((item, index) => `SOURCE ${index + 1} — ${item.source}\nTitre : ${item.title}\nÉléments : ${item.text || '(titre uniquement)'}`).join('\n\n');
  const expected = expectedSources.length ? `Les médias déjà regroupés par l'application sont : ${expectedSources.join(', ')}. ` : '';
  const prompt = `Tu réalises une synthèse de presse factuelle en français. ${expected}L'événement recherché est : « ${title} ».

Règles obligatoires :
- N'utilise QUE les éléments ci-dessous.
- Ne retiens dans le résumé que les faits soutenus par au moins DEUX sources distinctes.
- Si un chiffre, une date, un nom précis ou une version n'est présent que dans une seule source, omets-le.
- Si deux sources se contredisent, omets le point contesté au lieu de trancher.
- Ne complète avec aucune connaissance générale.
- 2 à 4 phrases, environ 55 à 100 mots, sans titre et sans liste.
- Commence directement par le fait principal.

ÉLÉMENTS MULTI-SOURCES :\n${material}`;

  let lastError = '';
  for (const model of GROQ_MODELS) {
    try {
      const text = await generate(model, key, prompt);
      if (text.length < 55) throw new Error('résumé trop court');
      if (!numbersCorroborated(text, evidence)) throw new Error('chiffre insuffisamment corroboré');
      return { text, model, sourceList };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 240);
    }
  }
  console.error('Multisource summary unavailable:', lastError);
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return send(res, 200, { ok: true, provider: 'groq-multisource', hasGroqKey: Boolean(groqKey()), models: GROQ_MODELS });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const article = body.article && typeof body.article === 'object' ? body.article : {};
  const title = clean(article.title || '');
  if (!title) return send(res, 400, { error: 'Titre manquant' });

  const expectedSources = [...new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(clean).filter(Boolean))];
  const evidence = await bingEvidence(title).catch(() => []);
  const distinct = [...new Set(evidence.map(item => normalize(item.source)).filter(Boolean))];
  if (distinct.length < 2) {
    return send(res, 200, { ok: false, unavailable: true, summary: '', multiSource: false, sourceCount: distinct.length, provider: 'multisource-insufficient' });
  }

  const result = await synthesize(title, evidence, expectedSources);
  if (!result) {
    return send(res, 200, { ok: false, unavailable: true, summary: '', multiSource: false, sourceCount: distinct.length, provider: 'multisource-unavailable' });
  }

  return send(res, 200, {
    ok: true,
    summary: result.text,
    ai: true,
    unavailable: false,
    multiSource: true,
    corroborated: true,
    sourceCount: result.sourceList.length,
    sources: result.sourceList,
    provider: 'groq-multisource',
    model: result.model
  });
};
