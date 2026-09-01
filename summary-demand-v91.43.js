(() => {
  'use strict';

  const RELEASE = '91.44';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const TOP_TARGET = 10;
  const TOTAL_TARGET = 30;
  const INITIAL_GAP_MS = 8000;
  const BACKGROUND_GAP_MS = 14000;
  const RETRY_AFTER_FAILURE_MS = 60000;
  const upstreamFetch = window.fetch.bind(window);
  const inflight = new Map();
  const readyByKey = new Map();
  const attemptedAt = new Map();
  let prewarmRunning = false;
  let prewarmTimer = 0;
  let lastArticleId = '';

  document.documentElement.dataset.summaryDemand = RELEASE;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function words(value = '') {
    const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','article']);
    return normalize(value).split(' ').filter(word => word.length >= 4 && !stop.has(word));
  }

  function overlap(a = '', b = '') {
    const aa = words(a).slice(0, 70);
    const bb = new Set(words(b).slice(0, 90));
    if (aa.length < 4 || bb.size < 4) return 0;
    return aa.filter(word => bb.has(word)).length / aa.length;
  }

  function requestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url || '', location.href);
    } catch {
      return null;
    }
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function articleKey(article = {}) {
    return clean(article.url || '') || `${clean(article.source || '')}|${clean(article.title || '')}`;
  }

  function modalMatches(article = {}) {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return false;
    const shown = normalize(modal.querySelector('.quick-summary-head h2, h2')?.textContent || '');
    const wanted = normalize(article.title || '');
    if (!shown || !wanted) return false;
    return shown === wanted || (Math.min(shown.length, wanted.length) >= 24 && (shown.includes(wanted) || wanted.includes(shown)));
  }

  function foreground(url, body) {
    if (url.searchParams.get('intent') === 'foreground') return true;
    const article = body?.article && typeof body.article === 'object' ? body.article : {};
    return modalMatches(article);
  }

  function jsonResponse(payload, source = null) {
    const headers = new Headers(source?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: source?.status && source.status >= 200 && source.status < 300 ? source.status : 200,
      statusText: source?.statusText || 'OK',
      headers
    });
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function articlePayload(article = {}) {
    return {
      id: article.id,
      url: article.url,
      title: clean(article.title),
      summary: clean(article.summary || article.detail || '').slice(0, 1800),
      source: clean(article.source || '')
    };
  }

  function goodAi(data) {
    const text = clean(data?.text || data?.summary || '');
    if (!data || data.ai !== true || text.length < 55) return null;
    return { ...data, text };
  }

  function cacheAi(article, data) {
    const good = goodAi(data);
    if (!article?.id || !good) return false;
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    cache[`article:${article.id}`] = {
      summary: good.text,
      ai: true,
      grounded: Boolean(good.grounded),
      provider: clean(good.origin || good.provider || 'groq-light'),
      model: clean(good.model || 'openai/gpt-oss-20b'),
      unavailable: false,
      savedAt: Date.now(),
      progressiveV9144: true
    };
    const trimmed = Object.fromEntries(Object.entries(cache).slice(-180));
    writeJson(SUMMARY_CACHE_KEY, trimmed);
    const key = articleKey(article);
    if (key) readyByKey.set(key, good);
    window.dispatchEvent(new CustomEvent('news:ai-summary-ready', { detail: { id: article.id, summary: good.text } }));
    return true;
  }

  function cachedAiEntry(article = {}) {
    if (!article?.id) return null;
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    const item = cache[`article:${article.id}`];
    const text = clean(item?.summary || '');
    if (item?.ai !== true || item?.unavailable || text.length < 55) return null;
    const data = {
      text,
      ai: true,
      grounded: Boolean(item.grounded),
      origin: clean(item.provider || 'cache'),
      model: clean(item.model || '')
    };
    const key = articleKey(article);
    if (key) readyByKey.set(key, data);
    return data;
  }

  async function fastSummary(article, intent = 'foreground') {
    const key = articleKey(article);
    if (!key) return null;
    const ready = readyByKey.get(key);
    if (ready) return ready;

    const existing = inflight.get(key);
    if (existing) {
      if (intent !== 'foreground') return existing;
      const quickWait = await Promise.race([
        existing,
        new Promise(resolve => setTimeout(() => resolve(null), 3500))
      ]);
      if (quickWait) return quickWait;
    }

    const job = (async () => {
      try {
        const response = await upstreamFetch(`/api/article-summary-smart?v=6&intent=${encodeURIComponent(intent)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ article: articlePayload(article), lightweight: true, intent })
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        const good = goodAi(data);
        if (!good) return null;
        readyByKey.set(key, good);
        return good;
      } catch {
        return null;
      } finally {
        setTimeout(() => inflight.delete(key), 12000);
      }
    })();
    inflight.set(key, job);
    return job;
  }

  window.fetch = async function summaryDemandFetch(input, init) {
    const url = requestUrl(input);
    const sameOriginPost = Boolean(url && url.origin === location.origin && String(init?.method || 'GET').toUpperCase() === 'POST');
    if (!sameOriginPost || url.pathname !== '/api/article-summary-groq') return upstreamFetch(input, init);

    const body = parseBody(init) || {};
    if (body?.mode === 'category') return upstreamFetch(input, init);
    const article = body?.article && typeof body.article === 'object' ? body.article : {};

    if (!foreground(url, body)) {
      return jsonResponse({
        summary: '',
        unavailable: true,
        ai: false,
        provider: 'background-managed-v9144',
        model: '',
        summaryPrewarmManagedV9144: true
      });
    }

    const key = articleKey(article);
    const ready = key ? readyByKey.get(key) : null;
    if (ready) {
      return jsonResponse({
        summary: ready.text,
        unavailable: false,
        ai: true,
        grounded: Boolean(ready.grounded),
        provider: ready.origin || ready.provider || 'progressive-cache',
        model: ready.model || 'openai/gpt-oss-20b',
        summaryDemandV9144: true
      });
    }

    const fast = await fastSummary(article, 'foreground');
    if (fast) {
      return jsonResponse({
        summary: fast.text,
        unavailable: false,
        ai: true,
        grounded: Boolean(fast.grounded),
        provider: fast.origin || 'groq-light',
        model: fast.model || 'openai/gpt-oss-20b',
        summaryDemandV9144: true
      });
    }

    const response = await upstreamFetch(input, init);
    try {
      const data = await response.clone().json();
      if (data?.ai === true && clean(data.summary || '').length >= 55) return response;
      return jsonResponse({
        ...data,
        summary: '',
        unavailable: true,
        ai: false,
        provider: data?.provider || 'unavailable',
        summaryDemandV9144: true
      }, response);
    } catch {
      return response;
    }
  };

  function readArticles() {
    const payload = readJson(NEWS_CACHE_KEY, {});
    return Array.isArray(payload?.articles) ? payload.articles.filter(Boolean) : [];
  }

  function orderedArticles() {
    const articles = readArticles();
    const byId = new Map(articles.map(article => [String(article.id || ''), article]));
    const result = [];
    const seen = new Set();
    document.querySelectorAll('.article-card[data-article], [data-stable-home-feed] [data-article]').forEach(card => {
      const id = String(card.dataset.article || '');
      if (!id || seen.has(id)) return;
      const article = byId.get(id);
      if (!article) return;
      seen.add(id);
      result.push(article);
    });
    for (const article of articles) {
      const id = String(article.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(article);
    }
    return result;
  }

  function cachedAi(id) {
    if (!id) return false;
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    const item = cache[`article:${id}`];
    return Boolean(item?.ai === true && !item?.unavailable && clean(item?.summary || '').length >= 55);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitUntilActive() {
    while (document.hidden || !navigator.onLine) await sleep(2500);
  }

  async function prewarmOne(article) {
    if (!article?.id || cachedAi(article.id)) {
      cachedAiEntry(article);
      return true;
    }
    const id = String(article.id);
    const last = Number(attemptedAt.get(id) || 0);
    if (Date.now() - last < RETRY_AFTER_FAILURE_MS) return false;
    attemptedAt.set(id, Date.now());
    const data = await fastSummary(article, 'prewarm');
    if (!data) return false;
    return cacheAi(article, data);
  }

  async function runProgressivePrewarm() {
    if (prewarmRunning || document.hidden || !navigator.onLine) return;
    const articles = orderedArticles().slice(0, TOTAL_TARGET);
    if (!articles.length) return;
    prewarmRunning = true;
    let consecutiveFailures = 0;
    try {
      for (let index = 0; index < articles.length; index++) {
        await waitUntilActive();
        const article = articles[index];
        if (cachedAi(article.id)) {
          cachedAiEntry(article);
          continue;
        }
        const ok = await prewarmOne(article);
        consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
        let gap = index < TOP_TARGET ? INITIAL_GAP_MS : BACKGROUND_GAP_MS;
        if (!ok) gap = Math.max(gap, 20000);
        if (consecutiveFailures >= 2) gap = Math.max(gap, 60000);
        await sleep(gap);
      }
    } finally {
      prewarmRunning = false;
      clearTimeout(prewarmTimer);
      prewarmTimer = setTimeout(runProgressivePrewarm, 120000);
    }
  }

  function scheduleProgressivePrewarm(delay = 1200) {
    clearTimeout(prewarmTimer);
    prewarmTimer = setTimeout(runProgressivePrewarm, delay);
  }

  function readArticle(id) {
    return readArticles().find(article => String(article.id || '') === String(id || '')) || null;
  }

  function replaceSourcePreview() {
    if (!lastArticleId || cachedAi(lastArticleId)) return;
    const article = readArticle(lastArticleId);
    const modal = document.querySelector('.quick-summary-backdrop');
    const node = modal?.querySelector('[data-quick-summary-text]');
    if (!article || !node) return;
    const shown = clean(node.textContent || '');
    const source = clean(article.summary || article.detail || '');
    if (!shown || /résumé ia en cours/i.test(shown)) return;
    const sourceLike = source.length >= 60 && (overlap(shown, source) >= 0.72 || normalize(source).startsWith(normalize(shown).slice(0, 90)));
    if (sourceLike) node.textContent = 'Résumé IA en cours de préparation…';
  }

  document.addEventListener('pointerdown', event => {
    const card = event.target.closest?.('.article-card[data-article], [data-article]');
    if (!card || event.target.closest?.('button,input,select,textarea,a')) return;
    const article = readArticle(card.dataset.article);
    if (article && !cachedAi(article.id)) fastSummary(article, 'foreground').then(data => { if (data) cacheAi(article, data); });
  }, { capture: true, passive: true });

  document.addEventListener('click', event => {
    const card = event.target.closest?.('.article-card[data-article], [data-article]');
    if (!card || event.target.closest?.('button,input,select,textarea,a')) return;
    lastArticleId = String(card.dataset.article || '');
    setTimeout(replaceSourcePreview, 0);
    setTimeout(replaceSourcePreview, 80);
  }, true);

  const observer = new MutationObserver(() => replaceSourcePreview());
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleProgressivePrewarm(1800);
  }, { once: true });
  window.addEventListener('news:stable-render', () => scheduleProgressivePrewarm(900));
  window.addEventListener('focus', () => scheduleProgressivePrewarm(1200));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleProgressivePrewarm(1200);
  });
})();
