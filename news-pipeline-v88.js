(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const TOPIC_PREF_KEY = 'news-topic-preferences-v1';
  const SOURCE_PREF_KEY = 'news-source-preferences-v82';
  const PROVENANCE_KEY = 'news-provenance-v88';
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const upstreamFetch = window.fetch.bind(window);

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

  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function responseFrom(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  function cleanBoundaryArticle(article = {}) {
    const copy = { ...article };
    if (copy.titleOriginalV86) copy.title = copy.titleOriginalV86;
    else copy.title = String(copy.title || '').replace(TITLE_MARK_RE, '').trim();
    if (copy.eventKeyV78OriginalV86) copy.eventKeyV78 = copy.eventKeyV78OriginalV86;
    delete copy.titleOriginalV86;
    delete copy.eventKeyV78OriginalV86;
    return copy;
  }

  function sourceKey(article = {}) {
    return normalize(article.source || '').slice(0, 120);
  }

  function score(article = {}) {
    return Number(article.score || article.editorialScore || 0);
  }

  function hiddenByPreference(article = {}) {
    const prefs = readJson(SOURCE_PREF_KEY, {});
    return Number(prefs[sourceKey(article)] || 0) <= -9;
  }

  function topicSignal(article = {}) {
    const prefs = readJson(TOPIC_PREF_KEY, {});
    const labels = [article.category, ...(Array.isArray(article.tags) ? article.tags : []), ...(Array.isArray(article.matches) ? article.matches : [])]
      .map(clean).filter(Boolean);
    let positive = 0;
    let negative = 0;
    for (const label of labels) {
      const direct = Number(prefs[label] || 0);
      const normalized = normalize(label);
      const fuzzy = Object.entries(prefs).find(([key]) => normalize(key) === normalized);
      for (const value of [direct, Number(fuzzy?.[1] || 0)]) {
        if (value > positive) positive = value;
        if (value < negative) negative = value;
      }
    }
    return positive > 0 ? positive : negative;
  }

  function category(article = {}) {
    return clean(article.category || 'Autres') || 'Autres';
  }

  function isProtected(article = {}) {
    return Boolean(article.essential)
      || Number(article.editorialImportanceV78 || article.editorialImportance || 0) >= 90
      || score(article) >= 94;
  }

  function markDiscovery(article) {
    if (!article || article.discoveryV87) return article;
    return {
      ...article,
      discoveryV87: true,
      discoveryReasonV87: 'Ouverture éditoriale : sujet pertinent hors de vos thèmes les plus favorisés'
    };
  }

  function rebalance(articles) {
    if (!Array.isArray(articles) || articles.length < 4) return articles || [];
    const original = articles.map(cleanBoundaryArticle);
    const target = Math.min(12, original.length);
    const selected = [];
    const used = new Set();

    function take(index, discovery = false) {
      if (index < 0 || index >= original.length || used.has(index)) return false;
      used.add(index);
      selected.push(discovery ? markDiscovery(original[index]) : original[index]);
      return true;
    }

    for (let i = 0; i < original.length && selected.length < target; i++) {
      if (isProtected(original[i])) take(i);
    }

    const preferredCategories = new Set(original.filter(article => topicSignal(article) > 0.4).map(category));
    const topScore = Math.max(...original.map(score), 0);
    const discoveryIndex = original.findIndex((article, index) => {
      if (used.has(index) || hiddenByPreference(article) || isProtected(article)) return false;
      if (topicSignal(article) < -0.2) return false;
      if (preferredCategories.has(category(article))) return false;
      return score(article) >= Math.max(45, topScore - 24);
    });

    while (selected.length < target) {
      const position = selected.length;
      if (position >= 4 && position <= 8 && discoveryIndex >= 0 && !used.has(discoveryIndex)) {
        take(discoveryIndex, true);
        continue;
      }

      const firstEight = selected.slice(0, 8);
      const categoryCounts = new Map();
      const sourceCounts = new Map();
      for (const item of firstEight) {
        categoryCounts.set(category(item), (categoryCounts.get(category(item)) || 0) + 1);
        const key = sourceKey(item);
        if (key) sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
      }

      let best = -1;
      let bestPenalty = Infinity;
      for (let i = 0; i < original.length; i++) {
        if (used.has(i)) continue;
        const article = original[i];
        let penalty = i * 0.35 - Math.min(8, score(article) / 15);
        if (position < 8 && !isProtected(article)) {
          penalty += Math.max(0, (categoryCounts.get(category(article)) || 0) - 1) * 18;
          const key = sourceKey(article);
          penalty += Math.max(0, (sourceCounts.get(key) || 0) - 1) * 14;
        }
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          best = i;
        }
      }
      if (best < 0) break;
      take(best);
    }

    const selectedIds = new Set(selected.map(article => String(article.id || '')));
    const rest = original.filter(article => !selectedIds.has(String(article.id || '')));
    const result = [...selected, ...rest];
    const firstEight = result.slice(0, 8);
    const categoryCount = new Set(firstEight.map(category)).size;

    return result.map((article, index) => index < target ? {
      ...article,
      semanticReclassifiedV87: Boolean(article.semanticOriginalCategoryV87 && clean(article.semanticOriginalCategoryV87) !== clean(article.category || '')),
      semanticCategoryFromV87: article.semanticOriginalCategoryV87 || '',
      feedBalanceV87: true,
      pipelineV88: true,
      ...(index === 0 ? { feedDiversityCategoriesV87: categoryCount } : {})
    } : article);
  }

  function transformNews(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = rebalance(payload.articles);
    const firstEight = payload.articles.slice(0, 8);
    payload.stats = {
      ...(payload.stats || {}),
      storyBoundaryV86: true,
      feedBalanceV87: true,
      pipelineV88: true,
      diversityCategoriesV87: new Set(firstEight.map(category)).size,
      discoverySlotsV87: firstEight.filter(article => article.discoveryV87).length,
      semanticReclassifiedV87: payload.articles.filter(article => article.semanticReclassifiedV87).length
    };
    return payload;
  }

  function tokens(value = '') {
    const stop = new Set('avec dans pour plus apres avant cette sont etre leur leurs tout mais sans vers entre une des les sur qui que aux par son ses est fait article actualite direct selon nouveau nouvelle'.split(' '));
    return [...new Set(normalize(value).split(' ').filter(word => word.length >= 4 && !stop.has(word)))];
  }

  function titleRestatement(summary = '', title = '') {
    const text = clean(summary);
    const wanted = tokens(title);
    if (!text || wanted.length < 4) return false;
    const found = new Set(tokens(text));
    const hits = wanted.filter(word => found.has(word)).length;
    const coverage = hits / Math.max(1, wanted.length);
    return text.length <= Math.max(190, clean(title).length * 1.7) && coverage >= 0.82;
  }

  function poorSummary(payload = {}, article = {}) {
    const summary = clean(payload.summary || payload.text || '');
    if (payload.unavailable || summary.length < 70) return true;
    if (/résumé (?:détailré )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(summary)) return true;
    return titleRestatement(summary, article.title || '');
  }

  function provenanceAliases(article = {}) {
    const values = [];
    const add = value => { const v = clean(value); if (v) values.push(v); };
    add(article.id ? `id:${article.id}` : '');
    add(article.url ? `url:${canonicalUrl(article.url)}` : '');
    add(article.title ? `title:${normalize(article.title)}` : '');
    add(article.eventKeyV78 ? `event:${normalize(article.eventKeyV78)}` : '');
    return [...new Set(values)];
  }

  function saveProvenance(article, data = {}) {
    const sources = [...new Set([
      ...(Array.isArray(data.sources) ? data.sources : []),
      article.source,
      ...(Array.isArray(article.sources) ? article.sources : [])
    ].map(clean).filter(Boolean))].slice(0, 12);
    if (!sources.length) return;
    const store = readJson(PROVENANCE_KEY, {});
    const entry = {
      savedAt: Date.now(),
      sources,
      sourceCount: Math.max(sources.length, Number(data.sourceCount || 0)),
      provider: clean(data.provider || ''),
      corroborated: Boolean(data.corroborated || data.multiSource || sources.length >= 2)
    };
    for (const alias of provenanceAliases(article)) store[alias] = entry;
    writeJson(PROVENANCE_KEY, Object.fromEntries(Object.entries(store).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0)).slice(0, 360)));
  }

  function parseArticle(init) {
    try {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      return body?.article && typeof body.article === 'object' ? body.article : null;
    } catch { return null; }
  }

  async function handleSummary(response, init) {
    const article = parseArticle(init);
    if (!article?.title || !response.ok) return response;
    let base;
    try { base = await response.clone().json(); }
    catch { return response; }

    if (base?.sources || base?.sourceCount || base?.multiSource) saveProvenance(article, base);
    if (!navigator.onLine || !poorSummary(base, article)) return response;

    try {
      const multiResponse = await upstreamFetch('/api/article-summary-multisource?v=88', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ article })
      });
      if (!multiResponse.ok) return response;
      const multi = await multiResponse.json().catch(() => null);
      const summary = clean(multi?.summary || '');
      if (!multi?.ok || multi?.unavailable || !multi?.corroborated || Number(multi?.sourceCount || 0) < 2 || summary.length < 55) return response;
      saveProvenance(article, multi);
      return responseFrom(response, {
        ...base,
        ...multi,
        summary,
        unavailable: false,
        supplementedV86: true,
        pipelineV88: true,
        provider: 'multisource-supplement-v88'
      });
    } catch {
      return response;
    }
  }

  window.fetch = async function newsPipelineV88Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch { return response; }

    if (url.origin !== location.origin) return response;
    if (url.pathname === '/api/news' && response.ok) {
      try { return responseFrom(response, transformNews(await response.clone().json())); }
      catch { return response; }
    }
    if (url.pathname === '/api/article-summary-groq') return handleSummary(response, init);
    return response;
  };

  const initial = readJson(CACHE_KEY, null);
  if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, transformNews(initial));

  function decorateDiscovery() {
    const cache = readJson(CACHE_KEY, {});
    const map = new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      const article = map.get(String(card.dataset.article || ''));
      if (!article?.discoveryV87 || card.querySelector('.discovery-chip-v87')) return;
      const chip = document.createElement('span');
      chip.className = 'discovery-chip-v87';
      chip.textContent = 'À découvrir';
      const top = card.querySelector('.card-top') || card.querySelector('.article-body');
      top?.prepend(chip);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => requestAnimationFrame(decorateDiscovery)).observe(document.body, { childList: true, subtree: true });
    decorateDiscovery();
  }, { once: true });
})();
