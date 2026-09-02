(() => {
  'use strict';

  const RELEASE = '91.51';
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
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
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
    return clean(document.querySelector('.page > .topbar h1')?.textContent || '') === 'Brief du jour';
  }

  function todayLabel() {
    const raw = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  }

  function decorateBrief() {
    const brief = isBriefView();
    document.body.classList.toggle('brief-view-v9150', brief);
    document.body.classList.toggle('brief-view-v9151', brief);
    if (!brief) return;

    const title = document.querySelector('.page > .topbar h1');
    if (title) title.dataset.briefDate = todayLabel();
    document.querySelectorAll('.brief-day-v9138, .journal-section .brief-section-title').forEach(node => node.remove());
  }

  function enforceBriefState() {
    const brief = isBriefView();
    document.body.classList.toggle('brief-view-v9150', brief);
    document.body.classList.toggle('brief-view-v9151', brief);
    if (!brief) return;

    const watches = document.querySelector('[data-brief-mode="watches"].active');
    const essential = document.querySelector('[data-brief-mode="essential"]');
    if (watches && essential) {
      essential.click();
      return;
    }

    document.querySelectorAll('.watch-edit-button-v9138').forEach(node => node.remove());
    decorateBrief();
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
    if (!sheet) return;

    sheet.closest('.sheet-backdrop')?.classList.add('personalize-tab-v9151');
    sheet.querySelector('.sheet-handle')?.remove();

    const head = sheet.querySelector('.personalize-head');
    if (head) {
      head.classList.add('personalize-head-v9151');
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
    });
  }

  function ensureBriefNavigation() {
    if (Date.now() > briefIntentUntil) return;
    if (isBriefView()) {
      enforceBriefState();
      decorateBrief();
      return;
    }
    const button = document.querySelector('.bottom-nav [data-view="brief"]');
    if (!button || briefRetrying) return;
    briefRetrying = true;
    try { button.click(); } finally {
      setTimeout(() => { briefRetrying = false; }, 45);
    }
  }

  document.addEventListener('click', event => {
    const navButton = event.target.closest?.('.bottom-nav [data-view]');
    if (navButton && navButton.dataset.view !== 'brief') {
      briefIntentUntil = 0;
      return;
    }

    const button = event.target.closest?.('.bottom-nav [data-view="brief"]');
    if (!button || briefRetrying) return;
    briefIntentUntil = Date.now() + 3500;
    [40, 120, 260, 520, 900, 1500, 2400, 3300].forEach(delay => setTimeout(ensureBriefNavigation, delay));
  }, true);

  function scan(root = document) {
    polishText(root);
    decorateArticleTimes(root);
    decoratePersonalize();
    enforceBriefState();
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
      enforceBriefState();
      if (Date.now() <= briefIntentUntil && !isBriefView()) ensureBriefNavigation();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();