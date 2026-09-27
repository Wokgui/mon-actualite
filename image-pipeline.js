import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=98.1';

const MAX_CONCURRENT = 4;
const PRIORITY_COUNT = 6;
const RETRY_AFTER_MS = 60_000;
const bound = new WeakSet();
const queued = new WeakSet();
const failures = new Map();
const queue = [];
let active = 0;

function articleMap() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return new Map((Array.isArray(payload.articles) ? payload.articles : []).map(article => [String(article.id || ''), article]));
  } catch { return new Map(); }
}

function proxyUrl(article) {
  const params = new URLSearchParams({
    v: '98.1', url: String(article?.url || '').slice(0, 1900),
    image: String(article?.visual?.url || article?.image || '').slice(0, 1900),
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70),
    source: String(article?.source || article?.feedTitle || '').slice(0, 100)
  });
  return `/api/article-photo-fast?${params}`;
}

function absolute(url) {
  try { return new URL(url, location.href).href; } catch { return String(url || ''); }
}

function mark(image, ready) {
  image.classList.remove('image-pending-v98');
  image.classList.toggle('image-ready-v98', ready);
  image.classList.toggle('image-fallback-v98', !ready);
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    if (!task.card.isConnected || task.finished) continue;
    active += 1;
    task.start();
  }
}

function enqueue(task) {
  if (task.started || task.finished || queued.has(task.card)) return;
  queued.add(task.card);
  queue.push(task);
  pump();
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const task = entry.target.__imageTaskV98;
    if (task) enqueue(task);
    observer.unobserve(entry.target);
  });
}, { rootMargin: '480px 0px', threshold: 0.01 });

function bind(card, index, articles) {
  if (bound.has(card)) return;
  const image = card.querySelector('img.article-image');
  const article = articles.get(String(card.dataset.article || ''));
  if (!image || !article) return;
  bound.add(card);

  const tile = sourceTileUrl(article);
  const preferred = image.dataset.photoSrc || preparedVisualUrl(article);
  const candidates = [...new Set([preferred, preparedVisualUrl(article), proxyUrl(article)]
    .filter(url => url && absolute(url) !== absolute(tile)))];
  const task = { card, image, candidates, tile, cursor: 0, started: false, finished: false, released: false, start: null };

  const release = () => {
    if (task.released) return;
    task.released = true;
    active = Math.max(0, active - 1);
    pump();
  };
  const finish = ready => {
    if (task.finished) return;
    task.finished = true;
    mark(image, ready);
    release();
  };
  const next = () => {
    while (task.cursor < task.candidates.length) {
      const candidate = task.candidates[task.cursor++];
      const failedAt = failures.get(candidate) || 0;
      if (Date.now() - failedAt < RETRY_AFTER_MS) continue;
      image.src = candidate;
      return;
    }
    image.src = tile;
    finish(false);
  };

  image.loading = 'eager';
  image.decoding = 'async';
  image.addEventListener('load', async () => {
    if (!task.started || task.finished) return;
    if (absolute(image.src) === absolute(tile)) { finish(false); return; }
    try { await image.decode(); } catch {}
    if (image.naturalWidth > 1 && image.naturalHeight > 1) finish(true);
    else next();
  });
  image.addEventListener('error', () => {
    if (!task.started || task.finished) return;
    const failed = task.candidates.find(candidate => absolute(candidate) === absolute(image.src));
    if (failed) failures.set(failed, Date.now());
    next();
  });
  task.start = () => {
    if (task.started || task.finished) return;
    task.started = true;
    next();
  };
  card.__imageTaskV98 = task;

  if (!candidates.length) { mark(image, false); task.finished = true; return; }
  if (index < PRIORITY_COUNT) enqueue(task);
  else observer.observe(card);
}

function scan() {
  const articles = articleMap();
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => bind(card, index, articles));
}

window.addEventListener('news:stable-render', () => requestAnimationFrame(scan));
window.addEventListener('pageshow', scan);
new MutationObserver(() => requestAnimationFrame(scan)).observe(document.getElementById('app'), { childList: true, subtree: true });
scan();
