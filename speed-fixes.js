const FAST_SUMMARY_CACHE = 'news-article-summaries-v4';
const failedDirectImages = new Set();
const visualByArticle = new Map();
const preconnected = new Set();
const summaryQueued = new Set();
const summaryQueue = [];
let summaryActive = 0;
let lastArticleId = '';
let speedScheduled = false;

function speedRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function speedWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function speedArticles() {
  const cache = speedRead('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}

function speedArticle(id) {
  return speedArticles().find(article => String(article?.id || '') === String(id || '')) || null;
}

function cleanSpeedText(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function usableDirectImage(value = '') {
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
    v: '9',
    url: String(article?.url || '').slice(0, 1900),
    image: usableDirectImage(article?.image || ''),
    title: cleanSpeedText(article?.title || '').slice(0, 280),
    category: cleanSpeedText(article?.category || '').slice(0, 70)
  });
  return `/api/article-thumbnail?${params}`;
}

function preferredVisual(article) {
  return visualByArticle.get(String(article?.id || '')) || usableDirectImage(article?.image || '') || proxyVisual(article);
}

function preconnect(src) {
  try {
    const url = new URL(src, location.href);
    if (url.origin === location.origin || preconnected.has(url.origin) || preconnected.size >= 4) return;
    preconnected.add(url.origin);
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = url.origin;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  } catch {}
}

function attachFastImage(img, article, shell) {
  if (!img || !article || img.dataset.fastImage === '1') return;
  img.dataset.fastImage = '1';
  img.alt = '';
  img.decoding = 'async';
  const id = String(article.id || '');
  const direct = usableDirectImage(article.image || '');
  const fallback = proxyVisual(article);
  const initial = visualByArticle.get(id) || direct || fallback;
  img.dataset.fastFallback = fallback;
  img.dataset.fastDirect = direct;
  img.dataset.fastFallbackTried = initial === fallback ? '1' : '0';
  shell?.classList.remove('is-loaded', 'is-failed');
  img.classList.add('fast-image');

  const markLoaded = () => {
    shell?.classList.add('is-loaded');
    shell?.classList.remove('is-failed');
    visualByArticle.set(id, img.currentSrc || img.src);
  };

  const markFailed = () => {
    const current = img.currentSrc || img.src;
    const directUrl = img.dataset.fastDirect || '';
    if (directUrl && current === directUrl) failedDirectImages.add(directUrl);
    if (img.dataset.fastFallbackTried !== '1' && fallback && current !== new URL(fallback, location.href).href) {
      img.dataset.fastFallbackTried = '1';
      shell?.classList.remove('is-loaded');
      img.src = fallback;
      return;
    }
    shell?.classList.remove('is-loaded');
    shell?.classList.add('is-failed');
  };

  img.addEventListener('load', markLoaded);
  img.addEventListener('error', markFailed);
  if (initial) {
    preconnect(initial);
    if (img.src !== new URL(initial, location.href).href) img.src = initial;
    if (img.complete && img.naturalWidth > 0) markLoaded();
  }
}

function configureCard(card, index) {
  if (!card?.dataset?.article) return;
  const article = speedArticle(card.dataset.article);
  const oldImg = card.querySelector('img.article-image');
  if (!article || !oldImg) return;

  let shell = oldImg.closest('.fast-thumb-shell');
  if (!shell) {
    shell = document.createElement('span');
    shell.className = 'fast-thumb-shell';
    oldImg.replaceWith(shell);
    shell.appendChild(oldImg);
  }
  if (index < 8) {
    oldImg.loading = 'eager';
    if ('fetchPriority' in oldImg) oldImg.fetchPriority = index < 4 ? 'high' : 'auto';
  } else {
    oldImg.loading = 'lazy';
  }
  attachFastImage(oldImg, article, shell);
}

function warmVisibleImages() {
  const cards = [...document.querySelectorAll('.article-card[data-article]')];
  cards.forEach((card, index) => configureCard(card, index));

  cards.slice(0, 12).forEach((card, index) => {
    const article = speedArticle(card.dataset.article);
    if (!article) return;
    const src = preferredVisual(article);
    if (!src) return;
    preconnect(src);
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    if ('fetchPriority' in image) image.fetchPriority = index < 4 ? 'high' : 'auto';
    image.src = src;
  });
}

function summaryIsUsable(value = '') {
  const text = cleanSpeedText(value);
  const lower = text.toLowerCase();
  return text.length >= 60
    && !/résumé indisponible/.test(lower)
    && !/ouvrez?\s+l[’']article/.test(lower)
    && !/consultez?\s+(?:les?\s+)?détails/.test(lower)
    && !/détails publiés par la source/.test(lower);
}

function cacheHasSummary(article) {
  const cache = speedRead(FAST_SUMMARY_CACHE, {});
  const item = cache[`article:${article.id}`];
  return Boolean(item?.summary && !item?.unavailable && summaryIsUsable(item.summary));
}

async function fetchSummaryAhead(article) {
  const key = `article:${article.id}`;
  if (cacheHasSummary(article)) return;
  try {
    const response = await fetch('/api/article-summary-groq?v=11', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        mode: 'article',
        article: {
          url: article.url,
          title: cleanSpeedText(article.title),
          summary: summaryIsUsable(article.summary) ? cleanSpeedText(article.summary) : ''
        }
      })
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.summary || data?.unavailable || !summaryIsUsable(data.summary)) return;
    const latest = speedRead(FAST_SUMMARY_CACHE, {});
    latest[key] = {
      summary: cleanSpeedText(data.summary),
      ai: Boolean(data.ai),
      unavailable: false,
      savedAt: Date.now()
    };
    speedWrite(FAST_SUMMARY_CACHE, Object.fromEntries(Object.entries(latest).slice(-180)));
  } catch {}
}

