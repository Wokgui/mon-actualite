(() => {
  'use strict';

  const RELEASE = '91.48';
  const NEWS_CACHE_KEY = 'news-live-cache';
  const HIDDEN_KEY = 'news-paywall-hidden-v1';
  const upstreamFetch = window.fetch.bind(window);
  const SUMMARY_PATHS = new Set([
    '/api/article-summary',
    '/api/article-summary-smart',
    '/api/article-summary-groq',
    '/api/article-summary-multisource'
  ]);

  const PAID_HOSTS = [
    'lemonde.fr', 'lesechos.fr', 'lefigaro.fr', 'liberation.fr', 'mediapart.fr',
    'courrierinternational.com', 'la-croix.com', 'lepoint.fr', 'lexpress.fr',
    'nouvelobs.com', 'challenges.fr', 'latribune.fr', 'lejdd.fr', 'lequipe.fr',
    'ouest-france.fr', 'sudouest.fr', 'letelegramme.fr', 'lavoixdunord.fr',
    'republicain-lorrain.fr', 'estrepublicain.fr', 'dna.fr', 'lalsace.fr',
    'leprogres.fr', 'ledauphine.com', 'bienpublic.com', 'lejsl.com',
    'midilibre.fr', 'ladepeche.fr', 'lamontagne.fr', 'nice-matin.fr', 'varmatin.com'
  ];

  const PAID_SOURCES = [
    'le monde', 'les echos', 'le figaro', 'liberation', 'libération', 'mediapart',
    'courrier international', 'la croix', 'le point', 'l express', "l'express",
    'le nouvel obs', 'nouvel obs', 'challenges', 'la tribune', 'le jdd',
    'journal du dimanche', 'l equipe', "l'équipe", 'ouest france', 'ouest-france',
    'sud ouest', 'le telegramme', 'le télégramme', 'la voix du nord',
    'republicain lorrain', 'républicain lorrain', 'est republicain', 'est républicain',
    'dernieres nouvelles d alsace', "dernières nouvelles d'alsace", 'dna',
    'l alsace', "l'alsace", 'le progres', 'le progrès', 'le dauphine', 'le dauphiné',
    'le bien public', 'journal de saone et loire', 'journal de saône-et-loire',
    'midi libre', 'la depeche', 'la dépêche', 'la montagne', 'nice matin', 'nice-matin',
    'var matin', 'var-matin'
  ];

  const PAYWALL_RX = /(?:réservé(?:e)?\s+aux?\s+abonnés?|contenu\s+(?:est\s+)?réservé|article\s+réservé|accès\s+réservé|pour\s+lire\s+la\s+suite[^.]{0,60}(?:abonn|connect)|abonnez[- ]?vous\s+pour\s+(?:lire|accéder|continuer)|déjà\s+abonné|offre\s+d['’]abonnement|premium\s+(?:article|content)|subscribers?\s+only|members?\s+only|cet\s+article\s+est\s+réservé)/i;

  document.documentElement.dataset.articleAccessVersion = RELEASE;

  function clean(value = '') {
    return String(value ?? '')
      .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&hellip;/gi, '…')
      .replace(/\uFFFD+/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase().replace(/[^a-z0-9.-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); }
    catch { return null; }
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function articleKey(article = {}) {
    const url = canonicalUrl(article.url || '');
    if (url) return `url:${url}`;
    return `text:${normalize(article.source || '')}|${normalize(article.title || '')}`;
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function hiddenStore() {
    const raw = readJson(HIDDEN_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function isHidden(article = {}) {
    const store = hiddenStore();
    return Boolean(store[articleKey(article)] || (article.id && store[`id:${article.id}`]));
  }

  function rememberHidden(article = {}, reason = 'paywall') {
    const store = hiddenStore();
    const record = { at: Date.now(), reason, title: clean(article.title || '').slice(0, 240), source: clean(article.source || '').slice(0, 120) };
    store[articleKey(article)] = record;
    if (article.id) store[`id:${article.id}`] = record;
    const entries = Object.entries(store)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, 500);
    writeJson(HIDDEN_KEY, Object.fromEntries(entries));
  }

  function sourceLooksPaid(article = {}) {
    const source = normalize(article.source || '');
    if (PAID_SOURCES.some(name => source === normalize(name) || source.includes(normalize(name)))) return true;
    try {
      const host = new URL(String(article.url || ''), location.href).hostname.toLowerCase().replace(/^www\./, '');
      return PAID_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch { return false; }
  }

  function explicitPaywall(article = {}, data = {}) {
    const text = [article.title, article.summary, article.detail, data?.summary, data?.text]
      .map(clean).filter(Boolean).join(' ');
    return PAYWALL_RX.test(text);
  }

  function visiblyTruncated(value = '') {
    const text = clean(value);
    if (!text) return false;
    return /(?:\.{3}|…)\s*[»”"']?\s*$/.test(text)
      || /\b(?:lire la suite|read more|en savoir plus)\s*[.!…]*$/i.test(text)
      || /[-–—,:;\/(]\s*$/.test(text);
  }

  function paywallReason(article = {}, data = {}) {
    if (explicitPaywall(article, data)) return 'explicit-paywall-marker';
    if (!sourceLooksPaid(article)) return '';

    const d = data?.diagnostics || {};
    const material = clean(d.materialSource || '');
    const method = clean(d.extractionMethod || '');
    const contentChars = Number(d.contentChars || 0);
    const sourceChars = Number(d.sourceChars || data?.sourceChars || 0);

    // A multisource/AI response can legitimately have no page-extraction
    // diagnostics. Absence of diagnostics alone must never be called a paywall.
    const hasExtractionEvidence = Boolean(material || method || contentChars > 0 || sourceChars > 0);
    if (!hasExtractionEvidence) return '';

    const weakMaterial = material !== 'full-text'
      || method === 'page-metadata'
      || method === 'none';
    const shortMaterial = (contentChars > 0 && contentChars < 950)
      || (sourceChars > 0 && sourceChars < 850);
    const teaser = visiblyTruncated(article.summary || article.detail || '')
      || visiblyTruncated(data?.summary || data?.text || '');

    if (weakMaterial) return 'paid-source-without-full-text';
    if (shortMaterial && teaser) return 'paid-source-truncated-teaser';
    return '';
  }

  function removeFromCache(article = {}) {
    const payload = readJson(NEWS_CACHE_KEY, null);
    if (!payload || !Array.isArray(payload.articles)) return false;
    const key = articleKey(article);
    const id = String(article.id || '');
    const before = payload.articles.length;
    payload.articles = payload.articles.filter(item => {
      if (id && String(item?.id || '') === id) return false;
      return articleKey(item || {}) !== key;
    });
    if (payload.articles.length === before) return false;
    payload.stats = { ...(payload.stats || {}), paywallFilteredV9148: Number(payload.stats?.paywallFilteredV9148 || 0) + 1 };
    writeJson(NEWS_CACHE_KEY, payload);
    return true;
  }

  function removeFromDom(article = {}) {
    const id = String(article.id || '');
    const key = articleKey(article);
    document.querySelectorAll('[data-article]').forEach(node => {
      const nodeId = String(node.dataset.article || '');
      if (id && nodeId === id) {
        (node.closest('.article-card') || node).remove();
        return;
      }
      if (!id) return;
      const cached = readJson(NEWS_CACHE_KEY, {})?.articles?.find?.(item => String(item?.id || '') === nodeId);
      if (cached && articleKey(cached) === key) (node.closest('.article-card') || node).remove();
    });
  }

  function hideArticle(article = {}, reason = 'paywall') {
    if (!article || (!article.id && !article.url && !article.title)) return;
    rememberHidden(article, reason);
    removeFromCache(article);
    removeFromDom(article);
    window.dispatchEvent(new CustomEvent('news:paywall-filtered', { detail: { id: article.id || '', reason } }));
  }

  function cloneJsonResponse(response, payload) {
    const headers = new Headers(response?.headers || {});
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(payload), {
      status: response?.status && response.status >= 200 && response.status < 300 ? response.status : 200,
      statusText: response?.statusText || 'OK',
      headers
    });
  }

  function paywallUnavailable(response, data = {}, reason = 'paywall') {
    return cloneJsonResponse(response, {
      ...data,
      ok: false,
      summary: '',
      text: '',
      ai: false,
      grounded: false,
      unavailable: true,
      paywalled: true,
      provider: 'paywall-filter-v91.48',
      paywallReasonV9148: reason
    });
  }

  function filterNewsPayload(payload = {}) {
    if (!Array.isArray(payload?.articles)) return { payload, removed: 0 };
    let removed = 0;
    const articles = payload.articles.filter(article => {
      const reason = explicitPaywall(article) ? 'explicit-paywall-marker' : '';
      if (reason) rememberHidden(article, reason);
      const blocked = Boolean(reason) || isHidden(article);
      if (blocked) removed += 1;
      return !blocked;
    });
    if (!removed) return { payload, removed: 0 };
    return {
      payload: {
        ...payload,
        articles,
        stats: { ...(payload.stats || {}), paywallFilteredV9148: Number(payload.stats?.paywallFilteredV9148 || 0) + removed }
      },
      removed
    };
  }

  function filterCachedNews() {
    const cached = readJson(NEWS_CACHE_KEY, null);
    if (!cached || !Array.isArray(cached.articles)) return [];
    const filtered = filterNewsPayload(cached);
    if (filtered.removed) writeJson(NEWS_CACHE_KEY, filtered.payload);
    return filtered.payload.articles || [];
  }

  async function probeOne(article) {
    if (!article || isHidden(article) || !sourceLooksPaid(article)) return;
    try {
      const response = await upstreamFetch('/api/article-summary?v=91.48&intent=paywall-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ mode: 'article', article, factualOnly: true, paywallProbe: true })
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (!data) return;
      const reason = paywallReason(article, data);
      if (reason) hideArticle(article, reason);
    } catch {}
  }

  async function probePaidCandidates(articles = []) {
    const candidates = articles.filter(article => sourceLooksPaid(article) && !isHidden(article)).slice(0, 18);
    for (let index = 0; index < candidates.length; index += 2) {
      if (document.hidden || !navigator.onLine) return;
      await Promise.all(candidates.slice(index, index + 2).map(probeOne));
      if (index + 2 < candidates.length) await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  window.fetch = async function articleAccessFetch(input, init) {
    const url = requestUrl(input);
    const sameOrigin = Boolean(url && url.origin === location.origin);
    const method = String(init?.method || 'GET').toUpperCase();
    const body = parseBody(init) || {};
    const article = body?.article && typeof body.article === 'object' ? body.article : {};

    if (sameOrigin && method === 'POST' && SUMMARY_PATHS.has(url.pathname) && isHidden(article)) {
      return paywallUnavailable(null, {}, 'known-paywall');
    }

    const response = await upstreamFetch(input, init);
    if (!sameOrigin || !response.ok) return response;

    if (url.pathname === '/api/news') {
      try {
        const data = await response.clone().json();
        const filtered = filterNewsPayload(data);
        setTimeout(() => probePaidCandidates(filtered.payload.articles || []), 250);
        return filtered.removed ? cloneJsonResponse(response, filtered.payload) : response;
      } catch { return response; }
    }

    if (method === 'POST' && SUMMARY_PATHS.has(url.pathname)) {
      try {
        const data = await response.clone().json();
        const reason = paywallReason(article, data);
        if (!reason) return response;
        hideArticle(article, reason);
        return paywallUnavailable(response, data, reason);
      } catch { return response; }
    }

    return response;
  };

  function splitSentences(value = '') {
    return clean(value).match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map(item => item.trim()).filter(Boolean) || [];
  }

  function balancedParagraphs(value = '') {
    const raw = String(value ?? '').replace(/\r/g, '').trim();
    const explicit = raw.split(/\n\s*\n+/).map(part => clean(part)).filter(Boolean);
    if (explicit.length >= 2) return explicit.slice(0, 3);

    const text = clean(raw);
    const sentences = splitSentences(text);
    if (sentences.length < 3 || text.length < 230) return [text];

    const target = text.length / 2;
    let length = 0;
    let cut = 1;
    for (let i = 0; i < sentences.length - 1; i++) {
      length += sentences[i].length + 1;
      cut = i + 1;
      if (length >= target) break;
    }
    cut = Math.max(1, Math.min(sentences.length - 1, cut));
    return [sentences.slice(0, cut).join(' '), sentences.slice(cut).join(' ')].filter(Boolean);
  }

  function summaryReady(value = '') {
    const text = clean(value);
    return text.length >= 55
      && !/résumé ia en cours|résumé ia momentanément indisponible|résumé indisponible/i.test(text);
  }

  function formatSummaryNode(node) {
    if (!(node instanceof Element)) return;
    const raw = node.textContent || '';
    const text = clean(raw);
    if (!summaryReady(text)) {
      node.dataset.summaryState = 'status';
      node.dataset.summaryFormattedText = '';
      return;
    }
    if (node.dataset.summaryFormattedText === text && node.querySelector('.quick-summary-paragraph')) return;

    const paragraphs = balancedParagraphs(raw);
    if (!paragraphs.length) return;
    const fragment = document.createDocumentFragment();
    paragraphs.forEach((paragraph, index) => {
      const p = document.createElement('p');
      p.className = 'quick-summary-paragraph';
      p.textContent = paragraph;
      if (index === 0) p.classList.add('quick-summary-lead');
      fragment.appendChild(p);
    });
    node.replaceChildren(fragment);
    node.dataset.summaryState = 'ready';
    node.dataset.summaryFormattedText = text;
  }

  function scanSummaryNodes(root = document) {
    if (root instanceof Element && root.matches('.quick-summary-text')) formatSummaryNode(root);
    root.querySelectorAll?.('.quick-summary-text').forEach(formatSummaryNode);
  }

  function startSummaryFormatting() {
    scanSummaryNodes(document);
    const observer = new MutationObserver(mutations => {
      const touched = new Set();
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        const summary = target?.closest?.('.quick-summary-text');
        if (summary) touched.add(summary);
        mutation.addedNodes?.forEach(node => {
          if (node instanceof Element) {
            if (node.matches('.quick-summary-text')) touched.add(node);
            node.querySelectorAll?.('.quick-summary-text').forEach(item => touched.add(item));
          }
        });
      }
      touched.forEach(formatSummaryNode);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  const cachedArticles = filterCachedNews();
  if (cachedArticles.length) setTimeout(() => probePaidCandidates(cachedArticles), 700);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSummaryFormatting, { once: true });
  else startSummaryFormatting();
})();
