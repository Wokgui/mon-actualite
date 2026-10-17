(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function articles() {
    try {
      const payload = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return Array.isArray(payload.articles) ? payload.articles : [];
    } catch {
      return [];
    }
  }

  function displayedTitle(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '');
    if (!source) return title;
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return title.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}\\s*$`, 'i'), '').trim();
  }

  function articleForModal(modal) {
    const shown = normalize(modal.querySelector('.quick-summary-head h2, .quick-summary-sheet > h2')?.textContent || '');
    if (!shown) return null;
    return articles().find(article => {
      const candidate = normalize(displayedTitle(article));
      return candidate === shown || candidate.startsWith(shown) || shown.startsWith(candidate);
    }) || null;
  }

  function exactDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
    }).format(date);
    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} à ${time}`;
  }

  function ensureDate(modal) {
    if (!(modal instanceof Element)) return;
    const meta = modal.querySelector('.quick-summary-meta');
    const sheet = modal.querySelector('.quick-summary-sheet');
    if (!meta || !sheet) return;
    const article = articleForModal(modal);
    const label = exactDateTime(article?.publishedAt || article?.date || '');
    if (!label) return;

    const spans = [...meta.querySelectorAll(':scope > span')];
    let date = meta.querySelector('[data-article-date-time]');
    if (!date) {
      date = spans.find(span => /^(?:à l.instant|il y a|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b)/i.test(clean(span.textContent))) || null;
    }
    if (!date) {
      date = document.createElement('span');
      const category = spans[spans.length - 1] || null;
      meta.insertBefore(date, category);
    }
    date.dataset.articleDateTime = '91.78';
    if (date.textContent !== label) date.textContent = label;

    const visuals = [...sheet.querySelectorAll('.quick-summary-image, .quick-summary-v42-image, .quick-summary-fast-image, .quick-summary-perf-image')];
    const lastVisual = visuals[visuals.length - 1];
    if (lastVisual && lastVisual.nextElementSibling !== meta) lastVisual.insertAdjacentElement('afterend', meta);
  }

  function refresh() {
    document.querySelectorAll('.quick-summary-backdrop').forEach(ensureDate);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(refresh));
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  document.addEventListener('click', () => requestAnimationFrame(refresh), true);
  document.addEventListener('pointerup', () => requestAnimationFrame(refresh), true);
})();