function pumpSummaryQueue() {
  while (summaryActive < 2 && summaryQueue.length) {
    const article = summaryQueue.shift();
    summaryActive++;
    fetchSummaryAhead(article).finally(() => {
      summaryActive--;
      pumpSummaryQueue();
    });
  }
}

function warmVisibleSummaries() {
  const articles = [...document.querySelectorAll('.article-card[data-article]')]
    .slice(0, 8)
    .map(card => speedArticle(card.dataset.article))
    .filter(Boolean);
  for (const article of articles) {
    const id = String(article.id || '');
    if (!id || summaryQueued.has(id) || cacheHasSummary(article)) continue;
    summaryQueued.add(id);
    summaryQueue.push(article);
  }
  pumpSummaryQueue();
}

function addQuickSummaryImage(modal) {
  const sheet = modal?.querySelector('.quick-summary-sheet');
  if (!sheet || sheet.querySelector('.quick-summary-fast-image')) return;
  const article = speedArticle(lastArticleId);
  if (!article) return;

  const meta = sheet.querySelector('.quick-summary-meta');
  const text = sheet.querySelector('[data-quick-summary-text]');
  const label = sheet.querySelector('[data-quick-summary-label]');
  const src = preferredVisual(article);
  if (src) {
    const shell = document.createElement('div');
    shell.className = 'quick-summary-fast-image';
    const img = document.createElement('img');
    shell.appendChild(img);
    if (meta) meta.insertAdjacentElement('afterend', shell);
    else sheet.prepend(shell);
    attachFastImage(img, article, shell);
  }

  if (text && /résumé en cours/i.test(text.textContent || '') && summaryIsUsable(article.summary)) {
    text.textContent = cleanSpeedText(article.summary);
    if (label) label.textContent = 'Résumé IA en cours…';
  }
}

function enhanceSpeed() {
  speedScheduled = false;
  warmVisibleImages();
  document.querySelectorAll('.quick-summary-backdrop').forEach(addQuickSummaryImage);
  clearTimeout(enhanceSpeed.summaryTimer);
  enhanceSpeed.summaryTimer = setTimeout(warmVisibleSummaries, 650);
}

function scheduleSpeed() {
  if (speedScheduled) return;
  speedScheduled = true;
  requestAnimationFrame(enhanceSpeed);
}

document.addEventListener('click', event => {
  const card = event.target.closest('.article-card[data-article], [data-article]');
  if (card?.dataset?.article && !event.target.closest('button, a, input, select, textarea')) {
    lastArticleId = card.dataset.article;
    const img = card.querySelector('img.article-image');
    if (img?.complete && img.naturalWidth > 0) visualByArticle.set(String(lastArticleId), img.currentSrc || img.src);
  }
}, true);

const speedRoot = document.getElementById('app');
if (speedRoot) new MutationObserver(scheduleSpeed).observe(speedRoot, { childList: true, subtree: true });
new MutationObserver(scheduleSpeed).observe(document.body, { childList: true, subtree: true });
window.addEventListener('focus', scheduleSpeed);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSpeed(); });
scheduleSpeed();
