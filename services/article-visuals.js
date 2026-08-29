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

function recoveryVisualUrl(article = {}) {
  const url = clean(article.url || '');
  const title = clean(article.title || '');
  if (!/^https?:\/\//i.test(url) || !title) return '';
  let suppliedImage = clean(article.visual?.url || article.image || '').slice(0, 1900);
  try {
    const prepared = new URL(suppliedImage, location.href);
    if (prepared.origin === location.origin && prepared.pathname === '/api/article-thumbnail') suppliedImage = '';
  } catch {}
  const params = new URLSearchParams({
    v: '22',
    url: url.slice(0, 1900),
    image: suppliedImage,
    title: title.slice(0, 280),
    category: clean(article.category || '').slice(0, 70),
    source: clean(article.source || '').slice(0, 100),
    custom: article.customSource ? '1' : '0'
  });
  return `/api/article-thumbnail?${params}`;
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
  if (isPersonalSourceArticle(article)) return '';
  const visual = article.visual && typeof article.visual === 'object' ? article.visual : {};
  const source = clean(visual.source || article.visualSource || '');
  const explicitlyUnavailable = visual.status === 'unavailable' || article.visualStatus === 'unavailable';
  if (!explicitlyUnavailable) {
    const prepared = trustedPreparedUrl(visual.url || article.image || '', source);
    if (prepared) return prepared;
  }
  return '';
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
  return Boolean(article.customSource) || /(?:^|\b)le\s+parisien(?:\b|$)/i.test(`${clean(article.source)} ${clean(article.title)}`);
}

export function articleVisualUrl(article = {}) {
  // Personal feeds may expose publisher images that reject browser hotlinking
  // on Android. Always route them through our same-origin recovery endpoint,
  // including stale Le Parisien cards cached before customSource was recorded.
  if (isPersonalSourceArticle(article)) return recoveryVisualUrl(article) || sourceTileUrl(article);
  return preparedVisualUrl(article) || recoveryVisualUrl(article) || sourceTileUrl(article);
}

export function hasPreparedVisual(article = {}) {
  return Boolean(preparedVisualUrl(article));
}

