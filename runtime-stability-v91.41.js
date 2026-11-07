(() => {
  'use strict';

  const RELEASE = '91.42';
  const VISUAL_KEY = 'news-visual-backfill-v3';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const SUMMARY_ATTEMPTS_KEY = 'news-summary-prewarm-attempts-v1';
  const SUMMARY_RESET_KEY = 'news-summary-cache-reset-v91.42';
  const nativeFetch = window.fetch.bind(window);
  const visualJobs = new Map();
  let prewarmStarted = false;
  let navIntent = null;

  document.documentElement.dataset.runtimeStability = RELEASE;

  function requestUrl(input) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      return new URL(raw, location.href);
    } catch {
      return null;
    }
  }

  function compactText(value = '') {
    return String(value ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalize(value = '') {
    return compactText(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  const SUMMARY_STOP = new Set([
    'avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','tous','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','font','comme','dont','elle','elles','ils','nous','vous','notre','votre','aussi','encore','deja','tres','moins','depuis','alors','chez','contre','lors','peut','peuvent','avait','avoir','sera','un','le','la','du','de','au','en','et','ou','ce','se','sa','ne','pas','article','direct','video','selon'
  ]);

  function normalizedWords(value = '') {
    return normalize(value).split(/\s+/).filter(word => word.length >= 4 && !SUMMARY_STOP.has(word));
  }

  function overlapRatio(a = '', b = '') {
    const aa = normalizedWords(a).slice(0, 70);
    const bb = new Set(normalizedWords(b).slice(0, 70));
    if (aa.length < 5 || bb.size < 5) return 0;
    return aa.filter(word => bb.has(word)).length / aa.length;
  }

  function summarySentences(value = '') {
    return compactText(value).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => sentence.trim()).filter(Boolean) || [];
  }

  function summaryBoilerplate(value = '') {
    const text = normalize(value);
    return !text || [
      'connectez vous','abonnez vous','newsletter','acceptez les cookies','voir aussi','lire aussi',
      'voir plus de titres et de points de vue','partager cet article','retrouvez nous sur','en savoir plus'
    ].some(term => text.includes(term));
  }

  function summaryJaccard(a = '', b = '') {
    const aa = new Set(normalizedWords(a));
    const bb = new Set(normalizedWords(b));
    if (!aa.size || !bb.size) return 0;
    let common = 0;
    for (const token of aa) if (bb.has(token)) common += 1;
    return common / Math.max(1, new Set([...aa, ...bb]).size);
  }

  function summarySentenceScore(sentence, title, index, total) {
    const words = normalizedWords(sentence);
    if (words.length < 5 || summaryBoilerplate(sentence)) return -Infinity;
    const titleSet = new Set(normalizedWords(title));
    const overlap = words.filter(word => titleSet.has(word)).length;
    let score = overlap * 7 + Math.min(new Set(words).size, 18) * 0.45;
    if (/\d/.test(sentence)) score += 3;
    if (/\b(?:annonce|indique|confirme|prévoit|devrait|pourrait|entraîne|provoque|après|avant|depuis|contre|accord|décision|hausse|baisse|mort|morts|victime|victimes|million|milliard|pour cent|%)\b/i.test(sentence)) score += 2.5;
    if (/\b[A-ZÀ-ÖØ-Þ][\p{L}'’-]{2,}\b/u.test(sentence)) score += 1.5;
    const length = compactText(sentence).length;
    if (length >= 65 && length <= 230) score += 2;
    if (length > 300) score -= 2;
    if (index >= Math.ceil(total / 2)) score += 0.8;
    return score;
  }

  function extractiveDigest(value = '', title = '') {
    const source = compactText(value);
    const list = summarySentences(source);
    const ranked = list
      .map((sentence, index) => ({ sentence, index, score: summarySentenceScore(sentence, title, index, list.length) }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    if (!ranked.length) return source.length <= 420 ? source : '';
    const chosen = [];
    let words = 0;
    for (const item of ranked) {
      if (chosen.some(previous => summaryJaccard(previous.sentence, item.sentence) >= 0.72)) continue;
      const count = item.sentence.split(/\s+/).filter(Boolean).length;
      if (chosen.length >= 2 && words + count > 110) continue;
      chosen.push(item);
      words += count;
      if (chosen.length >= 3 || words >= 85) break;
    }
    if (!chosen.length) return '';
    const lead = chosen[0];
    const rest = chosen.slice(1).sort((a, b) => a.index - b.index);
    return [lead, ...rest].map(item => compactText(item.sentence)).join(' ').trim();
  }

  function looksLikeRawBeginning(summary = '', article = {}) {
    const text = compactText(summary);
    if (!text) return false;
    return [article?.summary, article?.detail].map(compactText).filter(value => value.length >= 90).some(value => {
      const head = value.slice(0, 420);
      return overlapRatio(text.slice(0, 420), head) >= 0.78 ||
        normalizedWords(text.slice(0, 260)).join(' ').startsWith(normalizedWords(head).join(' ').slice(0, 90));
    });
  }

  async function requestBody(input, init) {
    try {
      if (typeof init?.body === 'string') return JSON.parse(init.body);
      if (input instanceof Request) return await input.clone().json();
    } catch {}
    return {};
  }

  function jsonResponse(payload, response = null) {
    const headers = new Headers(response?.headers || {});
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(payload), {
      status: response?.status || 200,
      statusText: response?.statusText || 'OK',
      headers
    });
  }

  async function improveSummaryResponse(response, body = {}, url = null) {
    if (!response.ok) return response;
    try {
      const payload = await response.clone().json();
      if (body?.mode === 'category') return response;
      const article = body?.article && typeof body.article === 'object' ? body.article : {};
      const foreground = url?.searchParams?.get('intent') === 'foreground';

      if (!foreground && payload?.ai !== true) {
        return jsonResponse({
          ...payload,
          summary: '',
          unavailable: true,
          ai: false,
          provider: payload?.provider || 'non-ai-background',
          summaryModeV9142: 'background-ai-required'
        }, response);
      }

      if (payload?.unavailable || !payload?.summary) return response;
      const factualFallback = payload.ai === false || /factual|feed-fallback/i.test(String(payload.provider || ''));
      if (!factualFallback && !looksLikeRawBeginning(payload.summary, article)) return response;

      const digest = extractiveDigest(payload.summary, article.title || '');
      if (digest.length < 55) return response;
      return jsonResponse({
        ...payload,
        summary: digest,
        unavailable: false,
        provider: factualFallback ? 'factual-extractive' : payload.provider,
        finalSummaryV9142: true,
        summaryModeV9142: factualFallback ? 'extractive-fallback' : 'anti-copy-condense'
      }, response);
    } catch {
      return response;
    }
  }

  window.fetch = async function runtimeStableFetch(input, init) {
    const url = requestUrl(input);
    if (url && url.origin === location.origin && url.pathname === '/api/article-summary-smart' && url.searchParams.get('v') === '3') {
      return jsonResponse({ ok: false, text: '', grounded: false, origin: 'ai-prewarm-disabled-v9142' });
    }
    const summaryRequest = Boolean(url && url.origin === location.origin && url.pathname === '/api/article-summary-groq');
    const bodyPromise = summaryRequest ? requestBody(input, init) : Promise.resolve({});
    const response = await nativeFetch(input, init);
    if (!summaryRequest) return response;
    return improveSummaryResponse(response, await bodyPromise, url);
  };

  function resetSummaryCacheOnce() {
    try {
      if (localStorage.getItem(SUMMARY_RESET_KEY) === '1') return;
      localStorage.removeItem(SUMMARY_CACHE_KEY);
      localStorage.removeItem(SUMMARY_ATTEMPTS_KEY);
      localStorage.setItem(SUMMARY_RESET_KEY, '1');
    } catch {}
  }

  function readNewsCache() {
    try {
      const payload = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || 'null');
      return Array.isArray(payload?.articles) ? payload.articles : [];
    } catch {
      return [];
    }
  }

  function readVisualCache() {
    try {
      const value = JSON.parse(localStorage.getItem(VISUAL_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeVisualSuccess(id, url) {
    if (!id || !url) return;
    const cache = readVisualCache();
    cache[String(id)] = { url, savedAt: Date.now() };
    const entries = Object.entries(cache)
      .filter(([, item]) => item?.url && Date.now() - Number(item.savedAt || 0) < 30 * 86400000)
      .slice(-300);
    try { localStorage.setItem(VISUAL_KEY, JSON.stringify(Object.fromEntries(entries))); } catch {}
  }

  function endpointFor(article = {}) {
    const params = new URLSearchParams({
      v: '19',
      url: String(article.url || '').slice(0, 1900),
      image: String(article.image || '').slice(0, 1900),
      title: String(article.title || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      category: String(article.category || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      source: String(article.source || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      custom: article.customSource ? '1' : '0'
    });
    return `/api/article-thumbnail?${params}`;
  }

  function neutralImage(img) {
    const src = String(img?.currentSrc || img?.src || '');
    return Boolean(img && (
      img.classList.contains('source-tile-visual') ||
      img.closest('.v42-image-failed') ||
      src.startsWith('data:image/svg+xml') ||
      /neutral|fallback|source-tile/i.test(src) ||
      (img.complete && img.naturalWidth > 0 && img.naturalWidth < 8)
    ));
  }

  function articleMap() {
    return new Map(readNewsCache().filter(Boolean).map(article => [String(article.id || ''), article]));
  }

  function promoteImage(img, high = false) {
    if (!(img instanceof HTMLImageElement)) return;
    if (high) {
      img.loading = 'eager';
      try { img.fetchPriority = 'high'; } catch {}
    }
    img.decoding = 'async';
  }

  function installEndpoint(id, endpoint) {
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      if (String(card.dataset.article || '') !== String(id)) return;
      const img = card.querySelector('img.article-image, img');
      if (!img || !neutralImage(img)) return;
      promoteImage(img, true);
      img.classList.remove('source-tile-visual');
      img.classList.add('prepared-visual');
      img.src = endpoint;
    });
  }

  function applyRememberedImages(root = document) {
    const cache = readVisualCache();
    const cards = [];
    if (root instanceof Element && root.matches('.article-card[data-article]')) cards.push(root);
    root.querySelectorAll?.('.article-card[data-article]').forEach(card => cards.push(card));
    cards.forEach((card, index) => {
      const img = card.querySelector('img.article-image, img');
      if (!img) return;
      promoteImage(img, index < 12 || card.getBoundingClientRect().top < innerHeight * 1.5);
      const remembered = cache[String(card.dataset.article || '')];
      if (remembered?.url && (neutralImage(img) || !img.src)) {
        img.classList.remove('source-tile-visual');
        img.classList.add('prepared-visual');
        img.src = remembered.url;
      }
    });
  }

  async function recoverVisual(article) {
    const id = String(article?.id || '');
    if (!id) return false;
    if (visualJobs.has(id)) return visualJobs.get(id);
    const job = (async () => {
      const endpoint = endpointFor(article);
      try {
        const response = await nativeFetch(endpoint, { cache: 'force-cache' });
        const status = response.headers.get('X-Thumbnail-Status') || '';
        const type = response.headers.get('Content-Type') || '';
        if (!response.ok || /fallback|publisher-tile|neutral/i.test(status) || /image\/svg\+xml/i.test(type)) return false;
        const blob = await response.blob();
        if (blob.size < 512) return false;
        writeVisualSuccess(id, endpoint);
        installEndpoint(id, endpoint);
        return true;
      } catch {
        return false;
      } finally {
        visualJobs.delete(id);
      }
    })();
    visualJobs.set(id, job);
    return job;
  }

  async function prewarmTopImages() {
    if (prewarmStarted || document.hidden || !navigator.onLine) return;
    prewarmStarted = true;
    try {
      const articles = readNewsCache().filter(Boolean).slice(0, 24);
      const existing = readVisualCache();
      articles.slice(0, 18).forEach(article => {
        const src = String(article?.visual?.url || article?.image || existing[String(article.id || '')]?.url || '');
        if (!src) return;
        try {
          const img = new Image();
          img.decoding = 'async';
          img.fetchPriority = 'low';
          img.src = src;
        } catch {}
      });
      const missing = articles.filter(article => {
        const id = String(article.id || '');
        if (!id || existing[id]?.url) return false;
        return String(article?.visual?.status || article?.visualStatus || '') !== 'ready';
      }).slice(0, 6);
      let cursor = 0;
      const worker = async () => {
        while (cursor < missing.length) {
          await recoverVisual(missing[cursor++]);
          await new Promise(resolve => setTimeout(resolve, 320));
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      prewarmStarted = false;
    }
  }

  function warmVisiblePlaceholders(root = document) {
    applyRememberedImages(root);
    const map = articleMap();
    const cards = [];
    if (root instanceof Element && root.matches('.article-card[data-article]')) cards.push(root);
    root.querySelectorAll?.('.article-card[data-article]').forEach(card => cards.push(card));
    cards.filter(card => card.getBoundingClientRect().top < innerHeight * 1.8).slice(0, 6).forEach(card => {
      const img = card.querySelector('img.article-image, img');
      if (!img || !neutralImage(img)) return;
      const article = map.get(String(card.dataset.article || ''));
      if (article) recoverVisual(article);
    });
  }

  function navButtonFromEvent(event) {
    return event.target?.closest?.('.bottom-nav [data-view]') || null;
  }

  function navViewReady(view = '') {
    if (view === 'sheet') return Boolean(document.querySelector('.sheet-backdrop[data-close-sheet]'));
    if (view === 'brief') return Boolean(document.querySelector('[data-stable-brief-content]'));
    if (view === 'home') return Boolean(document.querySelector('[data-stable-home-feed]'));
    return true;
  }

  document.addEventListener('pointerdown', event => {
    const button = navButtonFromEvent(event);
    if (!button || (typeof event.button === 'number' && event.button !== 0)) return;
    navIntent = {
      view: String(button.dataset.view || ''),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now()
    };
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', event => {
    if (!navIntent || event.pointerId !== navIntent.pointerId) return;
    if (Math.hypot(event.clientX - navIntent.x, event.clientY - navIntent.y) > 18) navIntent = null;
  }, { capture: true, passive: true });

  document.addEventListener('pointercancel', () => { navIntent = null; }, true);

  document.addEventListener('pointerup', event => {
    const intent = navIntent;
    navIntent = null;
    if (!intent || event.pointerId !== intent.pointerId || performance.now() - intent.at > 1200) return;
    if (Math.hypot(event.clientX - intent.x, event.clientY - intent.y) > 18) return;
    window.setTimeout(() => {
      if (navViewReady(intent.view)) return;
      const current = document.querySelector(`.bottom-nav [data-view="${CSS.escape(intent.view)}"]`);
      current?.click();
    }, 220);
  }, { capture: true, passive: true });

  function bootDomStability() {
    const style = document.createElement('style');
    style.textContent = `.bottom-nav [data-view]{touch-action:manipulation;-webkit-tap-highlight-color:transparent}.article-card img.article-image{transition:opacity .12s linear}`;
    document.head.appendChild(style);
    resetSummaryCacheOnce();
    applyRememberedImages(document);
    warmVisiblePlaceholders(document);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          applyRememberedImages(node);
          warmVisiblePlaceholders(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(prewarmTopImages, 450);
    window.setTimeout(prewarmTopImages, 2200);
  }

  document.addEventListener('DOMContentLoaded', bootDomStability, { once: true });
  window.addEventListener('focus', () => window.setTimeout(prewarmTopImages, 150));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) window.setTimeout(prewarmTopImages, 150);
  });
})();