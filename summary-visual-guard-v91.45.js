(() => {
  'use strict';

  const RELEASE = '91.45';
  const VISUAL_CACHE_KEY = 'news-visual-backfill-v3';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const nativeFetch = window.fetch.bind(window);
  let activeCard = null;
  let activeArticleId = '';
  let modalOpenedAt = 0;

  document.documentElement.dataset.summaryVisualGuard = RELEASE;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = value => clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); }
    catch { return null; }
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function jsonResponse(payload, source) {
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

  // The lightweight Groq endpoint can occasionally reject a valid paraphrase as
  // insufficiently supported. Retry only those semantic-validation failures once;
  // never retry rate limits, missing source text, network failures or missing keys.
  window.fetch = async function summaryRetryFetch(input, init) {
    const url = requestUrl(input);
    const isSmartPost = Boolean(
      url && url.origin === location.origin && url.pathname === '/api/article-summary-smart'
      && String(init?.method || 'GET').toUpperCase() === 'POST'
    );
    if (!isSmartPost || url.searchParams.get('retry9145') === '1') return nativeFetch(input, init);

    const first = await nativeFetch(input, init);
    let data = null;
    try { data = await first.clone().json(); } catch {}
    const error = clean(data?.error || '');
    if (!first.ok || data?.ai === true || !['support-check', 'title-restatement'].includes(error)) return first;

    await new Promise(resolve => setTimeout(resolve, 240));
    const retry = new URL(url.href);
    retry.searchParams.set('retry9145', '1');
    const second = await nativeFetch(retry.href, init);
    try {
      const retried = await second.clone().json();
      if (retried?.ai === true && clean(retried?.text || '').length >= 55) {
        return jsonResponse({ ...retried, retryV9145: true }, second);
      }
    } catch {}
    return second;
  };

  function usefulUrl(raw = '') {
    const value = clean(raw);
    if (!value || /^data:image\/svg\+xml/i.test(value)) return '';
    if (/neutral-fallback|publisher-tile/i.test(value)) return '';
    return value;
  }

  function cssBackgroundUrl(node) {
    if (!node) return '';
    try {
      const raw = getComputedStyle(node).backgroundImage || node.style?.backgroundImage || '';
      const match = raw.match(/^url\(["']?(.*?)["']?\)$/i);
      return usefulUrl(match?.[1] || '');
    } catch { return ''; }
  }

  function currentCardVisual(card, articleId = '') {
    if (card) {
      const selectors = [
        'img.article-image',
        '.source-tile-visual img',
        '.article-visual img',
        '.article-media img',
        'picture img',
        'img'
      ];
      for (const selector of selectors) {
        const nodes = card.querySelectorAll(selector);
        for (const image of nodes) {
          const src = usefulUrl(image.currentSrc || image.getAttribute('src') || image.src || '');
          if (src) return src;
        }
      }
      for (const node of card.querySelectorAll('.source-tile-visual, .article-visual, .article-media, [style*="background-image"]')) {
        const src = cssBackgroundUrl(node);
        if (src) return src;
      }
    }

    const visuals = readJson(VISUAL_CACHE_KEY, {});
    const remembered = usefulUrl(visuals[String(articleId || '')]?.url || '');
    if (remembered) return remembered;

    const payload = readJson(NEWS_CACHE_KEY, {});
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    const article = articles.find(item => String(item?.id || '') === String(articleId || '')) || {};
    return usefulUrl(article?.visual?.url)
      || usefulUrl(article?.image)
      || usefulUrl(article?.quickVisualUrl)
      || '';
  }

  function ensureModalImage() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return false;
    const card = activeCard?.isConnected
      ? activeCard
      : document.querySelector(`[data-article="${CSS.escape(String(activeArticleId || ''))}"]`);
    const src = currentCardVisual(card, activeArticleId);
    if (!src) return false;

    let image = modal.querySelector('.quick-summary-image');
    if (!image) {
      image = document.createElement('img');
      image.className = 'quick-summary-image';
      image.alt = '';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      const header = modal.querySelector('.quick-summary-head');
      header?.insertAdjacentElement('afterend', image);
    }
    const current = usefulUrl(image.currentSrc || image.getAttribute('src') || '');
    if (current !== src) image.src = src;
    return true;
  }

  function titleTokens(title = '') {
    const stop = new Set(['avec','dans','pour','plus','cette','sont','être','etre','leur','mais','sans','entre','une','des','les','sur','qui','que','aux','par','son','ses','est']);
    return new Set(normalize(title).split(' ').filter(token => token.length >= 4 && !stop.has(token)));
  }

  function extractiveFallback(article = {}) {
    const source = clean([article.summary, article.detail].filter(Boolean).join(' '));
    if (source.length < 90) return '';
    const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(item => clean(item)).filter(item => item.length >= 35) || [];
    if (!sentences.length) return '';
    const wanted = titleTokens(article.title || '');
    const scored = sentences.map((sentence, index) => {
      const tokens = normalize(sentence).split(' ').filter(Boolean);
      const overlap = tokens.filter(token => wanted.has(token)).length;
      const numbers = (sentence.match(/\d/g) || []).length ? 2 : 0;
      const proper = (sentence.match(/\b[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]{2,}\b/g) || []).length;
      const boilerplate = /newsletter|cookie|abonn|connectez|partager|lire aussi|voir aussi/i.test(sentence) ? 20 : 0;
      const density = Math.min(2, tokens.filter(token => token.length >= 6).length / 6);
      return { sentence, index, score: overlap * 3 + numbers + Math.min(2, proper) + density - boilerplate };
    }).filter(item => item.score > -5);
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = [];
    let words = 0;
    for (const item of scored) {
      const count = item.sentence.split(/\s+/).length;
      if (selected.length >= 3 || words + count > 105) continue;
      if (selected.some(existing => normalize(existing).includes(normalize(item.sentence).slice(0, 70)))) continue;
      selected.push(item.sentence);
      words += count;
      if (selected.length >= 2 && words >= 48) break;
    }
    return selected.join(' ').trim();
  }

  function activeArticle() {
    const payload = readJson(NEWS_CACHE_KEY, {});
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    return articles.find(item => String(item?.id || '') === String(activeArticleId || '')) || null;
  }

  function ensureUsefulSummary() {
    const modal = document.querySelector('.quick-summary-backdrop');
    const box = modal?.querySelector('[data-quick-summary-text]');
    if (!modal || !box) return;
    const shown = clean(box.textContent || '');
    const unavailable = /résumé ia .*indisponible|résumé indisponible/i.test(shown);
    const pendingTooLong = /résumé ia en cours/i.test(shown) && modalOpenedAt && Date.now() - modalOpenedAt > 7000;
    if (!unavailable && !pendingTooLong) return;
    const fallback = extractiveFallback(activeArticle() || {});
    if (!fallback) return;
    box.textContent = fallback;
    let status = modal.querySelector('.quick-summary-status-v9138');
    if (!status) {
      status = document.createElement('div');
      status.className = 'quick-summary-status-v9138 source';
      box.before(status);
    }
    status.className = 'quick-summary-status-v9138 source';
    status.textContent = 'Résumé automatique';
    modal.dataset.localFallbackV9145 = '1';
  }

  function scheduleModalSync() {
    for (const delay of [0, 70, 220, 600, 1400]) {
      setTimeout(() => {
        ensureModalImage();
        ensureUsefulSummary();
      }, delay);
    }
    setTimeout(ensureUsefulSummary, 7200);
  }

  function rememberCard(target) {
    const card = target?.closest?.('[data-article]');
    if (!card) return;
    activeCard = card;
    activeArticleId = String(card.dataset.article || '');
    modalOpenedAt = Date.now();
    scheduleModalSync();
  }

  document.addEventListener('pointerdown', event => rememberCard(event.target), true);
  document.addEventListener('click', event => rememberCard(event.target), true);

  const observer = new MutationObserver(() => {
    if (!document.querySelector('.quick-summary-backdrop')) return;
    ensureModalImage();
    ensureUsefulSummary();
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
  }, { once: true });

  window.__summaryVisualGuardV9145 = {
    version: RELEASE,
    ensureModalImage,
    extractiveFallback,
    retryErrors: ['support-check', 'title-restatement']
  };
})();
