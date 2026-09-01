(() => {
  'use strict';

  const RELEASE = '91.46';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const SUMMARY_CACHE_KEY = 'news-article-summaries-v8';
  const blockedHeavyPaths = new Set([
    '/api/article-summary-multisource',
    '/api/article-story-intelligence'
  ]);
  const previousFetch = window.fetch.bind(window);
  let activeArticleId = '';

  document.documentElement.dataset.qualityGuard = RELEASE;

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

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); }
    catch { return null; }
  }

  function synthetic(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  // These two legacy background endpoints use the 120B model and were consuming
  // nearly the entire Groq TPM budget while the user was simply reading the feed.
  // The quick article modal does not depend on them, so keep that budget for the
  // lightweight 20B summary path instead.
  window.fetch = function qualityBudgetFetch(input, init) {
    const url = requestUrl(input);
    const method = String(init?.method || 'GET').toUpperCase();
    if (url && url.origin === location.origin && method === 'POST' && blockedHeavyPaths.has(url.pathname)) {
      if (url.pathname === '/api/article-story-intelligence') {
        return Promise.resolve(synthetic({ ok: false, unavailable: true, ai: false, story: null, provider: 'budget-guard-v9146' }));
      }
      return Promise.resolve(synthetic({ ok: false, unavailable: true, ai: false, summary: '', provider: 'budget-guard-v9146' }));
    }
    return previousFetch(input, init);
  };

  function articles() {
    const payload = readJson(NEWS_CACHE_KEY, {});
    return Array.isArray(payload?.articles) ? payload.articles : [];
  }

  function articleById(id) {
    return articles().find(article => String(article?.id || '') === String(id || '')) || null;
  }

  function modalArticle(modal) {
    const active = articleById(activeArticleId);
    if (active) return active;
    const heading = normalize(modal?.querySelector('.quick-summary-head h2, h2')?.textContent || '');
    if (!heading) return null;
    return articles().find(article => {
      const title = normalize(article?.title || '');
      return title === heading || (Math.min(title.length, heading.length) > 24 && (title.includes(heading) || heading.includes(title)));
    }) || null;
  }

  function tokenOverlap(a = '', b = '') {
    const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','mais','sans','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','article']);
    const left = normalize(a).split(' ').filter(token => token.length >= 4 && !stop.has(token));
    const right = new Set(normalize(b).split(' ').filter(token => token.length >= 4 && !stop.has(token)));
    if (left.length < 5 || right.size < 5) return 0;
    return left.filter(token => right.has(token)).length / left.length;
  }

  function badSummaryReason(text, article = {}) {
    const value = clean(text);
    if (!value || /résumé ia (?:en cours|momentanément indisponible)|résumé indisponible/i.test(value)) return 'missing';
    if (/aucune information factuelle|ne fournit (?:aucune|pas d[’']?) information|ne contient (?:aucune|pas assez d[’']?) information|impossible de (?:résumer|déterminer)|le texte (?:fourni|source) ne permet pas|je ne peux pas (?:résumer|déterminer)/i.test(value)) return 'refusal';
    if (/(?:\.{3}|…)\s*$/.test(value)) return 'truncated';
    if (/^[a-zà-ÿ][^.!?]{0,35}\s+-\s+[A-ZÀ-ÖØ-Ý]/u.test(value)) return 'raw-prefix';

    const source = clean([article.summary, article.detail].filter(Boolean).join(' '));
    if (source.length >= 100) {
      const shown = normalize(value);
      const raw = normalize(source);
      if (shown.length >= 70 && (raw.startsWith(shown.slice(0, 100)) || shown.startsWith(raw.slice(0, 100)))) return 'source-copy';
      if (value.length < source.length * 0.85 && tokenOverlap(value, source) >= 0.9) return 'source-copy';
    }
    return '';
  }

  function setSummaryStatus(modal, label, ai = false) {
    const box = modal?.querySelector('[data-quick-summary-text]');
    if (!box) return;
    let status = modal.querySelector('.quick-summary-status-v9138');
    if (!status) {
      status = document.createElement('div');
      box.before(status);
    }
    status.className = `quick-summary-status-v9138 ${ai ? 'ai' : 'source'}`;
    status.textContent = label;
  }

  function cleanSourceLead(value = '') {
    let text = clean(value);
    text = text.replace(/^[a-zà-ÿ][^.!?]{0,35}\s+-\s+(?=[A-ZÀ-ÖØ-Ý])/u, '');
    text = text.replace(/(?:\.{3}|…)\s*$/, '').trim();
    return text;
  }

  function automaticFallback(article = {}) {
    const source = cleanSourceLead([article.detail, article.summary].filter(Boolean).join(' '));
    if (source.length < 90) return '';
    const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(clean).filter(sentence => sentence.length >= 38) || [];
    if (!sentences.length) return '';
    const titleWords = new Set(normalize(article.title || '').split(' ').filter(token => token.length >= 4));
    const ranked = sentences.map((sentence, index) => {
      const words = normalize(sentence).split(' ').filter(Boolean);
      const titleHits = words.filter(word => titleWords.has(word)).length;
      const factual = /\b\d|\b[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]{2,}/u.test(sentence) ? 1 : 0;
      const junk = /newsletter|cookie|abonn|connectez|partager|lire aussi|voir aussi/i.test(sentence) ? 20 : 0;
      return { sentence, index, score: titleHits * 3 + factual - junk };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const picked = [];
    let words = 0;
    for (const item of ranked) {
      const count = item.sentence.split(/\s+/).length;
      if (picked.length >= 3 || words + count > 100) continue;
      if (picked.some(existing => normalize(existing) === normalize(item.sentence))) continue;
      picked.push(item.sentence);
      words += count;
      if (picked.length >= 2 && words >= 45) break;
    }
    return picked.join(' ').trim();
  }

  function cacheAi(article, text, data = {}) {
    if (!article?.id || !text) return;
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    cache[`article:${article.id}`] = {
      summary: text,
      ai: true,
      grounded: Boolean(data.grounded),
      provider: clean(data.origin || data.provider || 'groq-light'),
      model: clean(data.model || 'openai/gpt-oss-20b'),
      unavailable: false,
      savedAt: Date.now(),
      repairedV9146: true
    };
    writeJson(SUMMARY_CACHE_KEY, Object.fromEntries(Object.entries(cache).slice(-180)));
  }

  function dropBadCache(article) {
    if (!article?.id) return;
    const cache = readJson(SUMMARY_CACHE_KEY, {});
    const key = `article:${article.id}`;
    const item = cache[key];
    if (!item || !badSummaryReason(item.summary || '', article)) return;
    delete cache[key];
    writeJson(SUMMARY_CACHE_KEY, cache);
  }

  async function repairModal(modal) {
    const box = modal?.querySelector('[data-quick-summary-text]');
    if (!box || modal.dataset.qualityRepairRunning === '1') return;
    const article = modalArticle(modal);
    if (!article) return;
    const reason = badSummaryReason(box.textContent || '', article);
    if (!reason) return;

    modal.dataset.qualityRepairRunning = '1';
    dropBadCache(article);
    box.textContent = 'Résumé IA en cours de préparation…';
    setSummaryStatus(modal, 'Résumé IA', true);

    let data = null;
    try {
      const response = await fetch('/api/article-summary-smart?v=8&intent=foreground-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ article: {
          id: article.id,
          url: article.url,
          title: clean(article.title),
          summary: clean(article.summary || article.detail || '').slice(0, 2200),
          detail: clean(article.detail || '').slice(0, 2200),
          source: clean(article.source || '')
        }, repairReason: reason, lightweight: true })
      });
      data = response.ok ? await response.json().catch(() => null) : null;
    } catch {}

    if (!modal.isConnected) return;
    const generated = clean(data?.text || data?.summary || '');
    if (data?.ai === true && generated.length >= 55 && !badSummaryReason(generated, article)) {
      box.textContent = generated;
      setSummaryStatus(modal, 'Résumé IA', true);
      cacheAi(article, generated, data || {});
      modal.dataset.qualityRepairDone = '1';
      modal.dataset.qualityRepairRunning = '0';
      return;
    }

    const fallback = automaticFallback(article)
      || window.__summaryVisualGuardV9145?.extractiveFallback?.(article)
      || '';
    if (fallback && fallback.length >= 80) {
      box.textContent = fallback;
      setSummaryStatus(modal, 'Résumé automatique', false);
      modal.dataset.qualityRepairDone = 'fallback';
    } else {
      box.textContent = 'Résumé momentanément indisponible pour cet article.';
      setSummaryStatus(modal, 'Résumé indisponible', false);
      modal.dataset.qualityRepairDone = 'unavailable';
    }
    modal.dataset.qualityRepairRunning = '0';
  }

  function usefulDirectImage(raw = '') {
    const value = clean(raw);
    if (!/^https?:\/\//i.test(value)) return '';
    if (/favicon|logo|avatar|sprite|wordmark|brandmark|google[-_ ]?news/i.test(value)) return '';
    return value;
  }

  function preload(url) {
    return new Promise(resolve => {
      const probe = new Image();
      probe.referrerPolicy = 'no-referrer';
      probe.onload = () => resolve(probe.naturalWidth >= 180 && probe.naturalHeight >= 100 ? url : '');
      probe.onerror = () => resolve('');
      probe.src = url;
    });
  }

  async function recoverImage(img, card) {
    if (!img?.isConnected || !card || img.dataset.qualityImageRecovery === '1') return;
    const neutral = (img.naturalWidth === 640 && img.naturalHeight === 420)
      || /^data:image\/svg\+xml/i.test(img.currentSrc || img.src || '');
    if (!neutral) return;
    img.dataset.qualityImageRecovery = '1';
    const article = articleById(card.dataset.article);
    if (!article) return;

    const direct = usefulDirectImage(article.visual?.url) || usefulDirectImage(article.image);
    if (direct) {
      const loaded = await preload(direct);
      if (loaded && img.isConnected) {
        img.src = loaded;
        img.classList.add('prepared-visual');
        img.classList.remove('source-tile-visual');
        return;
      }
    }

    if (!article.url || !article.title) return;
    const params = new URLSearchParams({
      v: '9146',
      exact: '1',
      url: String(article.url).slice(0, 1900),
      title: clean(article.title).slice(0, 280),
      source: clean(article.source || article.feedTitle || '').slice(0, 100),
      retry: String(Math.floor(Date.now() / 30000))
    });
    const candidate = `/api/article-thumbnail?${params}`;
    const loaded = await preload(candidate);
    if (loaded && img.isConnected) {
      img.src = candidate;
      img.classList.add('prepared-visual');
      img.classList.remove('source-tile-visual');
    }
  }

  function scanImages() {
    document.querySelectorAll('.article-card[data-article] img.article-image').forEach((img, index) => {
      const card = img.closest('.article-card[data-article]');
      if (!card) return;
      if (!img.complete) {
        img.addEventListener('load', () => setTimeout(() => recoverImage(img, card), index < 8 ? 200 : 900), { once: true });
        return;
      }
      setTimeout(() => recoverImage(img, card), index < 8 ? 100 : 700);
    });
  }

  function scanModal() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    window.__summaryVisualGuardV9145?.ensureModalImage?.();
    repairModal(modal);
  }

  function rememberArticle(target) {
    const card = target?.closest?.('[data-article]');
    if (!card) return;
    activeArticleId = String(card.dataset.article || '');
  }

  document.addEventListener('pointerdown', event => rememberArticle(event.target), true);
  document.addEventListener('click', event => rememberArticle(event.target), true);

  const observer = new MutationObserver(() => {
    scanModal();
    scanImages();
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
    scanImages();
    scanModal();
  }, { once: true });

  window.addEventListener('news:stable-render', () => setTimeout(scanImages, 100));
  window.addEventListener('news:ai-summary-ready', () => setTimeout(scanModal, 20));
  window.addEventListener('focus', () => setTimeout(scanImages, 300));
})();
