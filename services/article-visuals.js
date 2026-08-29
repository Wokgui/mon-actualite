function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function trustedPreparedUrl(raw = '', source = '') {
  const value = clean(raw);
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (url.origin === location.origin && url.pathname === '/' && !url.search) return '';
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews)/i.test(haystack)) return '';
    if (host === 'news.google.com') return '';
    if (host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) {
      return source.startsWith('google-news') ? url.href : '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function isLeParisienArticle(article = {}) {
  const sourceAndTitle = `${clean(article.source)} ${clean(article.title)}`;
  if (/(?:^|\b)le\s+parisien(?:\b|$)/i.test(sourceAndTitle)) return true;
  try {
    const host = new URL(clean(article.url || '')).hostname.toLowerCase();
    return host === 'leparisien.fr' || host.endsWith('.leparisien.fr');
  } catch {
    return false;
  }
}

function isSameOriginImageProxy(raw = '') {
  const value = clean(raw);
  if (!value) return false;
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin
      && ['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/image-proxy'].includes(url.pathname);
  } catch {
    return false;
  }
}

function recoveryVisualUrl(article = {}) {
  const url = clean(article.url || '');
  const title = clean(article.title || '');
  if (!/^https?:\/\//i.test(url) || !title) return '';
  const parisien = isLeParisienArticle(article);
  let suppliedImage = clean(article.visual?.url || article.image || '').slice(0, 1900);
  try {
    const prepared = new URL(suppliedImage, location.href);
    if (prepared.origin === location.origin && ['/api/article-thumbnail', '/api/exact-news-thumbnail'].includes(prepared.pathname)) suppliedImage = '';
  } catch {}
  const params = new URLSearchParams({
    v: '33',
    url: url.slice(0, 1900),
    image: suppliedImage,
    title: title.slice(0, 280),
    category: clean(article.category || '').slice(0, 70),
    source: clean(article.source || '').slice(0, 100),
    custom: article.customSource ? '1' : '0'
  });
  const endpoint = parisien ? '/api/exact-news-thumbnail' : '/api/article-thumbnail';
  return `${endpoint}?${params}`;
}

function xml(value = '') {
  return clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function hash(value = '') {
  let result = 2166136261;
  for (const character of clean(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function initials(value = '') {
  const words = clean(value).replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'A';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase();
}

export function preparedVisualUrl(article = {}) {
  const visual = article.visual && typeof article.visual === 'object' ? article.visual : {};
  const source = clean(visual.source || article.visualSource || '');
  const raw = visual.url || article.image || '';
  const explicitlyUnavailable = visual.status === 'unavailable' || article.visualStatus === 'unavailable';
  if (explicitlyUnavailable) return '';

  // Personal feeds can expose publisher URLs that reject hotlinking on Android.
  // Same-origin proxy images, however, have already been fetched and validated
  // by our server and must take priority, including for Le Parisien.
  if (article.customSource && !isSameOriginImageProxy(raw) && !source.startsWith('google-news')) return '';

  return trustedPreparedUrl(raw, source);
}

export function sourceTileUrl(article = {}) {
  const label = clean(article.source || article.feedTitle || article.category || 'Actualité');
  const category = clean(article.category || 'Actualité');
  const palettes = [
    ['#e8e2ff', '#c9bdf7', '#51419d'],
    ['#dff4ef', '#addfd1', '#236d5c'],
    ['#e2efff', '#b7d6fb', '#285f9f'],
    ['#fff0da', '#f4cf9b', '#89551f'],
    ['#f7e3ef', '#e9b8d4', '#873b66']
  ];
  const [start, end, ink] = palettes[hash(`${label}|${category}`) % palettes.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224" viewBox="0 0 400 224"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="400" height="224" rx="18" fill="url(#g)"/><circle cx="200" cy="92" r="54" fill="#fff" fill-opacity=".72"/><text x="200" y="111" text-anchor="middle" font-family="Arial,sans-serif" font-size="54" font-weight="700" fill="${ink}">${xml(initials(label))}</text><text x="200" y="178" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="600" fill="${ink}">${xml(label.slice(0, 24))}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function isPersonalSourceArticle(article = {}) {
  return Boolean(article.customSource) || isLeParisienArticle(article);
}

export function articleVisualUrl(article = {}) {
  const prepared = preparedVisualUrl(article);
  if (prepared) return prepared;
  if (isPersonalSourceArticle(article)) return recoveryVisualUrl(article) || sourceTileUrl(article);
  return recoveryVisualUrl(article) || sourceTileUrl(article);
}

export function hasPreparedVisual(article = {}) {
  if (preparedVisualUrl(article)) return true;
  // Le Parisien must stay on its dedicated recovery endpoint instead of being
  // overwritten by the generic backfill worker when its page returns 403.
  if (isLeParisienArticle(article)) return true;
  return false;
}