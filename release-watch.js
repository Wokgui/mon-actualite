// deployment retry 2026-09-24 16h
(() => {
  'use strict';

  // Capture the real fetch before any later compatibility layer can wrap it.
  // Release checks must use this reference, otherwise the v91.38 compatibility
  // shim can make the page look like v91.37 and trigger an endless reload loop.
  const nativeFetch = window.fetch.bind(window);

  const SUMMARY_CACHE_KEY = 'news-live-cache';
  const summaryStats = {
    version: '91.9',
    cleanedFeedSummaries: 0,
    cleanedCacheSummaries: 0,
    hiddenEmptyNodes: 0
  };
  window.__summaryQualityV919 = summaryStats;
  document.documentElement.dataset.summaryQualityVersion = '91.9';

  function clean(value = '') {
    return String(value ?? '')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function titleWithoutPublisher(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '');
    if (source) {
      const stripped = title.replace(new RegExp(`\\s*[-–—|]\\s*${escapeRegExp(source)}\\s*$`, 'i'), '').trim();
      if (stripped !== title) title = stripped;
    }
    return title;
  }

  function googleNewsRssArticle(article = {}) {
    if (!article || article.customSource === true) return false;
    try {
      const url = new URL(String(article.url || ''), location.href);
      return url.hostname.toLowerCase() === 'news.google.com' && /^\/rss\/articles\//.test(url.pathname);
    } catch {
      return false;
    }
  }

  function titleRestatement(value = '', article = {}) {
    const text = normalize(value);
    const title = normalize(titleWithoutPublisher(article));
    if (!text || !title) return false;
    const wanted = [...new Set(title.split(' ').filter(word => word.length >= 4))];
    const found = new Set(text.split(' ').filter(word => word.length >= 4));
    if (wanted.length < 3) return false;
    const hits = wanted.filter(word => found.has(word)).length;
    return hits / wanted.length >= 0.82 && clean(value).length <= Math.max(230, titleWithoutPublisher(article).length * 2.1);
  }

  function googleFeedDescription(value = '', article = {}) {
    const raw = String(value ?? '');
    if (!raw.trim() || !googleNewsRssArticle(article)) return false;
    if (/&nbsp;|&#160;|&#x0*a0;/i.test(raw)) return true;
    if (/voir plus de titres et de points de vue sur google actualit(?:é|e)s?/i.test(clean(raw))) return true;
    const source = normalize(article.source || '');
    const text = normalize(raw);
    return Boolean(source && text.includes(source) && titleRestatement(raw, article));
  }

  function sanitizeArticle(article = {}, origin = 'feed') {
    if (!googleNewsRssArticle(article)) return { article, changed: false };
    const copy = { ...article };
    let changed = false;
    if (googleFeedDescription(copy.summary, copy)) { copy.summary = ''; changed = true; }
    if (googleFeedDescription(copy.detail, copy)) { copy.detail = ''; changed = true; }
    if (!changed) return { article, changed: false };
    copy.summaryQualityV919 = 'google-news-headline-cluster';
    copy.summaryUnavailableV919 = true;
    copy.summaryNeedsFetchV919 = true;
    if (origin === 'cache') summaryStats.cleanedCacheSummaries += 1;
    else summaryStats.cleanedFeedSummaries += 1;
    return { article: copy, changed: true };
  }

  function sanitizePayload(payload, origin = 'feed') {
    if (!payload || !Array.isArray(payload.articles)) return { payload, changed: false };
    let changed = false;
    const articles = payload.articles.map(article => {
      const result = sanitizeArticle(article, origin);
      changed ||= result.changed;
      return result.article;
    });
    return { payload: changed ? { ...payload, articles } : payload, changed };
  }

  try {
    const cached = JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY) || 'null');
    const result = sanitizePayload(cached, 'cache');
    if (result.changed) localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(result.payload));
  } catch {}

  window.fetch = async function summaryQualityV919Fetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!response.ok) return response;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/news') return response;
      const data = await response.clone().json();
      const result = sanitizePayload(data, 'feed');
      if (!result.changed) return response;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(result.payload), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch {
      return response;
    }
  };

  function hideEmptySummaries(root = document) {
    const nodes = [];
    if (root instanceof Element && root.matches('.article-card .summary')) nodes.push(root);
    root.querySelectorAll?.('.article-card .summary').forEach(node => nodes.push(node));
    for (const node of nodes) {
      if (String(node.textContent || '').trim()) continue;
      if (!node.hidden) {
        node.hidden = true;
        summaryStats.hiddenEmptyNodes += 1;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    hideEmptySummaries(document);
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) hideEmptySummaries(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, { once: true });

  // Release watcher. This file is part of v91.38, so it must identify itself as
  // v91.38. Using nativeFetch here prevents later fetch shims from falsifying
  // the value returned by /version.json.
  const PAGE_RELEASE = '98.58';
  const RELEASE_DATE = '8 octobre 2026';
  const VERSION_PATH = '/version.json';
  const IS_NATIVE_ANDROID = /MonActualiteAndroid\//.test(navigator.userAgent) || location.pathname.startsWith('/assets/') || new URLSearchParams(location.search).get('nativePreview') === '1';
  const CHECK_COOLDOWN_MS = 45_000;
  let checking = false;
  let lastCheckedAt = 0;
  let reloadStarted = false;
  let uiScheduled = false;

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
    const response = await nativeFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`version HTTP ${response.status}`);
    const meta = await response.json();
    return String(meta?.codeRelease || '').trim();
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
    if (IS_NATIVE_ANDROID) {
      if (announce) showToast(`Version Android intégrée ${PAGE_RELEASE}`);
      return false;
    }
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
      if (!published || published === PAGE_RELEASE || Number(published) < Number(PAGE_RELEASE)) {
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
  window.__releaseWatch = { pageRelease: PAGE_RELEASE, checkRelease, patchVersionUi, nativeAndroid: IS_NATIVE_ANDROID };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-check-update]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    checkRelease({ force: true, announce: true });
  }, true);

  if (document.body) new MutationObserver(scheduleVersionUi).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scheduleVersionUi, { once: true });
  window.addEventListener('focus', () => { scheduleVersionUi(); checkRelease(); });
  window.addEventListener('online', () => checkRelease({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scheduleVersionUi(); checkRelease(); }
  });
  window.setInterval(() => checkRelease(), 5 * 60 * 1000);
  window.setTimeout(() => { scheduleVersionUi(); checkRelease({ force: true }); }, 1800);
})();
