(() => {
  'use strict';

  const RELEASE = '91.56';
  let scheduled = false;
  let personalizeOpenKey = '';

  document.documentElement.dataset.uxPolishV9156 = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function ensureHomeTitleRow(header, reset) {
    const title = header?.querySelector('h1');
    if (!header || !title || !reset) return;
    let row = title.closest('.home-title-row-v9156');
    if (!row) {
      row = document.createElement('div');
      row.className = 'home-title-row-v9156';
      title.parentNode?.insertBefore(row, title);
      row.appendChild(title);
    }
    if (reset.parentElement !== row) row.appendChild(reset);
  }

  function ensureBriefControlsRow(tabs, reset) {
    if (!tabs || !reset) return null;
    let row = tabs.closest('.brief-controls-row-v9156');
    if (!row) {
      row = document.createElement('div');
      row.className = 'brief-controls-row-v9156';
      tabs.parentNode?.insertBefore(row, tabs);
      row.appendChild(tabs);
    }
    if (reset.parentElement !== row) row.appendChild(reset);
    return row;
  }

  function sectionKey(title = '') {
    if (/^Accueil$/i.test(title)) return 'home';
    if (/^Brief(?:\s*[·•-]\s*Essentiel)?$/i.test(title)) return 'brief';
    if (/^(?:Brief\s*[·•-]\s*)?Mes veilles$/i.test(title)) return 'watches';
    return '';
  }

  function normalizePersonalizeLabels(section) {
    const heading = section.querySelector('h3');
    const paragraph = section.querySelector('p');
    const title = clean(heading?.textContent || '');
    const key = sectionKey(title);

    if (key === 'home') {
      if (paragraph) paragraph.textContent = 'Sujets prioritaires';
    } else if (key === 'brief') {
      if (heading) heading.textContent = 'Brief';
      if (paragraph) paragraph.textContent = 'Rubriques choisies';
    } else if (key === 'watches') {
      if (heading) heading.textContent = 'Mes veilles';
      if (paragraph) paragraph.textContent = 'Sujets à suivre';
    }
    return key;
  }

  function buildAccordion(section) {
    if (section.dataset.accordionV9156 === '1') return;
    const key = normalizePersonalizeLabels(section);
    if (!key) return;

    const heading = section.querySelector('h3');
    const paragraph = section.querySelector('p');
    if (!heading) return;

    section.dataset.accordionV9156 = '1';
    section.dataset.accordionKeyV9156 = key;
    section.classList.add('personalize-accordion-v9156');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'personalize-accordion-head-v9156';
    head.dataset.personalizeAccordionV9156 = key;
    head.setAttribute('aria-expanded', personalizeOpenKey === key ? 'true' : 'false');

    const body = document.createElement('div');
    body.className = 'personalize-accordion-body-v9156';

    const children = [...section.children];
    head.appendChild(heading);
    if (paragraph) head.appendChild(paragraph);
    children.forEach(child => {
      if (child !== heading && child !== paragraph) body.appendChild(child);
    });

    const open = personalizeOpenKey === key;
    body.hidden = !open;
    section.classList.toggle('open-v9156', open);
    section.replaceChildren(head, body);
  }

  function decoratePersonalize(sheet) {
    const active = Boolean(sheet);
    document.body.classList.toggle('personalize-page-v9156', active);
    if (!sheet) return;

    const head = sheet.querySelector('.personalize-head');
    if (head) head.classList.add('personalize-head-v9156');

    sheet.querySelectorAll('.personalize-section').forEach(buildAccordion);

    const settings = sheet.querySelector('.personalize-settings');
    if (settings) {
      settings.classList.add('personalize-settings-v9156');
      if (settings.parentElement === sheet && settings !== sheet.lastElementChild) sheet.appendChild(settings);
    }
  }

  function decorate() {
    scheduled = false;
    const app = document.querySelector('#app');
    if (!app) return;

    const homeHeader = app.querySelector('.hero-header');
    const briefTabs = app.querySelector('.brief-mode-tabs');
    const personalizeSheet = app.querySelector('.personalization-sheet');
    const reset = app.querySelector('.global-reset-v9154');

    const home = Boolean(homeHeader && app.querySelector('[data-stable-home-feed]'));
    const brief = Boolean(briefTabs && app.querySelector('[data-stable-brief-content]'));
    const watchActive = Boolean(brief && app.querySelector('[data-brief-mode="watches"].active'));

    document.body.classList.toggle('home-view-v9156', home);
    document.body.classList.toggle('brief-view-v9156', brief);
    document.body.classList.toggle('brief-watch-active-v9156', watchActive);

    if (briefTabs) {
      const briefTab = briefTabs.querySelector('[data-brief-mode="essential"]');
      const watchTab = briefTabs.querySelector('[data-brief-mode="watches"]');
      if (briefTab && clean(briefTab.textContent || '') !== 'Brief') briefTab.textContent = 'Brief';
      if (watchTab && clean(watchTab.textContent || '') !== 'Veille') watchTab.textContent = 'Veille';
    }

    decoratePersonalize(personalizeSheet);

    if (!reset) return;
    reset.classList.remove('home-reset-v9156', 'brief-reset-v9156');

    if (personalizeSheet) {
      if (reset.parentElement !== app) app.appendChild(reset);
      return;
    }

    if (briefTabs) {
      reset.classList.add('brief-reset-v9156');
      ensureBriefControlsRow(briefTabs, reset);
      return;
    }

    if (homeHeader) {
      reset.classList.add('home-reset-v9156');
      ensureHomeTitleRow(homeHeader, reset);
      return;
    }

    if (reset.parentElement !== app) app.appendChild(reset);
  }

  function toggleAccordion(button) {
    const section = button.closest('.personalize-accordion-v9156');
    const body = section?.querySelector('.personalize-accordion-body-v9156');
    const key = button.dataset.personalizeAccordionV9156 || '';
    if (!section || !body || !key) return;

    const opening = body.hidden;
    document.querySelectorAll('.personalize-accordion-v9156').forEach(other => {
      const otherBody = other.querySelector('.personalize-accordion-body-v9156');
      const otherHead = other.querySelector('.personalize-accordion-head-v9156');
      if (otherBody) otherBody.hidden = true;
      other.classList.remove('open-v9156');
      otherHead?.setAttribute('aria-expanded', 'false');
    });

    personalizeOpenKey = opening ? key : '';
    body.hidden = !opening;
    section.classList.toggle('open-v9156', opening);
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  function start() {
    document.addEventListener('click', event => {
      const accordion = event.target.closest?.('[data-personalize-accordion-v9156]');
      if (!accordion) return;
      event.preventDefault();
      event.stopPropagation();
      toggleAccordion(accordion);
    }, true);

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
