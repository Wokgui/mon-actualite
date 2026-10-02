function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isSameOriginImageProxy(raw = '') {
  const value = clean(raw);
  if (!value) return false;
  try {
    const url = new URL(value, location.href);
    return (url.origin === location.origin || url.origin === 'https://mon-actualite.vercel.app')
      && ['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast', '/api/image-proxy'].includes(url.pathname);
  } catch {
    return false;
  }
}

function extractPreparedImage(raw = '') {
  const value = clean(raw);
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin && !(url.origin === 'https://mon-actualite.vercel.app' && url.pathname.startsWith('/api/'))) {
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    }

    if (url.pathname === '/api/article-thumbnail' || url.pathname === '/api/exact-news-thumbnail' || url.pathname === '/api/article-photo-fast') {
      const image = clean(url.searchParams.get('image') || '');
      if (!image) return '';
      const parsed = new URL(image, location.href);
      if (parsed.origin === location.origin || !['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.href;
    }

    if (url.pathname === '/api/image-proxy') {
      const image = clean(url.searchParams.get('url') || '');
      if (!image) return '';
      const parsed = new URL(image, location.href);
      if (parsed.origin === location.origin || !['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.href;
    }
  } catch {}
  return '';
}

function pinnedProxyUrl(article = {}) {
  const raw = clean(article.pinnedVisualV85 || '');
  if (!raw) return '';
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return '';
    if (!['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) return '';
    return `${url.pathname}${url.search}`;
  } catch { return ''; }
}

function feedlyProxyUrl(article = {}) {
  const articleUrl = canonicalPhotoUrl(article.url || '');
  const title = clean(article.title || '');
  const rawVisual = clean(article.visual?.url || article.image || '');
  let suppliedImage = extractPreparedImage(rawVisual);

  if (!suppliedImage && rawVisual && !isSameOriginImageProxy(rawVisual)) {
    suppliedImage = rawVisual;
  }

  if (!articleUrl && !title && !suppliedImage) return '';
  const params = new URLSearchParams({
    v: '98.40',
    url: articleUrl.slice(0, 1900),
    image: suppliedImage.slice(0, 1900),
    title: title.slice(0, 280),
    category: clean(article.category || '').slice(0, 70),
    source: clean(article.source || article.feedTitle || '').slice(0, 100)
  });
  params.set('clientRecovery', '1');
  if (!articleUrl && article.id) params.set('id', String(article.id));
  const origin = location.hostname === 'wokgui.github.io' ? 'https://mon-actualite.vercel.app' : '';
  return `${origin}/api/article-photo-fast?${params}`;
}

export function preparedVisualUrl(article = {}) {
  const rawVisual = clean(article.visual?.url || article.image || '');
  // Only an exact image hint gets a separate prepared route. A legacy "ready"
  // flag or pin is not proof that a generic resolver returned a real photo.
  try {
    const raw = new URL(rawVisual, location.href);
    const exact = raw.searchParams.get('exact') === '1' && extractPreparedImage(rawVisual);
    if (exact && ['/api/article-thumbnail', '/api/exact-news-thumbnail'].includes(raw.pathname)) {
      const resolved = new URL(feedlyProxyUrl(article), location.href);
      resolved.pathname = '/api/article-thumbnail';
      resolved.searchParams.set('exact', '1');
      return location.hostname === 'wokgui.github.io' ? resolved.href : `${resolved.pathname}${resolved.search}`;
    }
  } catch {}
  return feedlyProxyUrl(article);
}

export function canonicalPhotoUrl(raw = '') {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch { return clean(raw); }
}

export function photoArticleKey(article = {}) {
  return canonicalPhotoUrl(article.url) || String(article.id || `${clean(article.source)}|${clean(article.title)}`);
}

export function sourceTileUrl() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224" viewBox="0 0 400 224"><rect width="400" height="224" rx="18" fill="#f1f1f4"/><path d="M0 181 91 119l64 43 66-67 179 129H0Z" fill="#d7d7de"/><circle cx="307" cy="64" r="25" fill="#dedee4"/></svg>';
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function articleVisualUrl(article = {}) {
  return feedlyProxyUrl(article) || sourceTileUrl();
}

export function hasPreparedVisual(article = {}) {
  if (pinnedProxyUrl(article)) return true;
  const rawVisual = clean(article.visual?.url || article.image || '');
  if (!rawVisual) return false;
  if (extractPreparedImage(rawVisual)) return true;
  if (!isSameOriginImageProxy(rawVisual)) return true;
  const status = clean(article.visual?.status || article.visualStatus || '').toLowerCase();
  return ['ready', 'available', 'loaded'].includes(status);
}
