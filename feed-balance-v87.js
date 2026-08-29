(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const TOPIC_PREF_KEY = 'news-topic-preferences-v1';
  const SOURCE_PREF_KEY = 'news-source-preferences-v82';
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
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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
    let best = 0;
    for (const label of labels) {
      const direct = Number(prefs[label] || 0);
      const normalized = normalize(label);
      const fuzzy = Object.entries(prefs).find(([key]) => normalize(key) === normalized);
      best = Math.max(best, direct, Number(fuzzy?.[1] || 0));
    }
    return best;
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

    const preferredCategories = new Set(
      original.filter(article => topicSignal(article) > 0.4).map(category)
    );

    const discoveryIndex = original.findIndex((article, index) => {
      if (used.has(index) || hiddenByPreference(article) || isProtected(article)) return false;
      if (topicSignal(article) < -0.2) return false;
      if (preferredCategories.has(category(article))) return false;
      const topScore = score(original[0]);
      return score(article) >= Math.max(45, topScore - 24);
    });

    while (selected.length < target) {
      const position = selected.length;
      if (position >= 4 && position <= 8 && discoveryIndex >= 0 && !used.has(discoveryIndex)) {
        take(discoveryIndex, true);
        continue;
      }

      const firstEight = selected.slice(0, 8);
      const catCounts = new Map();
      const sourceCounts = new Map();
      for (const item of firstEight) {
        catCounts.set(category(item), (catCounts.get(category(item)) || 0) + 1);
        const sk = sourceKey(item);
        if (sk) sourceCounts.set(sk, (sourceCounts.get(sk) || 0) + 1);
      }

      let best = -1;
      let bestPenalty = Infinity;
      for (let i = 0; i < original.length; i++) {
        if (used.has(i)) continue;
        const article = original[i];
        let penalty = 0;
        if (position < 8 && !isProtected(article)) {
          penalty += Math.max(0, (catCounts.get(category(article)) || 0) - 1) * 18;
          const sk = sourceKey(article);
          penalty += Math.max(0, (sourceCounts.get(sk) || 0) - 1) * 14;
        }
        penalty += i * 0.35;
        penalty -= Math.min(8, score(article) / 15);
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
      feedBalanceV87: true
    } : article).map((article, index) => index === 0 ? {
      ...article,
      feedDiversityCategoriesV87: categoryCount
    } : article);
  }

  function transform(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = rebalance(payload.articles);
    const firstEight = payload.articles.slice(0, 8);
    payload.stats = {
      ...(payload.stats || {}),
      feedBalanceV87: true,
      diversityCategoriesV87: new Set(firstEight.map(category)).size,
      discoverySlotsV87: firstEight.filter(article => article.discoveryV87).length,
      semanticReclassifiedV87: payload.articles.filter(article => article.semanticReclassifiedV87).length
    };
    return payload;
  }

  function responseFrom(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function feedBalanceV87Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        return responseFrom(response, transform(await response.clone().json()));
      }
    } catch {}
    return response;
  };

  const initial = readJson(CACHE_KEY, null);
  if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, transform(initial));

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