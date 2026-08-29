(() => {
  'use strict';

  const upstreamFetch = window.fetch.bind(window);
  const inflightGroq = new Map();
  const INFLIGHT_TTL = 25_000;
  const SMART_RACE_DEADLINE = 9_000;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    if (text.length < 55) return false;
    return !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
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
    if (data?.unavailable || !usefulSummary(summary)) throw new Error('groq summary unavailable');
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

  async function goodSmartCandidate(responsePromise) {
    const response = await responsePromise;
    const data = await responseJson(response);
    const summary = clean(data?.text || '');
    if (!data?.ok || !usefulSummary(summary)) throw new Error('smart summary unavailable');
    return { ...data, text: summary, raced: true };
  }

  function deadline(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('summary race timeout')), timeoutMs))
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

      return deadline(Promise.any(candidates), SMART_RACE_DEADLINE)
        .then(winner => jsonResponse(winner))
        .catch(() => jsonResponse({ ok: false, text: '', origin: 'parallel-timeout', raced: true }));
    }

    return upstreamFetch(input, init);
  };
})();
