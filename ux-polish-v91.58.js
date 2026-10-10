(() => {
  'use strict';

  const RELEASE = '91.58';
  const BLOCKED_KEY = 'news-blocked-terms-v1';
  let scheduled = false;
  let briefPrimeLocked = false;

  document.documentElement.dataset.uxPolishV9158 = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function esc(value = '') {
    return clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function settingsPage() {
    return [...document.querySelectorAll('#app main.page, #app .page')]
      .find(page => page.querySelector('[data-check-update], .app-version-section, [data-reset]')) || null;
  }

  function removeMovedOrObsoleteSettings(page) {
    if (!page) return;
    document.body.classList.add('advanced-settings-v9158');
    page.classList.add('advanced-settings-page-v9158');

    page.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());

    const removeTitle = title => (
      /^Contrôle qualité$/i.test(title)
      || /^Notifications?$/i.test(title)
      || /^Sources personnelles$/i.test(title)
      || /^Actualité générale$/i.test(title)
      || /^Centres d['’]intérêt$/i.test(title)
      || /^Ne plus afficher(?: un thème ou un mot)?$/i.test(title)
    );

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
    if (!Array.isArray(sources) || !sources.length) {
      return '<p class="muted-note personalize-source-empty-v9158">Aucune source personnelle ajoutée.</p>';
    }
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
      <div class="personalize-opml-v9158">
        <label class="secondary-btn" for="opml-input">Importer un fichier OPML</label>
        <input id="opml-input" class="file-input" type="file" accept=".opml,.xml">
      </div>
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
      <div class="inline-form personalize-block-form-v9158">
        <input class="text-input" data-block-input-v9158 maxlength="70" placeholder="Thème ou mot à exclure">
        <button type="button" class="small-primary-btn" data-block-add-v9158>Ajouter</button>
      </div>
      <div data-block-list-v9158>${blockedListMarkup()}</div>
    `;
    body.appendChild(section);
  }

  function decoratePersonalize() {
    const sheet = document.querySelector('.personalization-sheet');
    if (!sheet) return;

    const home = sheet.querySelector('[data-accordion-key-v9157="home"]');
    const body = home?.querySelector('.personalize-accordion-body-v9157');
    if (!body) return;

    wrapExistingGrid(body, '[data-general-category]', 'Actualité générale', 'Rubriques qui restent présentes dans votre sélection.');
    wrapExistingGrid(body, '[data-interest]', 'Centres d’intérêt', 'Sujets à faire remonter davantage dans Mon actualité.');
    ensureSourcesSection(body);
    ensureBlockedSection(body);
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

  function briefVisible() {
    return Boolean(document.querySelector('#app [data-stable-brief-content]'));
  }

  function primeBrief(button) {
    if (!button || briefPrimeLocked || briefVisible()) return;
    briefPrimeLocked = true;
    setTimeout(() => {
      try {
        if (!briefVisible() && button.isConnected) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
      } finally {
        setTimeout(() => { briefPrimeLocked = false; }, 180);
      }
    }, 0);
  }

  function decorate() {
    scheduled = false;
    const page = settingsPage();
    document.body.classList.toggle('advanced-settings-v9158', Boolean(page));
    if (page) removeMovedOrObsoleteSettings(page);
    decoratePersonalize();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  document.addEventListener('pointerdown', event => {
    const brief = event.target.closest?.('.bottom-nav [data-view="brief"]');
    if (!brief) return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    primeBrief(brief);
  }, true);

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
    const observer = new MutationObserver(schedule);
    observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', schedule);
    window.addEventListener('focus', schedule);
    document.addEventListener('news:stable-render', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
