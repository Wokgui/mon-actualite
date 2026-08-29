function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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

function extractPreparedImage(raw = '') {
  const value = clean(raw);
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin) {
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    }

    if (url.pathname === '/api/article-thumbnail' || url.pathname === '/api/exact-news-thumbnail') {
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

function feedlyProxyUrl(article = {}) {
  const articleUrl = clean(article.url || '');
  const title = clean(article.title || '');
  const rawVisual = clean(article.visual?.url || article.image || '');
  let suppliedImage = extractPreparedImage(rawVisual);

  // A visual already resolved by the feed API often arrives as a local
  // /api/article-thumbnail URL containing the real publisher/Google image in
  // its `image` parameter. Reuse that underlying image instead of throwing it
  // away and repeating the slower article-page/news-search discovery chain.
  if (!suppliedImage && rawVisual && !isSameOriginImageProxy(rawVisual)) {
    suppliedImage = rawVisual;
  }

  if (!articleUrl && !title && !suppliedImage) return '';
  const params = new URLSearchParams({
    v: '71',
    url: articleUrl.slice(0, 1900),
    image: suppliedImage.slice(0, 1900),
    title: title.slice(0, 280),
    category: clean(article.category || '').slice(0, 70),
    source: clean(article.source || article.feedTitle || '').slice(0, 100)
  });
  return `/api/article-thumbnail?${params}`;
}

export function preparedVisualUrl(article = {}) {
  // Feedly-like behaviour: the phone never hotlinks a publisher image. Every
  // visual goes through the server, which validates, normalizes and caches it.
  return feedlyProxyUrl(article);
}

export function sourceTileUrl() {
  // Deliberately neutral. A publisher logo must never masquerade as the photo
  // of an article when no verified visual could be found.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224" viewBox="0 0 400 224"><rect width="400" height="224" rx="18" fill="#f1f1f4"/><path d="M0 181 91 119l64 43 66-67 179 129H0Z" fill="#d7d7de"/><circle cx="307" cy="64" r="25" fill="#dedee4"/></svg>';
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function articleVisualUrl(article = {}) {
  return feedlyProxyUrl(article) || sourceTileUrl();
}

export function hasPreparedVisual(article = {}) {
  return Boolean(feedlyProxyUrl(article));
}
