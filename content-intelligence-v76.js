(() => {
  'use strict';

  const PREF_KEY = 'news-topic-preferences-v1';
  const CACHE_KEY = 'news-live-cache';
  const SUMMARY_KEY = 'news-article-summaries-v8';
  const SUMMARY_ATTEMPTS_KEY = 'news-summary-prewarm-attempts-v1';
  const SUMMARY_LIMIT = 10;
  const SUMMARY_CONCURRENCY = 2;
  const SUMMARY_RETRY_MS = 12 * 60 * 60 * 1000;
  const MAX_EVENT_AGE_MS = 36 * 60 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);
  let summaryBudget = 12;
  let summaryTimer = 0;
  let decorating = false;

  const CATEGORY_NAMES = new Set(['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe','IA','Tech','Smartphones','VR','Automobile','Énergie']);
  const STOP = new Set([
    'avec','dans','pour','plus','apres','avant','cette','cet','ces','sont','etre','leur','leurs','tout','tous','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','son','ses','est','fait','font','comme','dont','elle','elles','ils','nous','vous','notre','votre','leurs','aussi','encore','deja','tres','moins','depuis','alors','chez','contre','apres','avant','lors','peut','peuvent','avait','avoir','sera','etre','aux','une','un','le','la','du','de','des','d','au','en','et','ou','ce','se','sa','ne','pas','the','and','for','with','from','that','this','are','was','will','has','have','into','over','after','before'
  ]);

  const CONCEPTS = [
    ['intelligence artificielle', /\bintelligence artificielle\b|\bIA\b/i],
    ['OpenAI', /\bOpenAI\b/i], ['ChatGPT', /\bChatGPT\b/i], ['Anthropic', /\bAnthropic\b/i], ['Claude', /\bClaude\b/i], ['Gemini', /\bGemini\b/i],
    ['réalité virtuelle', /\br[ée]alit[ée] virtuelle\b|\bVR\b|\bPCVR\b/i], ['Meta Quest', /\b(?:Meta\s+)?Quest\s*\d*\b/i],
    ['smartphones', /\bsmartphones?\b/i], ['Android', /\bAndroid\b/i], ['iPhone', /\biPhone\b/i], ['Samsung Galaxy', /\bSamsung\s+Galaxy\b/i], ['Google Pixel', /\bGoogle\s+Pixel\b/i], ['Oppo', /\bOppo\b/i], ['Xiaomi', /\bXiaomi\b/i],
    ['Windows', /\bWindows\s*\d*\b/i], ['Linux', /\bLinux\b/i], ['cybersécurité', /\bcyber(?:s[ée]curit[ée]|attaque|attaques)\b/i],
    ['voiture électrique', /\b(?:voiture|v[ée]hicule)s? [ée]lectriques?\b/i], ['batteries lithium', /\bbatteries? lithium\b/i], ['nucléaire', /\bnucl[ée]aire\b/i], ['énergie', /\b[ée]nergie\b/i],
    ['espace', /\bespace\b|\borbite\b|\bspatial(?:e|es)?\b/i], ['James Webb', /\bJames Webb\b/i], ['Mars', /\bMars\b/],
    ['GTA 6', /\bGTA\s*(?:6|VI)\b/i], ['DLSS', /\bDLSS\s*\d*\b/i]
  ];

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
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function stripSourceTitle(title = '', source = '') {
    let result = clean(title);
    const src = clean(source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (src) result = result.replace(new RegExp(`\\s*[-–—|·:]\\s*${src}\\s*$`, 'i'), '').trim();
    return result.replace(/\s+[-–—|]\s+[^–—|]{2,42}$/, match => /\.(?:fr|com|net|org|be|ch)$/i.test(match) ? '' : match).trim();
  }

  function titleTokens(article = {}) {
    const sourceWords = new Set(normalize(article.source || '').split(' ').filter(Boolean));
    return [...new Set(normalize(stripSourceTitle(article.title, article.source)).split(' ').filter(word => {
      if (!word || STOP.has(word) || sourceWords.has(word)) return false;
      return word.length >= 3 || /^\d+$/.test(word);
    }))];
  }

  function titleNumbers(article = {}) {
    return [...new Set((normalize(stripSourceTitle(article.title, article.source)).match(/\b\d+(?:\.\d+)?\b/g) || []))];
  }

  function semanticSignals(article = {}) {
    const title = stripSourceTitle(article.title, article.source);
    const found = [];
    for (const [label, rx] of CONCEPTS) if (rx.test(title)) found.push(label);

    try {
      const named = title.match(/\b(?:[A-ZÀ-ÖØ-Þ][\p{L}\d’'\-]{1,}|[A-Z]{2,}|[A-Z][a-z]+\d+)(?:\s+(?:[A-ZÀ-ÖØ-Þ][\p{L}\d’'\-]{1,}|[A-Z]{2,}|\d+[A-Za-z]*)){1,3}\b/gu) || [];
      for (let phrase of named) {
        phrase = phrase.replace(/^(?:Le|La|Les|Un|Une|Des|Ce|Cette|Ces)\s+/i, '').trim();
        if (phrase.length >= 5 && !CATEGORY_NAMES.has(phrase)) found.push(phrase);
      }
    } catch {}

    const words = titleTokens(article);
    for (let i = 0; i < words.length - 1 && found.length < 7; i += 1) {
      const a = words[i], b = words[i + 1];
      if ((a.length >= 6 || b.length >= 6 || /\d/.test(a + b)) && !/^\d+$/.test(a) && !/^\d+$/.test(b)) {
        const phrase = `${a} ${b}`;
        if (!found.some(item => normalize(item) === phrase)) found.push(phrase);
      }
    }

    const unique = [];
    const seen = new Set();
    for (const value of found) {
      const key = normalize(value);
      if (!key || seen.has(key) || key.length < 4) continue;
      seen.add(key);
      unique.push(clean(value));
      if (unique.length >= 6) break;
    }
    return unique;
  }

  function sameEvent(a, b) {
    const aDate = Date.parse(a.publishedAt || 0), bDate = Date.parse(b.publishedAt || 0);
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && Math.abs(aDate - bDate) > MAX_EVENT_AGE_MS) return false;
    const aTitle = normalize(stripSourceTitle(a.title, a.source));
    const bTitle = normalize(stripSourceTitle(b.title, b.source));
    if (!aTitle || !bTitle) return false;
    if (aTitle === bTitle) return true;

    const at = titleTokens(a), bt = titleTokens(b);
    if (at.length < 3 || bt.length < 3) return false;
    const bs = new Set(bt);
    const common = at.filter(word => bs.has(word));
    if (common.length < 3) return false;
    const coverage = common.length / Math.min(at.length, bt.length);
    const union = new Set([...at, ...bt]).size;
    const jaccard = common.length / Math.max(1, union);

    const an = titleNumbers(a), bn = titleNumbers(b);
    const numberConflict = an.length && bn.length && !an.some(number => bn.includes(number));
    if (numberConflict) return common.length >= 5 && coverage >= 0.7 && jaccard >= 0.5;
    return (coverage >= 0.62 && jaccard >= 0.4) || (common.length >= 5 && coverage >= 0.5 && jaccard >= 0.34);
  }

  function summaryQuality(value = '', title = '') {
    const text = clean(value);
    if (!text) return 0;
    const normalizedText = normalize(text), normalizedTitle = normalize(title);
    if (normalizedText === normalizedTitle || text.length < 45) return 0;
    let score = Math.min(text.length, 650);
    if (/\d/.test(text)) score += 25;
    if (/[.!?]/.test(text)) score += 15;
    return score;
  }

  function chooseRepresentative(cluster) {
    return cluster.slice().sort((a, b) => {
      const visual = item => item.visual?.status === 'ready' && item.visual?.url ? 45 : item.image ? 25 : 0;
      const summary = item => Math.min(50, summaryQuality(item.summary || item.detail, item.title) / 10);
      return (Number(b.score || 0) + visual(b) + summary(b)) - (Number(a.score || 0) + visual(a) + summary(a));
    })[0];
  }

  function mergeCluster(cluster) {
    if (cluster.length === 1) {
      const article = { ...cluster[0] };
      article.matches = [...new Set([...(article.matches || []), ...semanticSignals(article)])].slice(0, 8);
      return article;
    }

    const representative = chooseRepresentative(cluster);
    const merged = { ...representative };
    const sources = [];
    for (const item of cluster) {
      for (const source of [item.source, ...(Array.isArray(item.sources) ? item.sources : [])]) {
        const value = clean(source);
        if (value && !sources.some(existing => normalize(existing) === normalize(value))) sources.push(value);
      }
    }

    const richest = cluster.slice().sort((a, b) => summaryQuality(b.summary || b.detail, b.title) - summaryQuality(a.summary || a.detail, a.title))[0];
    if (summaryQuality(richest?.summary || richest?.detail, richest?.title) > summaryQuality(merged.summary || merged.detail, merged.title)) {
      merged.summary = richest.summary || richest.detail || merged.summary;
      merged.detail = richest.detail || richest.summary || merged.detail;
    }

    const visual = cluster.find(item => item.visual?.status === 'ready' && item.visual?.url) || cluster.find(item => item.image);
    if (visual && !(merged.visual?.status === 'ready' && merged.visual?.url)) {
      merged.image = visual.visual?.url || visual.image || merged.image;
      merged.visual = visual.visual ? { ...visual.visual } : merged.visual;
      merged.visualStatus = visual.visualStatus || visual.visual?.status || merged.visualStatus;
    }

    merged.sources = sources;
    merged.relatedUrls = [...new Set(cluster.map(item => item.url).filter(Boolean))].slice(0, 12);
    merged.mergedCount = cluster.length;
    merged.publishedAt = cluster.map(item => item.publishedAt).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || merged.publishedAt;
    merged.score = Math.max(...cluster.map(item => Number(item.score || 0))) + Math.min(10, (sources.length - 1) * 2);
    merged.matches = [...new Set(cluster.flatMap(item => [...(item.matches || []), ...semanticSignals(item)]))].slice(0, 10);
    return merged;
  }

  function clusterArticles(articles) {
    if (!Array.isArray(articles) || articles.length < 2) return Array.isArray(articles) ? articles.map(item => mergeCluster([item])) : [];
    const clusters = [];
    const ordered = articles.slice().sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
    for (const article of ordered) {
      let target = null;
      for (const cluster of clusters) {
        if (sameEvent(cluster[0], article)) { target = cluster; break; }
      }
      if (target) target.push(article); else clusters.push([article]);
    }
    return clusters.map(mergeCluster);
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const before = payload.articles.length;
    payload.articles = clusterArticles(payload.articles);
    payload.stats = { ...(payload.stats || {}), semanticInput: before, semanticEvents: payload.articles.length, semanticMerged: Math.max(0, before - payload.articles.length) };
    return payload;
  }

  function transformNewsResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(transformPayload(payload)), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function contentAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return transformNewsResponse(response, payload);
      }
    } catch {}
    return response;
  };

  function upgradeStoredCache() {
    const cache = readJson(CACHE_KEY, null);
    if (!cache || !Array.isArray(cache.articles) || !cache.articles.length) return;
    const clustered = clusterArticles(cache.articles);
    if (clustered.length !== cache.articles.length || clustered.some((article, index) => JSON.stringify(article.matches || []) !== JSON.stringify(cache.articles[index]?.matches || []))) {
      cache.articles = clustered;
      writeJson(CACHE_KEY, cache);
    }
  }

  function prunePreferences(preferences) {
    const entries = Object.entries(preferences).filter(([key, value]) => key && Number.isFinite(Number(value)) && Math.abs(Number(value)) >= 0.05);
    const fixed = entries.filter(([key]) => CATEGORY_NAMES.has(key));
    const semantic = entries.filter(([key]) => !CATEGORY_NAMES.has(key)).sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1]))).slice(0, 70);
    return Object.fromEntries([...fixed, ...semantic]);
  }

  function adjustSemanticPreferences(article, mode) {
    if (!article) return;
    const delta = ({ more: 0.9, follow: 1.6, less: -0.9, not: -1.6 })[mode];
    if (!delta) return;
    const signals = semanticSignals(article).slice(0, 5);
    if (!signals.length) return;
    const preferences = readJson(PREF_KEY, {});
    for (const signal of signals) {
      const previous = Number(preferences[signal] || 0);
      preferences[signal] = Math.max(-3, Math.min(3, Math.round((previous + delta) * 10) / 10));
    }
    const pruned = prunePreferences(preferences);
    writeJson(PREF_KEY, pruned);
    window.dispatchEvent(new CustomEvent('news-topic-preferences-changed', { detail: pruned }));
  }

  function cachedArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function articleForFeedback(button) {
    const id = button.dataset.id || button.closest('[data-article]')?.dataset.article || '';
    const articles = cachedArticles();
    if (id) return articles.find(item => String(item.id) === String(id)) || null;
    const modalTitle = clean(button.closest('.quick-summary-backdrop')?.querySelector('.quick-summary-head h2')?.textContent || '');
    if (!modalTitle) return null;
    const wanted = normalize(modalTitle);
    return articles.find(item => normalize(stripSourceTitle(item.title, item.source)) === wanted) || null;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-feedback], [data-quick-feedback]');
    if (!button) return;
    const mode = button.dataset.feedback || button.dataset.quickFeedback || '';
    if (!['more','less','not','follow'].includes(mode)) return;
    adjustSemanticPreferences(articleForFeedback(button), mode);
  }, true);

  function goodSummary(value = '', article = {}) {
    const text = clean(value);
    if (text.length < 55 || /résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(text)) return false;
    const title = normalize(stripSourceTitle(article.title, article.source));
    const body = normalize(text);
    if (body === title) return false;
    const titleWords = title.split(' ').filter(word => word.length >= 4 && !STOP.has(word));
    const bodyWords = new Set(body.split(' '));
    const overlap = titleWords.length ? titleWords.filter(word => bodyWords.has(word)).length / titleWords.length : 0;
    return !(text.length <= Math.max(180, clean(article.title).length * 1.55) && overlap >= 0.86);
  }

  function articlePayload(article) {
    let summary = clean(article.summary || '');
    try { if (new URL(article.url, location.href).hostname === 'news.google.com') summary = ''; } catch {}
    if (summary.length < 60) summary = '';
    return { url: article.url, title: clean(article.title), summary, source: clean(article.source || '') };
  }

  async function fetchJson(url, options) {
    try {
      const response = await nativeFetch(url, options);
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }

  async function prewarmOneSummary(article) {
    if (!article || summaryBudget <= 0) return false;
    const summaryCache = readJson(SUMMARY_KEY, {});
    const cacheKey = `article:${article.id}`;
    if (goodSummary(summaryCache[cacheKey]?.summary, article)) return true;

    const attempts = readJson(SUMMARY_ATTEMPTS_KEY, {});
    const lastAttempt = Number(attempts[article.id] || 0);
    if (lastAttempt && Date.now() - lastAttempt < SUMMARY_RETRY_MS) return false;
    attempts[article.id] = Date.now();
    writeJson(SUMMARY_ATTEMPTS_KEY, Object.fromEntries(Object.entries(attempts).slice(-220)));
    summaryBudget -= 1;

    const payload = articlePayload(article);
    let data = null;
    if (/\ble\s+parisien\b/i.test(`${article.source || ''} ${article.title || ''}`)) {
      const smart = await fetchJson('/api/article-summary-smart?v=3', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ article: payload })
      });
      if (smart?.ok && goodSummary(smart.text, article)) data = { summary: clean(smart.text), ai: Boolean(smart.grounded), grounded: Boolean(smart.grounded) };
    }

    if (!data) {
      const groq = await fetchJson('/api/article-summary-groq?v=17', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ mode: 'article', article: payload })
      });
      if (!groq?.unavailable && goodSummary(groq?.summary, article)) data = { summary: clean(groq.summary), ai: true };
    }

    if (!data) return false;
    const latest = readJson(SUMMARY_KEY, {});
    latest[cacheKey] = { summary: data.summary, ai: Boolean(data.ai || data.grounded), unavailable: false, savedAt: Date.now(), prewarmed: true };
    writeJson(SUMMARY_KEY, Object.fromEntries(Object.entries(latest).slice(-180)));
    return true;
  }

  async function runSummaryPrewarm() {
    if (summaryBudget <= 0 || document.hidden || navigator.onLine === false || navigator.connection?.saveData) return;
    const articles = cachedArticles();
    const ids = [...document.querySelectorAll('.article-card[data-article]')].slice(0, SUMMARY_LIMIT).map(card => card.dataset.article);
    const queue = ids.map(id => articles.find(item => String(item.id) === String(id))).filter(Boolean);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length && summaryBudget > 0) {
        const article = queue[cursor++];
        await prewarmOneSummary(article);
      }
    }
    await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, queue.length) }, () => worker()));
  }

  function scheduleSummaryPrewarm() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      const run = () => runSummaryPrewarm().catch(() => {});
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3500 });
      else run();
    }, 1800);
  }

  function decorateMergedSourceCounts() {
    if (decorating) return;
    decorating = true;
    try {
      const articles = cachedArticles();
      const map = new Map(articles.map(article => [String(article.id), article]));
      document.querySelectorAll('.article-card[data-article]').forEach(card => {
        const article = map.get(String(card.dataset.article));
        const sourceNode = card.querySelector('.meta .source');
        if (!article || !sourceNode) return;
        const count = Array.isArray(article.sources) ? new Set(article.sources.map(normalize).filter(Boolean)).size : 0;
        const wanted = `${clean(article.source)}${count > 1 ? ` · ${count} sources` : ''}`;
        if (sourceNode.textContent !== wanted) sourceNode.textContent = wanted;
      });
    } finally { decorating = false; }
  }

  function scheduleUiIntelligence() {
    decorateMergedSourceCounts();
    scheduleSummaryPrewarm();
  }

  upgradeStoredCache();
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(scheduleUiIntelligence).observe(root, { childList: true, subtree: true });
    scheduleUiIntelligence();
  }, { once: true });
  window.addEventListener('focus', scheduleUiIntelligence);
})();
