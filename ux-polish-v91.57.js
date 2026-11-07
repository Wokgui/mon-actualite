(() => {
  'use strict';

  const RELEASE = '91.57';
  const RESET_SIZE = 40;
  const RESET_MARGIN = 8;
  const RESET_STORE_PREFIX = 'news-reset-position-v9157-';
  let scheduled = false;
  let openAccordion = '';
  let drag = null;
  let suppressResetClickUntil = 0;

  document.documentElement.dataset.uxPolishV9157 = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function viewKey(app) {
    if (app.querySelector('.hero-header') && app.querySelector('[data-stable-home-feed]')) return 'home';
    const brief = app.querySelector('[data-stable-brief-content]');
    if (!brief) return '';
    return app.querySelector('[data-brief-mode="watches"].active') ? 'watches' : 'brief';
  }

  function appBounds(app) {
    const rect = app.getBoundingClientRect();
    const left = Math.max(0, rect.left || 0);
    const right = Math.min(window.innerWidth, rect.right || window.innerWidth);
    return { left, right };
  }

  function clampPosition(app, left, top) {
    const bounds = appBounds(app);
    const minLeft = bounds.left + RESET_MARGIN;
    const maxLeft = Math.max(minLeft, bounds.right - RESET_SIZE - RESET_MARGIN);
    const minTop = RESET_MARGIN;
    const maxTop = Math.max(minTop, window.innerHeight - RESET_SIZE - RESET_MARGIN);
    return {
      left: Math.min(maxLeft, Math.max(minLeft, Number(left) || minLeft)),
      top: Math.min(maxTop, Math.max(minTop, Number(top) || minTop))
    };
  }

  function readPosition(key) {
    try {
      const value = JSON.parse(localStorage.getItem(`${RESET_STORE_PREFIX}${key}`) || 'null');
      if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function savePosition(key, position) {
    try { localStorage.setItem(`${RESET_STORE_PREFIX}${key}`, JSON.stringify(position)); } catch {}
  }

  function defaultPosition(app, key) {
    const bounds = appBounds(app);
    const rightDefault = bounds.right - RESET_SIZE - 12;

    if (key === 'home') {
      const title = app.querySelector('.hero-header h1');
      const rect = title?.getBoundingClientRect();
      if (rect) return clampPosition(app, rightDefault, rect.top + (rect.height - RESET_SIZE) / 2);
    }

    const tabs = app.querySelector('.brief-mode-tabs');
    const rect = tabs?.getBoundingClientRect();
    if (rect) {
      const midpoint = rect.right + Math.max(0, bounds.right - rect.right) / 2 - RESET_SIZE / 2;
      return clampPosition(app, midpoint, rect.top + (rect.height - RESET_SIZE) / 2);
    }

    return clampPosition(app, rightDefault, 12);
  }

  function applyResetPosition(app, reset, key, forceDefault = false) {
    if (!key) return;
    const stored = forceDefault ? null : readPosition(key);
    const position = clampPosition(app, stored?.left ?? defaultPosition(app, key).left, stored?.top ?? defaultPosition(app, key).top);
    reset.style.setProperty('--reset-left-v9157', `${Math.round(position.left)}px`);
    reset.style.setProperty('--reset-top-v9157', `${Math.round(position.top)}px`);
    reset.dataset.resetViewV9157 = key;
  }

  function prepareReset(app) {
    const key = viewKey(app);
    const reset = app.querySelector('.global-reset-v9154');
    document.body.classList.toggle('reset-visible-v9157', Boolean(key && reset));
    document.body.classList.toggle('brief-view-v9157', key === 'brief' || key === 'watches');
    if (!reset) return;

    reset.classList.add('reset-draggable-v9157');
    if (!key) {
      reset.dataset.resetViewV9157 = '';
      return;
    }

    if (reset.parentElement !== app) app.appendChild(reset);
    if (reset.dataset.resetViewV9157 !== key || !reset.style.getPropertyValue('--reset-left-v9157')) {
      applyResetPosition(app, reset, key);
    }
  }

  function sectionKey(title = '') {
    if (/^Accueil$/i.test(title)) return 'home';
    if (/^Brief(?:\s*[·•-]\s*Essentiel)?$/i.test(title)) return 'brief';
    if (/^(?:Brief\s*[·•-]\s*)?Mes veilles$/i.test(title)) return 'watches';
    return '';
  }

  function normalizeSection(section) {
    const heading = section.querySelector('h3');
    const paragraph = section.querySelector('p');
    const key = sectionKey(clean(heading?.textContent || ''));
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

  function makeAccordion(section) {
    if (section.dataset.accordionV9157 === '1') return;
    const key = normalizeSection(section);
    if (!key) return;
    const heading = section.querySelector('h3');
    const paragraph = section.querySelector('p');
    if (!heading) return;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'personalize-accordion-head-v9157';
    head.dataset.personalizeAccordionV9157 = key;

    const body = document.createElement('div');
    body.className = 'personalize-accordion-body-v9157';

    const children = [...section.children];
    head.appendChild(heading);
    if (paragraph) head.appendChild(paragraph);
    children.forEach(child => {
      if (child !== heading && child !== paragraph) body.appendChild(child);
    });

    const isOpen = openAccordion === key;
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    body.hidden = !isOpen;
    section.className = 'personalize-accordion-v9157';
    section.dataset.accordionV9157 = '1';
    section.dataset.accordionKeyV9157 = key;
    section.classList.toggle('open-v9157', isOpen);
    section.replaceChildren(head, body);
  }

  function makeAdvancedAccordion(sheet) {
    if (sheet.querySelector('[data-accordion-key-v9157="settings"]')) return;
    const launch = sheet.querySelector('.personalize-settings');
    if (!launch) return;

    const section = document.createElement('section');
    section.className = 'personalize-accordion-v9157';
    section.dataset.accordionV9157 = '1';
    section.dataset.accordionKeyV9157 = 'settings';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'personalize-accordion-head-v9157';
    head.dataset.personalizeAccordionV9157 = 'settings';
    const title = document.createElement('h3');
    title.textContent = 'Réglages avancés';
    head.appendChild(title);

    const body = document.createElement('div');
    body.className = 'personalize-accordion-body-v9157';
    launch.classList.remove('personalize-settings-v9155', 'personalize-settings-v9156');
    launch.classList.add('personalize-settings-launch-v9157');
    launch.textContent = 'Ouvrir les réglages avancés';
    body.appendChild(launch);

    const isOpen = openAccordion === 'settings';
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    body.hidden = !isOpen;
    section.classList.toggle('open-v9157', isOpen);
    section.append(head, body);
    sheet.appendChild(section);
  }

  function decoratePersonalize(app) {
    const sheet = app.querySelector('.personalization-sheet');
    document.body.classList.toggle('personalize-page-v9157', Boolean(sheet));
    if (!sheet) return;

    const head = sheet.querySelector('.personalize-head');
    if (head) head.classList.add('personalize-head-v9157');

    sheet.querySelectorAll('.personalize-section').forEach(makeAccordion);
    makeAdvancedAccordion(sheet);
  }

  function toggleAccordion(button) {
    const section = button.closest('.personalize-accordion-v9157');
    const body = section?.querySelector('.personalize-accordion-body-v9157');
    const key = button.dataset.personalizeAccordionV9157 || '';
    if (!section || !body || !key) return;
    const opening = body.hidden;

    document.querySelectorAll('.personalize-accordion-v9157').forEach(other => {
      const otherBody = other.querySelector('.personalize-accordion-body-v9157');
      const otherHead = other.querySelector('.personalize-accordion-head-v9157');
      if (otherBody) otherBody.hidden = true;
      other.classList.remove('open-v9157');
      otherHead?.setAttribute('aria-expanded', 'false');
    });

    openAccordion = opening ? key : '';
    body.hidden = !opening;
    section.classList.toggle('open-v9157', opening);
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const app = document.querySelector('#app');
      if (!app) return;
      prepareReset(app);
      decoratePersonalize(app);
    });
  }

  document.addEventListener('pointerdown', event => {
    const reset = event.target.closest?.('.global-reset-v9154.reset-draggable-v9157');
    if (!reset || !document.body.classList.contains('reset-visible-v9157')) return;
    const app = document.querySelector('#app');
    const key = reset.dataset.resetViewV9157 || viewKey(app);
    if (!app || !key) return;

    const rect = reset.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      key,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      app,
      reset
    };
    reset.setPointerCapture?.(event.pointerId);
  }, true);

  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.reset.classList.add('dragging-v9157');
    const next = clampPosition(drag.app, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    drag.reset.style.setProperty('--reset-left-v9157', `${Math.round(next.left)}px`);
    drag.reset.style.setProperty('--reset-top-v9157', `${Math.round(next.top)}px`);
    event.preventDefault();
  }, { capture: true, passive: false });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    current.reset.classList.remove('dragging-v9157');
    try { current.reset.releasePointerCapture?.(event.pointerId); } catch {}
    if (!current.moved) return;

    const rect = current.reset.getBoundingClientRect();
    const position = clampPosition(current.app, rect.left, rect.top);
    savePosition(current.key, position);
    suppressResetClickUntil = Date.now() + 350;
    event.preventDefault();
  }

  document.addEventListener('pointerup', endDrag, { capture: true, passive: false });
  document.addEventListener('pointercancel', endDrag, { capture: true, passive: false });

  document.addEventListener('click', event => {
    const accordion = event.target.closest?.('[data-personalize-accordion-v9157]');
    if (accordion) {
      event.preventDefault();
      event.stopPropagation();
      toggleAccordion(accordion);
      return;
    }

    if (event.target.closest?.('.global-reset-v9154.reset-draggable-v9157') && Date.now() < suppressResetClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('resize', () => {
    const app = document.querySelector('#app');
    const reset = app?.querySelector('.global-reset-v9154.reset-draggable-v9157');
    const key = reset?.dataset.resetViewV9157 || '';
    if (!app || !reset || !key) return;
    const rect = reset.getBoundingClientRect();
    const position = clampPosition(app, rect.left, rect.top);
    reset.style.setProperty('--reset-left-v9157', `${Math.round(position.left)}px`);
    reset.style.setProperty('--reset-top-v9157', `${Math.round(position.top)}px`);
    savePosition(key, position);
  });

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
