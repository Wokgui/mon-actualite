(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const BRIEF_SNAPSHOT_KEY = 'news-brief-snapshot-v80';
  const app = document.getElementById('app');
  if (!app) return;

  const upstreamFetch = window.fetch.bind(window);
  const nativeStorageSet = Storage.prototype.setItem;
  const previousInner = Object.getOwnPropertyDescriptor(app, 'innerHTML')
    || Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');

  let forceRefreshUntil = 0;
  let suppressNextRender = false;
  let holdCacheWrite = false;
  let heldCacheValue = '';
  let pendingPayload = null;
  let pendingCount = 0;
  let deliverPayload = null;
  let applyingPending = false;
  let briefBaseline = null;
  let briefShowingFull = false;
  let briefWasOpen = false;
  let decorateQueued = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { nativeStorageSet.call(localStorage, key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function currentView() {
    return document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function responseFromPayload(payload, sourceResponse = null) {
    const headers = new Headers(sourceResponse?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: sourceResponse?.ok ? sourceResponse.status : 200,
      statusText: sourceResponse?.statusText || 'OK',
      headers
    });
  }

  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function articleKey(article = {}) {
    return clean(article.eventKeyV78 || '')
      || canonicalUrl(article.url || '')
      || String(article.id || '')
      || normalize(article.title || '');
  }

  function articleMap(payload = {}) {
    return new Map((Array.isArray(payload.articles) ? payload.articles : []).map(article => [articleKey(article), article]));
  }

  function publishedAt(article = {}) {
    const parsed = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sameInformation(newArticle = {}, oldArticle = {}) {
    if (!oldArticle) return false;
    const oldIds = new Set([oldArticle.id, ...(Array.isArray(oldArticle.mergedArticleIdsV79) ? oldArticle.mergedArticleIdsV79 : [])].map(value => String(value || '')).filter(Boolean));
    const newIds = [newArticle.id, ...(Array.isArray(newArticle.mergedArticleIdsV79) ? newArticle.mergedArticleIdsV79 : [])].map(value => String(value || '')).filter(Boolean);
    if (newIds.some(id => oldIds.has(id))) {
      const newer = publishedAt(newArticle) - publishedAt(oldArticle) > 120000;
      const titleChanged = normalize(newArticle.title || '') !== normalize(oldArticle.title || '');
      const development = ['development','minor-update'].includes(newArticle.noveltyStateV78 || '');
      return !(newer && titleChanged && development);
    }
    const sameEvent = clean(newArticle.eventKeyV78 || '') && clean(newArticle.eventKeyV78 || '') === clean(oldArticle.eventKeyV78 || '');
    if (sameEvent) {
      const changed = normalize(newArticle.title || '') !== normalize(oldArticle.title || '')
        && ['development','minor-update'].includes(newArticle.noveltyStateV78 || '');
      return !changed;
    }
    return false;
  }

  function countNewInformation(nextPayload, oldPayload) {
    const oldArticles = Array.isArray(oldPayload?.articles) ? oldPayload.articles : [];
    if (!oldArticles.length) return 0;
    const oldByKey = articleMap(oldPayload);
    let count = 0;
    for (const article of Array.isArray(nextPayload?.articles) ? nextPayload.articles : []) {
      const direct = oldByKey.get(articleKey(article));
      if (direct && sameInformation(article, direct)) continue;
      const related = oldArticles.find(old => sameInformation(article, old));
      if (!related) count += 1;
    }
    return count;
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55
      && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
  }

  function fullArticleFor(requestArticle = {}) {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const url = canonicalUrl(requestArticle.url || '');
    const title = normalize(requestArticle.title || '');
    return articles.find(article => url && canonicalUrl(article.url || '') === url)
      || articles.find(article => title && normalize(article.title || '') === title)
      || requestArticle;
  }

  function sourceCount(article = {}) {
    return new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(normalize).filter(Boolean)).size;
  }

  async function validSummaryResponse(responsePromise, type) {
    const response = await responsePromise;
    if (!response?.ok) throw new Error(`${type} unavailable`);
    const data = await response.clone().json().catch(() => null);
    const summary = clean(data?.summary || data?.text || '');
    if (data?.unavailable || !usefulSummary(summary)) throw new Error(`${type} invalid`);
    return { response, data, summary, type };
  }

  function timeoutReject(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  }

  function markMultiSource(data = {}) {
    const count = Number(data.sourceCount || (Array.isArray(data.sources) ? data.sources.length : 0) || 2);
    requestAnimationFrame(() => {
      const modal = document.querySelector('.quick-summary-backdrop');
      const meta = modal?.querySelector('.quick-summary-meta');
      if (!modal || !meta) return;
      let note = modal.querySelector('.multi-source-note-v80');
      if (!note) {
        note = document.createElement('div');
        note.className = 'multi-source-note-v80';
        meta.insertAdjacentElement('afterend', note);
      }
      note.textContent = `Synthèse croisée · ${count} sources`;
    });
  }

  function pendingBanner() {
    if (!pendingPayload || pendingCount < 1 || currentView() !== 'home') return;
    let button = document.querySelector('.new-info-banner-v80');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'new-info-banner-v80';
      button.setAttribute('data-apply-news-v80', '');
      document.body.appendChild(button);
    }
    button.innerHTML = `<strong>${pendingCount} nouvelle${pendingCount > 1 ? 's' : ''} information${pendingCount > 1 ? 's' : ''}</strong><span>Afficher maintenant</span>`;
  }

  function removePendingBanner() {
    document.querySelector('.new-info-banner-v80')?.remove();
  }

  function commitHeldCache() {
    if (!heldCacheValue) return;
    try { nativeStorageSet.call(localStorage, CACHE_KEY, heldCacheValue); } catch {}
    heldCacheValue = '';
    holdCacheWrite = false;
  }

  function applyPendingNews() {
    if (!pendingPayload) return;
    const scrollTop = Math.max(0, Math.round(window.scrollY));
    const payload = pendingPayload;
    commitHeldCache();
    deliverPayload = payload;
    pendingPayload = null;
    pendingCount = 0;
    suppressNextRender = false;
    applyingPending = true;
    removePendingBanner();
    forceRefreshUntil = Date.now() + 5000;
    if (window.__applyNewsPayloadV9128?.(payload)) {
      deliverPayload = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: scrollTop, behavior: 'instant' });
        applyingPending = false;
      }));
      return;
    }
    const refresh = document.querySelector('[data-refresh]');
    if (refresh) refresh.click();
    else window.location.reload();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: scrollTop, behavior: 'instant' });
      applyingPending = false;
    }));
  }

  Storage.prototype.setItem = function v80SetItem(key, value) {
    if (this === localStorage && String(key) === CACHE_KEY && holdCacheWrite) {
      heldCacheValue = String(value);
      return;
    }
    return nativeStorageSet.call(this, key, value);
  };

  if (previousInner?.get && previousInner?.set) {
    try {
      Object.defineProperty(app, 'innerHTML', {
        configurable: true,
        enumerable: false,
        get() { return previousInner.get.call(this); },
        set(value) {
          if (suppressNextRender) {
            suppressNextRender = false;
            holdCacheWrite = false;
            requestAnimationFrame(() => { pendingBanner(); scheduleDecorate(); });
            return;
          }
          previousInner.set.call(this, value);
          requestAnimationFrame(scheduleDecorate);
        }
      });
    } catch {}
  }

  function briefArticleMap() {
    const cache = readJson(CACHE_KEY, {});
    return new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
  }

  function briefEntry(article = {}, id = '') {
    const event = clean(article.eventKeyV78 || '');
    const merged = Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79.map(String).sort() : [];
    const key = event || merged[0] || String(id || article.id || '') || normalize(article.title || '');
    return {
      key,
      title: normalize(article.title || ''),
      novelty: clean(article.noveltyStateV78 || article.noveltyState || '')
    };
  }

  function briefChanged(entry, previous) {
    if (!previous) return true;
    if (entry.title === previous.title && entry.novelty === previous.novelty) return false;
    if (['development','minor-update'].includes(entry.novelty) && entry.title !== previous.title) return true;
    return entry.key !== previous.key;
  }

  function decorateBrief() {
    const page = document.querySelector('.page');
    const list = page?.querySelector('.brief-points');
    if (!list || currentView() !== 'brief') {
      if (briefWasOpen && currentView() !== 'brief') {
        briefWasOpen = false;
        briefBaseline = null;
        briefShowingFull = false;
      }
      return;
    }

    const points = [...list.querySelectorAll(':scope > .brief-point[data-article]')];
    if (!points.length) return;
    const map = briefArticleMap();
    const current = points.map(point => {
      const article = map.get(String(point.dataset.article || '')) || {};
      return { point, entry: briefEntry(article, point.dataset.article || '') };
    });

    if (!briefWasOpen || !briefBaseline) {
      briefWasOpen = true;
      briefShowingFull = false;
      briefBaseline = readJson(BRIEF_SNAPSHOT_KEY, []);
      writeJson(BRIEF_SNAPSHOT_KEY, current.map(item => item.entry));
    }

    const previousMap = new Map((Array.isArray(briefBaseline) ? briefBaseline : []).map(entry => [entry.key, entry]));
    const firstBrief = previousMap.size === 0;
    const changed = current.filter(item => firstBrief || briefChanged(item.entry, previousMap.get(item.entry.key)));

    points.forEach(point => {
      point.hidden = !briefShowingFull && !firstBrief && !changed.some(item => item.point === point);
    });

    let status = page.querySelector('.brief-diff-v80');
    if (!status) {
      status = document.createElement('section');
      status.className = 'brief-diff-v80';
      list.insertAdjacentElement('beforebegin', status);
    }

    const dateTitle = page.querySelector('.date-card h2');
    if (dateTitle && !dateTitle.dataset.v80Original) dateTitle.dataset.v80Original = dateTitle.textContent || 'Les événements majeurs France & Monde';

    if (firstBrief) {
      status.innerHTML = '<div><strong>Premier Brief différentiel</strong><small>Ce Brief servira de référence pour la prochaine consultation.</small></div>';
      if (dateTitle) dateTitle.textContent = dateTitle.dataset.v80Original;
      return;
    }

    if (briefShowingFull) {
      status.innerHTML = `<div><strong>Brief complet</strong><small>${points.length} événement${points.length > 1 ? 's' : ''} majeur${points.length > 1 ? 's' : ''} actuellement retenu${points.length > 1 ? 's' : ''}.</small></div><button type="button" data-brief-diff-toggle-v80>Revenir aux changements</button>`;
      if (dateTitle) dateTitle.textContent = dateTitle.dataset.v80Original;
      return;
    }

    if (!changed.length) {
      status.innerHTML = '<div><strong>Aucun nouvel événement majeur</strong><small>Le top du Brief n’a pas changé depuis votre dernière consultation.</small></div><button type="button" data-brief-diff-toggle-v80>Voir le Brief complet</button>';
      if (dateTitle) dateTitle.textContent = 'Rien de majeur à ajouter depuis le dernier Brief';
      return;
    }

    status.innerHTML = `<div><strong>Depuis votre dernier Brief</strong><small>${changed.length} changement${changed.length > 1 ? 's' : ''} majeur${changed.length > 1 ? 's' : ''} à retenir.</small></div><button type="button" data-brief-diff-toggle-v80>Voir le Brief complet</button>`;
    if (dateTitle) dateTitle.textContent = `${changed.length} changement${changed.length > 1 ? 's' : ''} majeur${changed.length > 1 ? 's' : ''} depuis le dernier Brief`;
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      pendingBanner();
      decorateBrief();
    });
  }

  window.fetch = async function experienceV80Fetch(input, init) {
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch {
      return upstreamFetch(input, init);
    }

    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

    if (url.origin === location.origin && url.pathname === '/api/news') {
      if (deliverPayload) {
        const payload = deliverPayload;
        deliverPayload = null;
        return responseFromPayload(payload);
      }

      const oldCache = readJson(CACHE_KEY, {});
      const response = await upstreamFetch(input, init);
      if (!response?.ok) return response;
      const forced = Date.now() < forceRefreshUntil;
      if (forced || currentView() !== 'home' || !(Array.isArray(oldCache.articles) && oldCache.articles.length)) return response;

      const nextPayload = await response.clone().json().catch(() => null);
      if (!nextPayload || !Array.isArray(nextPayload.articles)) return response;
      const newCount = countNewInformation(nextPayload, oldCache);
      suppressNextRender = true;
      if (newCount > 0) {
        pendingPayload = nextPayload;
        pendingCount = newCount;
        holdCacheWrite = true;
      }
      return response;
    }

    if (url.origin === location.origin && url.pathname === '/api/article-summary-groq' && method === 'POST') {
      const body = parseBody(init);
      const requestArticle = body?.article && typeof body.article === 'object' ? body.article : null;
      const full = requestArticle ? fullArticleFor(requestArticle) : null;
      const count = full ? Math.max(sourceCount(full), Number(full.mergedCount || 0), Number(full.duplicateCountV79 || 0)) : 0;
      if (full && count >= 2) {
        const enriched = {
          ...body,
          article: {
            ...requestArticle,
            sources: [...new Set([full.source, ...(Array.isArray(full.sources) ? full.sources : [])].map(clean).filter(Boolean))],
            mergedCount: Math.max(Number(full.mergedCount || 0), Number(full.duplicateCountV79 || 0), count)
          }
        };
        const multiRaw = upstreamFetch('/api/article-summary-multisource?v=80', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(enriched)
        });
        const groqRaw = upstreamFetch(input, init);
        const multiCandidate = validSummaryResponse(multiRaw, 'multi');
        const groqCandidate = validSummaryResponse(groqRaw, 'groq');

        try {
          const preferred = await Promise.race([multiCandidate, timeoutReject(1600)]);
          markMultiSource(preferred.data);
          return preferred.response;
        } catch {}

        try {
          const winner = await Promise.any([multiCandidate, groqCandidate]);
          if (winner.type === 'multi') markMultiSource(winner.data);
          return winner.response;
        } catch {
          return groqRaw;
        }
      }
    }

    return upstreamFetch(input, init);
  };

  document.addEventListener('click', event => {
    const apply = event.target.closest?.('[data-apply-news-v80]');
    if (apply) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyPendingNews();
      return;
    }

    const briefToggle = event.target.closest?.('[data-brief-diff-toggle-v80]');
    if (briefToggle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      briefShowingFull = !briefShowingFull;
      decorateBrief();
      return;
    }

    const refresh = event.target.closest?.('[data-refresh]');
    if (refresh) {
      forceRefreshUntil = Date.now() + 5000;
      if (pendingPayload && !applyingPending) {
        const payload = pendingPayload;
        commitHeldCache();
        deliverPayload = payload;
        pendingPayload = null;
        pendingCount = 0;
        suppressNextRender = false;
        removePendingBanner();
      }
      return;
    }

    const interactiveSync = event.target.closest?.('[data-source-toggle], [data-source-delete], [data-add-source], [data-add-keyword], [data-setting-toggle], [data-interest]');
    if (interactiveSync) forceRefreshUntil = Date.now() + 5000;

    const nav = event.target.closest?.('.bottom-nav [data-view]');
    if (nav && nav.dataset.view !== 'home' && pendingPayload) {
      commitHeldCache();
      pendingPayload = null;
      pendingCount = 0;
      removePendingBanner();
    }
    if (nav && nav.dataset.view !== 'brief' && currentView() === 'brief') {
      briefWasOpen = false;
      briefBaseline = null;
      briefShowingFull = false;
    }
  }, true);

  document.addEventListener('change', event => {
    if (event.target?.id === 'opml-input') forceRefreshUntil = Date.now() + 5000;
  }, true);

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(app, { childList: true, subtree: true });
  window.addEventListener('focus', scheduleDecorate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleDecorate(); });
  scheduleDecorate();
})();
