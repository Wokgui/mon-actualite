(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const SEEN_KEY = 'news-seen-v77';
  const STORY_MEMORY_KEY = 'news-story-memory-v77';
  const SESSION_SEEN_KEY = 'news-session-seen-v77';
  const MEMORY_MAX_AGE = 10 * 24 * 60 * 60 * 1000;
  const STORY_COMPARE_AGE = 7 * 24 * 60 * 60 * 1000;
  const ESSENTIAL_MAX_AGE = 40 * 60 * 60 * 1000;
  const ESSENTIAL_COUNT = 6;
  const upstreamFetch = window.fetch.bind(window);
  const observedCards = new WeakSet();
  const viewTimers = new WeakMap();
  let decorateQueued = false;

  const STOP = new Set([
    'avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','tous','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','font','comme','dont','elle','elles','ils','nous','vous','notre','votre','aussi','encore','deja','tres','moins','depuis','alors','chez','contre','lors','peut','peuvent','avait','avoir','sera','une','un','le','la','du','de','d','au','en','et','ou','ce','se','sa','ne','pas','the','and','for','with','from','that','this','are','was','will','has','have','into','over','after','before','actualite','direct','video','photos','photo'
  ]);

  const CATEGORY_IMPORTANCE = {
    International: 28, Politique: 25, 'Économie': 21, 'Santé': 20,
    'Société': 17, Europe: 16, Environnement: 16, Science: 15,
    'Éducation': 10, Culture: 8, 'Énergie': 10, Automobile: 8,
    Tech: 8, IA: 8, Smartphones: 6, VR: 6
  };

  const MAJOR_EVENT_RX = /\b(guerre|cessez[- ]le[- ]feu|attaque|attentat|séisme|inondation|incendie|catastrophe|élection|démission|gouvernement|premier ministre|président|vote|accord|traité|interdiction|condamnation|procès|crise|récession|inflation|chômage|épidémie|pandémie|vaccin|découverte|percée|record|lancement|annonce|fermeture|rappel|urgence|alerte)\b/i;

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[’']/g, ' ')
      .replace(/[^a-z0-9%€$]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function titleWithoutSource(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (source) title = title.replace(new RegExp(`\\s*[-–—|·:]\\s*${source}\\s*$`, 'i'), '').trim();
    return title;
  }

  function tokens(article = {}) {
    const sourceWords = new Set(normalize(article.source || '').split(' ').filter(Boolean));
    return [...new Set(normalize(titleWithoutSource(article)).split(' ').filter(word => {
      if (!word || STOP.has(word) || sourceWords.has(word)) return false;
      return word.length >= 3 || /^\d/.test(word);
    }))];
  }

  function facts(article = {}) {
    const text = clean(`${titleWithoutSource(article)} ${article.summary || ''}`);
    const found = [];
    const numberMatches = text.match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|€|\$|euros?|dollars?|km|milliards?|millions?|ans?|mois|jours?|heures?))?\b/gi) || [];
    found.push(...numberMatches.map(normalize));
    const dateMatches = text.match(/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+\d{4})?\b/gi) || [];
    found.push(...dateMatches.map(normalize));
    return [...new Set(found.filter(Boolean))].slice(0, 18);
  }

  function specificTokens(article = {}) {
    return tokens(article).filter(word => word.length >= 6 || /\d/.test(word)).slice(0, 14);
  }

  function sourceCount(article = {}) {
    const sources = [article.source, ...(Array.isArray(article.sources) ? article.sources : [])]
      .map(normalize).filter(Boolean);
    return Math.max(1, new Set(sources).size);
  }

  function ageHours(article = {}) {
    const parsed = Date.parse(article.publishedAt || '');
    if (!Number.isFinite(parsed)) return 24;
    return Math.max(0, (Date.now() - parsed) / 3600000);
  }

  function overlapScore(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return { common: 0, coverage: 0, jaccard: 0 };
    const bs = new Set(bTokens);
    const common = aTokens.filter(token => bs.has(token)).length;
    const coverage = common / Math.min(aTokens.length, bTokens.length);
    const union = new Set([...aTokens, ...bTokens]).size;
    return { common, coverage, jaccard: common / Math.max(1, union) };
  }

  function storyMemory() {
    const now = Date.now();
    const stored = readJson(STORY_MEMORY_KEY, []);
    return Array.isArray(stored)
      ? stored.filter(item => item && now - Number(item.at || 0) <= MEMORY_MAX_AGE).slice(-260)
      : [];
  }

  function relatedMemory(article, memory) {
    const at = tokens(article);
    if (at.length < 3) return null;
    const published = Date.parse(article.publishedAt || '') || Date.now();
    let best = null;
    for (const item of memory) {
      if (!item || String(item.id || '') === String(article.id || '')) continue;
      if (Math.abs(published - Number(item.published || item.at || 0)) > STORY_COMPARE_AGE) continue;
      const overlap = overlapScore(at, Array.isArray(item.tokens) ? item.tokens : []);
      if (overlap.common < 3) continue;
      if (overlap.coverage < 0.56 && overlap.jaccard < 0.38) continue;
      const score = overlap.coverage * 0.65 + overlap.jaccard * 0.35;
      if (!best || score > best.score) best = { item, score, overlap };
    }
    return best;
  }

  function noveltyFor(article, memory) {
    const related = relatedMemory(article, memory);
    const currentFacts = facts(article);
    const currentSpecific = specificTokens(article);
    if (!related) return { score: 15, state: 'new', newFacts: currentFacts.length };

    const oldFacts = new Set(Array.isArray(related.item.facts) ? related.item.facts : []);
    const oldSpecific = new Set(Array.isArray(related.item.specific) ? related.item.specific : []);
    const newFacts = currentFacts.filter(value => !oldFacts.has(value));
    const newSpecific = currentSpecific.filter(value => !oldSpecific.has(value));

    if (newFacts.length >= 2) return { score: Math.min(30, 15 + newFacts.length * 4), state: 'development', newFacts: newFacts.length };
    if (newFacts.length === 1 || newSpecific.length >= 3) return { score: 10, state: 'development', newFacts: newFacts.length };
    if (newSpecific.length >= 2) return { score: 3, state: 'minor-update', newFacts: 0 };
    return { score: -20, state: 'repeat', newFacts: 0 };
  }

  function seenState() {
    const value = readJson(SEEN_KEY, {});
    return value && typeof value === 'object' ? value : {};
  }

  function seenPenalty(article, seen) {
    const record = seen[String(article.id || '')] || {};
    const impressions = Math.max(0, Number(record.impressions || 0));
    const opens = Math.max(0, Number(record.opens || 0));
    let penalty = Math.min(46, impressions * 7 + opens * 15);
    if (record.lastAt && Date.now() - Number(record.lastAt) < 2 * 3600000) penalty += 7;
    return Math.min(52, penalty);
  }

  function freshnessScore(article) {
    const hours = ageHours(article);
    if (hours <= 2) return 22;
    if (hours <= 6) return 17;
    if (hours <= 12) return 12;
    if (hours <= 24) return 7;
    if (hours <= 40) return 3;
    return -10;
  }

  function importanceScore(article, novelty, seen) {
    const category = Number(CATEGORY_IMPORTANCE[article.category] || 6);
    const sources = Math.min(22, (sourceCount(article) - 1) * 5);
    const factual = Math.min(10, facts(article).length * 2);
    const major = MAJOR_EVENT_RX.test(titleWithoutSource(article)) ? 16 : 0;
    const repeatPenalty = novelty.state === 'repeat' ? -14 : 0;
    const mildSeen = Math.min(18, Math.round(seenPenalty(article, seen) * 0.35));
    return category + freshnessScore(article) + sources + factual + major + Math.max(0, novelty.score) + repeatPenalty - mildSeen;
  }

  function chooseEssentials(scored) {
    const candidates = scored
      .filter(item => ageHours(item.article) <= ESSENTIAL_MAX_AGE)
      .slice()
      .sort((a, b) => b.importance - a.importance);
    const chosen = [];
    const categoryCounts = new Map();
    const sourceCounts = new Map();

    for (const item of candidates) {
      if (chosen.length >= ESSENTIAL_COUNT) break;
      const category = clean(item.article.category || 'Autre');
      const source = normalize(item.article.source || 'source');
      if (Number(categoryCounts.get(category) || 0) >= 2) continue;
      if (Number(sourceCounts.get(source) || 0) >= 2) continue;
      if (item.importance < 20 && chosen.length >= 4) continue;
      chosen.push(item);
      categoryCounts.set(category, Number(categoryCounts.get(category) || 0) + 1);
      sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
    }

    if (chosen.length < Math.min(4, candidates.length)) {
      for (const item of candidates) {
        if (chosen.includes(item)) continue;
        chosen.push(item);
        if (chosen.length >= Math.min(ESSENTIAL_COUNT, candidates.length)) break;
      }
    }
    return chosen;
  }

  function scoreArticles(articles, { remember = true } = {}) {
    if (!Array.isArray(articles)) return [];
    const memory = storyMemory();
    const seen = seenState();
    const scored = articles.map(article => {
      const copy = { ...article };
      const base = Number.isFinite(Number(copy.editorialBaseScore)) ? Number(copy.editorialBaseScore) : Number(copy.score || 0);
      copy.editorialBaseScore = base;
      const novelty = noveltyFor(copy, memory);
      const viewedPenalty = seenPenalty(copy, seen);
      const importance = importanceScore(copy, novelty, seen);
      copy.noveltyScore = novelty.score;
      copy.noveltyState = novelty.state;
      copy.seenPenalty = viewedPenalty;
      copy.editorialImportance = Math.round(importance);
      copy.essential = false;
      copy.essentialRank = 0;
      return { article: copy, base, novelty, viewedPenalty, importance };
    });

    const essentials = chooseEssentials(scored);
    essentials.forEach((item, index) => {
      item.article.essential = true;
      item.article.essentialRank = index + 1;
    });

    for (const item of scored) {
      const essentialBoost = item.article.essential ? Math.max(54, 86 - (item.article.essentialRank - 1) * 5) : 0;
      item.article.score = Math.round(item.base + item.novelty.score - item.viewedPenalty + essentialBoost);
    }

    if (remember) rememberStories(scored.map(item => item.article), memory);
    return scored.map(item => item.article);
  }

  function rememberStories(articles, memory = storyMemory()) {
    const now = Date.now();
    const byId = new Map(memory.map(item => [String(item.id || ''), item]));
    for (const article of articles) {
      const id = String(article.id || '');
      if (!id) continue;
      const published = Date.parse(article.publishedAt || '') || now;
      byId.set(id, {
        id,
        tokens: tokens(article).slice(0, 18),
        facts: facts(article),
        specific: specificTokens(article),
        category: clean(article.category || ''),
        published,
        at: now
      });
    }
    const compact = [...byId.values()]
      .filter(item => now - Number(item.at || 0) <= MEMORY_MAX_AGE)
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
      .slice(-260);
    writeJson(STORY_MEMORY_KEY, compact);
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    payload.articles = scoreArticles(payload.articles);
    const essentials = payload.articles.filter(article => article.essential).length;
    const repeats = payload.articles.filter(article => article.noveltyState === 'repeat').length;
    payload.stats = { ...(payload.stats || {}), essentialCount: essentials, repeatedWithoutNews: repeats, editorialV77: true };
    return payload;
  }

  function transformedResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(transformPayload(payload)), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async function editorialFetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return transformedResponse(response, payload);
      }
    } catch {}
    return response;
  };

  function upgradeStoredCache() {
    const cache = readJson(CACHE_KEY, null);
    if (!cache || !Array.isArray(cache.articles) || !cache.articles.length) return;
    cache.articles = scoreArticles(cache.articles, { remember: false });
    cache.stats = { ...(cache.stats || {}), editorialV77: true };
    writeJson(CACHE_KEY, cache);
  }

  function sessionSeen() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_SEEN_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  }

  function saveSessionSeen(set) {
    try { sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify([...set].slice(-300))); } catch {}
  }

  function recordSeen(id, type) {
    id = String(id || '');
    if (!id) return;
    const seen = seenState();
    const record = seen[id] && typeof seen[id] === 'object' ? { ...seen[id] } : {};
    if (type === 'open') record.opens = Math.min(20, Number(record.opens || 0) + 1);
    else record.impressions = Math.min(20, Number(record.impressions || 0) + 1);
    record.lastAt = Date.now();
    seen[id] = record;

    const entries = Object.entries(seen)
      .filter(([, value]) => value && Date.now() - Number(value.lastAt || 0) < 60 * 24 * 60 * 60 * 1000)
      .sort((a, b) => Number(a[1].lastAt || 0) - Number(b[1].lastAt || 0))
      .slice(-450);
    writeJson(SEEN_KEY, Object.fromEntries(entries));
  }

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    const counted = sessionSeen();
    for (const entry of entries) {
      const card = entry.target;
      const id = String(card.dataset.article || '');
      if (!id) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.65 && !counted.has(id)) {
        clearTimeout(viewTimers.get(card));
        const timer = setTimeout(() => {
          if (!card.isConnected || counted.has(id)) return;
          counted.add(id);
          saveSessionSeen(counted);
          recordSeen(id, 'view');
          card.classList.add('seen-v77');
        }, 1300);
        viewTimers.set(card, timer);
      } else if (!entry.isIntersecting || entry.intersectionRatio < 0.65) {
        clearTimeout(viewTimers.get(card));
      }
    }
  }, { threshold: [0.65] }) : null;

  function cacheArticleMap() {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    return new Map(articles.map(article => [String(article.id || ''), article]));
  }

  function decorateFeed() {
    decorateQueued = false;
    const feeds = [...document.querySelectorAll('.feed')];
    if (!feeds.length) return;
    const articleMap = cacheArticleMap();
    const seen = seenState();

    for (const feed of feeds) {
      const cards = [...feed.querySelectorAll(':scope > .article-card[data-article]')];
      if (!cards.length) continue;

      const essentialCards = [];
      for (const card of cards) {
        const article = articleMap.get(String(card.dataset.article || ''));
        card.classList.toggle('essential-v77', Boolean(article?.essential));
        card.classList.toggle('seen-v77', Boolean(seen[String(card.dataset.article || '')]));
        if (article?.essential) essentialCards.push(card);
        if (observer && !observedCards.has(card)) {
          observedCards.add(card);
          observer.observe(card);
        }
      }

      const page = feed.closest('.page');
      if (!page) continue;
      let banner = page.querySelector(':scope > .essential-banner-v77');
      if (essentialCards.length) {
        if (!banner) {
          banner = document.createElement('div');
          banner.className = 'essential-banner-v77';
          banner.innerHTML = '<span>Essentiel</span><small>Les informations à ne pas manquer</small>';
          feed.insertAdjacentElement('beforebegin', banner);
        }
        banner.hidden = false;
        banner.querySelector('span').textContent = 'Essentiel';
      } else if (banner) {
        banner.hidden = true;
      }
    }
  }

  function queueDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(decorateFeed);
  }

  document.addEventListener('click', event => {
    const card = event.target.closest?.('.article-card[data-article], .brief-point[data-article]');
    if (!card) return;
    if (event.target.closest?.('.save-btn, .category-link, [data-save]')) return;
    recordSeen(card.dataset.article, 'open');
    card.classList.add('seen-v77');
  }, true);

  upgradeStoredCache();

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(queueDecorate).observe(root, { childList: true, subtree: true });
    queueDecorate();
  }, { once: true });

  window.addEventListener('focus', queueDecorate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueDecorate(); });
})();
