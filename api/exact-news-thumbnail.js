const HTML_TIMEOUT_MS = 3200;
const IMAGE_TIMEOUT_MS = 3000;
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
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleWords(value = '') {
  const stop = new Set(['avec', 'dans', 'pour', 'plus', 'apres', 'avant', 'cette', 'sont', 'etre', 'leur', 'leurs', 'tout', 'mais', 'sans', 'vers', 'entre', 'une', 'des', 'les', 'sur', 'qui', 'que', 'aux']);
  return [...new Set(plainText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleOverlap(candidate, expected) {
  const wanted = titleWords(expected);
  const found = new Set(titleWords(candidate));
  if (!wanted.length || !found.size) return 0;
  return wanted.filter(word => found.has(word)).length / wanted.length;
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

async function googleNewsThumbnail(title, source) {
  const query = plainText(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 220);
  const wantedWords = titleWords(query);
  if (wantedWords.length < 3) return '';

  const searchUrl = new URL('https://news.google.com/search');
  searchUrl.search = new URLSearchParams({ q: query, hl: 'fr', gl: 'FR', ceid: 'FR:fr', ucbcb: '1' }).toString();
  const response = await fetch(searchUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    headers: {
      'User-Agent': GOOGLE_NEWS_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    }
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
    const score = titleOverlap(label, query);
    const hits = Math.round(score * wantedWords.length);
    if (score < 0.72 || hits < Math.min(4, wantedWords.length)) continue;

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
    const adjustedScore = Math.min(1, score + sourceBonus);
    if (!best || adjustedScore > best.score) best = { score: adjustedScore, url: new URL(attachment, searchUrl).href };
    if (adjustedScore >= 0.99) break;
  }
  return best?.url || '';
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
      headers: {
        'User-Agent': GOOGLE_NEWS_UA,
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        'Referer': 'https://news.google.com/'
      }
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
    if (!thumbnail) return sourceTile(res, source);
    const image = await fetchImage(thumbnail);
    res.statusCode = 200;
    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Length', String(image.buffer.byteLength));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('X-Thumbnail-Status', 'google-news-exact');
    return res.end(image.buffer);
  } catch (error) {
    console.warn('exact Google News thumbnail unavailable:', String(error?.message || error).slice(0, 140));
    return sourceTile(res, source);
  }
};
