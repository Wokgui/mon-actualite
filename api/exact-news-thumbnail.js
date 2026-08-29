const HTML_TIMEOUT_MS = 3200;
const IMAGE_TIMEOUT_MS = 3000;
const RELATED_TIMEOUT_MS = 7000;
const MAX_SEARCH_HTML_BYTES = 2_400_000;
const MAX_IMAGE_BYTES = 7_000_000;
const GOOGLE_NEWS_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function plainText(value = '') {
  return decode(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleWords(value = '') {
  const stop = new Set(['avec', 'dans', 'pour', 'plus', 'apres', 'avant', 'cette', 'sont', 'etre', 'leur', 'leurs', 'tout', 'mais', 'sans', 'vers', 'entre', 'une', 'des', 'les', 'sur', 'qui', 'que', 'aux', 'par', 'ses', 'son', 'ont', 'est', 'etats', 'unis']);
  return [...new Set(plainText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate, expected) {
  const wanted = titleWords(expected);
  const found = titleWords(candidate);
  if (!wanted.length || !found.length) return { score: 0, hits: 0, shorterCoverage: 0 };
  const foundSet = new Set(found);
  const hits = wanted.filter(word => foundSet.has(word)).length;
  return {
    score: hits / wanted.length,
    hits,
    shorterCoverage: hits / Math.max(1, Math.min(wanted.length, found.length))
  };
}

function sameEvent(candidate, expected) {
  const agreement = titleAgreement(candidate, expected);
  return (agreement.score >= 0.72 && agreement.hits >= Math.min(4, titleWords(expected).length))
    || (agreement.hits >= 5 && agreement.shorterCoverage >= 0.55)
    || (agreement.hits >= 4 && agreement.shorterCoverage >= 0.68);
}

function decodeBuffer(buffer, contentType = '') {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  const declared = (contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i) || [])[1]
    || (probe.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i) || [])[1]
    || 'utf-8';
  const charset = /^(iso-8859-1|latin1|windows-1252|cp1252)$/i.test(declared) ? 'windows-1252' : 'utf-8';
  try { return new TextDecoder(charset).decode(buffer); }
  catch { return buffer.toString('utf8'); }
}

async function searchGoogleNewsThumbnail(searchQuery, expectedTitle, source) {
  const wantedWords = titleWords(expectedTitle);
  if (wantedWords.length < 3) return null;
  const searchUrl = new URL('https://news.google.com/search');
  searchUrl.search = new URLSearchParams({ q: searchQuery, hl: 'fr', gl: 'FR', ceid: 'FR:fr', ucbcb: '1' }).toString();
  const response = await fetch(searchUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
  });
  if (!response.ok) throw new Error(`Google search HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > MAX_SEARCH_HTML_BYTES) throw new Error('Google search page too large');
  const html = decodeBuffer(buffer, type);
  const resultPattern = /<a\b[^>]*class=["'][^"']*\bJtKRv\b[^"']*["'][^>]*>([\s\S]{1,2200}?)<\/a>/gi;
  const results = [...html.matchAll(resultPattern)];
  let best = null;

  for (let index = 0; index < results.length; index += 1) {
    const match = results[index];
    const label = plainText(match[1]);
    if (!sameEvent(label, expectedTitle)) continue;
    const agreement = titleAgreement(label, expectedTitle);
    const previous = results[index - 1]?.index;
    const next = results[index + 1]?.index;
    const start = previous == null ? Math.max(0, match.index - 12_000) : Math.floor((previous + match.index) / 2);
    const end = next == null ? Math.min(html.length, match.index + 12_000) : Math.floor((match.index + next) / 2);
    const resultHtml = html.slice(start, end);
    const sourceText = plainText(resultHtml).toLowerCase();
    const sourceNeedle = plainText(source).toLowerCase();
    const sourceBonus = sourceNeedle && sourceText.includes(sourceNeedle) ? 0.08 : 0;
    const attachments = [...resultHtml.matchAll(/\/api\/attachments\/[^"'\s,]+/g)].map(item => decode(item[0]));
    if (!attachments.length) continue;
    const rawAttachment = attachments.find(value => /-w400-h224-/i.test(value)) || attachments[attachments.length - 1];
    const attachment = rawAttachment.replace(/-w\d+-h\d+-p-df(?:-rw)?$/i, '-w400-h224-p-df');
    const confidence = Math.min(1, Math.max(agreement.score, agreement.shorterCoverage * 0.88) + sourceBonus);
    if (!best || confidence > best.score) best = { score: confidence, url: new URL(attachment, searchUrl).href };
    if (confidence >= 0.99) break;
  }
  return best;
}

async function googleNewsThumbnail(title, source) {
  const query = plainText(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 220);
  const words = titleWords(query);
  if (words.length < 3) return '';
  let best = await searchGoogleNewsThumbnail(query, query, source);
  if (!best) {
    const coreQuery = words.filter(word => word.length >= 4).slice(0, 9).join(' ');
    if (coreQuery && coreQuery !== query) best = await searchGoogleNewsThumbnail(coreQuery, query, source);
  }
  return best?.url || '';
}

function xmlTag(block = '', name = '') {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? plainText(match[1]) : '';
}

async function relatedGoogleNewsItems(title, source) {
  const expected = plainText(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const words = titleWords(expected);
  if (words.length < 3) return [];
  const queries = [expected, words.filter(word => word.length >= 4).slice(0, 9).join(' ')].filter(Boolean);
  const seen = new Set();
  const items = [];

  for (const query of [...new Set(queries)]) {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.search = new URLSearchParams({ q: query, hl: 'fr', gl: 'FR', ceid: 'FR:fr' }).toString();
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'application/rss+xml,application/xml,text/xml' }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      for (const block of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 24)) {
        const headline = xmlTag(block, 'title');
        const link = xmlTag(block, 'link') || xmlTag(block, 'guid');
        const publisher = xmlTag(block, 'source');
        if (!headline || !/^https?:\/\//i.test(link) || !sameEvent(headline, expected)) continue;
        const key = headline.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const agreement = titleAgreement(headline, expected);
        const differentSource = publisher && source && publisher.toLowerCase() !== source.toLowerCase();
        items.push({ headline, link, publisher, confidence: Math.max(agreement.score, agreement.shorterCoverage) + (differentSource ? 0.06 : 0) });
      }
      if (items.length >= 6) break;
    } catch {}
  }
  return items.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

async function fetchRelatedPublisherImage(req, title, source) {
  const items = await relatedGoogleNewsItems(title, source);
  if (!items.length) return null;
  const protocol = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers?.host || '').trim();
  if (!host) return null;
  const origin = `${protocol}://${host}`;

  for (const item of items) {
    try {
      const params = new URLSearchParams({
        v: '25',
        url: item.link,
        image: '',
        title: item.headline.slice(0, 280),
        source: item.publisher.slice(0, 100),
        custom: '0'
      });
      const response = await fetch(`${origin}/api/article-thumbnail?${params}`, {
        signal: AbortSignal.timeout(RELATED_TIMEOUT_MS),
        headers: { 'User-Agent': GOOGLE_NEWS_UA }
      });
      const type = response.headers.get('content-type') || '';
      const status = response.headers.get('x-thumbnail-status') || '';
      if (!response.ok || !type.startsWith('image/') || /svg/i.test(type) || /fallback|tile/i.test(status)) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) continue;
      return { buffer, type, status: 'same-event-publisher' };
    } catch {}
  }
  return null;
}

function googleImageHost(hostname = '') {
  const host = hostname.toLowerCase();
  return host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.googleusercontent.com') || host.endsWith('.gstatic.com');
}

async function fetchImage(rawUrl) {
  let current = rawUrl;
  for (let i = 0; i < 5; i += 1) {
    const url = new URL(current);
    if (!googleImageHost(url.hostname)) throw new Error('unexpected image host');
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { 'User-Agent': GOOGLE_NEWS_UA, 'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8', 'Referer': 'https://news.google.com/' }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error('not image');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('bad image size');
    return { buffer, type };
  }
  throw new Error('too many image redirects');
}

function sendImage(res, image, status) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', status);
  return res.end(image.buffer);
}

