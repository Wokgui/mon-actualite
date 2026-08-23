(() => {
  const APP_ID = 'app';
  const LIVE_SUMMARY_TTL = 5 * 60 * 1000;
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v4';
  const nativeInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!nativeInner?.get || !nativeInner?.set) return;

  const nativeGet = nativeInner.get;
  const nativeSet = nativeInner.set;
  let parsing = false;

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
      || /pour\s+(?:sauvegarder|enregistrer|mémoriser|partager|commenter|lire)\s+(?:(?:cet|cette|un|une|l[’']?)\s*)?article/.test(text)
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
      const image = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, img.runtime-detail-image');
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
      const target = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, .article-placeholder, .brief-thumb.article-placeholder');
      if (target && target !== image) target.replaceWith(image);
      // The image node keeps its v42Loaded marker, but the surrounding card is
      // new. Restore the visual state as well or performance-v42 will consider
      // the image configured while CSS keeps it hidden.
      card.classList.remove('v42-image-pending', 'v42-image-failed');
      card.classList.add('v42-image-loaded');
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
    }
  });

  refreshLiveSummaryCache();
  window.addEventListener('focus', refreshLiveSummaryCache);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshLiveSummaryCache();
  });
})();
