(() => {
  'use strict';

  const RELEASE = '91.60';
  const BLOCKED_KEY = 'news-blocked-terms-v1';
  const PHOTO_WARMED = new Set();
  let scheduled = false;

  document.documentElement.dataset.uxPolishV9160 = RELEASE;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function settingsPage() {
    return [...document.querySelectorAll('#app main.page, #app .page')]
      .find(page => !page.closest('.personalization-sheet') && page.querySelector('[data-check-update], .app-version-section, [data-reset]')) || null;
  }

  function removeMovedOrObsoleteSettings(page) {
    if (!page) return;
    document.body.classList.add('advanced-settings-v9158');
    page.classList.add('advanced-settings-page-v9158');
    page.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());
    const removeTitle = title => /^Contrôle qualité$/i.test(title)
      || /^Notifications?$/i.test(title)
      || /^Sources personnelles$/i.test(title)
      || /^Actualité générale$/i.test(title)
      || /^Centres d['’]intérêt$/i.test(title)
      || /^Ne plus afficher(?: un thème ou un mot)?$/i.test(title);
    [...page.querySelectorAll('.settings-section')].forEach(section => {
      const title = clean(section.querySelector('h2')?.textContent || '');
      if (removeTitle(title)) section.remove();
      else section.classList.add('settings-flat-v9158');
    });
  }

  function wrapExistingGrid(body, selector, title, note) {
    const button = body?.querySelector(selector);
    const grid = button?.closest('.personalize-chips, .interest-grid');
    if (!body || !grid || grid.closest('.personalize-inline-section-v9158')) return;
    const section = document.createElement('section');
    section.className = 'personalize-inline-section-v9158';
    const heading = document.createElement('h4');
    heading.textContent = title;
    section.appendChild(heading);
    if (note) {
      const paragraph = document.createElement('p');
      paragraph.textContent = note;
      section.appendChild(paragraph);
    }
    grid.parentNode?.insertBefore(section, grid);
    section.appendChild(grid);
  }

  function sourceRowsMarkup() {
    const sources = readJson('news-sources', []);
    if (!Array.isArray(sources) || !sources.length) return '<p class="muted-note personalize-source-empty-v9158">Aucune source personnelle ajoutée.</p>';
    return `<div class="source-settings-list personalize-source-list-v9158">${sources.map((source, index) => `
      <div class="source-setting">
        <button class="source-state ${source?.enabled !== false ? 'active' : ''}" data-source-toggle="${index}" aria-label="Activer ou désactiver la source"></button>
        <div><strong>${esc(source?.title || 'Source')}</strong><span>${esc(source?.url || '')}</span></div>
        <button class="mini-icon-btn" data-source-delete="${index}" aria-label="Supprimer">×</button>
      </div>`).join('')}</div>`;
  }

  function settingSwitchMarkup(title, description, key, enabled) {
    return `<div class="setting-row personalize-setting-row-v9158"><div class="setting-label"><strong>${esc(title)}</strong><span>${esc(description)}</span></div><button class="switch ${enabled ? 'on' : ''}" data-setting-toggle="${esc(key)}" role="switch" aria-checked="${enabled ? 'true' : 'false'}"></button></div>`;
  }

  function ensureSourcesSection(body) {
    if (!body || body.querySelector('[data-personalize-sources-v9158]')) return;
    const settings = readJson('news-settings', {});
    const section = document.createElement('section');
    section.className = 'personalize-inline-section-v9158 personalize-sources-v9158';
    section.dataset.personalizeSourcesV9158 = '1';
    section.innerHTML = `
      <h4>Sources personnelles</h4>
      <p>Ajoutez ici les flux qui servent de sources de découverte pour vos sujets prioritaires.</p>
      <div class="form-stack personalize-source-form-v9158">
        <input id="source-name" class="text-input" type="text" maxlength="80" placeholder="Nom de la source">
        <input id="source-url" class="text-input" type="url" maxlength="600" placeholder="https://exemple.fr/feed">
        <button class="secondary-btn" data-add-source>Ajouter la source</button>
      </div>
      ${sourceRowsMarkup()}
      <div class="personalize-opml-v9158"><label class="secondary-btn" for="opml-input">Importer un fichier OPML</label><input id="opml-input" class="file-input" type="file" accept=".opml,.xml"></div>
      ${settingSwitchMarkup('Recherche web complémentaire', 'Compléter les sujets suivis avec Google Actualités', 'webSearch', settings?.webSearch !== false)}
    `;
    body.appendChild(section);
  }

  function blockedTerms() {
    const list = readJson(BLOCKED_KEY, []);
    return Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
  }

  function blockedListMarkup() {
    const list = blockedTerms();
    if (!list.length) return '<p class="muted-note personalize-block-empty-v9158">Aucun thème ou mot exclu.</p>';
    return `<div class="personalize-block-list-v9158">${list.map((term, index) => `<span>${esc(term)}<button type="button" data-block-remove-v9158="${index}" aria-label="Retirer ${esc(term)}">×</button></span>`).join('')}</div>`;
  }

  function ensureBlockedSection(body) {
    if (!body || body.querySelector('[data-personalize-blocked-v9158]')) return;
    const section = document.createElement('section');
    section.className = 'personalize-inline-section-v9158 personalize-blocked-v9158';
    section.dataset.personalizeBlockedV9158 = '1';
    section.innerHTML = `
      <h4>Ne plus afficher</h4>
      <p>Masquez un thème ou un mot dans Mon actualité, le Brief et la Veille.</p>
      <div class="inline-form personalize-block-form-v9158"><input class="text-input" data-block-input-v9158 maxlength="70" placeholder="Thème ou mot à exclure"><button type="button" class="small-primary-btn" data-block-add-v9158>Ajouter</button></div>
      <div data-block-list-v9158>${blockedListMarkup()}</div>`;
    body.appendChild(section);
  }

  function renameHomeAccordion(sheet) {
    const home = sheet?.querySelector('[data-accordion-key-v9157="home"]');
    const head = home?.querySelector('.personalize-accordion-head-v9157');
    const title = head?.querySelector('h3');
    const subtitle = head?.querySelector('p');
    if (title) title.textContent = 'Actualité générale';
    subtitle?.remove();
  }

  function flattenHomeCategories(sheet) {
    const body = sheet?.querySelector('[data-accordion-key-v9157="home"] .personalize-accordion-body-v9157');
    if (!body) return;
    body.querySelectorAll('.personalize-inline-section-v9158').forEach(section => {
      const title = clean(section.querySelector(':scope > h4')?.textContent || '');
      if (/^(Actualité générale|Centres d’intérêt)$/i.test(title)) {
        section.classList.add('personalize-chip-group-v9159');
        section.querySelector(':scope > h4')?.remove();
        section.querySelector(':scope > p')?.remove();
      }
    });
  }

  function watchTopics() {
    const settings = readJson('news-settings', {});
    return Array.isArray(settings?.briefWatchTopics) ? [...new Set(settings.briefWatchTopics.map(clean).filter(Boolean))] : [];
  }

  function ensureWatchList(sheet) {
    const body = sheet?.querySelector('[data-accordion-key-v9157="watches"] .personalize-accordion-body-v9157');
    if (!body) return;
    let section = body.querySelector('[data-added-watches-v9159]');
    if (!section) {
      section = document.createElement('section');
      section.dataset.addedWatchesV9159 = '1';
      section.className = 'added-watches-v9159';
      body.appendChild(section);
    }
    const topics = watchTopics();
    section.innerHTML = `<h4>Veilles ajoutées</h4>${topics.length ? `<div class="added-watches-list-v9159">${topics.map(topic => `<button type="button" data-brief-watch="${esc(topic)}" aria-label="Retirer ${esc(topic)}"><span>${esc(topic)}</span><b aria-hidden="true">×</b></button>`).join('')}</div>` : '<p>Aucune veille ajoutée.</p>'}`;
  }

  function switchMarkup(title, description, key, enabled) {
    return `<div class="setting-row"><div class="setting-label"><strong>${esc(title)}</strong><span>${esc(description)}</span></div><button class="switch ${enabled ? 'on' : ''}" data-setting-toggle="${esc(key)}" role="switch" aria-checked="${enabled ? 'true' : 'false'}"></button></div>`;
  }

  function embeddedAdvancedMarkup() {
    const settings = readJson('news-settings', {});
    const summaryLength = clean(settings?.summaryLength || 'court');
    const installed = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    const version = clean(document.documentElement.dataset.appVersion || '');
    return `<div class="page personalize-advanced-page-v9159" data-personalize-advanced-page-v9159>
      <section class="settings-section install-section"><div class="install-copy"><h2>${installed ? 'Application installée' : 'Installer l’application'}</h2><p>${installed ? 'Mon actualité fonctionne comme une application autonome sur cet appareil.' : 'Ajoutez Mon actualité à Android pour l’ouvrir sans la barre du navigateur.'}</p></div><button class="${installed ? 'secondary-btn' : 'primary-btn'}" data-install ${installed ? 'disabled' : ''}>${installed ? 'Déjà installée' : 'Installer sur cet appareil'}</button></section>
      <section class="settings-section"><h2>Actualisation</h2><p>Les nouveaux articles sont chargés au démarrage, au retour dans l’application et périodiquement lorsqu’elle reste ouverte.</p>${switchMarkup('Actualisation automatique', 'Toutes les 15 minutes quand l’application est ouverte', 'autoRefresh', settings?.autoRefresh !== false)}<button class="secondary-btn compact-btn" data-refresh>Actualiser maintenant</button></section>
      <section class="settings-section"><h2>Sélection et résumés</h2><div class="setting-row"><div class="setting-label"><strong>Longueur des résumés</strong><span>Format affiché dans les cartes</span></div><select class="select" data-setting-select="summaryLength"><option value="très court" ${summaryLength === 'très court' ? 'selected' : ''}>Très court</option><option value="court" ${summaryLength === 'court' ? 'selected' : ''}>Court</option><option value="détaillé" ${summaryLength === 'détaillé' ? 'selected' : ''}>Détaillé</option></select></div></section>
      <section class="settings-section app-version-section"><h2>Version de l’application</h2><p>Ce numéro permet de vérifier que l’appareil utilise bien la dernière publication.</p><div class="app-version-row"><div><strong>Mon actualité${version ? ` · version ${esc(version)}` : ''}</strong></div></div><button class="secondary-btn compact-btn" data-check-update>Vérifier et mettre à jour</button></section>
      <button class="secondary-btn reset-preferences-v9159" data-reset>Réinitialiser les préférences</button>
    </div>`;
  }

  function ensureAdvancedContent(sheet) {
    const body = sheet?.querySelector('[data-accordion-key-v9157="settings"] .personalize-accordion-body-v9157');
    if (!body) return;
    body.querySelector('.personalize-settings-launch-v9157, [data-open-settings]')?.remove();
    if (!body.querySelector('[data-personalize-advanced-page-v9159]')) body.insertAdjacentHTML('beforeend', embeddedAdvancedMarkup());
    body.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());
    const advanced = body.querySelector('[data-personalize-advanced-page-v9159]');
    const maintenance = advanced?.querySelector('.maintenance-v84');
    if (advanced && maintenance && advanced.firstElementChild !== maintenance) advanced.prepend(maintenance);
  }

  function moveBlockedFooter(sheet) {
    if (!sheet) return;
    const homeBody = sheet.querySelector('[data-accordion-key-v9157="home"] .personalize-accordion-body-v9157');
    const blocked = sheet.querySelector('.personalize-blocked-v9158');
    if (blocked && blocked.closest('.personalize-accordion-v9157')) {
      if (homeBody && !homeBody.querySelector('[data-blocked-marker-v9159]')) {
        const marker = document.createElement('span');
        marker.hidden = true;
        marker.dataset.blockedMarkerV9159 = '1';
        marker.dataset.personalizeBlockedV9158 = '1';
        homeBody.appendChild(marker);
      }
      blocked.classList.add('personalize-blocked-footer-v9159');
      sheet.appendChild(blocked);
    }
  }

  function decoratePersonalize() {
    const sheet = document.querySelector('#app .personalization-sheet');
    if (!sheet) return;
    const homeBody = sheet.querySelector('[data-accordion-key-v9157="home"] .personalize-accordion-body-v9157');
    if (homeBody) {
      wrapExistingGrid(homeBody, '[data-general-category]', 'Actualité générale', 'Rubriques qui restent présentes dans votre sélection.');
      wrapExistingGrid(homeBody, '[data-interest]', 'Centres d’intérêt', 'Sujets à faire remonter davantage dans Mon actualité.');
      ensureSourcesSection(homeBody);
      ensureBlockedSection(homeBody);
    }
    renameHomeAccordion(sheet);
    flattenHomeCategories(sheet);
    ensureWatchList(sheet);
    ensureAdvancedContent(sheet);
    moveBlockedFooter(sheet);
  }

  function refreshBlockedList() {
    const host = document.querySelector('[data-block-list-v9158]');
    if (host) host.innerHTML = blockedListMarkup();
  }

  function addBlockedTerm() {
    const input = document.querySelector('[data-block-input-v9158]');
    const value = clean(input?.value || '');
    if (!value) return;
    const list = blockedTerms();
    const wanted = normalize(value);
    if (!list.some(item => normalize(item) === wanted)) list.push(value);
    writeJson(BLOCKED_KEY, list.slice(-80));
    if (input) input.value = '';
    refreshBlockedList();
  }

  function removeBlockedTerm(index) {
    const list = blockedTerms();
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    writeJson(BLOCKED_KEY, list);
    refreshBlockedList();
  }

  function currentArticleView() {
    if (document.querySelector('#app [data-stable-home-feed]')) return 'home';
    if (document.querySelector('#app [data-stable-brief-content]')) return document.querySelector('#app [data-brief-mode="watches"].active') ? 'watches' : 'brief';
    return '';
  }

  function gearSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>';
  }

  function decorateBottomControls() {
    const nav = document.querySelector('#app .bottom-nav');
    if (!nav) return;
    const inPersonalize = Boolean(document.querySelector('.personalization-sheet'));
    const view = currentArticleView();
    const shouldReset = Boolean(view && !inPersonalize);
    const center = nav.querySelector('.nav-item.plus:not(.nav-gear-v9160), .reset-nav-v9160');
    if (!center) return;
    if (!center.dataset.originalHtmlV9160) center.dataset.originalHtmlV9160 = center.innerHTML;

    if (shouldReset) {
      center.classList.add('reset-nav-v9160', 'plus');
      center.removeAttribute('data-view');
      center.setAttribute('data-reset-read', '');
      center.setAttribute('aria-label', 'Réinitialiser les articles parcourus');
      if (!center.querySelector('.reset-nav-glyph-v9160')) center.innerHTML = '<span class="reset-nav-glyph-v9160" aria-hidden="true">↻</span>';
      let gear = nav.querySelector('.nav-gear-v9160');
      if (!gear) {
        gear = document.createElement('button');
        gear.type = 'button';
        gear.className = 'nav-gear-v9160';
        gear.dataset.view = 'sheet';
        gear.setAttribute('aria-label', 'Personnaliser et réglages');
        gear.innerHTML = gearSvg();
        nav.appendChild(gear);
      }
    } else {
      nav.querySelector('.nav-gear-v9160')?.remove();
      if (center.classList.contains('reset-nav-v9160')) {
        center.classList.remove('reset-nav-v9160');
        center.removeAttribute('data-reset-read');
        center.setAttribute('data-view', 'sheet');
        center.setAttribute('aria-label', 'Personnaliser');
        center.innerHTML = center.dataset.originalHtmlV9160 || center.innerHTML;
      }
    }
  }

  function decorateHomeSpacing() {
    document.body.classList.toggle('home-spacing-v9159', Boolean(document.querySelector('#app [data-stable-home-feed]')));
  }

  function promoteRenderedBriefImages() {
    document.querySelectorAll('#app [data-stable-brief-content] .article-image').forEach((img, index) => {
      if (!(img instanceof HTMLImageElement)) return;
      if (index < 14) {
        img.loading = 'eager';
        try { img.fetchPriority = 'high'; } catch {}
      }
      img.decoding = 'async';
    });
  }

  function externalImageFrom(raw = '') {
    const value = clean(raw);
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return /^https?:$/.test(url.protocol) ? url.href : '';
      if (['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) return clean(url.searchParams.get('image') || '');
      if (url.pathname === '/api/image-proxy') return clean(url.searchParams.get('url') || '');
    } catch {}
    return '';
  }

  function photoEndpoint(article = {}) {
    const pinned = clean(article.pinnedVisualV85 || '');
    if (pinned) {
      try {
        const url = new URL(pinned, location.href);
        if (url.origin === location.origin && ['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) return `${url.pathname}${url.search}`;
      } catch {}
    }
    const raw = clean(article.visual?.url || article.image || '');
    const supplied = externalImageFrom(raw) || (/^https?:\/\//i.test(raw) ? raw : '');
    const params = new URLSearchParams({
      v: '85',
      url: clean(article.url || '').slice(0, 1900),
      image: supplied.slice(0, 1900),
      title: clean(article.title || '').slice(0, 280),
      category: clean(article.category || '').slice(0, 70),
      source: clean(article.source || article.feedTitle || '').slice(0, 100)
    });
    return `/api/article-photo-fast?${params}`;
  }

  function cachedArticles() {
    const cache = readJson('news-live-cache', {});
    return Array.isArray(cache?.articles) ? cache.articles.filter(Boolean).sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)) : [];
  }

  function watchMatches(article, topics) {
    const haystack = normalize(`${article.title || ''} ${article.summary || ''} ${(article.tags || []).join(' ')} ${(article.matches || []).join(' ')}`);
    return topics.some(topic => {
      const words = normalize(topic).split(' ').filter(word => word.length >= 3);
      return words.length && words.every(word => haystack.includes(word));
    });
  }

  function prewarmPhotos(mode = 'brief', high = false) {
    if (!navigator.onLine || document.hidden) return;
    const all = cachedArticles();
    const topics = watchTopics();
    const chosen = (mode === 'watches' && topics.length ? all.filter(article => watchMatches(article, topics)) : all).slice(0, high ? 18 : 26);
    chosen.forEach((article, index) => {
      const src = photoEndpoint(article);
      if (!src || PHOTO_WARMED.has(src)) return;
      PHOTO_WARMED.add(src);
      try {
        const img = new Image();
        img.decoding = 'async';
        try { img.fetchPriority = high && index < 10 ? 'high' : 'low'; } catch {}
        img.src = src;
      } catch {}
    });
  }

  function instantTap(selector, modeResolver) {
    document.addEventListener('pointerdown', event => {
      const button = event.target.closest?.(selector);
      if (!button || (typeof event.button === 'number' && event.button !== 0)) return;
      const mode = modeResolver?.(button) || 'brief';
      prewarmPhotos(mode, true);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (event.cancelable) event.preventDefault();
    }, { capture: true, passive: false });
  }

  function decorate() {
    scheduled = false;
    const page = settingsPage();
    document.body.classList.toggle('advanced-settings-v9158', Boolean(page));
    if (page) removeMovedOrObsoleteSettings(page);
    decoratePersonalize();
    document.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());
    decorateBottomControls();
    decorateHomeSpacing();
    promoteRenderedBriefImages();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-block-add-v9158]')) {
      event.preventDefault();
      event.stopPropagation();
      addBlockedTerm();
      return;
    }
    const remove = event.target.closest?.('[data-block-remove-v9158]');
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      removeBlockedTerm(Number(remove.dataset.blockRemoveV9158));
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches?.('[data-block-input-v9158]')) return;
    event.preventDefault();
    addBlockedTerm();
  }, true);

  function start() {
    schedule();
    instantTap('.bottom-nav [data-view="brief"]', () => 'brief');
    instantTap('[data-brief-mode="essential"]', () => 'brief');
    instantTap('[data-brief-mode="watches"]', () => 'watches');
    new MutationObserver(schedule).observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', schedule);
    window.addEventListener('focus', () => { schedule(); setTimeout(() => prewarmPhotos('brief', false), 80); });
    document.addEventListener('news:stable-render', schedule);
    setTimeout(() => prewarmPhotos('brief', false), 120);
    setTimeout(() => prewarmPhotos('watches', false), 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
