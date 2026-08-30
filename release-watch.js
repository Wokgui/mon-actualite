(() => {
  'use strict';

  const PAGE_RELEASE = '91.5';
  const VERSION_PATH = '/version.json';
  const CHECK_COOLDOWN_MS = 45_000;
  let checking = false;
  let lastCheckedAt = 0;
  let reloadStarted = false;

  function clean(value = '') {
    return String(value ?? '').trim();
  }

  async function publishedRelease() {
    const url = new URL(VERSION_PATH, location.origin);
    url.searchParams.set('release-check', Date.now().toString());
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`version HTTP ${response.status}`);
    const meta = await response.json();
    return clean(meta?.codeRelease || '');
  }

  async function activateWaitingWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
      if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {}
  }

  async function checkRelease({ force = false } = {}) {
    if (checking || reloadStarted || document.hidden || !navigator.onLine) return false;
    const now = Date.now();
    if (!force && now - lastCheckedAt < CHECK_COOLDOWN_MS) return false;
    checking = true;
    lastCheckedAt = now;
    try {
      const published = await publishedRelease();
      if (!published || published === PAGE_RELEASE) return false;
      reloadStarted = true;
      await activateWaitingWorker();
      const next = new URL(location.href);
      next.searchParams.set('code-release', published);
      next.searchParams.set('update', Date.now().toString());
      location.replace(next.href);
      return true;
    } catch {
      return false;
    } finally {
      checking = false;
    }
  }

  document.documentElement.dataset.codeRelease = PAGE_RELEASE;
  window.__releaseWatch = { pageRelease: PAGE_RELEASE, checkRelease };

  window.addEventListener('focus', () => checkRelease());
  window.addEventListener('online', () => checkRelease({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkRelease();
  });
  window.setInterval(() => checkRelease(), 5 * 60 * 1000);
  window.setTimeout(() => checkRelease({ force: true }), 900);
})();
