import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=45.3';

const queued = new WeakSet();
let timer = 0;
let queue = [];

function readArticles() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(payload.articles) ? payload.articles : [];
  } catch {
    return [];
  }
}

function articleMap() {
  return new Map(readArticles().map(article => [String(article?.id || ''), article]));
}

function finish(card, img, ok) {
  card.classList.remove('v42-image-pending');
  card.classList.toggle('v42-image-loaded', ok);
  card.classList.toggle('v42-image-failed', !ok);
  img.dataset.imageSequenceDone = '1';
}

function loadOne(card, article) {
  if (!card?.isConnected || !article) return;
  const img = card.querySelector('img.article-image');
  if (!img || img.dataset.imageSequenceDone === '1') return;
  const tile = sourceTileUrl(article);
  const wanted = preparedVisualUrl(article);
  card.classList.add('v42-image-pending');
  if (!wanted || wanted === tile) {
    img.src = tile;
    finish(card, img, false);
    return;
  }
  const onLoad = () => {
    cleanup();
    finish(card, img, img.naturalWidth > 1);
  };
  const onError = () => {
    cleanup();
    img.src = tile;
    finish(card, img, false);
  };
  const cleanup = () => {
    img.removeEventListener('load', onLoad);
    img.removeEventListener('error', onError);
  };
  img.addEventListener('load', onLoad, { once: true });
  img.addEventListener('error', onError, { once: true });
  img.decoding = 'async';
  img.loading = 'eager';
  if ('fetchPriority' in img) img.fetchPriority = Number(card.dataset.imageSequenceIndex || 99) < 4 ? 'high' : 'auto';
  img.src = wanted;
  if (img.complete && img.naturalWidth > 1) onLoad();
}

function pump() {
  timer = 0;
  const next = queue.shift();
  if (next) loadOne(next.card, next.article);
  if (queue.length) timer = window.setTimeout(pump, 34);
}

function schedule() {
  const byId = articleMap();
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => {
    if (queued.has(card)) return;
    queued.add(card);
    card.dataset.imageSequenceIndex = String(index);
    card.classList.add('v42-image-pending');
    const article = byId.get(String(card.dataset.article || ''));
    if (article) queue.push({ card, article });
  });
  queue.sort((a, b) => Number(a.card.dataset.imageSequenceIndex || 999) - Number(b.card.dataset.imageSequenceIndex || 999));
  if (!timer && queue.length) pump();
}

const app = document.getElementById('app');
if (app) new MutationObserver(() => requestAnimationFrame(schedule)).observe(app, { childList: true, subtree: true });
window.addEventListener('news:stable-render', schedule);
window.addEventListener('focus', schedule);
schedule();
