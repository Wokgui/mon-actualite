(() => {
  'use strict';

  const PAGE_RELEASE = '91.8';
  const RELEASE_DATE = '30 août 2026';
  const VERSION_PATH = '/version.json';
  const CHECK_COOLDOWN_MS = 45_000;
  let checking = false;
  let lastCheckedAt = 0;
  let reloadStarted = false;
  let uiScheduled = false;

  function clean(value = '') {
    return String(value ?? '').trim();
  }

  function showToast(message = '') {
    const toast = document.getElementById('toast');
    if (!toast || !message) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function patchVersionUi() {
    uiScheduled = false;
    const section = document.querySelector('.app-version-section');
    if (!section) return;
    const title = section.querySelector('.app-version-row strong');
    const release = section.querySelector('.app-version-row span:not(.app-version-badge)');
    const badge = section.querySelector('.app-version-badge');
    if (title) title.textContent = `Mon actualité · version ${PAGE_RELEASE}`;
    if (release) release.textContent = `Publication du ${RELEASE_DATE}`;
    if (badge) badge.textContent = `v${PAGE_RELEASE}`;
    section.dataset.codeRelease = PAGE_RELEASE;
  }

  function scheduleVersionUi() {
    if (uiScheduled) return;
    uiScheduled = true;
    requestAnimationFrame(patchVersionUi);
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

  async function checkRelease({ force = false, announce = false } = {}) {
    if (checking || reloadStarted || document.hidden || !navigator.onLine) {
      if (announce && !navigator.onLine) showToast('Vérification impossible hors connexion');
      return false;
    }
    const now = Date.now();
    if (!force && now - lastCheckedAt < CHECK_COOLDOWN_MS) return false;
    checking = true;
    lastCheckedAt = now;
    try {
      const published = await publishedRelease();
      if (!published || published === PAGE_RELEASE) {
        if (announce) showToast(`Version ${PAGE_RELEASE} à jour`);
        return false;
      }
      if (announce) showToast(`Mise à jour vers la version ${published}…`);
      reloadStarted = true;
      await activateWaitingWorker();
      const next = new URL(location.href);
      next.searchParams.set('code-release', published);
      next.searchParams.set('update', Date.now().toString());
      location.replace(next.href);
      return true;
    } catch {
      if (announce) showToast('Vérification impossible pour le moment');
      return false;
    } finally {
      checking = false;
    }
  }

  document.documentElement.dataset.codeRelease = PAGE_RELEASE;
  window.__releaseWatch = { pageRelease: PAGE_RELEASE, checkRelease, patchVersionUi };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-check-update]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    checkRelease({ force: true, announce: true });
  }, true);

  if (document.body) {
    new MutationObserver(scheduleVersionUi).observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', scheduleVersionUi, { once: true });
  window.addEventListener('focus', () => { scheduleVersionUi(); checkRelease(); });
  window.addEventListener('online', () => checkRelease({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scheduleVersionUi(); checkRelease(); }
  });
  window.setInterval(() => checkRelease(), 5 * 60 * 1000);
  window.setTimeout(() => { scheduleVersionUi(); checkRelease({ force: true }); }, 900);
})();
