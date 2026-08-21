const nativeFetch = window.fetch.bind(window);
const MIGRATION_FLAG = 'news-summary-fix-v4-groq-applied';

const ENTITY_MAP = new Map([
  ['nbsp', ' '], ['amp', '&'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'],
  ['rsquo', '’'], ['lsquo', '‘'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…'],
  ['laquo', '«'], ['raquo', '»'], ['eacute', 'é'], ['egrave', 'è'], ['ecirc', 'ê'], ['euml', 'ë'], ['agrave', 'à'],
  ['acirc', 'â'], ['ccedil', 'ç'], ['icirc', 'î'], ['iuml', 'ï'], ['ocirc', 'ô'], ['ugrave', 'ù'], ['ucirc', 'û'],
  ['Eacute', 'É'], ['Agrave', 'À'], ['Ccedil', 'Ç'], ['oelig', 'œ'], ['OElig', 'Œ']
]);

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
  return text.replace(/\uFFFD+/g, '').trim();
}

function isBoilerplate(text = '') {
  const value = decodeEntities(text).toLowerCase();
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

function cleanSummary(value = '') {
  const decoded = decodeEntities(value);
  const parts = decoded.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const useful = parts.map(s => s.trim()).filter(s => s.length >= 25 && !isBoilerplate(s));
  return (useful.join(' ') || decoded).trim();
}

try {
  if (localStorage.getItem(MIGRATION_FLAG) !== '1') {
    localStorage.removeItem('news-factual-summaries-v1');
    localStorage.removeItem('news-factual-summaries-v2');
    localStorage.removeItem('news-factual-summaries-v3');
    localStorage.removeItem('news-ai-summaries-v4');
    localStorage.setItem(MIGRATION_FLAG, '1');
  }
} catch {}

window.fetch = async function patchedFetch(input, init) {
  const raw = typeof input === 'string' ? input : input?.url || '';
  let nextInput = input;
  let isSummary = false;

  try {
    const url = new URL(raw, location.href);
    if (url.pathname === '/api/article-summary' || url.pathname === '/api/article-summary-v3') {
      url.pathname = '/api/article-summary-groq';
      url.searchParams.set('v', '4');
      isSummary = true;
      nextInput = typeof input === 'string' ? `${url.pathname}${url.search}` : new Request(url.href, input);
    }
  } catch {}

  const response = await nativeFetch(nextInput, init);
  if (!isSummary || !response.ok) return response;

  try {
    const data = await response.clone().json();
    if (data && typeof data.summary === 'string') data.summary = cleanSummary(data.summary);
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
};
