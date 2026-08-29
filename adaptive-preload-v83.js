(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const warmedImages = new Set();
  const queuedImages = new Set();
  const imageQueue = [];
  const warmedSummaries = new Set();
  const summaryQueue = [];
  let imageActive = 0;
  let summaryActive = 0;
  let scheduled = false;
  let scrollTimer = 0;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effective = String(connection?.effectiveType || '').toLowerCase();
  const saveData = Boolean(connection?.saveData);
  const lowMemory = Number(navigator.deviceMemory || 4) <= 2;
  const constrained = saveData || effective === 'slow-2g' || effective === '2g';
  const medium = effective === '3g' || lowMemory;
  const IMAGE_LIMIT = constrained ? 4 : medium ? 6 : 10;
  const SUMMARY_LIMIT = constrained ? 0 : medium ? 1 : 2;
  const IMAGE_CONCURRENCY = constrained ? 1 : medium ? 2 : 3;
  const SUMMARY_CONCURRENCY = 1;
  const LOOKAHEAD_PX = constrained ? 1000 : medium ? 1800 : 2600;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
  }

  function currentArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function articleMap() {
    return new Map(currentArticles().map(article => [String(article.id || ''), article]));
  }

  function usableImage(img) {
    const raw = img?.currentSrc || img?.src || '';
    if (!raw || /^data:/i.test(raw)) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return '';
      if (!['/api/article-thumbnail','/api/exact-news-thumbnail','/api/article-photo-fast'].includes(url.pathname)) return '';
      return url.href;
    } catch { return ''; }
  }

  async function warmImage(url) {
    try {
      const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (response.ok) await response.blob();
    } catch {}
  }

  function pumpImages() {
    while (imageActive < IMAGE_CONCURRENCY && imageQueue.length) {
      const url = imageQueue.shift();
      queuedImages.delete(url);
      if (!url || warmedImages.has(url)) continue;
      warmedImages.add(url);
      imageActive += 1;
      warmImage(url).finally(() => { imageActive -= 1; pumpImages(); });
    }
  }

  function enqueueImages() {
    const bottom = window.scrollY + window.innerHeight + LOOKAHEAD_PX;
    const candidates = [...document.querySelectorAll('.article-card:not([hidden]) img.stable-visual')]
      .map(img => ({ url: usableImage(img), top: img.getBoundingClientRect().top + window.scrollY }))
      .filter(item => item.url && item.top <= bottom && !warmedImages.has(item.url) && !queuedImages.has(item.url))
      .sort((a, b) => a.top - b.top)
      .slice(0, IMAGE_LIMIT);
    for (const item of candidates) { queuedImages.add(item.url); imageQueue.push(item.url); }
    pumpImages();
  }

  function cachedSummary(id) {
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    const item = cache[`article:${id}`];
    return item?.summary && !item.unavailable && usefulSummary(item.summary);
  }

  async function warmSummary(article) {
    try {
      const payload = {
        url: article.url,
        title: clean(article.title),
        summary: usefulSummary(article.summary) ? clean(article.summary) : '',
        source: clean(article.source || '')
      };
      const response = await fetch('/api/article-summary-groq?v=17', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ mode: 'article', article: payload })
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      const summary = clean(data?.summary || data?.text || '');
      if (data?.unavailable || !usefulSummary(summary)) return;
      const cache = readJson(SUMMARY_CACHE_KEY, {});
      cache[`article:${article.id}`] = { summary, ai: Boolean(data.ai || data.grounded), unavailable: false, savedAt: Date.now(), deltaV81: Boolean(data.deltaV81) };
      writeJson(SUMMARY_CACHE_KEY, Object.fromEntries(Object.entries(cache).slice(-180)));
    } catch {}
  }

  function pumpSummaries() {
    while (summaryActive < SUMMARY_CONCURRENCY && summaryQueue.length) {
      const article = summaryQueue.shift();
      if (!article?.id || warmedSummaries.has(String(article.id))) continue;
      warmedSummaries.add(String(article.id));
      summaryActive += 1;
      warmSummary(article).finally(() => { summaryActive -= 1; pumpSummaries(); });
    }
  }

  function enqueueSummaries() {
    if (SUMMARY_LIMIT < 1 || document.hidden || document.querySelector('.quick-summary-backdrop')) return;
    const map = articleMap();
    const viewportBottom = window.scrollY + window.innerHeight;
    const cards = [...document.querySelectorAll('.article-card[data-article]:not([hidden])')]
      .map(card => ({
        card,
        article: map.get(String(card.dataset.article || '')),
        top: card.getBoundingClientRect().top + window.scrollY,
        essential: card.classList.contains('essential-v77')
      }))
      .filter(item => item.article && item.top >= window.scrollY - 200 && item.top <= viewportBottom + LOOKAHEAD_PX)
      .filter(item => !cachedSummary(item.article.id) && !warmedSummaries.has(String(item.article.id)))
      .sort((a, b) => (Number(b.essential) - Number(a.essential)) || (a.top - b.top))
      .slice(0, SUMMARY_LIMIT);
    for (const item of cards) summaryQueue.push(item.article);
    pumpSummaries();
  }

  function run() {
    if (document.hidden) return;
    enqueueImages();
    const idle = window.requestIdleCallback || (callback => setTimeout(() => callback({ timeRemaining: () => 20 }), 350));
    idle(() => enqueueSummaries(), { timeout: 1200 });
  }

  function schedule(delay = 120) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; run(); }, delay);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(220), { once: true });
  else schedule(220);

  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => schedule(40), 120);
  }, { passive: true });

  const app = document.getElementById('app');
  if (app) new MutationObserver(() => schedule(160)).observe(app, { childList: true, subtree: true });
  window.addEventListener('focus', () => schedule(120));
  window.addEventListener('storage', event => { if (event.key === CACHE_KEY) schedule(80); });
})();
