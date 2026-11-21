(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  let queued = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function clean(value = '') { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function normalize(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function articleMap() {
    const cache = readJson(CACHE_KEY, {});
    return new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
  }

  function revisionLabel(article = {}) {
    if (article.revisionTypeV89 === 'correction') return { type: 'correction', text: 'Corrigé depuis votre lecture' };
    if (article.revisionTypeV89 === 'updated') return { type: 'updated', text: 'Mis à jour depuis votre lecture' };
    return null;
  }

  function decorateCards() {
    const map = articleMap();
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      if (card.closest('.stable-owned-list')) return;
      const article = map.get(String(card.dataset.article || ''));
      if (!article) return;
      card.dataset.informationValueV89 = String(Number(article.informationValueV89 || 0));
      const revision = revisionLabel(article);
      const existing = card.querySelector('.revision-chip-v89');
      if (!revision) {
        existing?.remove();
        return;
      }
      const chip = existing || document.createElement('span');
      chip.className = `revision-chip-v89 ${revision.type}`;
      chip.textContent = revision.text;
      if (!existing) {
        const top = card.querySelector('.card-top') || card.querySelector('.article-body');
        top?.prepend(chip);
      }
    });
  }

  function articleFromModal(modal) {
    const map = articleMap();
    const title = normalize(modal?.querySelector('.quick-summary-head h2, h2')?.textContent || '');
    const source = normalize(modal?.querySelector('.quick-summary-meta span')?.textContent || '');
    return [...map.values()].find(article => title && normalize(article.title || '') === title && (!source || normalize(article.source || '') === source))
      || [...map.values()].find(article => title && normalize(article.title || '').includes(title))
      || null;
  }

  function decorateModal() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    const article = articleFromModal(modal);
    if (!article) return;
    const revision = revisionLabel(article);
    let note = modal.querySelector('.revision-note-v89');
    if (!revision) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement('div');
      const target = modal.querySelector('.verification-note-v83, .quick-summary-meta');
      target?.insertAdjacentElement('afterend', note);
    }
    note.className = `revision-note-v89 ${revision.type}`;
    note.innerHTML = `<strong>${revision.text}</strong><span>${clean(article.revisionReasonV89 || '')}</span>`;
  }

  function decorateQualityDetails() {
    const modal = document.querySelector('.quick-summary-backdrop');
    const article = articleFromModal(modal);
    const details = modal?.querySelector('.quality-details-v88');
    if (!article || !details || details.querySelector('.information-value-v89')) return;
    const value = Number(article.informationValueV89 || 0);
    const label = value >= 75 ? 'forte' : value >= 50 ? 'moyenne' : 'faible';
    const block = document.createElement('div');
    block.className = 'information-value-v89';
    block.innerHTML = `<strong>Valeur informationnelle ${label}</strong><span>${value}/100${Array.isArray(article.informationReasonsV89) && article.informationReasonsV89.length ? ` · ${article.informationReasonsV89.slice(0, 3).join(' · ')}` : ''}</span>`;
    details.appendChild(block);
  }

  function decorate() {
    queued = false;
    decorateCards();
    decorateModal();
    decorateQualityDetails();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(decorate);
  }

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }, { once: true });
  window.addEventListener('focus', schedule);
  window.addEventListener('news-story-intelligence-v81', schedule);
})();
