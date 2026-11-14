const PERF_SUMMARY_CACHE = 'news-article-summaries-v4';
const VISUAL_CACHE_KEY = 'news-visual-map-v2';
const failedDirectImages = new Set();
const configuredCards = new WeakSet();
const summaryInflight = new Map();
let activeArticleId = '';
let activeVisual = '';
let scanScheduled = false;

function perfRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function perfWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function perfArticles() {
  const cache = perfRead('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}

function perfArticle(id) {
  return perfArticles().find(article => String(article?.id || '') === String(id || '')) || null;
}

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function summaryUsable(value = '') {
  const text = clean(value);
  const lower = text.toLowerCase();
  return text.length >= 60
    && !/résumé indisponible/.test(lower)
    && !/ouvrez?\s+l[’']article/.test(lower)
    && !/consultez?\s+(?:les?\s+)?détails/.test(lower)
    && !/détails publiés par la source/.test(lower);
}

function validDirectImage(value = '') {
  try {
    const url = new URL(String(value || ''), location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews|google_actualites|google-actualites)/i.test(haystack)) return '';
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
    if (failedDirectImages.has(url.href)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function proxyVisual(article) {
  const params = new URLSearchParams({
    v: '10',
    url: String(article?.url || '').slice(0, 1900),
    image: validDirectImage(article?.image || ''),
    title: clean(article?.title || '').slice(0, 280),
    category: clean(article?.category || '').slice(0, 70)
  });
  return `/api/article-thumbnail?${params}`;
}

function visualMap() {
  return perfRead(VISUAL_CACHE_KEY, {});
}

function rememberedVisual(article) {
  const entry = visualMap()[String(article?.id || '')];
  if (!entry?.src || Date.now() - Number(entry.savedAt || 0) > 3 * 24 * 3600 * 1000) return '';
  return String(entry.src);
}

function rememberVisual(article, src) {
  if (!article?.id || !src) return;
  const map = visualMap();
  map[String(article.id)] = { src, savedAt: Date.now() };
  const entries = Object.entries(map).slice(-220);
  perfWrite(VISUAL_CACHE_KEY, Object.fromEntries(entries));
}

function preconnect(src) {
  try {
    const url = new URL(src, location.href);
    if (url.origin === location.origin) return;
    if (document.head.querySelector(`link[data-perf-preconnect="${CSS.escape(url.origin)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = url.origin;
    link.crossOrigin = 'anonymous';
    link.dataset.perfPreconnect = url.origin;
    document.head.appendChild(link);
  } catch {}
}

function setCardImage(card, article, index = 99) {
  const img = card.querySelector('img.article-image');
  if (!img || !article) return;
  const direct = validDirectImage(article.image || '');
  const proxy = proxyVisual(article);
  const remembered = rememberedVisual(article);
  const initial = remembered || direct || proxy;

  img.alt = '';
  img.decoding = 'async';
  img.loading = index < 5 ? 'eager' : 'lazy';
  if ('fetchPriority' in img) img.fetchPriority = index < 2 ? 'high' : 'auto';
  img.classList.remove('perf-loaded', 'perf-failed');
  card.classList.add('perf-image-pending');

  let usedProxy = initial === proxy;
  let usedDirect = initial === direct || initial === remembered && remembered === direct;

  const onLoad = () => {
    card.classList.remove('perf-image-pending');
    card.classList.add('perf-image-loaded');
    img.classList.add('perf-loaded');
    rememberVisual(article, img.currentSrc || img.src);
  };

  const onError = () => {
    const current = img.currentSrc || img.src;
    if (direct && (current === direct || usedDirect)) failedDirectImages.add(direct);
    if (!usedProxy && proxy) {
      usedProxy = true;
      img.src = proxy;
      return;
    }
    card.classList.remove('perf-image-pending');
    card.classList.add('perf-image-failed');
    img.classList.add('perf-failed');
  };

  img.addEventListener('load', onLoad, { once: false });
  img.addEventListener('error', onError, { once: false });
  if (direct) preconnect(direct);
  if (!img.getAttribute('src') || img.src !== new URL(initial, location.href).href) img.src = initial;
  if (img.complete && img.naturalWidth > 0) onLoad();
}

const imageObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    imageObserver.unobserve(entry.target);
    const index = Number(entry.target.dataset.perfIndex || 99);
    setCardImage(entry.target, perfArticle(entry.target.dataset.article), index);
  }
}, { rootMargin: '420px 0px' }) : null;

function configureCards() {
  const cards = [...document.querySelectorAll('.article-card[data-article]')];
  cards.forEach((card, index) => {
    if (configuredCards.has(card)) return;
    configuredCards.add(card);
    card.dataset.perfIndex = String(index);
    const img = card.querySelector('img.article-image');
    if (img) {
      img.alt = '';
      img.decoding = 'async';
      img.loading = index < 5 ? 'eager' : 'lazy';
      if ('fetchPriority' in img) img.fetchPriority = index < 2 ? 'high' : 'auto';
    }
    if (index < 5 || !imageObserver) setCardImage(card, perfArticle(card.dataset.article), index);
    else imageObserver.observe(card);
  });
}

// Deduplicate identical Groq POSTs so a pointer-down prefetch and the modal share one network request.
const nativeFetch = window.fetch.bind(window);
window.fetch = function performanceFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  if (method === 'POST' && /\/api\/article-summary-groq(?:\?|$)/.test(url)) {
    const key = `${url}|${String(init?.body || '')}`;
    const existing = summaryInflight.get(key);
    if (existing) return existing.then(response => response.clone());
    const request = nativeFetch(input, init).finally(() => summaryInflight.delete(key));
    summaryInflight.set(key, request);
    return request.then(response => response.clone());
  }
  return nativeFetch(input, init);
};

async function prefetchSummary(article) {
  if (!article?.id) return;
  const cache = perfRead(PERF_SUMMARY_CACHE, {});
  const key = `article:${article.id}`;
  if (cache[key]?.summary && !cache[key]?.unavailable && summaryUsable(cache[key].summary)) return;
  try {
    const response = await fetch('/api/article-summary-groq?v=12', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        mode: 'article',
        article: {
          url: article.url,
          title: clean(article.title),
          summary: summaryUsable(article.summary) ? clean(article.summary) : ''
        }
      })
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.summary || data?.unavailable || !summaryUsable(data.summary)) return;
    const latest = perfRead(PERF_SUMMARY_CACHE, {});
    latest[key] = { summary: clean(data.summary), ai: Boolean(data.ai), unavailable: false, savedAt: Date.now() };
    perfWrite(PERF_SUMMARY_CACHE, Object.fromEntries(Object.entries(latest).slice(-180)));
  } catch {}
}

function enhanceModal(modal) {
  if (!modal || modal.dataset.perfEnhanced === '1') return;
  modal.dataset.perfEnhanced = '1';
  const article = perfArticle(activeArticleId);
  if (!article) return;
  const sheet = modal.querySelector('.quick-summary-sheet');
  const meta = modal.querySelector('.quick-summary-meta');
  const text = modal.querySelector('[data-quick-summary-text]');
  const label = modal.querySelector('[data-quick-summary-label]');
  if (!sheet) return;

  const cached = perfRead(PERF_SUMMARY_CACHE, {})[`article:${article.id}`];
  if (text && /résumé en cours/i.test(text.textContent || '')) {
    if (cached?.summary && !cached.unavailable && summaryUsable(cached.summary)) {
      text.textContent = clean(cached.summary);
      if (label) label.textContent = cached.ai ? 'Résumé IA' : 'Résumé factuel';
    } else if (summaryUsable(article.summary)) {
      text.textContent = clean(article.summary);
      if (label) label.textContent = 'Résumé factuel · IA en cours…';
    }
  }

  const src = activeVisual || rememberedVisual(article) || validDirectImage(article.image || '') || proxyVisual(article);
  if (src && !sheet.querySelector('.quick-summary-perf-image')) {
    const wrap = document.createElement('div');
    wrap.className = 'quick-summary-perf-image';
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.fetchPriority = 'high';
    image.src = src;
    wrap.appendChild(image);
    if (meta) meta.insertAdjacentElement('afterend', wrap);
    else sheet.prepend(wrap);
    image.addEventListener('load', () => wrap.classList.add('is-loaded'), { once: true });
    image.addEventListener('error', () => wrap.remove(), { once: true });
    if (image.complete && image.naturalWidth > 0) wrap.classList.add('is-loaded');
  }
}

function closeModalImmediately(event) {
  const close = event.target.closest('[data-quick-close]');
  if (!close) return false;
  const modal = close.closest('.quick-summary-backdrop');
  if (!modal) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  modal.remove();
  document.body.classList.remove('quick-summary-open');
  return true;
}

document.addEventListener('pointerdown', event => {
  if (closeModalImmediately(event)) return;
  const card = event.target.closest('.article-card[data-article]');
  if (!card || event.target.closest('button, a, input, select, textarea')) return;
  activeArticleId = card.dataset.article || '';
  const img = card.querySelector('img.article-image');
  activeVisual = img?.complete && img.naturalWidth > 0 ? (img.currentSrc || img.src) : '';
  const article = perfArticle(activeArticleId);
  if (article) prefetchSummary(article);
}, true);

function scan() {
  scanScheduled = false;
  configureCards();
  document.querySelectorAll('.quick-summary-backdrop').forEach(enhanceModal);
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(scan);
}

const root = document.getElementById('app');
if (root) new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('.quick-summary-backdrop') || node.querySelector?.('.quick-summary-backdrop'))))) scheduleScan();
}).observe(document.body, { childList: true, subtree: false });
window.addEventListener('focus', scheduleScan);
scheduleScan();
