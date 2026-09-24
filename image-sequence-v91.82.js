import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=91.97';

const queued = new WeakSet();
let queue = [];
let timer = 0;

function readArticles() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(payload.articles) ? payload.articles : [];
  } catch {
    return [];
  }
}

function articlesById() {
  return new Map(readArticles().map(article => [String(article?.id || ''), article]));
}

function settle(img, ok) {
  img.classList.remove('image-pending-v9184');
  img.classList.toggle('image-ready-v9184', ok);
  img.classList.toggle('image-failed-v9184', !ok);
  img.dataset.imageSequenceDone = '1';
}

function loadOne(card, article) {
  if (!card?.isConnected || !article) return;
  const img = card.querySelector('img.article-image');
  if (!img || img.dataset.imageSequenceDone === '1') return;

  const tile = sourceTileUrl(article);
  const wanted = preparedVisualUrl(article);
  img.classList.add('image-pending-v9184');

  if (!wanted || wanted === tile) {
    if (img.src !== tile) img.src = tile;
    settle(img, false);
    return;
  }

  const wantedAbs = new URL(wanted, location.href).href;
  if (img.currentSrc === wantedAbs && img.complete && img.naturalWidth > 1) {
    settle(img, true);
    return;
  }

  const cleanup = () => {
    img.removeEventListener('load', onLoad);
    img.removeEventListener('error', onError);
  };
  const onLoad = () => {
    cleanup();
    if (img.naturalWidth > 1) settle(img, true);
    else onError();
  };
  const onError = () => {
    cleanup();
    if (img.src !== tile) img.src = tile;
    settle(img, false);
  };

  img.addEventListener('load', onLoad, { once: true });
  img.addEventListener('error', onError, { once: true });
  img.decoding = 'async';
  img.loading = Number(card.dataset.imageSequenceIndex || 99) < 8 ? 'eager' : 'lazy';
  if ('fetchPriority' in img) img.fetchPriority = Number(card.dataset.imageSequenceIndex || 99) < 4 ? 'high' : 'auto';
  img.src = wanted;
  if (img.complete && img.naturalWidth > 1) onLoad();
}

function pump() {
  timer = 0;
  const item = queue.shift();
  if (item) loadOne(item.card, item.article);
  if (queue.length) timer = window.setTimeout(pump, 26);
}

function schedule() {
  const byId = articlesById();
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => {
    if (queued.has(card)) return;
    const rect = card.getBoundingClientRect();
    const nearViewport = index < 12 || (rect.bottom >= -300 && rect.top <= window.innerHeight * 2.2);
    if (!nearViewport) return;
    queued.add(card);
    card.dataset.imageSequenceIndex = String(index);
    const img = card.querySelector('img.article-image');
    if (img) img.classList.add('image-pending-v9184');
    const article = byId.get(String(card.dataset.article || ''));
    if (article) queue.push({ card, article, index });
  });
  queue.sort((a,b) => a.index - b.index);
  if (!timer && queue.length) pump();
}

const app = document.getElementById('app');
if (app) new MutationObserver(() => requestAnimationFrame(schedule)).observe(app, { childList: true, subtree: true });
window.addEventListener('news:stable-render', schedule);
window.addEventListener('pageshow', schedule);
let scrollFrame = 0;
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; schedule(); });
}, { passive: true });
schedule();
