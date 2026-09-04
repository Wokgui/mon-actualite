(() => {
  'use strict';

  const RELEASE = '91.75';
  document.documentElement.dataset.startupStabilityV9175 = RELEASE;

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
