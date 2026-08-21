const nativeFetch = window.fetch.bind(window);
const MIGRATION_FLAG = 'news-summary-fix-v3-applied';

const ENTITY_MAP = new Map([
  ['nbsp', ' '], ['amp', '&'], ['quot', '"'], ['apos', "'"], ['lt', '<'], ['gt', '>'],
  ['rsquo', '’'], ['lsquo', '‘'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…'],
  ['laquo', '«'], ['raquo', '»'], ['eacute', 'é'], ['egrave', 'è'], ['ecirc', 'ê'], ['euml', 'ë'], ['agrave', 'à'],
  ['acirc', 'â'], ['ccedil', 'ç'], ['icirc', 'î'], ['iuml', 'ï'], ['ocirc', 'ô'], ['ugrave', 'ù'], ['ucirc', 'û'],
  ['Eacute', 'É'], ['Agrave', 'À'], ['Ccedil', 'Ç'], ['oelig', 'œ'], ['OElig', 'Œ']
]);

function decodeEntities(value = '') {
  let text = String(value ?? '');
  for (let pass = 0; pass < 3; pass++) {
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

try {
  if (localStorage.getItem(MIGRATION_FLAG) !== '1') {
    localStorage.removeItem('news-factual-summaries-v1');
    localStorage.removeItem('news-factual-summaries-v2');
    localStorage.setItem(MIGRATION_FLAG, '1');
  }
} catch {}

window.fetch = async function patchedFetch(input, init) {
  const raw = typeof input === 'string' ? input : input?.url || '';
  let nextInput = input;
  let isSummary = false;

  try {
    const url = new URL(raw, location.href);
    if (url.pathname === '/api/article-summary') {
      url.pathname = '/api/article-summary-v3';
      url.searchParams.set('v', '3');
      isSummary = true;
      nextInput = typeof input === 'string' ? `${url.pathname}${url.search}` : new Request(url.href, input);
    }
  } catch {}

  const response = await nativeFetch(nextInput, init);
  if (!isSummary || !response.ok) return response;

  try {
    const data = await response.clone().json();
    if (data && typeof data.summary === 'string') data.summary = decodeEntities(data.summary);
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
