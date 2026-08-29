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
    // Old article records may keep a previously cached exact-thumbnail URL.
    // Always move those URLs to the current resolver generation so a former
    // publisher-tile result can never remain frozen in local history.
    if (url.origin === location.origin && url.pathname === '/api/exact-news-thumbnail') {
      url.searchParams.set('v', '35');
      return url.href;
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
    v: parisien ? '35' : '34',
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

export function sourceTileUrl() {
  // A publisher logo looked like an article photo and hid image-recovery bugs.
  // The last-resort visual is intentionally neutral and carries no publisher
  // branding; exact article photos are always attempted before this is used.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224" viewBox="0 0 400 224"><rect width="400" height="224" rx="18" fill="#f1f1f4"/><path d="M0 181 91 119l64 43 66-67 179 129H0Z" fill="#d7d7de"/><circle cx="307" cy="64" r="25" fill="#dedee4"/></svg>';
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
  // Le Parisien uses a dedicated exact-title resolver. Mark it prepared so
  // generic background workers cannot replace it with a guessed illustration.
  if (isLeParisienArticle(article)) return true;
  return false;
}