(() => {
  'use strict';

  const RELEASE = '91.52';
  const CACHE_KEY = 'news-live-cache';
  const SETTINGS_KEY = 'news-settings';
  const FEEDBACK_KEY = 'news-feedback';
  const upstreamFetch = window.fetch.bind(window);
  let briefRetrying = false;
  let briefIntentUntil = 0;

  const WATCH_ALIASES = {
    'recherche scientifique': ['recherche', 'science', 'scientifique', 'laboratoire', 'etude', 'decouverte'],
    innovations: ['innovation', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
    innovation: ['innovation', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
    'progres humains': ['progres', 'avancee', 'decouverte', 'qualite de vie', 'education', 'droits humains'],
    medecine: ['medecine', 'medical', 'sante', 'traitement', 'therapie', 'vaccin', 'chirurgie'],
    espace: ['espace', 'spatial', 'astronomie', 'nasa', 'esa', 'satellite', 'lune', 'mars'],
    energie: ['energie', 'electricite', 'nucleaire', 'solaire', 'eolien', 'batterie', 'hydrogene'],
    environnement: ['environnement', 'climat', 'biodiversite', 'pollution', 'ecologie'],
    education: ['education', 'ecole', 'universite', 'apprentissage', 'formation'],
    vr: ['vr', 'realite virtuelle', 'virtual reality', 'quest', 'steamvr'],
    ia: ['ia', 'intelligence artificielle', 'openai', 'chatgpt', 'gemini', 'anthropic']
  };

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

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function dayKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function todayKey() {
    return dayKey(new Date());
  }

  function uniqueTopics(values = []) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(values) ? values : []) {
      const value = clean(raw);
      const key = normalize(value);
      if (!value || !key || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  function watchMatches(article = {}, topic = '') {
    const wanted = normalize(topic);
    if (!wanted) return false;
    if (normalize(article.category) === wanted) return true;
    const tags = Array.isArray(article.tags) ? article.tags : (typeof article.tags === 'string' ? [article.tags] : []);
    const matches = Array.isArray(article.matches) ? article.matches : (typeof article.matches === 'string' ? [article.matches] : []);
    const text = ` ${normalize([article.title, article.summary, article.detail, article.category, article.source, ...tags, ...matches].filter(Boolean).join(' '))} `;
    return uniqueTopics([wanted, ...(WATCH_ALIASES[wanted] || [])]).map(normalize).some(term => {
      if (!term) return false;
      return term.length <= 3 && !term.includes(' ') ? text.includes(` ${term} `) : text.includes(term);
    });
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
    const title = clean(document.querySelector('.page > .topbar h1')?.textContent || '');
    return title === 'Brief du jour';
  }

  function decorateBrief() {
    const brief = isBriefView();
    document.body.classList.toggle('brief-view-v9150', brief);
    document.body.classList.toggle('brief-view-v9151', brief);
    document.body.classList.toggle('brief-view-v9152', brief);
    if (!brief) return;

    const title = document.querySelector('.page > .topbar h1');
    if (title && clean(title.textContent || '') !== 'Brief du jour') title.textContent = 'Brief du jour';
    title?.removeAttribute('data-brief-date');
    document.querySelectorAll('.brief-day-v9138, .journal-section .brief-section-title').forEach(node => node.remove());
  }

  function enforceBriefState() {
    const brief = isBriefView();
    document.body.classList.toggle('brief-view-v9150', brief);
    document.body.classList.toggle('brief-view-v9151', brief);
    document.body.classList.toggle('brief-view-v9152', brief);
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

  function cleanArticleTitle(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '');
    if (!title || !source) return title;
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return title.replace(new RegExp(`\\s*(?:[-–—|·:]\\s*)${escaped}\\s*$`, 'i'), '').trim();
  }

  function visualUrl(article = {}) {
    const candidates = [article.visual?.url, article.image, article.quickVisualUrl, article.thumbnail, article.urlToImage];
    return clean(candidates.find(value => value && !/^data:image\/svg\+xml/i.test(String(value))) || '');
  }

  function watchRowMarkup(article = {}) {
    const title = cleanArticleTitle(article);
    const visual = visualUrl(article);
    const picture = visual
      ? `<img class="article-image" src="${escapeHtml(visual)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<div class="article-image article-placeholder brief-watch-placeholder-v9152"><span>${escapeHtml(article.category || 'Veille')}</span></div>`;
    return `<article class="article-card runtime-row brief-watch-row-v9152" data-article="${escapeHtml(article.id)}" tabindex="0" aria-label="Lire : ${escapeHtml(title)}">${picture}<div class="article-body"><h2>${escapeHtml(title)}</h2></div></article>`;
  }

  function sectionDayKey(section, articleMap) {
    if (section.classList.contains('journal-section')) return todayKey();
    const firstCard = section.querySelector('.feed .article-card[data-article]');
    const article = firstCard ? articleMap.get(String(firstCard.dataset.article || '')) : null;
    return dayKey(article?.publishedAt);
  }

  function integrateWatchesIntoBrief() {
    if (!isBriefView()) return;
    const cached = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cached?.articles) ? cached.articles : [];
    if (!articles.length) return;

    const settings = readJson(SETTINGS_KEY, {});
    const topics = uniqueTopics(settings?.briefWatchTopics || []);
    if (!topics.length) return;
    const feedback = readJson(FEEDBACK_KEY, {});
    const articleMap = new Map(articles.map(article => [String(article.id), article]));

    document.querySelectorAll('.journal-section, .brief-history-day-v9138').forEach(section => {
      if (section.dataset.watchIntegratedV9152 === '1') return;
      const mainFeed = section.querySelector(':scope > .feed');
      if (!mainFeed) return;

      mainFeed.querySelectorAll('.article-card.runtime-row').forEach(card => card.classList.add('brief-major-v9152'));
      const dateKey = sectionDayKey(section, articleMap);
      if (!dateKey) {
        section.dataset.watchIntegratedV9152 = '1';
        return;
      }

      const used = new Set([...mainFeed.querySelectorAll('.article-card[data-article]')].map(card => String(card.dataset.article || '')));
      const watched = articles
        .filter(article => dayKey(article.publishedAt) === dateKey)
        .filter(article => feedback?.[article.id] !== 'not')
        .filter(article => !used.has(String(article.id)))
        .filter(article => topics.some(topic => watchMatches(article, topic)))
        .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
        .slice(0, 30);

      if (watched.length) {
        const wrapper = document.createElement('section');
        wrapper.className = 'brief-integrated-watches-v9152';
        wrapper.innerHTML = `<div class="brief-watch-separator-v9152"><span>Veille</span></div><div class="feed stable-owned-list brief-watch-feed-v9152">${watched.map(watchRowMarkup).join('')}</div>`;
        mainFeed.insertAdjacentElement('afterend', wrapper);
      }
      section.dataset.watchIntegratedV9152 = '1';
    });
  }

  function setBriefIntent(duration = 8000) {
    briefIntentUntil = Math.max(briefIntentUntil, Date.now() + duration);
  }

  function ensureBriefNavigation() {
    if (Date.now() > briefIntentUntil) return;
    if (isBriefView()) {
      enforceBriefState();
      decorateBrief();
      integrateWatchesIntoBrief();
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
    enforceBriefState();
    integrateWatchesIntoBrief();
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
      integrateWatchesIntoBrief();
      if (Date.now() <= briefIntentUntil && !isBriefView()) ensureBriefNavigation();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();