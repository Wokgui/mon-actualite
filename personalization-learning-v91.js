(() => {
  'use strict';

  const STORAGE_KEY = 'news-feedback-learning-v1';
  const ACTION_WEIGHT = Object.freeze({ more: 0.35, less: -0.3, follow: 0.55, not: -0.45 });
  const TOPIC_WEIGHT = Object.freeze([1, 0.6, 0.35]);
  let cachedRaw = null;
  let cachedStore = null;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '';
      if (raw === cachedRaw && cachedStore) return cachedStore;
      const value = JSON.parse(raw || 'null');
      cachedRaw = raw;
      cachedStore = value && typeof value === 'object' && value.topics && typeof value.topics === 'object'
        ? value
        : { topics: {}, updatedAt: 0 };
      return cachedStore;
    } catch {
      return { topics: {}, updatedAt: 0 };
    }
  }

  function writeStore(store) {
    try {
      cachedRaw = JSON.stringify(store);
      cachedStore = store;
      localStorage.setItem(STORAGE_KEY, cachedRaw);
    } catch {}
  }

  function articleTopics(article = {}) {
    return [...new Set([article.category, ...(article.tags || []), ...(article.matches || [])]
      .map(value => String(value || '').trim())
      .filter(value => value && value !== 'À suivre'))].slice(0, 3);
  }

  function recordFeedback(article, nextAction = '', previousAction = '') {
    const delta = Number(ACTION_WEIGHT[nextAction] || 0) - Number(ACTION_WEIGHT[previousAction] || 0);
    const topics = articleTopics(article);
    if (!topics.length || Math.abs(delta) < 0.001) return readStore();

    const store = readStore();
    topics.forEach((topic, index) => {
      store.topics[topic] = Number(clamp(Number(store.topics[topic] || 0) + delta * TOPIC_WEIGHT[index], -2, 2).toFixed(3));
      if (Math.abs(store.topics[topic]) < 0.01) delete store.topics[topic];
    });
    store.topics = Object.fromEntries(Object.entries(store.topics)
      .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
      .slice(0, 80));
    store.updatedAt = Date.now();
    writeStore(store);
    return store;
  }

  function learnedSignal(article, store = readStore()) {
    return articleTopics(article).reduce((total, topic, index) => (
      total + Number(store.topics?.[topic] || 0) * TOPIC_WEIGHT[index]
    ), 0);
  }

  function rankingContribution(article, explicitPreferences = {}, generalCategories = [], store = readStore()) {
    const topics = articleTopics(article);
    const explicit = clamp(topics.reduce((total, topic, index) => (
      total + Number(explicitPreferences?.[topic] || 0) * 12 * TOPIC_WEIGHT[index]
    ), 0), -18, 18);
    const learned = clamp(learnedSignal(article, store) * 8, -10, 12);
    let combined = clamp(explicit + learned, -22, 24);

    const protectsGeneralNews = Boolean(article.essential)
      || Number(article.score || 0) >= 100
      || generalCategories.includes(article.category);
    if (protectsGeneralNews) combined = Math.max(-6, combined);
    return combined;
  }

  function createRanker(explicitPreferences = {}, generalCategories = []) {
    const store = readStore();
    return article => rankingContribution(article, explicitPreferences, generalCategories, store);
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    cachedRaw = '';
    cachedStore = { topics: {}, updatedAt: 0 };
  }

  window.NewsPersonalizationV91 = Object.freeze({
    storageKey: STORAGE_KEY,
    articleTopics,
    createRanker,
    learnedSignal,
    rankingContribution,
    recordFeedback,
    reset
  });
})();
