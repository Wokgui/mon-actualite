'use strict';

const PREWARM_LIMIT = 16;
const PREWARM_CONCURRENCY = 4;
const PREWARM_TIMEOUT_MS = 6000;
const PREWARM_INTERVAL_MS = 120;
const { canonicalUrl } = require('./article-photo-cache.js');

function requestOrigin(req) {
  const rawHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!rawHost || !/^[a-z0-9.-]+(?::\d+)?$/i.test(rawHost)) return '';
  const rawProto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim().toLowerCase();
  const protocol = rawProto === 'http' ? 'http' : 'https';
  return `${protocol}://${rawHost}`;
}

function suppressCorePrewarmRequest(req) {
  const clone = Object.create(req || null);
  clone.headers = { ...(req?.headers || {}) };
  delete clone.headers.host;
  delete clone.headers['x-forwarded-host'];
  return clone;
}

function unwrapPreparedVisual(raw = '', origin = '') {
  if (!raw || !origin) return '';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    if (['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) {
      const nested = String(url.searchParams.get('image') || '').trim();
      return /^https?:\/\//i.test(nested) ? nested.slice(0, 1900) : '';
    }
    if (url.pathname === '/api/image-proxy') {
      const nested = String(url.searchParams.get('url') || '').trim();
      return /^https?:\/\//i.test(nested) ? nested.slice(0, 1900) : '';
    }
  } catch {}
  return '';
}

function prewarmPhotoUrl(origin, article = {}) {
  if (!origin || !article?.title) return '';
  const suppliedImage = unwrapPreparedVisual(article.visual?.url || article.image || '', origin);
  const params = new URLSearchParams({
    v: '98.31',
    url: canonicalUrl(article.url || '').slice(0, 1900),
    image: suppliedImage.slice(0, 1900),
    title: String(article.title || '').slice(0, 280),
    category: String(article.category || '').slice(0, 70),
    source: String(article.source || article.feedTitle || '').slice(0, 100)
  });
  if (!article.url && article.id) params.set('id', String(article.id));
  return `${origin}/api/article-photo-fast?${params}`;
}

async function warmPhoto(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
      headers: {
        'User-Agent': 'MonActualite-ImagePrewarm/1.1',
        'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.6'
      }
    });
    if (!response.ok) return false;
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/') || type.includes('svg')) return false;
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

async function prewarmTopArticleImages(req, articles) {
  const origin = requestOrigin(req);
  if (!origin || !Array.isArray(articles) || !articles.length) return 0;
  const urls = [...new Set(articles.slice(0, PREWARM_LIMIT).map(article => prewarmPhotoUrl(origin, article)).filter(Boolean))];
  let cursor = 0;
  let warmed = 0;
  let nextStart = 0;
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      const delay = Math.max(0, nextStart - Date.now());
      nextStart = Math.max(Date.now(), nextStart) + PREWARM_INTERVAL_MS;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (await warmPhoto(urls[index])) warmed += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(PREWARM_CONCURRENCY, urls.length) }, () => worker()));
  if (warmed) console.log(`final image prewarm: ${warmed}/${urls.length}`);
  return warmed;
}

async function scheduleFinalImagePrewarm(req, articles) {
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(prewarmTopArticleImages(req, articles).catch(error => {
      console.warn('final image prewarm unavailable:', String(error?.message || error).slice(0, 120));
    }));
    return Math.min(PREWARM_LIMIT, Array.isArray(articles) ? articles.length : 0);
  } catch (error) {
    console.warn('final image waitUntil unavailable:', String(error?.message || error).slice(0, 120));
    return 0;
  }
}

module.exports = {
  PREWARM_LIMIT,
  suppressCorePrewarmRequest,
  prewarmPhotoUrl,
  scheduleFinalImagePrewarm
};
