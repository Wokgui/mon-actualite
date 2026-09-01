(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const TOPIC_PREF_KEY = 'news-topic-preferences-v1';
  const SOURCE_PREF_KEY = 'news-source-preferences-v82';
  const PROVENANCE_KEY = 'news-provenance-v88';
  const READ_REVISION_KEY = 'news-read-revisions-v89';
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const LOW_VALUE_RX = /\b(réagit|réaction|se confie|confidences?|donne son avis|tacle|coup de gueule|s['’]indigne|fait polémique|buzz|réseaux sociaux|les internautes|voici ce qu['’]il pense|interview promo|promotion de)\b/i;
  const ACTION_RX = /\b(adopte|vote|rejette|valide|annule|interdit|autorise|condamne|acquitte|démissionne|nomme|remplace|ferme|ouvre|suspend|reprend|cesse|annonce|lance|publie|officialise|découvre|confirme|atteint|baisse|augmente)\b/i;
  const upstreamFetch = window.fetch.bind(window);

  window.__NEWS_PIPELINE_VERSION__ = '89';
  document.documentElement.dataset.pipelineVersion = '89';

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
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9%€$]+/g, ' ').replace(/\s+/g, ' ').trim();
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
    const explicit = positive > 0 ? positive : negative;
    const learned = Number(window.NewsPersonalizationV91?.learnedSignal(article) || 0);
    return Math.max(-2, Math.min(2, explicit + learned));
  }

  function category(article = {}) {
    return clean(article.category || 'Autres') || 'Autres';
  }

  function isProtected(article = {}) {
    return Boolean(article.essential)
      || Number(article.editorialImportanceV78 || article.editorialImportance || 0) >= 90
      || score(article) >= 94;
  }

  function sourceCount(article = {}) {
    return new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(normalize).filter(Boolean)).size;
  }

  function numericClaims(value = '') {
    return [...new Set((clean(value).match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|€|\$|euros?|dollars?|km|milliards?|millions?|ans?|mois|jours?|heures?))?\b/gi) || []).map(normalize).filter(Boolean))].slice(0, 20);
  }

  function informationValue(article = {}) {
    const title = clean(article.title || '');
    const summary = clean(article.summary || article.detail || '');
    const text = `${title} ${summary}`;
    const numbers = numericClaims(text);
    const sources = sourceCount(article);
    const hasAction = ACTION_RX.test(text);
    const reactional = LOW_VALUE_RX.test(text);
    let value = 42;
    const reasons = [];

    if (article.essential) { value += 26; reasons.push('actualité majeure'); }
    else if (Number(article.editorialImportanceV78 || article.editorialImportance || 0) >= 80) { value += 10; reasons.push('forte importance éditoriale'); }

    const novelty = clean(article.noveltyStateV78 || article.noveltyState || '');
    if (novelty === 'development') { value += 15; reasons.push('nouveau développement'); }
    else if (novelty === 'new') { value += 8; reasons.push('information nouvelle'); }
    else if (novelty === 'minor-update') value += 3;
    else if (novelty === 'repeat') { value -= 18; reasons.push('information déjà connue'); }

    if (sources >= 2) { value += Math.min(12, 4 + (sources - 2) * 2); reasons.push(`${sources} sources`); }
    if (summary.length >= 180) value += 8;
    else if (summary.length >= 90) value += 4;
    else if (summary.length < 55) value -= 8;
    if (numbers.length) { value += Math.min(12, numbers.length * 3); reasons.push('faits chiffrés'); }
    if (hasAction) { value += 9; reasons.push('fait ou décision identifiable'); }
    if (article.titleSupportV83 === 'weak') value -= 8;
    if (/\?$/.test(title)) value -= 4;

    if (reactional) {
      const penalty = numbers.length || hasAction ? 12 : 24;
      value -= penalty;
      reasons.push('contenu surtout réactionnel');
      // An upstream "Essentiel" flag must never make a pure reaction outrank
      // a concrete factual item. Without a number or a verifiable action,
      // reaction/commentary content is deliberately capped.
      if (!numbers.length && !hasAction) value = Math.min(value, 34);
    }

    // Conversely, a corroborated item that carries both concrete figures and
    // an identifiable action keeps a factual floor even if another layer has
    // slightly reduced its editorial score.
    if (!reactional && sources >= 2 && numbers.length && hasAction) value = Math.max(value, 68);

    value = Math.max(0, Math.min(100, Math.round(value)));
    return { value, reasons: reasons.slice(0, 5) };
  }

  function applyInformationQuality(article = {}) {
    const copy = { ...article };
    const result = informationValue(copy);
    const base = Number(copy.score || 0);
    copy.scoreV89Base = base;
    copy.informationValueV89 = result.value;
    copy.informationReasonsV89 = result.reasons;
    copy.lowInformationV89 = result.value < 38;
    if (!isProtected(copy)) {
      if (result.value < 28) copy.score = base - 22;
      else if (result.value < 42) copy.score = base - 10;
      else if (result.value >= 82) copy.score = base + 6;
    }
    return copy;
  }

  function revisionAliases(article = {}) {
    const aliases = [];
    const url = canonicalUrl(article.url || '');
    if (url) aliases.push(`url:${url}`);
    const ids = [article.id, ...(Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : [])].map(value => String(value || '')).filter(Boolean);
    for (const id of ids) aliases.push(`id:${id}`);
    return [...new Set(aliases)];
  }

  function contentTokens(article = {}) {
    return [...new Set(normalize(`${article.title || ''} ${String(article.summary || article.detail || '').slice(0, 1000)}`).split(' ').filter(word => word.length >= 4))].slice(0, 80);
  }

  function contentFingerprint(article = {}) {
    return normalize(`${article.title || ''}|${String(article.summary || article.detail || '').slice(0, 1200)}`);
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function revisionRecord(article = {}) {
    const store = readJson(READ_REVISION_KEY, {});
    for (const alias of revisionAliases(article)) {
      if (store[alias]) return store[alias];
    }
    return null;
  }

  function similarity(a = [], b = []) {
    const bs = new Set(b);
    const common = a.filter(token => bs.has(token)).length;
    return {
      coverage: common / Math.max(1, Math.min(a.length, b.length)),
      jaccard: common / Math.max(1, new Set([...a, ...b]).size)
    };
  }

  function annotateRevision(article = {}) {
    const copy = { ...article };
    const previous = revisionRecord(copy);
    if (!previous) return copy;
    const fingerprint = contentFingerprint(copy);
    if (!fingerprint || fingerprint === previous.fingerprint) return copy;

    const currentTokens = contentTokens(copy);
    const oldTokens = Array.isArray(previous.tokens) ? previous.tokens : [];
    const sim = similarity(currentTokens, oldTokens);
    const currentNumbers = numericClaims(`${copy.title || ''} ${copy.summary || copy.detail || ''}`);
    const previousNumbers = Array.isArray(previous.numbers) ? previous.numbers : [];
    const numbersChanged = currentNumbers.length && previousNumbers.length
      && currentNumbers.slice().sort().join('|') !== previousNumbers.slice().sort().join('|');
    const material = numbersChanged || (sim.coverage < .78 && sim.jaccard < .68);
    if (!material) return copy;

    const currentPublished = publishedAt(copy);
    const previousPublished = Number(previous.publishedAt || 0);
    const newerPublication = currentPublished && previousPublished && currentPublished > previousPublished + 120000;
    const development = ['development','minor-update','new'].includes(clean(copy.noveltyStateV78 || copy.noveltyState || ''));
    const correction = Boolean(numbersChanged && !newerPublication && !development && canonicalUrl(copy.url || '') === clean(previous.url || ''));

    copy.revisionSinceReadV89 = true;
    copy.revisionTypeV89 = correction ? 'correction' : 'updated';
    copy.revisionReasonV89 = correction
      ? 'Des données chiffrées du même article ont changé sans nouvelle publication identifiable.'
      : 'Le contenu de cet article a substantiellement changé depuis votre lecture.';
    copy.revisionDetectedAtV89 = Date.now();
    return copy;
  }

  function saveReadRevision(article = {}) {
    if (!article?.id && !article?.url) return;
    const store = readJson(READ_REVISION_KEY, {});
    const record = {
      at: Date.now(),
      url: canonicalUrl(article.url || ''),
      publishedAt: publishedAt(article),
      fingerprint: contentFingerprint(article),
      tokens: contentTokens(article),
      numbers: numericClaims(`${article.title || ''} ${article.summary || article.detail || ''}`),
      title: clean(article.title || '').slice(0, 360)
    };
    for (const alias of revisionAliases(article)) store[alias] = record;
    const entries = Object.entries(store).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 420);
    writeJson(READ_REVISION_KEY, Object.fromEntries(entries));
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
    const original = articles.slice();
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
      if (article.lowInformationV89) return false;
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
        if (article.lowInformationV89 && !isProtected(article)) penalty += 12;
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
      pipelineV89: true,
      ...(index === 0 ? { feedDiversityCategoriesV87: categoryCount } : {})
    } : article);
  }

  function transformNews(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const prepared = payload.articles
      .map(cleanBoundaryArticle)
      .map(applyInformationQuality)
      .map(annotateRevision);
    payload.articles = rebalance(prepared);
    const firstEight = payload.articles.slice(0, 8);
    const values = payload.articles.map(article => Number(article.informationValueV89 || 0)).filter(Number.isFinite);
    payload.stats = {
      ...(payload.stats || {}),
      storyBoundaryV86: true,
      feedBalanceV87: true,
      pipelineV88: true,
      pipelineV89: true,
      diversityCategoriesV87: new Set(firstEight.map(category)).size,
      discoverySlotsV87: firstEight.filter(article => article.discoveryV87).length,
      semanticReclassifiedV87: payload.articles.filter(article => article.semanticReclassifiedV87).length,
      lowInformationV89: payload.articles.filter(article => article.lowInformationV89).length,
      correctionsV89: payload.articles.filter(article => article.revisionTypeV89 === 'correction').length,
      updatesSinceReadV89: payload.articles.filter(article => article.revisionTypeV89 === 'updated').length,
      averageInformationValueV89: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
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
    if (/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(summary)) return true;
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
      const multiResponse = await upstreamFetch('/api/article-summary-multisource?v=89', {
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
        pipelineV89: true,
        provider: 'multisource-supplement-v89'
      });
    } catch {
      return response;
    }
  }

  window.fetch = async function newsPipelineV89Fetch(input, init) {
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

  function articleMap() {
    const cache = readJson(CACHE_KEY, {});
    return new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
  }

  function decorateDiscovery() {
    const map = articleMap();
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      if (card.closest('.stable-owned-list')) return;
      const article = map.get(String(card.dataset.article || ''));
      if (!article?.discoveryV87 || card.querySelector('.discovery-chip-v87')) return;
      const chip = document.createElement('span');
      chip.className = 'discovery-chip-v87';
      chip.textContent = 'À découvrir';
      const top = card.querySelector('.card-top') || card.querySelector('.article-body');
      top?.prepend(chip);
    });
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-save], .save-btn, .category-link, [data-why-v85], [data-why-panel-v85]')) return;
    const target = event.target.closest?.('[data-article]');
    if (!target) return;
    const article = articleMap().get(String(target.dataset.article || ''));
    if (article) saveReadRevision(article);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => requestAnimationFrame(decorateDiscovery)).observe(document.body, { childList: true, subtree: true });
    decorateDiscovery();
  }, { once: true });
})();
