import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=92.04';

const queued = new WeakSet();
const FIRST_BATCH = 14;
let generation = 0;
let laterTimer = 0;

function readArticles() {
  try {
    const payload = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(payload.articles) ? payload.articles : [];
  } catch { return []; }
}
function articlesById() { return new Map(readArticles().map(a => [String(a?.id || ''), a])); }
function preload(url, timeout = 6500) {
  return new Promise(resolve => {
    if (!url) return resolve(false);
    const probe = new Image();
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); probe.onload = probe.onerror = null; resolve(ok); };
    const timer = setTimeout(() => finish(false), timeout);
    probe.onload = () => finish(probe.naturalWidth > 1);
    probe.onerror = () => finish(false);
    probe.decoding = 'async';
    try { probe.fetchPriority = 'high'; } catch {}
    probe.src = url;
    if (probe.complete) finish(probe.naturalWidth > 1);
  });
}
function mark(img, ok) {
  img.classList.remove('image-pending-v9184');
  img.classList.toggle('image-ready-v9184', ok);
  img.classList.toggle('image-failed-v9184', !ok);
  img.dataset.imageSequenceDone = '1';
}
async function resolveVisual(article) {
  const tile = sourceTileUrl(article);
  const wanted = preparedVisualUrl(article);
  if (wanted && wanted !== tile && await preload(wanted)) return { url: wanted, ok: true };
  if (tile) await preload(tile, 3000);
  return { url: tile || wanted || '', ok: false };
}
async function loadFirstBatch(items, token) {
  // Resolve the whole first screen in parallel, then swap every thumbnail in one frame.
  const resolved = await Promise.all(items.map(async item => ({ ...item, visual: await resolveVisual(item.article) })));
  if (token !== generation) return;
  requestAnimationFrame(() => {
    resolved.forEach(({ card, visual }) => {
      if (!card?.isConnected) return;
      const img = card.querySelector('img.article-image');
      if (!img) return;
      img.loading = 'eager'; img.decoding = 'async';
      try { img.fetchPriority = 'high'; } catch {}
      if (visual.url && (img.currentSrc || img.src) !== new URL(visual.url, location.href).href) img.src = visual.url;
      mark(img, visual.ok);
    });
  });
}
async function loadLater(item, token) {
  const visual = await resolveVisual(item.article);
  if (token !== generation || !item.card?.isConnected) return;
  const img = item.card.querySelector('img.article-image');
  if (!img) return;
  img.loading = 'lazy'; img.decoding = 'async';
  if (visual.url) img.src = visual.url;
  mark(img, visual.ok);
}
function schedule() {
  const byId = articlesById();
  const fresh = [];
  document.querySelectorAll('.article-card[data-article]').forEach((card, index) => {
    if (queued.has(card)) return;
    const rect = card.getBoundingClientRect();
    if (!(index < 40 || (rect.bottom >= -500 && rect.top <= window.innerHeight * 4))) return;
    const article = byId.get(String(card.dataset.article || ''));
    if (!article) return;
    queued.add(card); card.dataset.imageSequenceIndex = String(index);
    const img = card.querySelector('img.article-image');
    if (img) img.classList.add('image-pending-v9184');
    fresh.push({ card, article, index });
  });
  if (!fresh.length) return;
  fresh.sort((a,b) => a.index - b.index);
  const token = generation;
  const first = fresh.filter(x => x.index < FIRST_BATCH);
  const later = fresh.filter(x => x.index >= FIRST_BATCH);
  if (first.length) loadFirstBatch(first, token);
  if (later.length) {
    clearTimeout(laterTimer);
    laterTimer = setTimeout(() => later.forEach(item => loadLater(item, token)), 30);
  }
}
function resetForRender() {
  generation += 1;
  document.querySelectorAll('.article-card img.article-image').forEach(img => { delete img.dataset.imageSequenceDone; });
  schedule();
}
const app = document.getElementById('app');
if (app) new MutationObserver(() => requestAnimationFrame(schedule)).observe(app, { childList: true, subtree: true });
window.addEventListener('news:stable-render', resetForRender);
window.addEventListener('pageshow', schedule);
let scrollFrame = 0;
window.addEventListener('scroll', () => { if (scrollFrame) return; scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; schedule(); }); }, { passive: true });
schedule();
