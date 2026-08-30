(() => {
  'use strict';

  const CACHE_KEY = 'news-visual-stability-v918';
  const BACKFILL_KEY = 'news-visual-backfill-v3';
  const MAX_AGE = 30 * 86400000;
  const MAX_ENTRIES = 300;
  const readyVisuals = new Map();
  let persistTimer = null;

  const stats = {
    version: '91.8',
    remembered: 0,
    reused: 0,
    preventedChanges: 0
  };
  window.__visualStabilityV918 = stats;
  document.documentElement.dataset.visualStabilityVersion = '91.8';

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch { return {}; }
  }

  function usableUrl(raw = '') {
    const value = String(raw || '').trim();
    if (!value || value.startsWith('data:image/')) return '';
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function hydrate() {
    const now = Date.now();
    const own = readJson(CACHE_KEY);
    for (const [id, item] of Object.entries(own)) {
      const url = usableUrl(item?.url);
      const savedAt = Number(item?.savedAt || 0);
      if (id && url && savedAt && now - savedAt < MAX_AGE) readyVisuals.set(String(id), { url, savedAt });
    }

    // Reuse the application's successful recovery cache too. This prevents a
    // recovered thumbnail from being replaced by a freshly generated proxy URL
    // on the next render/navigation.
    const backfills = readJson(BACKFILL_KEY);
    for (const [id, item] of Object.entries(backfills)) {
      const url = usableUrl(item?.url);
      const savedAt = Number(item?.savedAt || 0);
      if (!id || !url || !savedAt || now - savedAt >= MAX_AGE) continue;
      const current = readyVisuals.get(String(id));
      if (!current || savedAt > current.savedAt) readyVisuals.set(String(id), { url, savedAt });
    }
  }

  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const entries = [...readyVisuals.entries()]
        .filter(([, item]) => item?.url && Date.now() - Number(item.savedAt || 0) < MAX_AGE)
        .sort((a, b) => Number(a[1].savedAt || 0) - Number(b[1].savedAt || 0))
        .slice(-MAX_ENTRIES);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
    }, 150);
  }

  function articleIdFor(image) {
    return String(image?.closest?.('.article-card[data-article]')?.dataset.article || '');
  }

  function rememberLoaded(image) {
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('img.article-image.stable-visual')) return;
    if (!image.classList.contains('prepared-visual')) return;
    if (!image.complete || image.naturalWidth < 2) return;
    const id = articleIdFor(image);
    const url = usableUrl(image.currentSrc || image.src);
    if (!id || !url) return;
    const previous = readyVisuals.get(id);
    if (previous?.url === url) return;
    readyVisuals.set(id, { url, savedAt: Date.now() });
    stats.remembered += 1;
    persistSoon();
  }

  function stabilizeCard(card) {
    if (!(card instanceof Element) || !card.matches('.article-card[data-article]')) return;
    const id = String(card.dataset.article || '');
    const image = card.querySelector('img.article-image.stable-visual');
    const remembered = readyVisuals.get(id);
    if (!id || !image || !remembered?.url) return;
    const current = usableUrl(image.getAttribute('src') || image.src);
    if (current === remembered.url) return;

    // Replace an about-to-load regenerated URL with the last URL that actually
    // completed successfully for this article. This does not add a request: it
    // cancels/replaces one pending image request with the known-good one.
    image.classList.remove('source-tile-visual');
    image.classList.add('prepared-visual');
    image.src = remembered.url;
    stats.reused += 1;
    stats.preventedChanges += 1;
  }

  function stabilizeTree(root) {
    if (!(root instanceof Element)) return;
    if (root.matches('.article-card[data-article]')) stabilizeCard(root);
    root.querySelectorAll?.('.article-card[data-article]').forEach(stabilizeCard);
  }

  hydrate();
  document.querySelectorAll('.article-card[data-article]').forEach(stabilizeCard);

  document.addEventListener('load', event => rememberLoaded(event.target), true);

  const app = document.getElementById('app');
  if (app) {
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) stabilizeTree(node);
      }
    }).observe(app, { childList: true, subtree: true });
  }

  window.addEventListener('pageshow', () => {
    hydrate();
    document.querySelectorAll('.article-card[data-article]').forEach(stabilizeCard);
  });
})();
