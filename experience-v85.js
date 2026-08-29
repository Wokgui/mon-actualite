(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const PINS_KEY = 'news-image-pins-v85';
  const SOURCE_PREF_KEY = 'news-source-preferences-v82';
  const TOPIC_PREF_KEY = 'news-topic-preferences-v1';
  const MAX_PINS = 260;
  const upstreamFetch = window.fetch.bind(window);
  let decorateQueued = false;
  const validating = new Set();

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function normalize(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href); url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function aliases(article = {}) {
    const list = [];
    const add = value => { const v = clean(value); if (v) list.push(v); };
    add(article.id ? `id:${article.id}` : '');
    for (const id of Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : []) add(`id:${id}`);
    add(article.eventKeyV78 ? `event:${normalize(article.eventKeyV78)}` : '');
    add(article.storyMemoryV81?.key ? `story:${normalize(article.storyMemoryV81.key)}` : '');
    add(article.url ? `url:${canonicalUrl(article.url)}` : '');
    return [...new Set(list)].slice(0, 16);
  }

  function validPinnedProxy(raw = '') {
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin && ['/api/article-thumbnail','/api/article-photo-fast','/api/exact-news-thumbnail'].includes(url.pathname);
    } catch { return false; }
  }

  function findPin(article, pins = readJson(PINS_KEY, {})) {
    for (const key of aliases(article)) {
      const item = pins[key];
      if (item?.url && validPinnedProxy(item.url)) return item.url;
    }
    return '';
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const pins = readJson(PINS_KEY, {});
    let restored = 0;
    payload.articles = payload.articles.map(article => {
      const pin = findPin(article, pins);
      if (!pin) return article;
      restored += 1;
      return { ...article, pinnedVisualV85: pin };
    });
    payload.stats = { ...(payload.stats || {}), experienceV85: true, pinnedImagesRestoredV85: restored };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function experienceV85Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return responseFromPayload(response, transformPayload(payload));
      }
    } catch {}
    return response;
  };

  function currentArticles() { const cache = readJson(CACHE_KEY, {}); return Array.isArray(cache.articles) ? cache.articles : []; }
  function articleMap() { return new Map(currentArticles().map(article => [String(article.id || ''), article])); }
  function sourceKey(value = '') { return normalize(value).slice(0, 120); }
  function distinctSources(article = {}) { return [...new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(sourceKey).filter(Boolean))].length; }

  function reasons(article = {}) {
    const out = [];
    const add = text => { const value = clean(text); if (value && !out.includes(value)) out.push(value); };
    const sourcePrefs = readJson(SOURCE_PREF_KEY, {});
    const topicPrefs = readJson(TOPIC_PREF_KEY, {});
    const topics = [...new Set([article.category, ...(article.tags || []), ...(article.matches || [])].map(clean).filter(Boolean))];
    if (article.essential) add('Actualité considérée comme majeure');
    if (article.noveltyStateV78 === 'development') add('Nouveau développement d’un sujet déjà suivi');
    else if (article.noveltyStateV78 === 'new') add('Information nouvelle');
    const count = distinctSources(article);
    if (count >= 2) add(`${count} sources couvrent le même événement`);
    if (article.customSource) add('Source que vous avez ajoutée à vos suivis');
    if (Number(sourcePrefs[sourceKey(article.source)] || 0) > 0) add(`Source favorisée : ${article.source}`);
    const preferredTopics = topics.filter(topic => Number(topicPrefs[topic] || 0) > 0).slice(0, 2);
    for (const topic of preferredTopics) add(`Sujet favorisé : ${topic}`);
    const matched = (article.matches || []).map(clean).filter(Boolean).slice(0, 2);
    for (const match of matched) add(`Correspond à votre suivi : ${match}`);
    if (article.whyV78 && !/^actualité majeure$/i.test(article.whyV78)) add(article.whyV78);
    if (Number(article.sourceQualityV82 || 0) >= 18) add('Article suffisamment complet pour être privilégié parmi les doublons');
    if (!out.length) add('Sélectionné selon son importance, sa fraîcheur et sa pertinence');
    return out.slice(0, 6);
  }

  function escapeHtml(value = '') { return clean(value).replace(/[&<>'\"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
  function whyMarkup(article) { return `<div class="why-panel-v85" hidden data-why-panel-v85>${reasons(article).map(reason => `<div><span>•</span><span>${escapeHtml(reason)}</span></div>`).join('')}</div>`; }

  function decorateCards() {
    const map = articleMap();
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      const article = map.get(String(card.dataset.article || ''));
      if (!article || card.querySelector('[data-why-v85]')) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'why-button-v85'; button.dataset.whyV85 = ''; button.textContent = 'Pourquoi je vois ça ?';
      const line = card.querySelector('.trust-line-v83') || card.querySelector('.meta');
      if (line) line.insertAdjacentElement('afterend', button); else card.querySelector('.article-body')?.appendChild(button);
      button.insertAdjacentHTML('afterend', whyMarkup(article));
    });
  }

  function modalArticle(modal) {
    const map = articleMap();
    const title = normalize(modal?.querySelector('.quick-summary-head h2')?.textContent || '');
    const source = normalize(modal?.querySelector('.quick-summary-meta span')?.textContent || '');
    return [...map.values()].find(article => title && normalize(article.title || '').includes(title) && (!source || normalize(article.source || '') === source))
      || [...map.values()].find(article => title && normalize(article.title || '').includes(title)) || null;
  }

  function decorateModal() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal || modal.querySelector('.why-modal-v85')) return;
    const article = modalArticle(modal); if (!article) return;
    const section = document.createElement('section'); section.className = 'why-modal-v85';
    section.innerHTML = `<strong>Pourquoi cet article est proposé</strong>${reasons(article).map(reason => `<p>• ${escapeHtml(reason)}</p>`).join('')}`;
    const target = modal.querySelector('.verification-note-v83') || modal.querySelector('.quick-summary-meta');
    if (target) target.insertAdjacentElement('afterend', section);
  }

  async function validateAndPin(img, article) {
    const raw = img.currentSrc || img.src || '';
    if (!validPinnedProxy(raw)) return;
    const key = `${article.id || ''}|${raw}`; if (validating.has(key)) return; validating.add(key);
    try {
      const response = await upstreamFetch(raw, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok || response.type === 'opaque') return;
      const status = clean(response.headers.get('X-Thumbnail-Status') || '').toLowerCase();
      const type = clean(response.headers.get('Content-Type') || '').toLowerCase();
      if (['fallback','publisher-tile','neutral-fallback'].includes(status) || type.includes('svg')) return;
      const pins = readJson(PINS_KEY, {}); const now = Date.now();
      for (const alias of aliases(article)) pins[alias] = { url: raw, savedAt: now };
      const compact = Object.fromEntries(Object.entries(pins).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0)).slice(0, MAX_PINS));
      writeJson(PINS_KEY, compact);
      const cache = readJson(CACHE_KEY, null);
      if (cache && Array.isArray(cache.articles)) {
        let changed = false;
        cache.articles = cache.articles.map(item => {
          const intersects = aliases(item).some(alias => compact[alias]?.url === raw);
          if (!intersects) return item; changed = true; return { ...item, pinnedVisualV85: raw };
        });
        if (changed) writeJson(CACHE_KEY, cache);
      }
    } catch {} finally { validating.delete(key); }
  }

  function watchImages() {
    const map = articleMap();
    document.querySelectorAll('.article-card[data-article] img.stable-visual').forEach(img => {
      if (img.dataset.pinWatchV85 === '1') return;
      img.dataset.pinWatchV85 = '1';
      const run = () => {
        const card = img.closest('.article-card[data-article]');
        const article = map.get(String(card?.dataset.article || '')) || articleMap().get(String(card?.dataset.article || ''));
        if (article) validateAndPin(img, article);
      };
      if (img.complete && img.naturalWidth > 0) run(); else img.addEventListener('load', run, { once: true });
    });
  }

  function scheduleDecorate() {
    if (decorateQueued) return; decorateQueued = true;
    requestAnimationFrame(() => { decorateQueued = false; decorateCards(); decorateModal(); watchImages(); });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-why-v85]'); if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const panel = button.parentElement?.querySelector('[data-why-panel-v85]') || button.nextElementSibling; if (!panel) return;
    const opening = panel.hidden; panel.hidden = !opening; button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }, true);

  const initial = readJson(CACHE_KEY, null); if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, transformPayload(initial));
  document.addEventListener('DOMContentLoaded', () => { new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true }); scheduleDecorate(); }, { once: true });
  window.addEventListener('focus', scheduleDecorate);
  window.addEventListener('storage', event => { if ([CACHE_KEY, PINS_KEY, SOURCE_PREF_KEY, TOPIC_PREF_KEY].includes(event.key)) scheduleDecorate(); });
})();
