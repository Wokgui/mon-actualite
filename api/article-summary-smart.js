const TIMEOUT_MS = 8000;
const GEMINI_TIMEOUT_MS = 18000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const PARISIEN_FEEDS = [
  'https://feeds.leparisien.fr/leparisien/rss',
  'https://feeds.leparisien.fr/leparisien/rss/societe',
  'https://feeds.leparisien.fr/leparisien/rss/futurs',
  'https://feeds.leparisien.fr/leparisien/rss/economie',
  'https://feeds.leparisien.fr/leparisien/rss/international'
];
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store');
  res.end(JSON.stringify(payload));
}

function decodeEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function clean(value = '') {
  return decodeEntities(String(value || '')
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
    .toLowerCase()
    .replace(/\s+[-–—]\s+le\s+parisien\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article','parisien']);
  return [...new Set(normalize(value).split(' ').filter(word => word.length >= 3 && !stop.has(word)))];
}

function sameTitle(candidate = '', expected = '') {
  const a = normalize(candidate);
  const b = normalize(expected);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wanted = titleTokens(expected);
  const found = new Set(titleTokens(candidate));
  if (!wanted.length || !found.size) return false;
  const hits = wanted.filter(word => found.has(word)).length;
  return hits >= Math.min(5, wanted.length)
    && hits / Math.max(1, Math.min(wanted.length, found.size)) >= 0.72;
}

function informativeText(raw = '', title = '') {
  const text = clean(raw);
  if (text.length < 60) return '';
  const textNorm = normalize(text);
  const titleNorm = normalize(title);
  if (!textNorm || textNorm === titleNorm) return '';
  if (textNorm.includes(titleNorm) && text.length < Math.max(220, clean(title).length * 1.5)) return '';
  return text;
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1] : '';
}

async function fetchFeed(feedUrl, title) {
  const response = await fetch(feedUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': UA,
      'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
  });
  if (!response.ok) return null;
  const xml = await response.text();
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 70)) {
    const itemTitle = clean(xmlTag(item, 'title'));
    if (!sameTitle(itemTitle, title)) continue;
    const candidates = ['content:encoded', 'description', 'summary', 'content']
      .map(name => informativeText(xmlTag(item, name), title))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    return {
      text: candidates[0] || '',
      url: clean(xmlTag(item, 'link')),
      publishedAt: clean(xmlTag(item, 'pubDate'))
    };
  }
  return null;
}

async function fetchRssText(title = '') {
  const results = await Promise.allSettled(PARISIEN_FEEDS.map(feed => fetchFeed(feed, title)));
  return results
    .map(result => result.status === 'fulfilled' ? result.value : null)
    .filter(Boolean)
    .sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0] || null;
}

