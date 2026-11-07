'use strict';

// Publisher-owned structured metadata comes before scraping HTML or searching
// third-party images. Adapters never extract article bodies or use RSS logos.
const pending = new Map();
const positive = new Map();
const MAX_BYTES = 1_500_000;
const TTL_MS = 5 * 60_000;
const publisherHost = url => /^(?:www\.)?lequipe\.fr$/i.test(new URL(url).hostname);
const articleId = url => new URL(url).pathname.match(/\/(\d+)\/?$/)?.[1] || '';
const clean = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function publicText(url, io, accept) {
  const { response } = await io.fetchWithRedirects(url, {
    signal: io.photoSignal(2600), headers: { Accept: accept }
  }, 2);
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Publisher metadata unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Publisher metadata too large');
  return bytes.toString('utf8');
}

async function lequipe(query, io) {
  let canonical = query.url;
  if (!publisherHost(canonical)) {
    // If Google decoding was blocked, recover the link from the publisher's
    // official feed. Never substitute that feed's generic L'Équipe logo.
    if (new URL(canonical).hostname !== 'news.google.com' || !/^(?:lequipe(?: fr)?|l equipe)$/i.test(clean(query.source))) return null;
    const expected = clean(String(query.title || '').replace(/\s+[-–—]\s+[^-–—]{2,90}$/, ''));
    const words = expected.split(' ').filter(word => word.length >= 4);
    if (words.length < 4) return null;
    for (const path of ['/Football/', '/Tous-sports/']) {
      const xml = await publicText('https://dwh.lequipe.fr/api/edito/rss?path=' + encodeURIComponent(path), io, 'application/rss+xml,application/xml,text/xml');
      const entries = [];
      for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
        const title = clean(io.decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''));
        const url = io.decode(item.match(/<(?:guid|link)>([\s\S]*?)<\/(?:guid|link)>/i)?.[1] || '');
        const found = new Set(title.split(' '));
        const coverage = words.filter(word => found.has(word)).length / words.length;
        try { if (coverage >= .9 && publisherHost(url) && articleId(url)) entries.push({ url, coverage }); } catch {}
      }
      entries.sort((a, b) => b.coverage - a.coverage || a.url.localeCompare(b.url));
      if (entries.length) { canonical = entries[0].url; break; }
    }
  }
  if (!publisherHost(canonical)) return null;
  const id = articleId(canonical);
  if (!id) return null;
  const payload = JSON.parse(await publicText('https://dwh.lequipe.fr/api/v10/efr/news/' + id, io, 'application/json'));
  const exact = payload?.metas?.canonical;
  if (String(payload?.id) !== id || !exact || !publisherHost(exact) || articleId(exact) !== id) throw new Error('Publisher identity mismatch');
  const metadataImage = payload.metas.sharing_image?.url;
  const featured = (Array.isArray(payload.medias) ? payload.medias : []).filter(media => media?.__type === 'image' && media.featured === true).map(media => media.url);
  const images = [...new Set([metadataImage, ...featured].filter(url => typeof url === 'string').map(url => url.replaceAll('{width}', '720').replaceAll('{height}', '480').replaceAll('{quality}', '80')))];
  return images.length ? { publisherUrl: exact, images } : null;
}

const connectors = [{ accepts: query => {
  try { return publisherHost(query.url) || (new URL(query.url).hostname === 'news.google.com' && /^(?:lequipe(?: fr)?|l equipe)$/i.test(clean(query.source))); } catch { return false; }
}, resolve: lequipe }];

module.exports = async function publisherPhotoCandidates(query, io) {
  const connector = connectors.find(connector => connector.accepts(query));
  if (!connector) return null;
  const key = String(query.url);
  const cached = positive.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if (pending.has(key)) return pending.get(key);
  const task = connector.resolve(query, io).then(value => {
    if (value) {
      positive.set(key, { at: Date.now(), value });
      if (positive.size > 200) positive.delete(positive.keys().next().value);
    }
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
};
