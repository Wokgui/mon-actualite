const dns = require('node:dns').promises;
const net = require('node:net');
const genericThumbnail = require('./article-thumbnail.js');

const SEARCH_TIMEOUT_MS = 6000;
const IMAGE_TIMEOUT_MS = 5000;
const MAX_RSS_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 7_000_000;
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
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

function plainText(value = '') {
  return decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleWords(value = '') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','ses','son','ont','est','fait','article','parisien']);
  return [...new Set(plainText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/).filter(word => word.length >= 3 && !stop.has(word)))];
}

function titleAgreement(candidate = '', expected = '') {
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

function sameEvent(candidate = '', expected = '') {
  const agreement = titleAgreement(candidate, expected);
  const wantedLength = titleWords(expected).length;
  return (agreement.score >= 0.68 && agreement.hits >= Math.min(4, wantedLength))
    || (agreement.hits >= 5 && agreement.shorterCoverage >= 0.52)
    || (agreement.hits >= 4 && agreement.shorterCoverage >= 0.66);
}

function queryVariants(title = '') {
  const clean = plainText(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/, '').slice(0, 240);
  const variants = [clean];
  const afterColon = clean.split(/\s*[:：]\s*/).filter(Boolean).pop();
  if (afterColon && afterColon !== clean && titleWords(afterColon).length >= 4) variants.push(afterColon);
  const words = titleWords(clean).filter(word => word.length >= 4);
  if (words.length >= 4) {
    variants.push(words.slice(-10).join(' '));
    variants.push(words.slice(Math.max(0, words.length - 8)).join(' '));
  }
  return [...new Set(variants.filter(Boolean))];
}

function xmlTag(block = '', name = '') {
  const escaped = name.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? plainText(match[1]) : '';
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return true;
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('local host blocked');
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error('private address blocked');
  } else {
    const records = await dns.lookup(url.hostname, { all: true });
    if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('private address blocked');
  }
  return url;
}

async function bingNewsThumbnail(title = '', source = '') {
  let best = null;
  for (const query of queryVariants(title)) {
    try {
      const searchUrl = new URL('https://www.bing.com/news/search');
      searchUrl.search = new URLSearchParams({
        q: query,
        format: 'RSS',
        setmkt: 'fr-FR',
        qft: 'sortbydate="1"'
      }).toString();
      const response = await fetch(searchUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.5',
          'Accept-Language': 'fr-FR,fr;q=0.9'
        }
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.byteLength > MAX_RSS_BYTES) continue;
      const xml = buffer.toString('utf8');
      for (const block of (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).slice(0, 25)) {
        const headline = xmlTag(block, 'title');
        if (!headline || !sameEvent(headline, title)) continue;
        const image = xmlTag(block, 'News:Image');
        if (!/^https?:\/\//i.test(image)) continue;
        const publisher = xmlTag(block, 'News:Source');
        const agreement = titleAgreement(headline, title);
        const sameSource = publisher && source && publisher.toLowerCase().includes(source.toLowerCase());
        const confidence = Math.max(agreement.score, agreement.shorterCoverage) + (sameSource ? 0.08 : 0);
        if (!best || confidence > best.confidence) best = { url: image, confidence };
      }
      if (best?.confidence >= 0.9) break;
    } catch {}
  }
  return best?.url || '';
}

async function fetchBingImage(rawUrl = '') {
  let current = rawUrl;
  for (let step = 0; step < 5; step += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        'Referer': 'https://www.bing.com/news/'
      }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/') || /svg/i.test(type)) throw new Error('not a photo');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 2500 || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('invalid image size');
    return { buffer, type };
  }
  throw new Error('too many image redirects');
}

function sendImage(res, image) {
  res.statusCode = 200;
  res.setHeader('Content-Type', image.type);
  res.setHeader('Content-Length', String(image.buffer.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.setHeader('X-Thumbnail-Status', 'bing-news-exact');
  return res.end(image.buffer);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  const title = String(req.query?.title || '').slice(0, 300);
  const source = String(req.query?.source || 'Le Parisien').slice(0, 100);

  if (title) {
    try {
      const thumbnail = await bingNewsThumbnail(title, source);
      if (thumbnail) return sendImage(res, await fetchBingImage(thumbnail));
    } catch (error) {
      console.warn('Bing exact thumbnail unavailable:', String(error?.message || error).slice(0, 140));
    }
  }

  // The generic resolver may still have an exact feed/Google image. Force its
  // exact-only mode so it returns 404 instead of a publisher logo/tile when
  // no verified photo exists.
  req.query = { ...(req.query || {}), exact: '1' };
  return genericThumbnail(req, res);
};