async function fetchBingNewsText(title = '') {
  const cleanTitle = clean(title).replace(/\s+[-–—]\s+Le Parisien\s*$/i, '').slice(0, 220);
  const queryVariants = [
    `"${cleanTitle}"`,
    cleanTitle,
    `${cleanTitle} Le Parisien`
  ];
  for (const query of queryVariants) {
    try {
      const url = new URL('https://www.bing.com/news/search');
      url.search = new URLSearchParams({ q: query, format: 'RSS', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5',
          'Accept-Language': 'fr-FR,fr;q=0.9'
        }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      for (const item of items.slice(0, 20)) {
        const itemTitle = clean(xmlTag(item, 'title'));
        if (!sameTitle(itemTitle, title)) continue;
        const description = informativeText(xmlTag(item, 'description'), title);
        const snippet = informativeText(xmlTag(item, 'News:Description'), title) || description;
        if (!snippet) continue;
        const link = clean(xmlTag(item, 'link'));
        return { text: snippet, url: link, title: itemTitle };
      }
    } catch {}
  }
  return null;
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
}

function groundingUrls(payload = {}) {
  const chunks = payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return [...new Set(chunks
    .map(chunk => chunk?.web?.uri || '')
    .filter(uri => /^https?:\/\//i.test(uri)))]
    .slice(0, 6);
}

async function groundedSearch(title = '', articleUrl = '') {
  const key = geminiKey();
  if (!key) return { text: '', model: '', sources: [], error: 'Gemini key missing' };
  const cleanTitle = clean(title).replace(/\s+[-–—]\s+Le Parisien\s*$/i, '');
  const prompt = `Utilise Google Search pour retrouver l'article précis du Parisien intitulé : « ${cleanTitle} ». ${articleUrl ? `Le lien reçu par l'application est ${articleUrl}.` : ''}\n\nRédige ensuite en français un résumé factuel de 2 à 4 phrases, environ 55 à 100 mots. Utilise UNIQUEMENT des faits explicitement confirmés par les résultats de recherche qui concernent cet article exact ou le même événement. N'ajoute aucune connaissance générale, supposition, conseil ou détail plausible. Si les résultats publics ne donnent aucune information au-delà du titre, réponds exactement : AUCUNE_INFORMATION`;
  let lastError = '';

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 320 }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = `${model}: ${payload?.error?.message || `HTTP ${response.status}`}`;
        continue;
      }
      const text = clean((payload?.candidates?.[0]?.content?.parts || []).map(part => part?.text || '').join(' '));
      if (!text || /^AUCUNE_INFORMATION\.?$/i.test(text)) return { text: '', model, sources: groundingUrls(payload), error: '' };
      if (text.length < 60) return { text: '', model, sources: groundingUrls(payload), error: 'Grounded answer too short' };
      return { text: text.slice(0, 900), model, sources: groundingUrls(payload), error: '' };
    } catch (error) {
      lastError = `${model}: ${String(error?.message || error)}`.slice(0, 280);
    }
  }
  return { text: '', model: '', sources: [], error: lastError };
}

async function recover(article = {}) {
  const title = clean(article.title || '');
  const rss = await fetchRssText(title).catch(() => null);
  if (rss?.text) {
    return {
      ok: true,
      text: rss.text.slice(0, 3500),
      articleUrl: rss.url || String(article.url || ''),
      publishedAt: rss.publishedAt || '',
      origin: 'publisher-rss',
      grounded: false,
      sources: []
    };
  }

  const bing = await fetchBingNewsText(title).catch(() => null);
  if (bing?.text) {
    return {
      ok: true,
      text: bing.text.slice(0, 1200),
      articleUrl: bing.url || String(article.url || ''),
      origin: 'bing-news-rss',
      grounded: true,
      sources: bing.url ? [bing.url] : []
    };
  }

  const searched = await groundedSearch(title, String(article.url || '')).catch(() => ({ text: '', model: '', sources: [], error: '' }));
  if (searched.text) {
    return {
      ok: true,
      text: searched.text,
      articleUrl: String(article.url || ''),
      origin: 'google-search-grounded',
      grounded: true,
      model: searched.model,
      sources: searched.sources
    };
  }

  return {
    ok: false,
    text: '',
    articleUrl: String(article.url || ''),
    origin: 'unavailable',
    grounded: true,
    model: searched.model || '',
    sources: searched.sources || [],
    error: searched.error || ''
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && String(req.query?.status || '') === '1') {
    return send(res, 200, { ok: true, hasGeminiKey: Boolean(geminiKey()), models: GEMINI_MODELS });
  }
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Méthode non autorisée' });
  const input = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const article = input.article && typeof input.article === 'object' ? input.article : input;
  const title = clean(article.title || '');
  const source = clean(article.source || 'Le Parisien');
  if (!title) return send(res, 400, { error: 'Titre manquant' });
  if (!/le\s+parisien/i.test(`${source} ${title}`)) return send(res, 400, { error: 'Source non prise en charge' });
  const result = await recover(article);
  return send(res, 200, result);
};