const MAX_IMAGE_BYTES = 7_000_000;
const COMMONS_TIMEOUT_MS = 3600;
const IMAGE_TIMEOUT_MS = 3200;

const STOP = new Set([
  'avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','tous','toute','mais','sans','vers','entre','dont','selon','comme','fait','faits','aux','une','des','les','par','sur','qui','que','quoi','comment','nouveau','nouvelle','plusieurs','sujets','sujet','france','francais','francaise','aujourd','hui','hier','demain','annonce','contre','autour','encore','voici','pourquoi','quand','direct','infos','info','derniere','dernieres','derniers','est','de','du','la','le','un','en','au','et','certains','pays','voient','fournisseur','fiable'
]);

const CATEGORY_QUERY = {
  politique: 'French government parliament politics',
  international: 'United Nations diplomacy international relations',
  economie: 'economy finance business market',
  societe: 'France society public life',
  sante: 'medicine health hospital',
  environnement: 'climate environment nature',
  science: 'science research laboratory',
  culture: 'arts culture museum cinema',
  education: 'school education university',
  europe: 'European Union Brussels',
  ia: 'artificial intelligence computing',
  tech: 'technology computer electronics',
  smartphones: 'smartphone mobile phone',
  vr: 'virtual reality headset',
  automobile: 'car road transport',
  energie: 'energy electricity power plant'
};

const ENTITY_ALIASES = {
  russie: 'Russia Moscow', ukraine: 'Ukraine Kyiv', iran: 'Iran Tehran', israel: 'Israel', gaza: 'Gaza', liban: 'Lebanon Beirut', chine: 'China Beijing',
  trump: 'Donald Trump', macron: 'Emmanuel Macron', zelensky: 'Volodymyr Zelenskyy', poutine: 'Vladimir Putin',
  anthropic: 'Anthropic artificial intelligence', openai: 'OpenAI', nvidia: 'Nvidia', canada: 'Canada', islande: 'Iceland',
  cyberattaque: 'cybersecurity computer', piratage: 'cybersecurity computer', pogacar: 'Tadej Pogacar cycling', vuelta: 'Vuelta a Espana cycling',
  pelikan: 'radar military', drones: 'military drone', missiles: 'missile', europe: 'European Union'
};

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function titleQueries(title = '') {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const acronyms = { MBS: 'Mohammed bin Salman', UE: 'European Union', USA: 'United States', OTAN: 'NATO', IA: 'artificial intelligence' };
  const words = normalize(raw)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !STOP.has(word));
  const queries = [];

  for (const acronym of raw.match(/\b[A-Z]{2,7}\b/g) || []) {
    if (acronyms[acronym] && !queries.includes(acronyms[acronym])) queries.push(acronyms[acronym]);
  }
  for (const word of words) {
    const alias = ENTITY_ALIASES[word];
    if (alias && !queries.includes(alias)) queries.push(alias);
  }
  const remaining = words.filter(word => !ENTITY_ALIASES[word]).slice(0, 4).join(' ');
  if (remaining) queries.push(remaining);
  if (!queries.length && words.length) queries.push(words.slice(0, 4).join(' '));
  return [...new Set(queries.filter(Boolean))].slice(0, 4);
}

function candidateScore(label = '', query = '') {
  const haystack = normalize(label).replace(/[^a-z0-9]+/g, ' ');
  const words = normalize(query).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !['the','and','with','from'].includes(word));
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

async function commonsSearch(query, requireOverlap) {
  if (!query) return '';
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|mime|size', iiurlwidth: '640', format: 'json'
  }).toString();
  const response = await fetch(api, {
    signal: AbortSignal.timeout(COMMONS_TIMEOUT_MS),
    headers: { 'User-Agent': 'MonActualite/6.1 (+https://mon-actualite.vercel.app)' }
  });
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  const candidates = [];
  for (const page of Object.values(data?.query?.pages || {})) {
    const info = page?.imageinfo?.[0];
    const url = info?.thumburl || info?.url || '';
    if (!url || !/^image\/(jpeg|png|webp)$/i.test(info?.mime || '')) continue;
    const width = Number(info?.thumbwidth || info?.width || 0);
    const height = Number(info?.thumbheight || info?.height || 0);
    if (width && width < 300) continue;
    if (height && height < 160) continue;
    const label = `${page.title || ''} ${url}`;
    if (/logo|icon|coat_of_arms|flag_of|map_of|diagram|symbol|wordmark|emblem/i.test(label)) continue;
    candidates.push({ url, score: candidateScore(page.title || '', query) });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return '';
  if (requireOverlap && candidates[0].score < 1) return '';
  return candidates[0].url;
}

async function chooseImage(title, category) {
  for (const query of titleQueries(title)) {
    const specific = await commonsSearch(query, true).catch(() => '');
    if (specific) return specific;
  }
  const categoryQuery = CATEGORY_QUERY[normalize(category).trim()] || 'current events world news';
  return commonsSearch(categoryQuery, false).catch(() => '');
}

async function fetchImage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    headers: { 'User-Agent': 'MonActualite/6.1', 'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*' }
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error('not image');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('bad image size');
  return { buffer, type };
}

function neutralFallback(res) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eeeeF1"/><stop offset="1" stop-color="#ddddE3"/></linearGradient></defs><rect width="640" height="420" rx="22" fill="url(#g)"/><path d="M0 330L155 220l105 70 104-105 276 235H0Z" fill="#c9c9d1"/><circle cx="470" cy="120" r="42" fill="#d2d2d9"/></svg>';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  res.setHeader('X-Photo-Source', 'neutral-fallback');
  res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const title = String(req.query?.title || '').slice(0, 300);
  const category = String(req.query?.category || '').slice(0, 80);
  try {
    const url = await chooseImage(title, category);
    if (!url) return neutralFallback(res);
    const image = await fetchImage(url);
    res.statusCode = 200;
    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', String(image.buffer.byteLength));
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('X-Photo-Source', 'wikimedia-fast');
    return res.end(image.buffer);
  } catch (error) {
    console.error('fast photo:', String(error?.message || error).slice(0, 140));
    return neutralFallback(res);
  }
};
