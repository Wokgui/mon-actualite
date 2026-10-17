(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const CLEANUP_KEY = 'news-maintenance-last-cleanup-v84';
  const SUMMARY_KEY = 'news-article-summaries-v8';
  const INTEL_KEY = 'news-story-intelligence-cache-v81';
  const PERF_KEY = 'news-performance-v81';
  const STORY_KEY = 'news-story-history-v81';
  const RESTORABLE_KEYS = [
    'news-settings',
    'news-sources',
    'news-keywords',
    'news-topic-preferences-v1',
    'news-source-preferences-v82',
    'news-feedback',
    'news-saved',
    'news-story-history-v81',
    'news-known-articles-v79'
  ];
  const upstreamFetch = window.fetch.bind(window);
  let decorateQueued = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(text);
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function jsonResponse(payload, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
    });
  }

  window.fetch = async function maintenanceV84Fetch(input, init) {
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch {
      return upstreamFetch(input, init);
    }

    if (!navigator.onLine && url.origin === location.origin) {
      if (url.pathname === '/api/news') {
        const cache = readJson(CACHE_KEY, null);
        if (cache && Array.isArray(cache.articles) && cache.articles.length) {
          return jsonResponse({ ...cache, offlineV84: true, fetchedAt: cache.fetchedAt || new Date().toISOString() }, 200, { 'X-News-Offline': '1' });
        }
      }
      if (url.pathname === '/api/article-summary-groq') {
        const body = parseBody(init);
        const summary = clean(body?.article?.summary || '');
        if (usefulSummary(summary)) {
          return jsonResponse({ summary, ai: false, unavailable: false, provider: 'offline-feed-v84', offline: true });
        }
      }
      if (url.pathname.startsWith('/api/article-summary-') || url.pathname === '/api/article-story-intelligence') {
        return jsonResponse({ ok: false, unavailable: true, offline: true }, 503);
      }
    }

    return upstreamFetch(input, init);
  };

  function pruneMap(key, maxAge, maxEntries) {
    const value = readJson(key, null);
    if (!value || Array.isArray(value) || typeof value !== 'object') return 0;
    const cutoff = Date.now() - maxAge;
    const entries = Object.entries(value)
      .filter(([, item]) => !item || typeof item !== 'object' || !item.savedAt || Number(item.savedAt) >= cutoff)
      .sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0))
      .slice(0, maxEntries);
    const removed = Math.max(0, Object.keys(value).length - entries.length);
    writeJson(key, Object.fromEntries(entries));
    return removed;
  }

  function pruneStories() {
    const memory = readJson(STORY_KEY, null);
    if (!memory || !Array.isArray(memory.stories)) return 0;
    const cutoff = Date.now() - 14 * 86400000;
    const before = memory.stories.length;
    memory.stories = memory.stories
      .filter(story => Number(story.lastSeen || 0) >= cutoff)
      .slice(0, 180)
      .map(story => ({ ...story, snapshots: Array.isArray(story.snapshots) ? story.snapshots.slice(-7) : [] }));
    writeJson(STORY_KEY, memory);
    return Math.max(0, before - memory.stories.length);
  }

  function prunePerformance() {
    const perf = readJson(PERF_KEY, []);
    if (!Array.isArray(perf)) return 0;
    const cutoff = Date.now() - 14 * 86400000;
    const next = perf.filter(item => Number(item?.at || 0) >= cutoff).slice(-160);
    const removed = Math.max(0, perf.length - next.length);
    writeJson(PERF_KEY, next);
    return removed;
  }

  async function cleanup({ manual = false } = {}) {
    const last = Number(localStorage.getItem(CLEANUP_KEY) || 0);
    if (!manual && Date.now() - last < 24 * 60 * 60 * 1000) return 0;
    let removed = 0;
    removed += pruneMap(SUMMARY_KEY, 45 * 86400000, 180);
    removed += pruneMap(INTEL_KEY, 14 * 86400000, 180);
    removed += pruneStories();
    removed += prunePerformance();

    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        const currentPrefixes = ['mon-actualite-v84-', 'mon-actualite-thumbnails-'];
        const stale = keys.filter(key => key.startsWith('mon-actualite-') && !currentPrefixes.some(prefix => key.startsWith(prefix)));
        await Promise.all(stale.map(key => caches.delete(key)));
        removed += stale.length;
      } catch {}
    }
    try { localStorage.setItem(CLEANUP_KEY, String(Date.now())); } catch {}
    return removed;
  }

  function storageBytes() {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        const value = localStorage.getItem(key) || '';
        total += (key.length + value.length) * 2;
      }
    } catch {}
    return total;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  function summaryCount() {
    const cache = readJson(SUMMARY_KEY, {});
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? Object.keys(cache).length : 0;
  }

  function buildBackup() {
    const data = {};
    for (const key of RESTORABLE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      try { data[key] = JSON.parse(raw); }
      catch {}
    }
    return {
      type: 'mon-actualite-backup',
      schema: 1,
      app: 'Mon actualité',
      exportedAt: new Date().toISOString(),
      data
    };
  }

  function exportBackup() {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mon-actualite-sauvegarde-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function validateBackup(payload) {
    if (!payload || payload.type !== 'mon-actualite-backup' || !payload.data || typeof payload.data !== 'object') return false;
    return Object.keys(payload.data).some(key => RESTORABLE_KEYS.includes(key));
  }

  async function importBackup(file) {
    if (!file || file.size > 3 * 1024 * 1024) throw new Error('Fichier trop volumineux');
    const payload = JSON.parse(await file.text());
    if (!validateBackup(payload)) throw new Error('Sauvegarde non reconnue');
    for (const key of RESTORABLE_KEYS) {
      if (!(key in payload.data)) continue;
      localStorage.setItem(key, JSON.stringify(payload.data[key]));
    }
    return true;
  }

  function settingsPage() {
    return document.querySelector('.settings-page, main.settings-page, .page.settings-page')
      || [...document.querySelectorAll('.page, main')].find(node => node.querySelector('.app-version-section'));
  }

  function statusText() {
    return navigator.onLine ? 'En ligne' : 'Hors connexion · dernier fil conservé';
  }

  function decorateSettings() {
    const page = settingsPage();
    if (!page) return;
    let section = page.querySelector('.maintenance-v84');
    if (!section) {
      section = document.createElement('section');
      section.className = 'settings-section maintenance-v84';
      const reset = page.querySelector('[data-reset]');
      if (reset) reset.insertAdjacentElement('beforebegin', section);
      else page.appendChild(section);
    }
    section.innerHTML = `<h2>Sauvegarde et stockage</h2>
      <div class="maintenance-status-v84"><span class="status-dot-v84 ${navigator.onLine ? 'online' : 'offline'}"></span><strong>${statusText()}</strong><small>${summaryCount()} résumé${summaryCount() > 1 ? 's' : ''} en cache · ${formatBytes(storageBytes())} de données locales</small></div>
      <p>Le dernier fil et les résumés déjà enregistrés restent disponibles sans réseau. Les réglages peuvent être exportés puis restaurés après une réinstallation.</p>
      <div class="maintenance-actions-v84">
        <button type="button" class="secondary-btn compact-btn" data-export-v84>Exporter mes réglages</button>
        <button type="button" class="secondary-btn compact-btn" data-import-v84>Restaurer une sauvegarde</button>
        <button type="button" class="secondary-btn compact-btn" data-clean-v84>Nettoyer les caches temporaires</button>
      </div>
      <input type="file" accept="application/json,.json" data-import-file-v84 hidden>`;
  }

  function offlineBanner() {
    let banner = document.querySelector('.offline-banner-v84');
    if (navigator.onLine) {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'offline-banner-v84';
      document.body.appendChild(banner);
    }
    banner.textContent = 'Hors connexion · affichage du dernier fil disponible';
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateSettings();
      offlineBanner();
    });
  }

  document.addEventListener('click', async event => {
    if (event.target.closest?.('[data-export-v84]')) {
      event.preventDefault();
      exportBackup();
      return;
    }
    if (event.target.closest?.('[data-import-v84]')) {
      event.preventDefault();
      settingsPage()?.querySelector('[data-import-file-v84]')?.click();
      return;
    }
    if (event.target.closest?.('[data-clean-v84]')) {
      event.preventDefault();
      const button = event.target.closest('[data-clean-v84]');
      const removed = await cleanup({ manual: true });
      button.textContent = removed ? `Nettoyé · ${removed} élément${removed > 1 ? 's' : ''}` : 'Caches déjà propres';
      setTimeout(scheduleDecorate, 900);
    }
  }, true);

  document.addEventListener('change', async event => {
    const input = event.target.closest?.('[data-import-file-v84]');
    if (!input?.files?.[0]) return;
    try {
      await importBackup(input.files[0]);
      location.reload();
    } catch (error) {
      input.value = '';
      const section = input.closest('.maintenance-v84');
      let errorNode = section?.querySelector('.maintenance-error-v84');
      if (!errorNode && section) {
        errorNode = document.createElement('p');
        errorNode.className = 'maintenance-error-v84';
        section.appendChild(errorNode);
      }
      if (errorNode) errorNode.textContent = error?.message || 'Impossible de restaurer cette sauvegarde.';
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    cleanup().catch(() => {});
    new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
    scheduleDecorate();
  }, { once: true });
  window.addEventListener('online', scheduleDecorate);
  window.addEventListener('offline', scheduleDecorate);
  window.addEventListener('focus', scheduleDecorate);
})();
