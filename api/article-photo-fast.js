const mainResolver = require('./article-thumbnail.js');

const SEARCH_TIMEOUT_MS = 2300;
const IMAGE_TIMEOUT_MS = 2200;
const MAX_SEARCH_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } });
}

function plain(value = '') {
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function titleWords(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','ses','son','ont','est','fait','article','parisien']);
  return [...new Set(normalize(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate = '', expected = '') {
  const wanted = titleWords(expected);
  const found = titleWords(candidate);
  if (!wanted.length || !found.length) return { score: 0, hits: 0, shorterCoverage: 0 };
  const set = new Set(found);
  const hits = wanted.filter(word => set.has(word)).length;
  return { score: hits / wanted.length, hits, shorterCoverage: hits / Math.max(1, Math.min(wanted.length, found.length)) };
}

function sameEvent(candidate = '', expected = '') {
  const a = titleAgreement(candidate, expected);
  const wantedLength = titleWords(expected).length;
  return (a.score >= 0.68 && a.hits >= Math.min(4, wantedLength))
    || (a.hits >= 5 && a.shorterCoverage >= 0.52)
    || (a.hits >= 4 && a.shorterCoverage >= 0.66);
}

function queryVariants(title = '') {
  const clean = plain(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const variants = [clean];
  const afterColon = clean.split(/\s*[:：]\s*/).filter(Boolean).pop();
  if (afterColon && afterColon !== clean && titleWords(afterColon).length >= 4) variants.push(afterColon);
  const words = titleWords(clean).filter(word => word.length >= 4);
  if (words.length >= 5) variants.push(words.slice(-10).join(' '));
  return [...new Set(variants.filter(Boolean))].slice(0, 2);
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? plain(match[1]) : '';
}

function imageDimensions(buffer, type = '') {
  try {
    if (/png/i.test(type) && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (/jpe?g/i.test(type) || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        const length = buffer.readUInt16BE(offset + 2);
        if (!length) break;
        offset += 2 + length;
      }
    }
  } catch {}
  return { width: 0, height: 0 };
}

function usefulImage(buffer, type) {
  if (!/^image\/(?:jpeg|png|webp|avif)/i.test(type) || buffer.byteLength < 3500 || buffer.byteLength > MAX_IMAGE_BYTES) return false;
  const { width, height } = imageDimensions(buffer, type);
  if (width && height) {
    if (width < 180 || height < 100 || width * height < 45_000) return false;
    if (width <= 260 && height <= 260 && Math.abs(width - height) < 25) return false;
  }
  return true;
}

async function fetchImage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    headers: { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*', 'Referer': 'https://www.bing.com/news/' }
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!usefulImage(buffer, type)) throw new Error('weak image');
  return { buffer, type };
}

async function fastBingImage(title, source = '') {
  for (const query of queryVariants(title)) {
    try {
      const searchUrl = new URL('https://www.bing.com/news/search');
      searchUrl.search = new URLSearchParams({ q: query, format: 'RSS', setmkt: 'fr-FR', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(searchUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5', 'Accept-Language': 'fr-FR,fr;q=0.9' }
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.byteLength > MAX_SEARCH_BYTES) continue;
      const xml = buffer.toString('utf8');
      let best = null;
      for (const block of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 24)) {
        const headline = xmlTag(block, 'title');
        if (!headline || !sameEvent(headline, title)) continue;
        const image = xmlTag(block, 'News:Image');
        if (!/^https?:\/\//i.test(image)) continue;
        const publisher = xmlTag(block, 'News:Source');
        const agreement = titleAgreement(headline, title);
        const sameSource = publisher && source && normalize(publisher).includes(normalize(source));
        const confidence = Math.max(agreement.score, agreement.shorterCoverage) + (sameSource ? 0.08 : 0);
        if (!best || confidence > best.confidence) best = { url: image, confidence };
      }
      if (best?.url) return await fetchImage(best.url);
    } catch {}
  }
  throw new Error('no fast exact image');
}

function captureMain(req) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const chunks = [];
    let finished = false;
    const fakeRes = {
      statusCode: 200,
      setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
      getHeader(name) { return headers.get(String(name).toLowerCase()); },
      write(chunk) { if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
      end(chunk) {
        if (finished) return;
        finished = true;
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        resolve({ statusCode: this.statusCode || 200, headers, buffer: Buffer.concat(chunks) });
      }
    };
    Promise.resolve(mainResolver(req, fakeRes)).catch(reject);
  });
}

function validCaptured(result) {
  const type = result?.headers?.get('content-type') || '';
  const status = result?.headers?.get('x-thumbnail-status') || '';
  return result?.statusCode === 200 && /^image\//i.test(type) && !/svg/i.test(type)
    && status !== 'neutral-fallback' && result.buffer?.length > 0;
}

function replay(res, result) {
  res.statusCode = result.statusCode || 200;
  for (const [name, value] of result.headers.entries()) res.setHeader(name, value);
  return res.end(result.buffer);
}

function sendFast(res, image) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', 'bing-news-fast-exact');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(image.buffer);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const title = plain(String(req.query?.title || '')).slice(0, 300);
  const source = plain(String(req.query?.source || '')).slice(0, 120);

  const mainPromise = captureMain(req);
  const mainValid = mainPromise.then(result => {
    if (!validCaptured(result)) throw new Error('main resolver has no photo');
    return { kind: 'main', result };
  });
  const fast = title
    ? fastBingImage(title, source).then(image => ({ kind: 'fast', image }))
    : Promise.reject(new Error('no title'));

  try {
    const winner = await Promise.any([fast, mainValid]);
    if (winner.kind === 'fast') return sendFast(res, winner.image);
    return replay(res, winner.result);
  } catch {
    try { return replay(res, await mainPromise); }
    catch {
      res.statusCode = 404;
      res.setHeader('Cache-Control', 'no-store');
      return res.end();
    }
  }
};
