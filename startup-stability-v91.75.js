(() => {
  'use strict';

  const RELEASE = '91.76';
  document.documentElement.dataset.startupStabilityV9175 = RELEASE;

  // The first news synchronisation must never wait for the complete catalogue.
  // It uses a small, current Google News catalogue with a hard server budget;
  // later automatic/manual synchronisations keep using the full personalised
  // pipeline, including imported RSS sources and learned interests.
  const nativeFetch = window.fetch.bind(window);
  let startupNewsRequestHandled = false;

  function newsRequestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url || '', location.href);
    } catch {
      return null;
    }
  }

  window.fetch = async function fastStartupFetch(input, init) {
    const url = newsRequestUrl(input);
    const isNewsRequest = url && url.origin === location.origin && url.pathname === '/api/news';
    if (!startupNewsRequestHandled && isNewsRequest && url.searchParams.get('fast') !== '1') {
      startupNewsRequestHandled = true;
      const fastUrl = new URL('/api/news', location.origin);
      fastUrl.searchParams.set('fast', '1');

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3200);
      try {
        const fastResponse = await nativeFetch(fastUrl.href, {
          method: 'GET',
          cache: 'default',
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (fastResponse.ok) return fastResponse;
      } catch {
        // If the fast path is exceptionally unavailable, preserve the complete
        // synchronisation rather than leaving the application without news.
      } finally {
        window.clearTimeout(timer);
      }
    }
    return nativeFetch(input, init);
  };

  const container = navigator.serviceWorker;
  if (!container) return;

  // app.js historically reloads the whole page on controllerchange. During an
  // installed-PWA launch a waiting worker can take control a few seconds after
  // first paint, which produces the second Android splash seen in the capture.
  // Suppress only controllerchange subscriptions while the application modules
  // initialise; all other ServiceWorkerContainer events keep their native path.
  const nativeAdd = container.addEventListener.bind(container);
  let patched = false;

  try {
    Object.defineProperty(container, 'addEventListener', {
      configurable: true,
      value(type, listener, options) {
        if (type === 'controllerchange') return;
        return nativeAdd(type, listener, options);
      }
    });
    patched = true;
  } catch {}

  // Module scripts run before load. Restore the native method afterwards so
  // future code is unaffected; the unwanted launch-time listener was never
  // registered, therefore a worker activation cannot reload this session.
  window.addEventListener('load', () => {
    if (!patched) return;
    try { delete container.addEventListener; } catch {}
  }, { once: true });
})();
