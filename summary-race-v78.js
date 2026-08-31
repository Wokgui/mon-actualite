(() => {
  'use strict';

  const upstreamFetch = window.fetch.bind(window);
  const inflightGroq = new Map();
  const pointerStarts = new Map();
  const INFLIGHT_TTL = 25_000;
  const SMART_RACE_DEADLINE = 9_000;
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const LIVE_CACHE_KEY = 'news-live-cache';
  const latencyStats = window.__summaryLatencyV9133 = {
    version: '91.33',
    groqStarted: 0,
    groqReused: 0,
    pointerWarms: 0,
    usefulSamplesMs: [],
    lastUsefulMs: 0
  };

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    if (text.length < 55) return false;
    return !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function nowMs() {
    return typeof performance?.now === 'function' ? performance.now() : Date.now();
  }

  function parseBody(init) {
    try {
      return typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      return null;
    }
  }

  function articleFrom(init) {
    const body = parseBody(init);
    return body?.article && typeof body.article === 'object' ? body.article : null;
  }

  function articleKey(article = {}) {
    return clean(article.url || '') || `${clean(article.source || '')}|${clean(article.title || '')}`;
  }

  function jsonResponse(payload, sourceResponse = null) {
    const headers = new Headers(sourceResponse?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: sourceResponse?.status && sourceResponse.status >= 200 && sourceResponse.status < 300 ? sourceResponse.status : 200,
      statusText: sourceResponse?.statusText || 'OK',
      headers
    });
  }

  async function responseJson(response) {
    if (!response?.ok) return null;
    try { return await response.clone().json(); }
    catch { return null; }
  }

  function rememberGroq(key, dataPromise) {
    if (!key) return;
    const entry = { dataPromise, at: Date.now() };
    inflightGroq.set(key, entry);
    setTimeout(() => {
      if (inflightGroq.get(key) === entry) inflightGroq.delete(key);
    }, INFLIGHT_TTL);
  }

  function goodGroqCandidate(data) {
    const summary = clean(data?.summary || '');
    if (data?.unavailable || !usefulSummary(summary)) return null;
    return {
      ok: true,
      text: summary,
      grounded: Boolean(data?.ai || data?.corroborated),
      origin: data?.cached ? 'shared-cache' : 'parallel-groq',
      raced: true,
      provider: data?.provider || '',
      model: data?.model || ''
    };
  }

  function recordUsefulLatency(key, data) {
    if (!key || !goodGroqCandidate(data)) return;
    const startedAt = pointerStarts.get(key);
    if (!Number.isFinite(startedAt)) return;
    const elapsed = Math.max(0, Math.round(nowMs() - startedAt));
    latencyStats.lastUsefulMs = elapsed;
    latencyStats.usefulSamplesMs = [...latencyStats.usefulSamplesMs, elapsed].slice(-12);
    pointerStarts.delete(key);
  }

  async function goodSmartCandidate(responsePromise) {
    const response = await responsePromise;
    const data = await responseJson(response);
    const summary = clean(data?.text || '');
    if (!data?.ok || !usefulSummary(summary)) return null;
    return { ...data, text: summary, raced: true };
  }

  function firstUseful(candidates) {
    return new Promise(resolve => {
      let pending = candidates.length;
      let settled = false;
      const finish = value => {
        if (settled) return;
        if (value) {
          settled = true;
          resolve(value);
          return;
        }
        pending -= 1;
        if (pending <= 0) {
          settled = true;
          resolve(null);
        }
      };
      for (const candidate of candidates) Promise.resolve(candidate).then(finish, () => finish(null));
    });
  }

  function deadlineValue(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  window.fetch = function summaryRaceFetch(input, init) {
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch {
      return upstreamFetch(input, init);
    }

    if (url.origin !== location.origin || String(init?.method || 'GET').toUpperCase() !== 'POST') {
      return upstreamFetch(input, init);
    }

    const article = articleFrom(init);
    const key = articleKey(article || {});

    if (url.pathname === '/api/article-summary-groq') {
      const existing = key ? inflightGroq.get(key) : null;
      if (existing && Date.now() - existing.at < INFLIGHT_TTL) {
        latencyStats.groqReused += 1;
        return existing.dataPromise.then(data => {
          if (data) return jsonResponse({ ...data, reusedInflight: true });
          return upstreamFetch(input, init);
        });
      }

      latencyStats.groqStarted += 1;
      const rawPromise = upstreamFetch(input, init);
      const feedFallback = clean(article?.summary || '');

      const finalPromise = rawPromise.then(async response => {
        if (!response?.ok || !usefulSummary(feedFallback)) return response;
        const data = await responseJson(response);
        const generated = clean(data?.summary || '');
        if (!data || (!data.unavailable && usefulSummary(generated))) return response;
        return jsonResponse({
          ...data,
          summary: feedFallback,
          unavailable: false,
          ai: false,
          provider: 'feed-fallback',
          model: '',
          raced: true
        }, response);
      });

      const dataPromise = finalPromise
        .then(responseJson)
        .then(data => {
          recordUsefulLatency(key, data);
          return data;
        })
        .catch(() => null);
      rememberGroq(key, dataPromise);
      return finalPromise;
    }

    if (url.pathname === '/api/article-summary-smart') {
      const smartResponsePromise = upstreamFetch(input, init);
      const candidates = [goodSmartCandidate(smartResponsePromise)];
      const groq = key ? inflightGroq.get(key) : null;
      if (groq && Date.now() - groq.at < INFLIGHT_TTL) {
        candidates.push(groq.dataPromise.then(goodGroqCandidate));
      }

      if (candidates.length === 1) return smartResponsePromise;

      return deadlineValue(firstUseful(candidates), SMART_RACE_DEADLINE)
        .then(winner => jsonResponse(winner || { ok: false, text: '', origin: 'parallel-timeout', raced: true }));
    }

    return upstreamFetch(input, init);
  };

  function cachedUsefulSummary(article = {}) {
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    const item = cache[`article:${article.id}`];
    return Boolean(item?.summary && !item.unavailable && usefulSummary(item.summary));
  }

  function immediateFeedSummary(article = {}) {
    const summary = clean(article.summary || '');
    if (!usefulSummary(summary)) return false;
    try {
      const host = new URL(String(article.url || ''), location.href).hostname.toLowerCase();
      if (host === 'news.google.com' || host.endsWith('.news.google.com')) return false;
    } catch {}
    return true;
  }

  function liveArticle(id) {
    const cache = readJson(LIVE_CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    return articles.find(article => String(article.id || '') === String(id || '')) || null;
  }

  function warmFromPointer(card) {
    const article = liveArticle(card?.dataset?.article);
    if (!article?.id || cachedUsefulSummary(article) || immediateFeedSummary(article)) return;
    const key = articleKey(article);
    if (!key) return;
    const existing = inflightGroq.get(key);
    if (existing && Date.now() - existing.at < INFLIGHT_TTL) return;

    pointerStarts.set(key, nowMs());
    latencyStats.pointerWarms += 1;
    const payload = {
      url: article.url,
      title: clean(article.title),
      summary: '',
      source: clean(article.source || '')
    };
    window.fetch('/api/article-summary-groq?v=17', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ mode: 'article', article: payload })
    }).catch(() => {});
  }

  document.addEventListener('pointerdown', event => {
    if (event.isPrimary === false) return;
    if (event.target.closest?.('button,a,input,select,textarea,label,[data-save],[data-category]')) return;
    const card = event.target.closest?.('.article-card[data-article]');
    if (card) warmFromPointer(card);
  }, { capture: true, passive: true });
})();
