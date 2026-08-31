(() => {
  'use strict';

  const VERIFIED_AI_CACHE_KEY = 'news-verified-ai-summaries-v9138';
  const VERIFIED_MAX_AGE = 30 * 86400000;
  let lastArticleId = '';
  const processedModals = new WeakSet();

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
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function goodSummary(value = '') {
    const text = clean(value);
    return text.length >= 55
      && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(text);
  }

  function articles() {
    const cache = readJson('news-live-cache', {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function articleForModal(modal) {
    if (lastArticleId) {
      const exact = articles().find(article => String(article.id || '') === String(lastArticleId));
      if (exact) return exact;
    }
    const title = normalize(modal.querySelector('.quick-summary-head h2')?.textContent || '');
    const source = normalize(modal.querySelector('.quick-summary-meta span')?.textContent || '');
    return articles().find(article => {
      const candidate = normalize(article.title || '');
      const candidateSource = normalize(article.source || '');
      return title && (candidate.includes(title) || title.includes(candidate)) && (!source || source === candidateSource);
    }) || null;
  }

  function ensureStatus(modal) {
    let status = modal.querySelector('.quick-summary-status-v9138');
    if (status) return status;
    const text = modal.querySelector('[data-quick-summary-text]');
    if (!text) return null;
    status = document.createElement('div');
    status.className = 'quick-summary-status-v9138 loading';
    status.textContent = 'Résumé IA en préparation…';
    text.insertAdjacentElement('beforebegin', status);
    return status;
  }

  function setStatus(modal, label, kind = '') {
    const status = ensureStatus(modal);
    if (!status) return;
    status.className = `quick-summary-status-v9138 ${kind}`.trim();
    status.textContent = label;
  }

  function lockVerifiedSummary(modal, summary) {
    const text = modal.querySelector('[data-quick-summary-text]');
    if (!text) return;
    text.textContent = summary;
    modal.dataset.verifiedAiV9138 = '1';
    const observer = new MutationObserver(() => {
      if (!modal.isConnected) {
        observer.disconnect();
        return;
      }
      if (clean(text.textContent) !== clean(summary)) text.textContent = summary;
    });
    observer.observe(text, { childList: true, characterData: true, subtree: true });
  }

  function cacheVerified(article, summary) {
    const current = readJson(VERIFIED_AI_CACHE_KEY, {});
    current[`article:${article.id}`] = { summary, savedAt: Date.now() };
    const compact = Object.fromEntries(Object.entries(current).slice(-180));
    writeJson(VERIFIED_AI_CACHE_KEY, compact);

    // Keep the application's normal summary cache coherent too.
    const normal = readJson('news-article-summaries-v8', {});
    normal[`article:${article.id}`] = { summary, ai: true, unavailable: false, savedAt: Date.now(), verifiedAiV9138: true };
    writeJson('news-article-summaries-v8', Object.fromEntries(Object.entries(normal).slice(-180)));
  }

  async function loadVerifiedAi(article, modal) {
    const key = `article:${article.id}`;
    const cached = readJson(VERIFIED_AI_CACHE_KEY, {})[key];
    if (cached?.summary && Date.now() - Number(cached.savedAt || 0) < VERIFIED_MAX_AGE && goodSummary(cached.summary)) {
      lockVerifiedSummary(modal, clean(cached.summary));
      setStatus(modal, 'Résumé IA', 'ai');
      return;
    }

    setStatus(modal, 'Résumé IA en préparation…', 'loading');
    const payload = {
      url: article.url,
      title: clean(article.title),
      summary: clean(article.summary || ''),
      source: clean(article.source || '')
    };

    let data = null;
    try {
      const response = await fetch('/api/article-summary-ai?v=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ mode: 'article', article: payload })
      });
      if (response.ok) data = await response.json();
    } catch {}

    if (!modal.isConnected) return;
    const summary = clean(data?.summary || '');
    if (data?.ai === true && !data?.unavailable && goodSummary(summary)) {
      cacheVerified(article, summary);
      lockVerifiedSummary(modal, summary);
      setStatus(modal, 'Résumé IA', 'ai');
      return;
    }

    const current = clean(modal.querySelector('[data-quick-summary-text]')?.textContent || '');
    if (goodSummary(current)) setStatus(modal, 'Extrait de la source · résumé IA indisponible', 'source');
    else setStatus(modal, 'Résumé IA indisponible', 'unavailable');
  }

  function tidyTrustNote(modal) {
    const note = modal.querySelector('.verification-note-v83');
    if (!note || note.dataset.tidyV9138 === '1') return;
    if (note.classList.contains('crossed') || note.classList.contains('multi')) {
      note.textContent = clean(note.textContent).replace(/^Vérification\s*:\s*/i, 'Sources recoupées : ');
    } else if (note.classList.contains('disputed')) {
      note.textContent = 'Sources : désaccord entre médias';
    }
    note.dataset.tidyV9138 = '1';
  }

  function processModal(modal) {
    tidyTrustNote(modal);
    if (processedModals.has(modal)) return;
    processedModals.add(modal);
    const article = articleForModal(modal);
    if (!article?.id) {
      setStatus(modal, 'Résumé', 'source');
      return;
    }
    loadVerifiedAi(article, modal);
  }

  const style = document.createElement('style');
  style.id = 'ui-summary-fixes-v9138';
  style.textContent = `
    .article-card.essential-v77 {
      border-color: rgba(232,227,244,.8) !important;
      background: var(--card, rgba(255,255,255,.97)) !important;
      box-shadow: var(--shadow, 0 10px 30px rgba(74,60,119,.07)) !important;
    }
    .article-card.essential-v77 .article-body { background: transparent !important; }
    .quick-summary-text {
      border-color: #e8e5ec !important;
      background: #fff !important;
    }
    .quick-summary-status-v9138 {
      margin: 5px 2px 7px;
      color: #716b78;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
    }
    .quick-summary-status-v9138.ai { color: #5644bd; }
    .quick-summary-status-v9138.source,
    .quick-summary-status-v9138.unavailable { color: #817a88; font-weight: 700; }
    .verification-note-v83.single { display: none !important; }
    .verification-note-v83.crossed,
    .verification-note-v83.multi,
    .verification-note-v83.disputed {
      margin: 4px 2px 8px !important;
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      font-size: 11px !important;
      font-weight: 700 !important;
    }
  `;
  document.head.appendChild(style);

  document.addEventListener('click', event => {
    const card = event.target.closest?.('[data-article]');
    if (card?.dataset?.article) lastArticleId = String(card.dataset.article);
  }, true);

  const observer = new MutationObserver(() => {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (modal) processModal(modal);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
