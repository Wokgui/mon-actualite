(() => {
  'use strict';

  const RELEASE = '91.53';
  const CACHE_KEY = 'news-live-cache';
  const upstreamFetch = window.fetch.bind(window);
  let briefRetrying = false;
  let briefIntentUntil = 0;

  document.documentElement.dataset.uxGuardVersion = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9.]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function isLesEchos(article = {}) {
    const source = normalize(article.source || '');
    if (source === 'les echos' || source.startsWith('les echos ')) return true;
    try {
      const host = new URL(String(article.url || ''), location.href).hostname.toLowerCase().replace(/^www\./, '');
      return host === 'lesechos.fr' || host.endsWith('.lesechos.fr');
    } catch {
      return /\bles\s+echos\b/i.test(`${article.source || ''} ${article.url || ''}`);
    }
  }

  function filterHardPaywalls(payload) {
    if (!payload || !Array.isArray(payload.articles)) return { payload, removed: 0 };
    const before = payload.articles.length;
    const articles = payload.articles.filter(article => !isLesEchos(article));
    const removed = before - articles.length;
    if (!removed) return { payload, removed: 0 };
    return {
      removed,
      payload: {
        ...payload,
        articles,
        stats: {
          ...(payload.stats || {}),
          hardPaywallFilteredV9150: Number(payload.stats?.hardPaywallFilteredV9150 || 0) + removed
        }
      }
    };
  }

  function cloneJsonResponse(response, payload) {
    const headers = new Headers(response.headers || {});
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  function purgeCachedHardPaywalls() {
    try {
      const cached = readJson(CACHE_KEY, null);
      const filtered = filterHardPaywalls(cached);
      if (filtered.removed) localStorage.setItem(CACHE_KEY, JSON.stringify(filtered.payload));
    } catch {}
  }

  window.fetch = async function uxGuardFetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        const filtered = filterHardPaywalls(payload);
        if (filtered.removed) return cloneJsonResponse(response, filtered.payload);
      }
    } catch {}
    return response;
  };

  function polishText(root = document) {
    const nodes = [];
    if (root instanceof Element) nodes.push(root);
    root.querySelectorAll?.('div, p, span, strong, small, button').forEach(node => nodes.push(node));

    nodes.forEach(node => {
      const text = clean(node.textContent || '');
      if (!text) return;
      if (/^Résumé IA$/i.test(text) && node.children.length === 0) {
        node.remove();
        return;
      }
      if (/^Vérification\s*:/i.test(text) || /^Résumé\s+(?:IA\s+)?vérifié\b/i.test(text)) {
        if (node.classList.contains('verification-note-v83') || node.children.length === 0) node.remove();
        return;
      }
      if (/^Ne plus afficher un thème ou un mot[.!?:]?$/i.test(text)) {
        node.classList.add('center-topic-word-v9150');
      }
    });

    root.querySelectorAll?.('.verification-note-v83').forEach(node => node.remove());
    root.querySelectorAll?.('.watch-edit-button-v9138').forEach(node => node.remove());
  }

  function isBriefView() {
    return Boolean(document.querySelector('[data-stable-brief-content]'));
  }

  function decorateBrief() {
    const brief = isBriefView();
    document.body.classList.toggle('brief-view-v9150', brief);
    document.body.classList.toggle('brief-view-v9151', brief);
    document.body.classList.toggle('brief-view-v9152', brief);
    document.body.classList.toggle('brief-view-v9153', brief);
    if (!brief) return;

    document.querySelectorAll('.brief-integrated-watches-v9152').forEach(node => node.remove());
    document.querySelectorAll('.brief-major-v9152').forEach(node => node.classList.remove('brief-major-v9152'));
    document.querySelectorAll('.brief-day-v9138, .journal-section .brief-section-title').forEach(node => node.remove());

    const briefTab = document.querySelector('[data-brief-mode="essential"]');
    const watchTab = document.querySelector('[data-brief-mode="watches"]');
    if (briefTab) briefTab.textContent = 'Brief';
    if (watchTab) watchTab.textContent = 'Veille';
  }

  function decorateArticleTimes(root = document) {
    root.querySelectorAll?.('.quick-summary-meta').forEach(meta => {
      if (meta.children.length >= 2) meta.children[1]?.remove();
    });

    root.querySelectorAll?.('.detail-meta').forEach(meta => {
      if (meta.dataset.noRelativeTime === '1') return;
      const category = meta.querySelector('.category-link');
      if (!category) return;
      const source = clean((meta.textContent || '').split('·')[0]);
      meta.replaceChildren();
      if (source) meta.append(document.createTextNode(source));
      if (source) meta.append(document.createTextNode(' · '));
      meta.append(category);
      meta.dataset.noRelativeTime = '1';
    });
  }

  function decoratePersonalize() {
    const sheet = document.querySelector('.personalization-sheet');
    const active = Boolean(sheet);
    document.body.classList.toggle('personalize-page-v9151', active);
    document.body.classList.toggle('personalize-page-v9152', active);
    if (!sheet) return;

    sheet.closest('.sheet-backdrop')?.classList.add('personalize-tab-v9151', 'personalize-tab-v9152');
    sheet.querySelector('.sheet-handle')?.remove();

    const head = sheet.querySelector('.personalize-head');
    if (head) {
      head.classList.add('personalize-head-v9151', 'personalize-head-v9152');
      const eyebrow = [...head.querySelectorAll('span')].find(node => /^Votre sélection$/i.test(clean(node.textContent || '')));
      eyebrow?.remove();
    }

    const settings = sheet.querySelector('.personalize-settings');
    if (head && settings && settings.previousElementSibling !== head) {
      head.insertAdjacentElement('afterend', settings);
    }

    sheet.querySelectorAll('.personalize-section').forEach(section => {
      const title = clean(section.querySelector('h3')?.textContent || '');
      section.classList.toggle('personalize-brief-section-v9151', /^Brief\s*[·•-]\s*(?:Essentiel|Mes veilles)$/i.test(title));
      section.classList.toggle('personalize-home-section-v9152', /^Accueil$/i.test(title));
    });
  }

  function setBriefIntent(duration = 8000) {
    briefIntentUntil = Math.max(briefIntentUntil, Date.now() + duration);
  }

  function ensureBriefNavigation() {
    if (Date.now() > briefIntentUntil) return;
    if (isBriefView()) {
      decorateBrief();
      return;
    }
    const button = document.querySelector('.bottom-nav [data-view="brief"]');
    if (!button || briefRetrying) return;
    briefRetrying = true;
    try { button.click(); } finally {
      setTimeout(() => { briefRetrying = false; }, 55);
    }
  }

  function scheduleBriefRecovery() {
    [30, 90, 180, 320, 520, 800, 1200, 1800, 2600, 3600, 5000, 6500, 7800].forEach(delay => setTimeout(ensureBriefNavigation, delay));
  }

  document.addEventListener('pointerdown', event => {
    const navButton = event.target.closest?.('.bottom-nav [data-view]');
    if (!navButton || event.isTrusted === false) return;
    if (navButton.dataset.view === 'brief') {
      setBriefIntent();
      scheduleBriefRecovery();
    } else {
      briefIntentUntil = 0;
    }
  }, true);

  document.addEventListener('click', event => {
    const navButton = event.target.closest?.('.bottom-nav [data-view]');
    if (navButton && navButton.dataset.view !== 'brief' && Date.now() <= briefIntentUntil && !event.isTrusted) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const button = event.target.closest?.('.bottom-nav [data-view="brief"]');
    if (!button || briefRetrying) return;
    setBriefIntent();
    scheduleBriefRecovery();
  }, true);

  function scan(root = document) {
    polishText(root);
    decorateArticleTimes(root);
    decoratePersonalize();
    decorateBrief();
    if (Date.now() <= briefIntentUntil && !isBriefView()) ensureBriefNavigation();
  }

  function start() {
    purgeCachedHardPaywalls();
    scan(document);
    const observer = new MutationObserver(mutations => {
      let needsGlobal = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          needsGlobal = true;
          continue;
        }
        mutation.addedNodes?.forEach(node => {
          if (node instanceof Element) {
            polishText(node);
            decorateArticleTimes(node);
          }
        });
      }
      if (needsGlobal) polishText(document);
      decoratePersonalize();
      decorateBrief();
      if (Date.now() <= briefIntentUntil && !isBriefView()) ensureBriefNavigation();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();