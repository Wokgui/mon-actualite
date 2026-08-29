(() => {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  const nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!nativeInnerHTML?.get || !nativeInnerHTML?.set) return;

  const viewCache = new Map();
  let pendingTarget = '';
  let leavingView = '';
  const upstreamFetch = window.fetch.bind(window);

  function detectPageView() {
    const page = app.querySelector(':scope > .page');
    if (!page) return '';
    if (page.querySelector('.brief-points, .date-card') && /brief/i.test(page.textContent || '')) return 'brief';
    if (page.querySelector('.hero-header') && /mon actualité/i.test(page.textContent || '')) return 'home';
    return '';
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
  }

  function restoreCached(view) {
    const fragment = viewCache.get(view);
    if (!fragment || !fragment.childNodes.length) return false;
    app.appendChild(fragment);
    viewCache.delete(view);
    setNavActive(view);
    return true;
  }

  try {
    Object.defineProperty(app, 'innerHTML', {
      configurable: true,
      enumerable: false,
      get() {
        return nativeInnerHTML.get.call(this);
      },
      set(value) {
        if (!pendingTarget || !['home', 'brief'].includes(pendingTarget)) {
          nativeInnerHTML.set.call(this, value);
          return;
        }

        const target = pendingTarget;
        const from = leavingView;
        pendingTarget = '';
        leavingView = '';

        if (from && from !== target) stashCurrent(from);
        if (restoreCached(target)) return;
        nativeInnerHTML.set.call(this, value);
      }
    });
  } catch {
    return;
  }

  function clearCache() {
    viewCache.clear();
  }

  window.fetch = async function navigationCacheFetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) clearCache();
    } catch {}
    return response;
  };

  document.addEventListener('click', event => {
    const nav = event.target.closest?.('.bottom-nav [data-view="home"], .bottom-nav [data-view="brief"]');
    if (nav) {
      const target = nav.dataset.view;
      const current = detectPageView();
      if (current && current !== target) {
        leavingView = current;
        pendingTarget = target;
      }
      return;
    }

    if (event.target.closest?.('[data-save], [data-saved-filter], [data-reset], [data-general-category], [data-interest], [data-brief-essential], [data-brief-watch], [data-topic-feedback], [data-quick-feedback]')) {
      clearCache();
    }
  }, true);

  window.addEventListener('pageshow', event => {
    if (event.persisted) clearCache();
  });
})();
