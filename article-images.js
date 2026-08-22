const resolverRequests = new Map();
const IMAGE_CACHE_KEY = 'news-original-images-v3-no-google-logo';

function readCachedArticles() {
  try {
    const cached = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(cached.articles) ? cached.articles : [];
  } catch {
    return [];
  }
}

function readImageCache() {
  try { return JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}') || {}; }
  catch { return {}; }
}

function saveImageCache(id, url) {
  if (!id || !url) return;
  const cache = readImageCache();
  cache[String(id)] = url;
  const entries = Object.entries(cache).slice(-240);
  try { localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
}

function validImageUrl(value) {
  try {
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews|google_actualites|google-actualites)/i.test(haystack)) return '';
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
    return url.href;
  } catch {
    return '';
  }
}

async function resolvePublisherImage(article) {
  if (!article?.url) return '';
  const cached = validImageUrl(readImageCache()[String(article.id)]);
  if (cached) return cached;

  const key = String(article.id || article.url);
  if (resolverRequests.has(key)) return resolverRequests.get(key);

  const request = fetch(`/api/article-image?v=6&url=${encodeURIComponent(article.url)}`, { cache: 'force-cache' })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const image = validImageUrl(data?.image);
      if (image) saveImageCache(article.id, image);
      return image;
    })
    .catch(() => '')
    .finally(() => resolverRequests.delete(key));

  resolverRequests.set(key, request);
  return request;
}

function showImage(placeholder, src, detail = false, brief = false, priority = false, allowProxy = true) {
  return new Promise(resolve => {
    if (!placeholder?.isConnected || !src) return resolve(false);
    const image = new Image();
    image.className = detail ? 'detail-hero original-article-image' : brief ? 'brief-thumb article-image original-article-image' : 'article-image original-article-image';
    image.alt = '';
    image.loading = detail || priority ? 'eager' : 'lazy';
    image.decoding = 'async';
    if (priority) image.fetchPriority = 'high';
    image.referrerPolicy = 'no-referrer';
    let proxied = false;

    image.onload = () => {
      if (placeholder.isConnected) placeholder.replaceWith(image);
      resolve(true);
    };
    image.onerror = () => {
      if (allowProxy && !proxied && /^https?:\/\//i.test(src)) {
        proxied = true;
        image.removeAttribute('referrerpolicy');
        image.src = `/api/image-proxy?url=${encodeURIComponent(src)}`;
      } else {
        resolve(false);
      }
    };
    image.src = src;
  });
}

async function loadOriginalImage(placeholder, article, detail = false, brief = false, priority = false) {
  if (!placeholder || !article || placeholder.dataset.imageAttempted === '1') return;
  placeholder.dataset.imageAttempted = '1';

  const cached = validImageUrl(readImageCache()[String(article.id)]);
  const feedImage = validImageUrl(article.image);
  const first = cached || feedImage;

  if (first && await showImage(placeholder, first, detail, brief, priority, true)) return;
  if (!placeholder.isConnected) return;

  const resolved = await resolvePublisherImage(article);
  if (resolved && resolved !== first && await showImage(placeholder, resolved, detail, brief, priority, true)) return;
  if (!placeholder.isConnected || !article.url) return;

  const fallback = `/api/article-thumbnail?v=3&url=${encodeURIComponent(article.url)}`;
  await showImage(placeholder, fallback, detail, brief, priority, false);
}

function applyOriginalArticleImages() {
  const articles = readCachedArticles();
  if (!articles.length) return;
  const byId = new Map(articles.map(article => [String(article.id), article]));

  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => {
    const article = byId.get(String(card.dataset.article));
    loadOriginalImage(card.querySelector('.article-placeholder'), article, false, false, index < 6);
  });

  document.querySelectorAll('.brief-point[data-article]').forEach((row, index) => {
    const article = byId.get(String(row.dataset.article));
    loadOriginalImage(row.querySelector('.brief-thumb.article-placeholder'), article, false, true, index < 4);
  });

  const detailPage = document.querySelector('.detail-page');
  if (detailPage) {
    const id = detailPage.querySelector('.save-btn-detail[data-save]')?.dataset.save;
    loadOriginalImage(detailPage.querySelector('.detail-hero.article-placeholder'), byId.get(String(id || '')), true, false, true);
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new MutationObserver(() => applyOriginalArticleImages()).observe(appRoot, { childList: true, subtree: true });
}

window.addEventListener('storage', event => {
  if (event.key === 'news-live-cache') applyOriginalArticleImages();
});

applyOriginalArticleImages();