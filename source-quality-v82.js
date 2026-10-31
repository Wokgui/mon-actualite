(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const SOURCE_PREF_KEY = 'news-source-preferences-v82';
  const TOPIC_PREF_KEY = 'news-topic-preferences-v1';
  const FEEDBACK_KEY = 'news-feedback';
  const upstreamFetch = window.fetch.bind(window);
  let decorateQueued = false;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function sourceKey(value = '') {
    return normalize(value).slice(0, 120);
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
  }

  function directPublisherUrl(value = '') {
    try {
      const host = new URL(value, location.href).hostname.toLowerCase().replace(/^www\./, '');
      if (!host) return false;
      return !/(^|\.)news\.google\.|(^|\.)google\.com$|bing\.com$|feedly\.com$/.test(host);
    } catch { return false; }
  }

  function sourcePreference(source = '') {
    const prefs = readJson(SOURCE_PREF_KEY, {});
    return Number(prefs[sourceKey(source)] || 0);
  }

  function qualityScore(article = {}) {
    let score = 0;
    const summary = clean(article.summary || article.detail || '');
    if (usefulSummary(summary)) score += 10;
    if (summary.length >= 180) score += 5;
    if (summary.length >= 350) score += 3;
    if (directPublisherUrl(article.url || '')) score += 7;
    else score -= 5;
    if (clean(article.visual?.url || article.image || article.quickVisualUrl || '')) score += 4;
    if (clean(article.title || '').length >= 45) score += 2;
    if (article.customSource) score += 3;
    return score;
  }

  function preferenceAdjustment(pref) {
    if (pref <= -99) return -600;
    if (pref <= -2) return -34;
    if (pref < 0) return -18;
    if (pref >= 2) return 38;
    if (pref > 0) return 20;
    return 0;
  }

  function transformArticle(article = {}) {
    const copy = { ...article };
    const pref = sourcePreference(copy.source || '');
    const quality = qualityScore(copy);
    const base = Number.isFinite(Number(copy.scoreV82Base)) ? Number(copy.scoreV82Base) : Number(copy.score || 0);
    copy.scoreV82Base = base;
    copy.sourceQualityV82 = quality;
    copy.sourcePreferenceV82 = pref;
    copy.score = base + quality + preferenceAdjustment(pref);
    copy.preferredLeadV82 = pref > 0 || quality >= 18;
    return copy;
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    let hidden = 0;
    payload.articles = payload.articles.map(transformArticle).filter(article => {
      const pref = Number(article.sourcePreferenceV82 || 0);
      const merged = new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(sourceKey).filter(Boolean)).size > 1;
      if (pref <= -99 && !merged) { hidden += 1; return false; }
      return true;
    });
    payload.stats = { ...(payload.stats || {}), sourceQualityV82: true, sourceHiddenV82: hidden };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function sourceQualityV82Fetch(input, init) {
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

  const initialCache = readJson(CACHE_KEY, null);
  if (initialCache && Array.isArray(initialCache.articles)) {
    writeJson(CACHE_KEY, transformPayload(initialCache));
  }

  function currentArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function titleCore(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '');
    if (source) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`\\s*[-–—|·:]\\s*${escaped}\\s*$`, 'i')).trim();
    }
    return title;
  }

  function activeModalArticle(modal) {
    const title = normalize(modal?.querySelector('.quick-summary-head h2')?.textContent || '');
    const source = normalize(modal?.querySelector('.quick-summary-meta span')?.textContent || '');
    const articles = currentArticles();
    return articles.find(article => title && normalize(titleCore(article)) === title && (!source || normalize(article.source || '') === source))
      || articles.find(article => title && normalize(titleCore(article)) === title)
      || null;
  }

  function sourcePreferenceMarkup(article) {
    const source = clean(article?.source || 'Cette source');
    const current = sourcePreference(source);
    const selected = value => current === value ? 'selected' : '';
    return `<section class="source-preference-v82" data-source-pref-panel-v82>
      <strong>Réglage de cette source</strong>
      <p>${escapeHtml(source)} est réglé indépendamment du sujet de l’article.</p>
      <div class="source-pref-actions-v82">
        <button type="button" class="${selected(-1)}" data-source-pref-v82="-1">Moins</button>
        <button type="button" class="${selected(0)}" data-source-pref-v82="0">Normal</button>
        <button type="button" class="${selected(1)}" data-source-pref-v82="1">Plus</button>
        <button type="button" class="danger ${current <= -99 ? 'selected' : ''}" data-source-pref-v82="-99">Masquer</button>
      </div>
    </section>`;
  }

  function escapeHtml(value = '') {
    return clean(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function decorateQuickSummary() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    const article = activeModalArticle(modal);
    if (!article) return;

    const oldNot = modal.querySelector('[data-quick-feedback="not"]');
    if (oldNot && !oldNot.dataset.v82Relabelled) {
      oldNot.dataset.v82Relabelled = '1';
      const strong = oldNot.querySelector('strong');
      const small = oldNot.querySelector('small');
      if (strong) strong.textContent = 'Moins de sujets comme ça';
      if (small) small.textContent = 'Réduire les thèmes semblables sans masquer la source';
    }

    if (!modal.querySelector('[data-article-only-v82]')) {
      const help = modal.querySelector('.quick-feedback-help');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'article-only-v82';
      button.dataset.articleOnlyV82 = '';
      button.textContent = 'Masquer seulement cet article';
      if (help) help.insertAdjacentElement('afterend', button);
      else modal.querySelector('.quick-summary-sheet')?.appendChild(button);
    }

    if (!modal.querySelector('[data-source-pref-panel-v82]')) {
      const topic = modal.querySelector('.quick-topic-feedback');
      const target = topic || modal.querySelector('.quick-feedback-help');
      if (target) target.insertAdjacentHTML('afterend', sourcePreferenceMarkup(article));
    }
  }

  function topicValues(article = {}) {
    return [...new Set([article.category, ...(article.tags || []), ...(article.matches || [])].map(clean).filter(value => value && value !== 'À suivre'))].slice(0, 3);
  }

  function applyTopicLess(article, button) {
    const prefs = readJson(TOPIC_PREF_KEY, {});
    for (const topic of topicValues(article)) prefs[topic] = Math.max(-2, Number(prefs[topic] || 0) - 1);
    writeJson(TOPIC_PREF_KEY, prefs);
    const feedback = readJson(FEEDBACK_KEY, {});
    feedback[String(article.id || '')] = 'less';
    writeJson(FEEDBACK_KEY, feedback);
    const modal = button.closest('.quick-summary-backdrop');
    modal?.querySelectorAll('[data-quick-feedback]').forEach(item => item.classList.toggle('selected', item === button));
    window.dispatchEvent(new CustomEvent('news-topic-preferences-changed', { detail: prefs }));
  }

  function applyArticleOnly(article) {
    const feedback = readJson(FEEDBACK_KEY, {});
    feedback[String(article.id || '')] = 'not';
    writeJson(FEEDBACK_KEY, feedback);
    document.querySelector(`.article-card[data-article="${CSS.escape(String(article.id || ''))}"]`)?.setAttribute('hidden', '');
    document.querySelector('.quick-summary-backdrop')?.remove();
    document.body.classList.remove('quick-summary-open');
  }

  function updateSourcePreference(article, value) {
    const prefs = readJson(SOURCE_PREF_KEY, {});
    const key = sourceKey(article.source || '');
    if (!key) return;
    if (value === 0) delete prefs[key];
    else prefs[key] = value;
    writeJson(SOURCE_PREF_KEY, prefs);

    const cache = readJson(CACHE_KEY, null);
    if (cache && Array.isArray(cache.articles)) writeJson(CACHE_KEY, transformPayload(cache));
    scheduleDecorate();
    decorateQuickSummary();
  }

  function currentView() {
    return document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function articleMap() {
    return new Map(currentArticles().map(article => [String(article.id || ''), article]));
  }

  function visualImportance(article = {}) {
    const pref = sourcePreference(article.source || '');
    return Number(article.scoreV82Base ?? article.score ?? 0) + qualityScore(article) + preferenceAdjustment(pref);
  }

  function diversifiedOrder(items) {
    const pool = items.slice();
    const result = [];
    while (pool.length) {
      const top = pool[0];
      const topImportance = visualImportance(top.article);
      let bestIndex = 0;
      let bestValue = -Infinity;
      const last = result[result.length - 1]?.article;
      const previous = result[result.length - 2]?.article;
      const limit = Math.min(pool.length, 5);

      for (let index = 0; index < limit; index++) {
        const candidate = pool[index];
        const importance = visualImportance(candidate.article);
        if (index > 0 && topImportance - importance > 28) continue;
        let value = -index * 7;
        if (last && clean(candidate.article.category) === clean(last.category)) value -= 18;
        if (previous && clean(candidate.article.category) === clean(previous.category)) value -= 7;
        if (last && sourceKey(candidate.article.source) === sourceKey(last.source)) value -= 11;
        if (candidate.article.essential) value += 4;
        if (value > bestValue) { bestValue = value; bestIndex = index; }
      }
      result.push(pool.splice(bestIndex, 1)[0]);
    }
    return result;
  }

  function decorateFeed() {
    if (currentView() !== 'home') return;
    const map = articleMap();
    document.querySelectorAll('.page .feed').forEach(feed => {
      const cards = [...feed.querySelectorAll(':scope > .article-card[data-article]')]
        .map(card => ({ card, article: map.get(String(card.dataset.article || '')) }))
        .filter(item => item.article);
      if (!cards.length) return;

      for (const item of cards) {
        const pref = sourcePreference(item.article.source || '');
        const mergedCount = new Set([item.article.source, ...(Array.isArray(item.article.sources) ? item.article.sources : [])].map(sourceKey).filter(Boolean)).size;
        if (pref <= -99 && mergedCount <= 1) item.card.hidden = true;
      }

      const essential = diversifiedOrder(cards.filter(item => item.card.classList.contains('essential-v77') && !item.card.hidden));
      const regular = diversifiedOrder(cards.filter(item => !item.card.classList.contains('essential-v77') && !item.card.hidden));
      essential.forEach((item, index) => { item.card.style.order = String(-1000 + index); });
      regular.forEach((item, index) => { item.card.style.order = String(100 + index); });

      const separator = feed.querySelector(':scope > .essential-separator-v78');
      if (separator) separator.style.order = '0';
    });
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateQuickSummary();
      decorateFeed();
    });
  }

  document.addEventListener('click', event => {
    const modal = event.target.closest?.('.quick-summary-backdrop');
    const article = modal ? activeModalArticle(modal) : null;

    const oldNot = event.target.closest?.('[data-quick-feedback="not"]');
    if (oldNot && article) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyTopicLess(article, oldNot);
      return;
    }

    const articleOnly = event.target.closest?.('[data-article-only-v82]');
    if (articleOnly && article) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyArticleOnly(article);
      return;
    }

    const sourceButton = event.target.closest?.('[data-source-pref-v82]');
    if (sourceButton && article) {
      event.preventDefault();
      event.stopImmediatePropagation();
      updateSourcePreference(article, Number(sourceButton.dataset.sourcePrefV82 || 0));
      const panel = sourceButton.closest('[data-source-pref-panel-v82]');
      panel?.querySelectorAll('[data-source-pref-v82]').forEach(button => button.classList.toggle('selected', button === sourceButton));
      return;
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.body;
    if (root) new MutationObserver(scheduleDecorate).observe(root, { childList: true, subtree: true });
    scheduleDecorate();
  }, { once: true });
  window.addEventListener('focus', scheduleDecorate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleDecorate(); });
})();
