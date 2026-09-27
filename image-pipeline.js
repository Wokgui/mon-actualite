import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=98.0';

const bound = new WeakSet();
const failures = new Map();
const retryAfter = 60_000;

function articleMap() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return new Map((Array.isArray(payload.articles) ? payload.articles : []).map(article => [String(article.id || ''), article]));
  } catch { return new Map(); }
}

function proxyUrl(article) {
  const params = new URLSearchParams({
    v: '98', url: String(article?.url || '').slice(0, 1900),
    image: String(article?.visual?.url || article?.image || '').slice(0, 1900),
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70),
    source: String(article?.source || article?.feedTitle || '').slice(0, 100)
  });
  return `/api/article-photo-fast?${params}`;
}

function mark(image, ready) {
  image.classList.remove('image-pending-v98');
  image.classList.toggle('image-ready-v98', ready);
  image.classList.toggle('image-fallback-v98', !ready);
}

function bind(card, index, articles) {
  if (bound.has(card)) return;
  const image = card.querySelector('img.article-image');
  const article = articles.get(String(card.dataset.article || ''));
  if (!image || !article) return;
  bound.add(card);
  image.loading = index < 6 ? 'eager' : 'lazy';
  image.fetchPriority = index < 4 ? 'high' : 'auto';
  image.decoding = 'async';
  const tile = sourceTileUrl(article);
  const candidates = [...new Set([preparedVisualUrl(article), proxyUrl(article)].filter(Boolean))];
  let candidateIndex = candidates.findIndex(url => {
    try { return new URL(url, location.href).href === image.src; } catch { return false; }
  });
  const next = () => {
    while (++candidateIndex < candidates.length) {
      const candidate = candidates[candidateIndex];
      const failedAt = failures.get(candidate) || 0;
      if (Date.now() - failedAt < retryAfter) continue;
      image.src = candidate;
      return;
    }
    image.src = tile;
    mark(image, false);
  };
  image.addEventListener('load', async () => {
    if (image.src.startsWith('data:image/svg+xml')) { mark(image, false); return; }
    try { await image.decode(); } catch {}
    if (image.naturalWidth > 0) mark(image, true); else next();
  });
  image.addEventListener('error', () => {
    const failed = candidates.find(url => { try { return new URL(url, location.href).href === image.src; } catch { return false; } });
    if (failed) failures.set(failed, Date.now());
    next();
  });
  if (image.complete) {
    if (image.naturalWidth > 0 && !image.src.startsWith('data:image/svg+xml')) mark(image, true);
    else if (!image.src.startsWith('data:image/svg+xml')) next();
  }
}

function scan() {
  const articles = articleMap();
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => bind(card, index, articles));
}

window.addEventListener('news:stable-render', () => requestAnimationFrame(scan));
window.addEventListener('pageshow', scan);
new MutationObserver(() => requestAnimationFrame(scan)).observe(document.getElementById('app'), { childList: true, subtree: true });
scan();
