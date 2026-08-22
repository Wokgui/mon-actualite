(() => {
  const APP_ID = 'app';
  const LIVE_SUMMARY_TTL = 5 * 60 * 1000;
  const IMAGE_CACHE_KEY = 'news-original-images-v3-no-google-logo';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v4';
  const nativeInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!nativeInner?.get || !nativeInner?.set) return;

  const nativeGet = nativeInner.get;
  const nativeSet = nativeInner.set;
  let parsing = false;
  let imagePassScheduled = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function liveArticles() {
    const cache = readJson('news-live-cache', {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function isLiveArticle(article = {}) {
    const title = String(article.title || '').toLowerCase();
    const url = String(article.url || '').toLowerCase();
    return /\b(?:en direct|direct|live)\b/.test(title) || /\/(?:live|direct)\//.test(url);
  }

  function badSummary(value = '') {
    const text = String(value || '').toLowerCase();
    return !text
      || /résumé indisponible/.test(text)
      || /ouvrez?\s+l[’']article|consultez?\s+(?:les?\s+)?détails/.test(text)
      || /lire\s+(?:tous\s+)?nos\s+articles(?:,\s*analyses)?(?:\s+et\s+reportages)?/.test(text)
      || /retrouvez?\s+notre\s+(?:précédent|ancien|nouveau)\s+live|en cliquant sur ce lien/.test(text)
      || /ce live est fermé|basculer vers (?:notre|le) nouveau live/.test(text);
  }

  function refreshLiveSummaryCache() {
    const now = Date.now();
    const articles = liveArticles().filter(isLiveArticle);
    if (!articles.length) return;
    const ids = new Set(articles.map(article => String(article.id || '')));

    for (const key of [SUMMARY_CACHE_KEY, 'news-factual-summaries-v2']) {
      const cache = readJson(key, {});
      let changed = false;
      for (const [entryKey, value] of Object.entries(cache)) {
        const id = entryKey.startsWith('article:') ? entryKey.slice(8) : entryKey;
        if (!ids.has(String(id))) continue;
        const stale = !value?.savedAt || now - Number(value.savedAt || 0) > LIVE_SUMMARY_TTL;
        if (stale || badSummary(value?.summary || '')) {
          delete cache[entryKey];
          changed = true;
        }
      }
      if (changed) writeJson(key, cache);
    }
  }

  function loadedImagesByArticle(root) {
    const map = new Map();
    root?.querySelectorAll?.('[data-article]').forEach(card => {
      const id = card.getAttribute('data-article');
      if (!id || map.has(id)) return;
      const image = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, img.direct-thumb');
      if (!image) return;
      const src = image.currentSrc || image.getAttribute('src') || '';
      if (src && image.complete && image.naturalWidth > 1) map.set(id, image);
    });
    return map;
  }

  function transplantLoadedImages(currentRoot, nextRoot) {
    const loaded = loadedImagesByArticle(currentRoot);
    if (!loaded.size) return;
    nextRoot?.querySelectorAll?.('[data-article]').forEach(card => {
      const id = card.getAttribute('data-article');
      const image = loaded.get(id);
      if (!image) return;
      const target = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, img.direct-thumb, .article-placeholder, .brief-thumb.article-placeholder');
      if (target && target !== image) target.replaceWith(image);
    });
  }

  function shouldPreserve(element, value) {
    if (parsing || typeof value !== 'string' || !value.includes('data-article=')) return false;
    if (element.id === APP_ID && element.querySelector('[data-article]')) return true;
    if (element.classList?.contains('feed') && element.querySelector('[data-article]')) return true;
    return false;
  }

  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: nativeInner.configurable,
    enumerable: nativeInner.enumerable,
    get() { return nativeGet.call(this); },
    set(value) {
      if (!shouldPreserve(this, value)) {
        nativeSet.call(this, value);
        return;
      }

      const template = document.createElement('template');
      try {
        parsing = true;
        nativeSet.call(template, String(value));
      } finally {
        parsing = false;
      }
      transplantLoadedImages(this, template.content);
      this.replaceChildren(...template.content.childNodes);
      scheduleImagePass();
    }
  });

  function validImage(value = '') {
    try {
      const url = new URL(String(value || ''), location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const host = url.hostname.toLowerCase();
      const text = `${host}${url.pathname}${url.search}`.toLowerCase();
      if (/logo|avatar|icon|sprite|tracking|pixel|wordmark|favicon|site-logo|google-news|googlenews|google_actualites|google-actualites/i.test(text)) return '';
      if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
      return url.href;
    } catch { return ''; }
  }

  function articleMap() {
    return new Map(liveArticles().map(article => [String(article.id || ''), article]));
  }

  function publisherImage(article) {
    const cached = readJson(IMAGE_CACHE_KEY, {});
    return validImage(cached[String(article?.id || '')] || '') || validImage(article?.image || '');
  }

  function fallbackImage(article) {
    const params = new URLSearchParams({
      v: '5',
      title: String(article?.title || '').slice(0, 280),
      category: String(article?.category || '').slice(0, 70)
    });
    return `/api/article-photo-fast?${params}`;
  }

  const lazyObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      const pending = image.dataset.pendingStableSrc;
      if (pending && !image.getAttribute('src')) image.src = pending;
      delete image.dataset.pendingStableSrc;
      lazyObserver.unobserve(image);
    }
  }, { rootMargin: '900px 0px' }) : null;

  function setImageSource(image, src, immediate) {
    if (!src) return;
    if (image.getAttribute('src') === src || image.dataset.pendingStableSrc === src) return;
    if (immediate || !lazyObserver) {
      image.src = src;
    } else {
      image.removeAttribute('src');
      image.dataset.pendingStableSrc = src;
      lazyObserver.observe(image);
    }
  }

  function stabilizeCard(card, article, index) {
    if (!article) return;
    let image = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, img.direct-thumb');
    const placeholder = card.querySelector('.article-placeholder, .brief-thumb.article-placeholder');

    if (!image && placeholder) {
      image = document.createElement('img');
      image.alt = '';
      image.className = placeholder.classList.contains('brief-thumb')
        ? 'brief-thumb article-image original-article-image'
        : 'article-image original-article-image';
      placeholder.replaceWith(image);
    }
    if (!image || image.dataset.stableDomImage === '1') return;

    const direct = publisherImage(article);
    const fallback = fallbackImage(article);
    const existing = validImage(image.getAttribute('src') || '');
    const wanted = existing && !existing.includes('/api/article-thumbnail') ? existing : (direct || fallback);

    image.dataset.stableDomImage = '1';
    image.dataset.imageStableV4 = '1';
    image.dataset.stableFallback = fallback;
    image.classList.remove('direct-thumb');
    image.removeAttribute('data-thumbnail-fallback');
    image.removeAttribute('data-fallback-applied');
    image.removeAttribute('referrerpolicy');
    image.decoding = 'async';
    image.loading = index < 6 ? 'eager' : 'lazy';
    if (index < 3) image.fetchPriority = 'high';

    image.onerror = () => {
      if (image.dataset.stableFallbackApplied === '1') return;
      image.dataset.stableFallbackApplied = '1';
      image.removeAttribute('src');
      setImageSource(image, fallback, true);
    };

    setImageSource(image, wanted, index < 6);
  }

  function imagePass() {
    imagePassScheduled = false;
    const byId = articleMap();
    document.querySelectorAll('[data-article]').forEach((card, index) => {
      stabilizeCard(card, byId.get(String(card.getAttribute('data-article') || '')), index);
    });
  }

  function scheduleImagePass() {
    if (imagePassScheduled) return;
    imagePassScheduled = true;
    requestAnimationFrame(imagePass);
  }

  refreshLiveSummaryCache();
  const app = document.getElementById(APP_ID);
  if (app) new MutationObserver(scheduleImagePass).observe(app, { childList: true, subtree: true });
  window.addEventListener('focus', () => {
    refreshLiveSummaryCache();
    scheduleImagePass();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshLiveSummaryCache();
      scheduleImagePass();
    }
  });
  scheduleImagePass();
})();
