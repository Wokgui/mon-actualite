(() => {
  'use strict';

  const RELEASE = '91.43';
  const upstreamFetch = window.fetch.bind(window);
  const inflight = new Map();
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

  async function fastSummary(article) {
    const key = articleKey(article);
    if (key && inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      try {
        const response = await upstreamFetch('/api/article-summary-smart?v=5&intent=foreground', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ article })
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        const text = clean(data?.text || '');
        if (!data?.ok || data?.ai !== true || text.length < 55) return null;
        return { ...data, text };
      } catch {
        return null;
      } finally {
        if (key) setTimeout(() => inflight.delete(key), 15000);
      }
    })();
    if (key) inflight.set(key, job);
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
        provider: 'background-disabled-v9143',
        model: '',
        summaryPrewarmBlockedV9143: true
      });
    }

    const fast = await fastSummary(article);
    if (fast) {
      return jsonResponse({
        summary: fast.text,
        unavailable: false,
        ai: true,
        grounded: true,
        provider: fast.origin || 'groq-fast',
        model: fast.model || 'openai/gpt-oss-20b',
        summaryDemandV9143: true
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
        summaryDemandV9143: true
      }, response);
    } catch {
      return response;
    }
  };

  function readArticle(id) {
    try {
      const payload = JSON.parse(localStorage.getItem('news-live-cache') || 'null');
      const articles = Array.isArray(payload?.articles) ? payload.articles : [];
      return articles.find(article => String(article.id || '') === String(id || '')) || null;
    } catch {
      return null;
    }
  }

  function cachedAi(id) {
    try {
      const cache = JSON.parse(localStorage.getItem('news-article-summaries-v8') || '{}');
      return cache?.[`article:${id}`]?.ai === true;
    } catch {
      return false;
    }
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

  document.addEventListener('click', event => {
    const card = event.target.closest?.('.article-card[data-article], [data-article]');
    if (!card || event.target.closest?.('button,input,select,textarea,a')) return;
    lastArticleId = String(card.dataset.article || '');
    setTimeout(replaceSourcePreview, 0);
    setTimeout(replaceSourcePreview, 80);
  }, true);

  const observer = new MutationObserver(() => replaceSourcePreview());
  document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }), { once: true });
})();
