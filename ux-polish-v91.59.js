(() => {
  'use strict';

  const RELEASE = '91.59';
  let scheduled = false;
  document.documentElement.dataset.uxPolishV9159 = RELEASE;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };

  function switchMarkup(title, description, key, enabled) {
    return `<div class="setting-row"><div class="setting-label"><strong>${esc(title)}</strong><span>${esc(description)}</span></div><button class="switch ${enabled ? 'on' : ''}" data-setting-toggle="${esc(key)}" role="switch" aria-checked="${enabled ? 'true' : 'false'}"></button></div>`;
  }

  function currentArticleView() {
    if (document.querySelector('#app [data-stable-home-feed]')) return 'home';
    if (document.querySelector('#app [data-stable-brief-content]')) {
      return document.querySelector('#app [data-brief-mode="watches"].active') ? 'watches' : 'brief';
    }
    return '';
  }

  function decorateBottomReset() {
    const nav = document.querySelector('#app .bottom-nav');
    const center = nav?.querySelector('.nav-item.plus, [data-view="sheet"], .reset-nav-v9159');
    if (!center) return;

    if (!center.dataset.originalHtmlV9159) center.dataset.originalHtmlV9159 = center.innerHTML;
    const inPersonalize = Boolean(document.querySelector('.personalization-sheet'));
    const view = currentArticleView();
    const shouldReset = Boolean(view && !inPersonalize);

    if (shouldReset) {
      center.classList.add('reset-nav-v9159', 'plus');
      center.removeAttribute('data-view');
      center.setAttribute('data-reset-read', '');
      center.setAttribute('aria-label', 'Réinitialiser les articles parcourus');
      if (!center.querySelector('.reset-nav-glyph-v9159')) {
        center.innerHTML = '<span class="reset-nav-glyph-v9159" aria-hidden="true">↻</span><span class="reset-nav-text-v9159">Réinitialiser</span>';
      }
    } else if (center.classList.contains('reset-nav-v9159')) {
      center.classList.remove('reset-nav-v9159');
      center.removeAttribute('data-reset-read');
      center.setAttribute('data-view', 'sheet');
      center.setAttribute('aria-label', 'Personnaliser');
      center.innerHTML = center.dataset.originalHtmlV9159 || center.innerHTML;
    }
  }

  function personalizeSheet() {
    return document.querySelector('#app .personalization-sheet');
  }

  function renameHomeAccordion(sheet) {
    const home = sheet?.querySelector('[data-accordion-key-v9157="home"]');
    const head = home?.querySelector('.personalize-accordion-head-v9157');
    const title = head?.querySelector('h3');
    const subtitle = head?.querySelector('p');
    if (title) title.textContent = 'Actualité générale';
    if (subtitle) subtitle.remove();
  }

  function flattenHomeCategories(sheet) {
    const home = sheet?.querySelector('[data-accordion-key-v9157="home"]');
    const body = home?.querySelector('.personalize-accordion-body-v9157');
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
    const watches = sheet?.querySelector('[data-accordion-key-v9157="watches"]');
    const body = watches?.querySelector('.personalize-accordion-body-v9157');
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
    const settingsAccordion = sheet?.querySelector('[data-accordion-key-v9157="settings"]');
    const body = settingsAccordion?.querySelector('.personalize-accordion-body-v9157');
    if (!body) return;
    const launch = body.querySelector('.personalize-settings-launch-v9157, [data-open-settings]');
    launch?.remove();
    if (!body.querySelector('[data-personalize-advanced-page-v9159]')) body.insertAdjacentHTML('beforeend', embeddedAdvancedMarkup());
    body.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());
    const advanced = body.querySelector('[data-personalize-advanced-page-v9159]');
    const maintenance = advanced?.querySelector('.maintenance-v84');
    if (advanced && maintenance && advanced.firstElementChild !== maintenance) advanced.prepend(maintenance);
  }

  function moveBlockedFooter(sheet) {
    if (!sheet) return;
    const homeBody = sheet.querySelector('[data-accordion-key-v9157="home"] .personalize-accordion-body-v9157');
    let blocked = sheet.querySelector('.personalize-blocked-v9158');
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

  function cleanAdvancedSettingsPage() {
    document.querySelectorAll('.quality-diagnostic-v88').forEach(node => node.remove());
  }

  function decorateHomeSpacing() {
    document.body.classList.toggle('home-spacing-v9159', Boolean(document.querySelector('#app [data-stable-home-feed]')));
  }

  function decorate() {
    scheduled = false;
    const sheet = personalizeSheet();
    if (sheet) {
      renameHomeAccordion(sheet);
      flattenHomeCategories(sheet);
      ensureWatchList(sheet);
      ensureAdvancedContent(sheet);
      moveBlockedFooter(sheet);
    }
    cleanAdvancedSettingsPage();
    decorateBottomReset();
    decorateHomeSpacing();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  document.addEventListener('pointerdown', event => {
    const brief = event.target.closest?.('.bottom-nav [data-view="brief"]');
    if (!brief || document.querySelector('#app [data-stable-brief-content]')) return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    brief.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, true);

  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
    window.addEventListener('pageshow', schedule);
    window.addEventListener('focus', schedule);
    document.addEventListener('news:stable-render', schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();