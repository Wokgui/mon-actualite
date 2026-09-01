(() => {
  'use strict';

  const LIVE_CACHE = 'news-live-cache';
  const QUICK_CACHE = 'news-article-summaries-v8';
  const AI_CACHE = 'news-verified-ai-summaries-v9138';
  const inflight = new Map();
  let warmQueued = false;
  let prefetchTimer = 0;

  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const good = value => clean(value).length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(clean(value));
  const articles = () => {
    const cache = read(LIVE_CACHE, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  };
  const articleById = id => articles().find(article => String(article.id || '') === String(id || '')) || null;

  function distanceFromViewport(card) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom >= -200 && rect.top <= innerHeight + 200) return 0;
    if (rect.top > innerHeight) return rect.top - innerHeight;
    return Math.abs(rect.bottom);
  }

  function warmNearbyImages() {
    warmQueued = false;
    const cards = [...document.querySelectorAll('.article-card[data-article]')]
      .map(card => ({ card, distance: distanceFromViewport(card) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 18);

    cards.forEach(({ card }, index) => {
      const image = card.querySelector('img.article-image');
      if (!image) return;
      image.loading = 'eager';
      image.decoding = 'async';
      if ('fetchPriority' in image) image.fetchPriority = index < 8 ? 'high' : 'auto';
    });
  }

  function queueWarm() {
    if (warmQueued) return;
    warmQueued = true;
    requestAnimationFrame(warmNearbyImages);
  }

  function saveSummary(article, summary, data = {}) {
    if (!article?.id || !good(summary)) return;
    const key = `article:${article.id}`;
    const item = { summary: clean(summary), ai: Boolean(data.ai || data.grounded), unavailable: false, savedAt: Date.now() };
    const quick = read(QUICK_CACHE, {});
    quick[key] = item;
    write(QUICK_CACHE, Object.fromEntries(Object.entries(quick).slice(-180)));
    if (data.ai === true) {
      const verified = read(AI_CACHE, {});
      verified[key] = { summary: item.summary, savedAt: item.savedAt };
      write(AI_CACHE, Object.fromEntries(Object.entries(verified).slice(-180)));
    }
    applyOpenModal(article, item.summary, data.ai === true);
  }

  function applyOpenModal(article, summary, verifiedAi) {
    if (!verifiedAi) return;
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    const shown = norm(modal.querySelector('.quick-summary-head h2')?.textContent || '');
    const title = norm(article.title || '');
    if (!shown || (!title.includes(shown) && !shown.includes(title))) return;
    const box = modal.querySelector('[data-quick-summary-text]');
    if (box) box.textContent = summary;
    let status = modal.querySelector('.quick-summary-status-v9138');
    if (!status && box) { status = document.createElement('div'); box.before(status); }
    if (status) { status.className = 'quick-summary-status-v9138 ai'; status.textContent = 'Résumé IA'; }
  }

  function cachedSummary(article) {
    const key = `article:${article.id}`;
    const verified = read(AI_CACHE, {})[key];
    if (good(verified?.summary)) return { summary: clean(verified.summary), ai: true };
    const quick = read(QUICK_CACHE, {})[key];
    if (good(quick?.summary) && !quick?.unavailable) {
      if (quick.ai === true) {
        const verifiedCache = read(AI_CACHE, {});
        verifiedCache[key] = { summary: clean(quick.summary), savedAt: Number(quick.savedAt || Date.now()) };
        write(AI_CACHE, Object.fromEntries(Object.entries(verifiedCache).slice(-180)));
      }
      return { summary: clean(quick.summary), ai: Boolean(quick.ai) };
    }
    return null;
  }

  function prefetchArticle(article) {
    if (!article?.id || !article.url || cachedSummary(article)) return Promise.resolve();
    const key = String(article.id);
    if (inflight.has(key)) return inflight.get(key);
    const body = JSON.stringify({
      mode: 'article',
      article: {
        url: article.url,
        title: clean(article.title),
        summary: clean(article.summary),
        source: clean(article.source)
      }
    });
    const job = fetch('/api/article-summary-groq?v=17&intent=prefetch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body
    }).then(response => response.ok ? response.json() : null)
      .then(data => {
        const summary = clean(data?.summary || '');
        if (data && !data.unavailable && good(summary)) saveSummary(article, summary, data);
      }).catch(() => {}).finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  async function prefetchVisibleSummaries() {
    if (document.hidden || !navigator.onLine) return;
    const cards = [...document.querySelectorAll('.page .feed > .article-card[data-article]')]
      .map(card => ({ card, distance: distanceFromViewport(card) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 4);
    const targets = cards.map(({ card }) => articleById(card.dataset.article)).filter(Boolean);
    for (let index = 0; index < targets.length; index += 2) {
      await Promise.all(targets.slice(index, index + 2).map(prefetchArticle));
    }
  }

  function queuePrefetch(delay = 250) {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchVisibleSummaries, delay);
  }

  function refresh() {
    queueWarm();
    queuePrefetch(180);
  }

  const style = document.createElement('style');
  style.textContent = `
    .article-card.new-since-visit-v79::after,
    .article-card.essential-v77::before,
    .article-card.essential-v77::after {
      content: none !important;
      display: none !important;
    }
    .article-card.essential-v77 {
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    .article-card.essential-v77 .article-body { background: transparent !important; }
  `;
  document.head.appendChild(style);

  const root = document.getElementById('app');
  if (root) new MutationObserver(refresh).observe(root, { childList: true, subtree: true });

  document.addEventListener('pointerdown', event => {
    const card = event.target.closest?.('.article-card[data-article]');
    if (card) prefetchArticle(articleById(card.dataset.article));
  }, { capture: true, passive: true });
  window.addEventListener('scroll', () => { queueWarm(); queuePrefetch(500); }, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  refresh();
})();
