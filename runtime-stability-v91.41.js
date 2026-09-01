(() => {
  'use strict';

  const RELEASE = '91.41';
  const VISUAL_KEY = 'news-visual-backfill-v3';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const SUMMARY_ATTEMPTS_KEY = 'news-summary-prewarm-attempts-v1';
  const SUMMARY_MIGRATION_KEY = 'news-summary-cache-migrated-v91.41';
  const nativeFetch = window.fetch.bind(window);
  const visualJobs = new Map();
  let prewarmStarted = false;
  let navIntent = null;
  let suppressView = '';
  let suppressUntil = 0;

  document.documentElement.dataset.runtimeStability = RELEASE;

  function requestUrl(input) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      return new URL(raw, location.href);
    } catch {
      return null;
    }
  }

  function rewriteSummaryRequest(input) {
    const url = requestUrl(input);
    if (!url || url.origin !== location.origin || url.pathname !== '/api/article-summary-groq') return input;
    url.pathname = '/api/article-summary-v9141';
    if (typeof input === 'string') return url.href;
    if (input instanceof URL) return url;
    if (input instanceof Request) {
      try { return new Request(url.href, input); } catch { return url.href; }
    }
    return input;
  }

  window.fetch = function runtimeStableFetch(input, init) {
    return nativeFetch(rewriteSummaryRequest(input), init);
  };

  function compactText(value = '') {
    return String(value ?? '')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizedWords(value = '') {
    return compactText(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/).filter(word => word.length >= 4);
  }

  function overlapRatio(a = '', b = '') {
    const aa = normalizedWords(a).slice(0, 70);
    const bb = new Set(normalizedWords(b).slice(0, 70));
    if (aa.length < 5 || bb.size < 5) return 0;
    return aa.filter(word => bb.has(word)).length / aa.length;
  }

  function readNewsCache() {
    try {
      const payload = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || 'null');
      return Array.isArray(payload?.articles) ? payload.articles : [];
    } catch {
      return [];
    }
  }

  function migrateBadSummaryCache() {
    try {
      if (localStorage.getItem(SUMMARY_MIGRATION_KEY) === '1') return;
      const articles = readNewsCache();
      const map = new Map(articles.map(article => [String(article.id || ''), article]));
      const cache = JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY) || '{}');
      const attempts = JSON.parse(localStorage.getItem(SUMMARY_ATTEMPTS_KEY) || '{}');
      let changed = false;
      for (const [key, entry] of Object.entries(cache || {})) {
        const match = /^article:(.+)$/.exec(key);
        if (!match || !entry?.summary) continue;
        const article = map.get(String(match[1]));
        if (!article) continue;
        const summary = compactText(entry.summary);
        const inputs = [article.summary, article.detail].map(compactText).filter(text => text.length >= 90);
        const copied = inputs.some(text => {
          const head = text.slice(0, 420);
          return overlapRatio(summary.slice(0, 420), head) >= 0.78 ||
            normalizedWords(summary.slice(0, 260)).join(' ').startsWith(normalizedWords(head).join(' ').slice(0, 90));
        });
        if (!copied) continue;
        delete cache[key];
        delete attempts[String(match[1])];
        changed = true;
      }
      if (changed) {
        localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(cache));
        localStorage.setItem(SUMMARY_ATTEMPTS_KEY, JSON.stringify(attempts));
      }
      localStorage.setItem(SUMMARY_MIGRATION_KEY, '1');
    } catch {}
  }

  function readVisualCache() {
    try {
      const value = JSON.parse(localStorage.getItem(VISUAL_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeVisualSuccess(id, url) {
    if (!id || !url) return;
    const cache = readVisualCache();
    cache[String(id)] = { url, savedAt: Date.now() };
    const entries = Object.entries(cache)
      .filter(([, item]) => item?.url && Date.now() - Number(item.savedAt || 0) < 30 * 86400000)
      .slice(-300);
    try { localStorage.setItem(VISUAL_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
  }

  function endpointFor(article = {}) {
    const params = new URLSearchParams({
      v: '19',
      url: String(article.url || '').slice(0, 1900),
      image: String(article.image || '').slice(0, 1900),
      title: String(article.title || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      category: String(article.category || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      source: String(article.source || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      custom: article.customSource ? '1' : '0'
    });
    return `/api/article-thumbnail?${params}`;
  }

  function neutralImage(img) {
    const src = String(img?.currentSrc || img?.src || '');
    return Boolean(img && (
      img.classList.contains('source-tile-visual') ||
      img.closest('.v42-image-failed') ||
      src.startsWith('data:image/svg+xml') ||
      /neutral|fallback|source-tile/i.test(src) ||
      (img.complete && img.naturalWidth > 0 && img.naturalWidth < 8)
    ));
  }

  function articleMap() {
    return new Map(readNewsCache().filter(Boolean).map(article => [String(article.id || ''), article]));
  }

  function promoteImage(img, high = false) {
    if (!(img instanceof HTMLImageElement)) return;
    if (high) {
      img.loading = 'eager';
      try { img.fetchPriority = 'high'; } catch {}
    }
    img.decoding = 'async';
  }

  function installEndpoint(id, endpoint) {
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      if (String(card.dataset.article || '') !== String(id)) return;
      const img = card.querySelector('img.article-image, img');
      if (!img || (!neutralImage(img) && String(img.currentSrc || img.src || '').includes('/api/article-thumbnail'))) return;
      promoteImage(img, true);
      img.classList.remove('source-tile-visual');
      img.classList.add('prepared-visual');
      img.src = endpoint;
    });
  }

  function applyRememberedImages(root = document) {
    const cache = readVisualCache();
    const cards = [];
    if (root instanceof Element && root.matches('.article-card[data-article]')) cards.push(root);
    root.querySelectorAll?.('.article-card[data-article]').forEach(card => cards.push(card));
    cards.forEach((card, index) => {
      const img = card.querySelector('img.article-image, img');
      if (!img) return;
      promoteImage(img, index < 12 || card.getBoundingClientRect().top < innerHeight * 1.5);
      const remembered = cache[String(card.dataset.article || '')];
      if (remembered?.url && (neutralImage(img) || !img.src)) {
        img.classList.remove('source-tile-visual');
        img.classList.add('prepared-visual');
        img.src = remembered.url;
      }
    });
  }

  async function recoverVisual(article) {
    const id = String(article?.id || '');
    if (!id) return false;
    if (visualJobs.has(id)) return visualJobs.get(id);
    const job = (async () => {
      const endpoint = endpointFor(article);
      try {
        const response = await nativeFetch(endpoint, { cache: 'force-cache' });
        const status = response.headers.get('X-Thumbnail-Status') || '';
        const type = response.headers.get('Content-Type') || '';
        if (!response.ok || /fallback|publisher-tile|neutral/i.test(status) || /image\/svg\+xml/i.test(type)) return false;
        const blob = await response.blob();
        if (blob.size < 512) return false;
        writeVisualSuccess(id, endpoint);
        installEndpoint(id, endpoint);
        return true;
      } catch {
        return false;
      } finally {
        visualJobs.delete(id);
      }
    })();
    visualJobs.set(id, job);
    return job;
  }

  function warmPrepared(article) {
    const src = String(article?.visual?.url || article?.image || '');
    if (!src || String(article?.visual?.status || article?.visualStatus || '') !== 'ready') return;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.src = src;
    } catch {}
  }

  async function prewarmTopImages() {
    if (prewarmStarted || document.hidden || !navigator.onLine) return;
    prewarmStarted = true;
    try {
      const articles = readNewsCache().filter(Boolean).slice(0, 28);
      articles.slice(0, 24).forEach(warmPrepared);
      const existing = readVisualCache();
      const missing = articles
        .filter(article => {
          const id = String(article.id || '');
          if (!id || existing[id]?.url) return false;
          return String(article?.visual?.status || article?.visualStatus || '') !== 'ready';
        })
        .slice(0, 10);
      let cursor = 0;
      const worker = async () => {
        while (cursor < missing.length) {
          const article = missing[cursor++];
          await recoverVisual(article);
          await new Promise(resolve => setTimeout(resolve, 280));
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      prewarmStarted = false;
    }
  }

  function warmVisiblePlaceholders(root = document) {
    applyRememberedImages(root);
    const map = articleMap();
    const cards = [];
    if (root instanceof Element && root.matches('.article-card[data-article]')) cards.push(root);
    root.querySelectorAll?.('.article-card[data-article]').forEach(card => cards.push(card));
    cards
      .filter(card => card.getBoundingClientRect().top < innerHeight * 1.8)
      .slice(0, 8)
      .forEach(card => {
        const img = card.querySelector('img.article-image, img');
        if (!img || !neutralImage(img)) return;
        const article = map.get(String(card.dataset.article || ''));
        if (article) recoverVisual(article);
      });
  }

  function navButtonFromEvent(event) {
    return event.target?.closest?.('.bottom-nav [data-view]') || null;
  }

  document.addEventListener('pointerdown', event => {
    const button = navButtonFromEvent(event);
    if (!button || (typeof event.button === 'number' && event.button !== 0)) return;
    navIntent = {
      view: String(button.dataset.view || ''),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now()
    };
  }, true);

  document.addEventListener('pointermove', event => {
    if (!navIntent || event.pointerId !== navIntent.pointerId) return;
    if (Math.hypot(event.clientX - navIntent.x, event.clientY - navIntent.y) > 18) navIntent = null;
  }, { capture: true, passive: true });

  document.addEventListener('pointercancel', () => { navIntent = null; }, true);

  document.addEventListener('pointerup', event => {
    const intent = navIntent;
    navIntent = null;
    if (!intent || event.pointerId !== intent.pointerId || performance.now() - intent.at > 1200) return;
    if (Math.hypot(event.clientX - intent.x, event.clientY - intent.y) > 18) return;
    const current = document.querySelector(`.bottom-nav [data-view="${CSS.escape(intent.view)}"]`);
    if (!current) return;
    suppressView = intent.view;
    suppressUntil = performance.now() + 700;
    current.click();
  }, true);

  document.addEventListener('click', event => {
    const button = navButtonFromEvent(event);
    if (!button || !event.isTrusted) return;
    if (performance.now() <= suppressUntil && String(button.dataset.view || '') === suppressView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressUntil = 0;
      suppressView = '';
    }
  }, true);

  function bootDomStability() {
    const style = document.createElement('style');
    style.textContent = `.bottom-nav [data-view]{touch-action:manipulation;-webkit-tap-highlight-color:transparent}.article-card img.article-image{transition:opacity .12s linear}`;
    document.head.appendChild(style);
    migrateBadSummaryCache();
    applyRememberedImages(document);
    warmVisiblePlaceholders(document);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          applyRememberedImages(node);
          warmVisiblePlaceholders(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(prewarmTopImages, 450);
    window.setTimeout(prewarmTopImages, 2200);
  }

  document.addEventListener('DOMContentLoaded', bootDomStability, { once: true });
  window.addEventListener('focus', () => window.setTimeout(prewarmTopImages, 150));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) window.setTimeout(prewarmTopImages, 150);
  });
})();