function xmlText(value = '') {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function sourceTile(res, source) {
  const label = String(source || 'Source suivie').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Source suivie';
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'S';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e7f4ff"/><stop offset="1" stop-color="#b9c9ff"/></linearGradient></defs><rect width="640" height="420" rx="22" fill="url(#g)"/><circle cx="320" cy="178" r="92" fill="#fff" fill-opacity=".82"/><text x="320" y="198" text-anchor="middle" font-family="Arial,sans-serif" font-size="62" font-weight="800" fill="#3156a8">${xmlText(initials)}</text><text x="320" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#294789">${xmlText(label)}</text></svg>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');
  res.setHeader('X-Thumbnail-Status', 'publisher-tile');
  return res.end(svg);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const title = String(req.query?.title || '').slice(0, 300);
  const source = String(req.query?.source || 'Le Parisien').slice(0, 100);

  try {
    const thumbnail = await googleNewsThumbnail(title, source);
    if (thumbnail) {
      try {
        const image = await fetchImage(thumbnail);
        return sendImage(res, image, 'google-news-related');
      } catch {}
    }

    const related = await fetchRelatedPublisherImage(req, title, source);
    if (related) return sendImage(res, related, related.status);
  } catch (error) {
    console.warn('exact Google News thumbnail unavailable:', String(error?.message || error).slice(0, 140));
  }
  return sourceTile(res, source);
};