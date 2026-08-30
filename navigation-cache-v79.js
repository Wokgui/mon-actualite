(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const app = document.getElementById('app');
  if (!app) return;

  const nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!nativeInnerHTML?.get || !nativeInnerHTML?.set) return;

  const viewCache = new Map();
  const cacheStats = {
    version: '91.11',
    stashed: 0,
    restored: 0,
    misses: 0,
    invalidations: 0,
    preservedRefreshes: 0
  };
  const performanceStats = {
    version: '91.11',
    newsResponses: 0,
    unchangedResponses: 0,
    changedResponses: 0,
    suppressedSilentRenders: 0,
    manualRefreshesPreserved: 0,
    cachePreservations: 0,
    cacheInvalidations: 0
  };

  let suppressNextSilentRender = false;
  let suppressUntil = 0;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function detectPageView() {
    const active = app.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
    if (active === 'home' || active === 'brief') return active;
    const page = app.querySelector(':scope > .page');
    if (!page) return '';
    if (page.querySelector('.runtime-brief-content, .brief-mode-tabs, .brief-points, .date-card')) return 'brief';
    if (page.querySelector('.hero-header') && /mon actualité/i.test(page.textContent || '')) return 'home';
    return '';
  }

  function targetView(markup = '') {
    const template = document.createElement('template');
    nativeInnerHTML.set.call(template, String(markup || ''));
    const active = template.content.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
    return active === 'home' || active === 'brief' ? active : '';
  }

  function savedOnlyHome() {
    const button = app.querySelector('[data-saved-filter]');
    return Boolean(button && /voir toute l[’']actualité/i.test(button.textContent || ''));
  }

  function cacheable(view) {
    if (view === 'brief') return true;
    if (view === 'home') return !savedOnlyHome();
    return false;
  }

  function setNavActive(view) {
    app.querySelectorAll('.bottom-nav .nav-item[data-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
    });
  }

  function stashCurrent(view) {
    if (!view || !cacheable(view) || !app.firstChild) return;
    setNavActive(view);
    const fragment = document.createDocumentFragment();
    while (app.firstChild) fragment.appendChild(app.firstChild);
    viewCache.set(view, fragment);
    cacheStats.stashed += 1;
  }

  function restoreCached(view) {
    const fragment = viewCache.get(view);
    if (!fragment || !fragment.childNodes.length) {
      cacheStats.misses += 1;
      return false;
    }
    app.appendChild(fragment);
    viewCache.delete(view);
    setNavActive(view);
    cacheStats.restored += 1;
    return true;
  }

  function clearCache() {
    if (viewCache.size) cacheStats.invalidations += 1;
    viewCache.clear();
  }

  function preserveRefresh() {
    cacheStats.preservedRefreshes += 1;
  }

  try {
    Object.defineProperty(app, 'innerHTML', {
      configurable: true,
      enumerable: false,
      get() {
        return nativeInnerHTML.get.call(this);
      },
      set(value) {
        const now = performance.now();
        const current = detectPageView();
        const targetFromMarkup = targetView(value);
        const transition = Boolean(
          current
          && targetFromMarkup
          && current !== targetFromMarkup
          && ['home', 'brief'].includes(current)
          && ['home', 'brief'].includes(targetFromMarkup)
        );
        const canSuppress = !transition
          && suppressNextSilentRender
          && now <= suppressUntil
          && current
          && current === targetFromMarkup
          && ['home', 'brief'].includes(current)
          && !this.querySelector('.sync-strip.loading');

        suppressNextSilentRender = false;
        suppressUntil = 0;
        if (canSuppress) {
          performanceStats.suppressedSilentRenders += 1;
          return;
        }

        if (transition) {
          stashCurrent(current);
          if (restoreCached(targetFromMarkup)) return;
        }

        nativeInnerHTML.set.call(this, value);
      }
    });
  } catch {
    return;
  }

  function articlePart(article = {}) {
    const sources = Array.isArray(article.sources) ? [...article.sources].map(clean).filter(Boolean).sort().join(',') : '';
    return [
      clean(article.id || ''),
      clean(article.url || ''),
      clean(article.title || ''),
      clean(article.summary || ''),
      clean(article.detail || ''),
      clean(article.source || ''),
      clean(article.category || ''),
      clean(article.publishedAt || article.date || ''),
      article.essential ? '1' : '0',
      sources
    ].join('\u001f');
  }

  function payloadSignature(payload = {}) {
    const articles = Array.isArray(payload.articles) ? payload.articles : [];
    return articles.map(articlePart).join('\u001e');
  }

  function cachedSignature() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return cached && Array.isArray(cached.articles) ? payloadSignature(cached) : '';
    } catch {
      return '';
    }
  }

  let lastSignature = cachedSignature();
  const upstreamFetch = window.fetch.bind(window);
  window.fetch = async function navigationCacheFetch(input, init) {
    const response = await upstreamFetch(input, init);
    if (!response.ok) return response;

    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/news') return response;

      performanceStats.newsResponses += 1;
      const manualRefresh = Boolean(app.querySelector('.sync-strip.loading'));
      const payload = await response.clone().json();
      const signature = payloadSignature(payload);
      const unchanged = Boolean(lastSignature) && signature === lastSignature;

      if (unchanged) {
        performanceStats.unchangedResponses += 1;
        performanceStats.cachePreservations += 1;
        preserveRefresh();
        if (manualRefresh) {
          performanceStats.manualRefreshesPreserved += 1;
        } else {
          suppressNextSilentRender = true;
          suppressUntil = performance.now() + 750;
        }
      } else {
        performanceStats.changedResponses += 1;
        performanceStats.cacheInvalidations += 1;
        suppressNextSilentRender = false;
        suppressUntil = 0;
        clearCache();
      }

      lastSignature = signature;
    } catch {}
    return response;
  };

  window.__navigationCacheV9111 = {
    stats: cacheStats,
    clearCache,
    cacheSize: () => viewCache.size
  };
  window.__navigationPerformanceV9111 = performanceStats;
  document.documentElement.dataset.navigationPerformanceVersion = '91.11';

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-save], [data-saved-filter], [data-reset], [data-general-category], [data-interest], [data-brief-essential], [data-brief-watch], [data-topic-feedback], [data-quick-feedback]')) {
      clearCache();
    }
  }, true);

  window.addEventListener('pageshow', event => {
    if (event.persisted) clearCache();
  });
})();
