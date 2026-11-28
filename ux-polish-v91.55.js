(() => {
  'use strict';

  const RELEASE = '91.55';
  let scheduled = false;

  document.documentElement.dataset.uxPolishV9155 = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function ensureBriefControlsRow(tabs) {
    if (!tabs) return null;
    let row = tabs.closest('.brief-controls-row-v9155');
    if (row) return row;
    row = document.createElement('div');
    row.className = 'brief-controls-row-v9155';
    tabs.parentNode?.insertBefore(row, tabs);
    row.appendChild(tabs);
    return row;
  }

  function decoratePersonalize(sheet) {
    const active = Boolean(sheet);
    document.body.classList.toggle('personalize-page-v9155', active);
    if (!sheet) return;

    const head = sheet.querySelector('.personalize-head');
    if (head) head.classList.add('personalize-head-v9155');

    const settings = sheet.querySelector('.personalize-settings');
    if (settings) settings.classList.add('personalize-settings-v9155');

    sheet.querySelectorAll('.personalize-section').forEach(section => {
      const heading = section.querySelector('h3');
      const paragraph = section.querySelector('p');
      const title = clean(heading?.textContent || '');

      if (/^Accueil$/i.test(title)) {
        if (paragraph && clean(paragraph.textContent || '') !== 'Sujets prioritaires') paragraph.textContent = 'Sujets prioritaires';
        return;
      }

      if (/^Brief\s*[·•-]\s*Essentiel$/i.test(title) || /^Brief$/i.test(title)) {
        if (heading && clean(heading.textContent || '') !== 'Brief') heading.textContent = 'Brief';
        if (paragraph && clean(paragraph.textContent || '') !== 'Rubriques choisies') paragraph.textContent = 'Rubriques choisies';
        return;
      }

      if (/^Brief\s*[·•-]\s*Mes veilles$/i.test(title) || /^Mes veilles$/i.test(title)) {
        if (heading && clean(heading.textContent || '') !== 'Mes veilles') heading.textContent = 'Mes veilles';
        if (paragraph && clean(paragraph.textContent || '') !== 'Sujets à suivre') paragraph.textContent = 'Sujets à suivre';
      }
    });
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

    document.body.classList.toggle('home-view-v9155', home);
    document.body.classList.toggle('brief-view-v9155', brief);
    document.body.classList.toggle('brief-watch-active-v9155', watchActive);

    if (briefTabs) {
      const briefTab = briefTabs.querySelector('[data-brief-mode="essential"]');
      const watchTab = briefTabs.querySelector('[data-brief-mode="watches"]');
      if (briefTab && clean(briefTab.textContent || '') !== 'Brief') briefTab.textContent = 'Brief';
      if (watchTab && clean(watchTab.textContent || '') !== 'Veille') watchTab.textContent = 'Veille';
    }

    decoratePersonalize(personalizeSheet);

    if (!reset) return;

    reset.classList.remove('home-reset-v9155', 'brief-reset-v9155', 'personalize-reset-v9155');

    if (personalizeSheet) {
      reset.classList.add('personalize-reset-v9155');
      if (reset.parentElement !== personalizeSheet) personalizeSheet.appendChild(reset);
      return;
    }

    if (briefTabs) {
      const row = ensureBriefControlsRow(briefTabs);
      if (row) {
        reset.classList.add('brief-reset-v9155');
        if (reset.parentElement !== row) row.appendChild(reset);
      }
      return;
    }

    if (homeHeader) {
      reset.classList.add('home-reset-v9155');
      if (reset.parentElement !== homeHeader) homeHeader.appendChild(reset);
      return;
    }

    if (reset.parentElement !== app) app.appendChild(reset);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

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
