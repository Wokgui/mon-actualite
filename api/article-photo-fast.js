const mainResolver = require('../lib/article-photo-resolver.js');
const { cachedPhoto, withPhotoBudget, photoSignal, photoKey } = require('../lib/article-photo-cache.js');

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
  const colonParts = clean.split(/\s*[:：]\s*/).filter(Boolean);
  const beforeColon = colonParts[0];
  const afterColon = colonParts.pop();
  if (beforeColon && beforeColon !== clean && titleWords(beforeColon).length >= 3) variants.push(beforeColon);
  if (afterColon && afterColon !== clean && titleWords(afterColon).length >= 4) variants.push(afterColon);
  const words = titleWords(clean).filter(word => word.length >= 4);
  if (words.length >= 5) variants.push(words.slice(0, 8).join(' '));
  if (words.length >= 5) variants.push(words.slice(-10).join(' '));
  return [...new Set(variants.filter(Boolean))].slice(0, 4);
}

function sourceKey(value = '') {
  return normalize(value).replace(/\b(?:www|com|fr|org|net|eu|lu|info|actualites?)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '');
}

function sourceAgreement(pageUrl = '', source = '') {
  const wanted = sourceKey(source);
  if (!wanted) return false;
  try {
    const host = sourceKey(new URL(pageUrl).hostname);
    return host.includes(wanted) || wanted.includes(host);
  } catch { return false; }
}

function bingImageEntries(html = '', title = '', source = '') {
  const ranked = [];
  let position = 0;
  for (const anchor of String(html).match(/<a\b[^>]{0,6000}>/gi) || []) {
    if (!/\bclass=["'][^"']*\biusc\b/i.test(anchor)) continue;
    const encoded = (anchor.match(/\bm=(["'])([\s\S]*?)\1/i) || [])[2] || '';
    if (!encoded) continue;
    try {
      const item = JSON.parse(decode(encoded));
      const label = plain(`${item.t || ''} ${item.desc || ''}`);
      const agreement = titleAgreement(label, title);
      const sameSource = sourceAgreement(item.purl, source);
      if (!sameEvent(label, title) && !(sameSource && agreement.hits >= 2)) continue;
      const urls = [item.murl, item.turl].filter(value => /^https?:\/\//i.test(value || ''));
      if (!urls.length) continue;
      ranked.push({
        urls,
        pageUrl: /^https?:\/\//i.test(item.purl || '') ? item.purl : 'https://www.bing.com/images/',
        score: Math.max(agreement.score, agreement.shorterCoverage) + (sameSource ? .45 : 0) - position * .002
      });
    } catch {}
    position += 1;
    if (position >= 80) break;
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, 8);
}

async function fetchImageEntry(entry) {
  for (const url of entry.urls) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: photoSignal(IMAGE_TIMEOUT_MS),
        headers: { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*', 'Referer': entry.pageUrl }
      });
      if (!response.ok) continue;
      const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_IMAGE_BYTES) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (usefulImage(buffer, type)) return { buffer, type };
    } catch {}
  }
  throw new Error('image candidate unavailable');
}

async function fastBingImageSearch(title, source = '') {
  for (const query of queryVariants(title).slice(0, 2)) {
    const searches = [...new Set([
      source ? `"${query}" "${source}"` : '',
      `"${query}"`,
      source ? `${query} ${source}` : query
    ].filter(Boolean))];
    for (const exactQuery of searches.slice(0, 2)) {
      try {
        const searchUrl = new URL('https://www.bing.com/images/search');
        searchUrl.search = new URLSearchParams({ q: exactQuery, form: 'HDRSC2', setlang: 'fr-FR' }).toString();
        const response = await fetch(searchUrl, {
          redirect: 'follow',
          signal: photoSignal(SEARCH_TIMEOUT_MS),
          headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }
        });
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.byteLength > MAX_SEARCH_BYTES) continue;
        const entries = bingImageEntries(buffer.toString('utf8'), title, source);
        for (let offset = 0; offset < entries.length; offset += 3) {
          const batch = await Promise.allSettled(entries.slice(offset, offset + 3).map(fetchImageEntry));
          const valid = batch.find(result => result.status === 'fulfilled');
          if (valid) return valid.value;
        }
      } catch {}
    }
  }
  throw new Error('no exact image-search result');
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
    signal: photoSignal(IMAGE_TIMEOUT_MS),
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
  for (const query of queryVariants(title).slice(0, 2)) {
    try {
      const searchUrl = new URL('https://www.bing.com/news/search');
      searchUrl.search = new URLSearchParams({ q: query, format: 'RSS', setmkt: 'fr-FR', qft: 'sortbydate="1"' }).toString();
      const response = await fetch(searchUrl, {
        redirect: 'follow',
        signal: photoSignal(SEARCH_TIMEOUT_MS),
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
    && !/fallback|neutral|tile/i.test(status) && result.buffer?.length > 0;
}

function replay(res, result) {
  res.statusCode = result.statusCode || 200;
  for (const [name, value] of result.headers.entries()) res.setHeader(name, value);
  return res.end(result.buffer);
}

function sendFast(res, image, kind = 'fast') {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', kind === 'search' ? 'bing-images-fast-exact' : 'bing-news-fast-exact');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(image.buffer);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://wokgui.github.io');
  res.setHeader('Access-Control-Expose-Headers', 'X-Thumbnail-Status, X-Photo-Key, X-Photo-Cache, X-Photo-Resolve-Ms');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const started = performance.now();
  const selection = await cachedPhoto(req.query || {}, () => withPhotoBudget(12000, () => selectPhoto(req)));
  res.setHeader('X-Photo-Key', photoKey(req.query || {}));
  res.setHeader('X-Photo-Cache', selection.cache);
  res.setHeader('X-Photo-Resolve-Ms', String(Math.round(performance.now() - started)));
  return replay(res, selection.result);
};

async function selectPhoto(req) {
  const title = plain(String(req.query?.title || '')).slice(0, 300);
  const source = plain(String(req.query?.source || '')).slice(0, 120);
  // Fixed authority order instead of arrival order. Discovery can prepare in
  // parallel, but can never beat a valid publisher cover just by being faster.
  const discovery = !req.query?.image && title
    ? fastBingImage(title, source).then(image => ({ image, kind: 'fast' })).catch(() => null)
    : Promise.resolve(null);
  const publisherRequest = { ...req, query: { ...req.query, publisherOnly: '1' } };
  const publisher = await withPhotoBudget(6000, () => captureMain(publisherRequest)).catch(() => null);
  if (validCaptured(publisher)) return publisher;
  if (String(req.query?.exact || '') === '1') return missingPhoto();
  const news = await discovery;
  if (news) return capturedFast(news.image, news.kind);
  if (title) {
    try { return capturedFast(await fastBingImageSearch(title, source), 'search'); } catch {}
  }
  try {
    const result = await captureMain({ ...req, photoPublisherUrl: publisherRequest.photoPublisherUrl, query: { ...req.query, searchOnly: '1' } });
    if (validCaptured(result)) return result;
  } catch {}
  return missingPhoto();
}

function capturedFast(image, kind) {
  const headers = new Map();
  const res = { setHeader: (name, value) => headers.set(name.toLowerCase(), value), end: buffer => ({ statusCode: 200, headers, buffer }) };
  return sendFast(res, image, kind);
}

function missingPhoto() {
  return { statusCode: 404, headers: new Map([['cache-control', 'no-store'], ['x-thumbnail-status', 'unavailable']]), buffer: Buffer.alloc(0) };
}

module.exports.__test = { bingImageEntries, sourceAgreement, titleAgreement, sameEvent };
