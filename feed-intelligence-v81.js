(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const STORY_KEY = 'news-story-history-v81';
  const INTEL_KEY = 'news-story-intelligence-cache-v81';
  const PERF_KEY = 'news-performance-v81';
  const QUICK_CACHE_KEY = 'news-article-summaries-v8';
  const STORY_MAX_AGE = 14 * 86400000;
  const INTEL_MAX_AGE = 7 * 86400000;
  const MAX_STORIES = 180;
  const MAX_SNAPSHOTS = 7;
  const app = document.getElementById('app');
  if (!app) return;

  const upstreamFetch = window.fetch.bind(window);
  let activeArticleKey = '';
  let navStarted = null;
  let summaryStarted = null;
  let imageErrors = 0;
  let decorateQueued = false;

  const STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux article'.split(' '));

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

  function tokens(value = '') {
    return [...new Set(normalize(value).split(' ').filter(word => word && !STOP.has(word) && (word.length >= 4 || /\d/.test(word))))].slice(0, 30);
  }

  function overlap(a = [], b = []) {
    const bs = new Set(b);
    const common = a.filter(token => bs.has(token)).length;
    return {
      common,
      coverage: common / Math.max(1, Math.min(a.length, b.length)),
      jaccard: common / Math.max(1, new Set([...a, ...b]).size)
    };
  }

  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function storyTokens(article = {}) {
    return tokens(`${article.title || ''} ${String(article.summary || '').slice(0, 240)}`).slice(0, 20);
  }

  function compatibleCategory(a = '', b = '') {
    if (!a || !b || a === b) return true;
    const families = [
      new Set(['International','Europe','Politique']),
      new Set(['IA','Tech','Smartphones','VR']),
      new Set(['Économie','Énergie','Automobile']),
      new Set(['Science','Santé','Environnement'])
    ];
    return families.some(family => family.has(a) && family.has(b));
  }

  function baseStoryKey(article = {}) {
    const event = clean(article.eventKeyV78 || article.eventKey || '');
    if (event) return `event:${normalize(event)}`;
    const merged = Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79.map(String).filter(Boolean).sort() : [];
    if (merged.length) return `merged:${merged[0]}`;
    const url = canonicalUrl(article.url || '');
    if (url) return `url:${url}`;
    return `title:${storyTokens(article).slice(0, 8).join('-') || String(article.id || '')}`;
  }

  function fingerprint(snapshot = {}) {
    return normalize(`${snapshot.title || ''}|${String(snapshot.summary || '').slice(0, 420)}`);
  }

  function meaningfulChange(current = {}, previous = {}) {
    if (!previous?.title && !previous?.summary) return true;
    const a = tokens(`${current.title || ''} ${current.summary || ''}`);
    const b = tokens(`${previous.title || ''} ${previous.summary || ''}`);
    const o = overlap(a, b);
    if (fingerprint(current) === fingerprint(previous)) return false;
    const novelty = clean(current.novelty || current.noveltyStateV78 || '');
    if (['development','minor-update'].includes(novelty) && o.coverage < .92) return true;
    return o.coverage < .80 || o.jaccard < .68;
  }

  function splitSentences(value = '') {
    return clean(value).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(sentence => clean(sentence)).filter(sentence => sentence.length >= 28) || [];
  }

  function sentenceDelta(article = {}, previous = {}) {
    const currentSentences = splitSentences(article.summary || '');
    const previousSentences = splitSentences(previous.summary || '');
    if (!currentSentences.length) return '';
    const novel = currentSentences.filter(sentence => {
      const st = tokens(sentence);
      if (st.length < 4) return false;
      let best = 0;
      for (const old of previousSentences) best = Math.max(best, overlap(st, tokens(old)).coverage);
      return best < .68;
    });
    let selected = novel.slice(0, 2).join(' ');
    if (selected.length < 55 && normalize(article.title || '') !== normalize(previous.title || '')) {
      const title = clean(article.title || '');
      if (title.length >= 45 && overlap(tokens(title), tokens(previous.title || '')).coverage < .72) selected = `${title}${/[.!?]$/.test(title) ? '' : '.'} ${selected}`.trim();
    }
    return selected.length >= 55 ? selected.slice(0, 420) : '';
  }

  function snapshotOf(article = {}) {
    return {
      id: String(article.id || ''),
      title: clean(article.title || '').slice(0, 420),
      summary: clean(article.summary || '').slice(0, 1200),
      publishedAt: article.publishedAt || '',
      seenAt: Date.now(),
      source: clean(article.source || ''),
      sources: [...new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(clean).filter(Boolean))].slice(0, 10),
      novelty: clean(article.noveltyStateV78 || article.noveltyState || ''),
      fingerprint: ''
    };
  }

  function findStory(stories, article) {
    const exact = baseStoryKey(article);
    let story = stories.find(item => item.key === exact);
    if (story) return story;
    const currentTokens = storyTokens(article);
    if (currentTokens.length < 4) return null;
    let best = null;
    let bestScore = 0;
    for (const candidate of stories) {
      if (Date.now() - Number(candidate.lastSeen || 0) > STORY_MAX_AGE) continue;
      if (!compatibleCategory(clean(candidate.category || ''), clean(article.category || ''))) continue;
      const o = overlap(currentTokens, Array.isArray(candidate.tokens) ? candidate.tokens : []);
      const score = o.coverage * .7 + o.jaccard * .3;
      if (o.common >= 4 && o.coverage >= .58 && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function enrichStories(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const memory = readJson(STORY_KEY, { stories: [] });
    let stories = Array.isArray(memory.stories) ? memory.stories : [];
    const cutoff = Date.now() - STORY_MAX_AGE;
    stories = stories.filter(story => Number(story.lastSeen || 0) >= cutoff);

    const invalidateQuick = [];
    payload.articles = payload.articles.map(article => {
      const copy = { ...article };
      let story = findStory(stories, copy);
      if (!story) {
        story = {
          key: baseStoryKey(copy),
          category: clean(copy.category || ''),
          tokens: storyTokens(copy),
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          snapshots: []
        };
        stories.push(story);
      }

      const snapshots = Array.isArray(story.snapshots) ? story.snapshots : [];
      const previous = snapshots.length ? snapshots[snapshots.length - 1] : null;
      const current = snapshotOf(copy);
      current.fingerprint = fingerprint(current);
      const changed = !previous || meaningfulChange(current, previous);
      const deltaPreview = previous && changed ? sentenceDelta(copy, previous) : '';

      copy.storyMemoryV81 = {
        key: story.key,
        firstSeenAt: Number(story.firstSeen || Date.now()),
        updateCount: snapshots.length + (changed ? 1 : 0),
        ageDays: Math.max(0, Math.floor((Date.now() - Number(story.firstSeen || Date.now())) / 86400000))
      };
      if (previous) {
        copy.storyPreviousV81 = {
          title: previous.title,
          summary: previous.summary,
          publishedAt: previous.publishedAt,
          source: previous.source,
          sources: previous.sources
        };
        copy.deltaEligibleV81 = changed && ['development','minor-update'].includes(clean(copy.noveltyStateV78 || copy.noveltyState || ''));
        if (deltaPreview) copy.deltaPreviewV81 = deltaPreview;
        if (copy.deltaEligibleV81 && copy.id) invalidateQuick.push(`article:${copy.id}`);
      }

      if (changed && (!previous || previous.fingerprint !== current.fingerprint)) {
        story.snapshots = [...snapshots, current].slice(-MAX_SNAPSHOTS);
      }
      story.lastSeen = Date.now();
      story.category = clean(copy.category || story.category || '');
      story.tokens = [...new Set([...(Array.isArray(story.tokens) ? story.tokens : []), ...storyTokens(copy)])].slice(0, 24);
      return copy;
    });

    if (invalidateQuick.length) {
      const quick = readJson(QUICK_CACHE_KEY, {});
      let changedQuick = false;
      for (const key of invalidateQuick) {
        if (quick[key] && !quick[key].deltaV81) { delete quick[key]; changedQuick = true; }
      }
      if (changedQuick) writeJson(QUICK_CACHE_KEY, quick);
    }

    stories.sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
    writeJson(STORY_KEY, { version: 81, updatedAt: Date.now(), stories: stories.slice(0, MAX_STORIES) });
    payload.stats = { ...(payload.stats || {}), storyMemoryV81: true, storyCountTrackedV81: Math.min(stories.length, MAX_STORIES) };
    return payload;
  }

  function responseFromPayload(payload, source = null) {
    const headers = new Headers(source?.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: source?.ok ? source.status : 200,
      statusText: source?.statusText || 'OK',
      headers
    });
  }

  function parseBody(init) {
    try { return typeof init?.body === 'string' ? JSON.parse(init.body) : null; }
    catch { return null; }
  }

  function cachedArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function fullArticleFor(requestArticle = {}) {
    const url = canonicalUrl(requestArticle.url || '');
    const title = normalize(requestArticle.title || '');
    return cachedArticles().find(article => url && canonicalUrl(article.url || '') === url)
      || cachedArticles().find(article => title && normalize(article.title || '') === title)
      || requestArticle;
  }

  function articleKey(article = {}) {
    return String(article.id || '') || canonicalUrl(article.url || '') || normalize(article.title || '');
  }

  function sourceCount(article = {}) {
    return new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(normalize).filter(Boolean)).size;
  }

  function readIntel(article = {}) {
    const cache = readJson(INTEL_KEY, {});
    const item = cache[articleKey(article)];
    if (!item || Date.now() - Number(item.savedAt || 0) > INTEL_MAX_AGE) return null;
    return item;
  }

  function saveIntel(article, data) {
    if (!article || !data) return;
    const cache = readJson(INTEL_KEY, {});
    cache[articleKey(article)] = { ...data, savedAt: Date.now() };
    const entries = Object.entries(cache).sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0)).slice(0, 180);
    writeJson(INTEL_KEY, Object.fromEntries(entries));
    scheduleDecorate();
  }

  function recordMetric(name, duration, status = '') {
    if (!Number.isFinite(duration) || duration < 0) return;
    const log = readJson(PERF_KEY, []);
    log.push({ name, duration: Math.round(duration), status: clean(status), at: Date.now() });
    writeJson(PERF_KEY, log.slice(-160));
  }

  function usefulDelta(value = '') {
    const text = clean(value);
    return text.length >= 55 && !/aucun changement|aucune nouveauté|résumé indisponible/i.test(text);
  }

  function quickCacheBetterDelta(article, summary, data = {}) {
    if (!article?.id || !usefulDelta(summary)) return;
    const cache = readJson(QUICK_CACHE_KEY, {});
    cache[`article:${article.id}`] = { summary, ai: Boolean(data.ai), unavailable: false, savedAt: Date.now(), deltaV81: true };
    writeJson(QUICK_CACHE_KEY, Object.fromEntries(Object.entries(cache).slice(-180)));
  }

  function dispatchIntel(article, data) {
    saveIntel(article, data);
    window.dispatchEvent(new CustomEvent('news-story-intelligence-v81', { detail: { articleKey: articleKey(article), articleId: String(article.id || ''), ...data } }));
  }

  async function storyIntelligence(article) {
    const cached = readIntel(article);
    if (cached) return cached;
    const previous = article.storyPreviousV81 || null;
    const response = await upstreamFetch('/api/article-story-intelligence?v=81', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        article: {
          id: article.id,
          title: article.title,
          summary: article.summary,
          source: article.source,
          sources: article.sources,
          url: article.url,
          category: article.category,
          noveltyStateV78: article.noveltyStateV78
        },
        previous
      })
    });
    if (!response.ok) throw new Error(`story intelligence ${response.status}`);
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('story intelligence invalid');
    dispatchIntel(article, data);
    return data;
  }

  function syntheticDeltaResponse(article, summary, data = {}) {
    return responseFromPayload({
      summary,
      ai: Boolean(data.ai),
      unavailable: false,
      provider: data.provider || 'delta-v81',
      model: data.model || '',
      delta: true,
      deltaV81: true,
      contradictions: Array.isArray(data.contradictions) ? data.contradictions : [],
      sourceCount: Number(data.sourceCount || sourceCount(article) || 1)
    });
  }

  window.fetch = async function intelligenceV81Fetch(input, init) {
    const started = performance.now();
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch {
      return upstreamFetch(input, init);
    }
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

    if (url.origin === location.origin && url.pathname === '/api/news') {
      const response = await upstreamFetch(input, init);
      recordMetric('actualités', performance.now() - started, response?.status || '');
      if (!response?.ok) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload || !Array.isArray(payload.articles)) return response;
      return responseFromPayload(enrichStories(payload), response);
    }

    if (url.origin === location.origin && url.pathname === '/api/article-summary-groq' && method === 'POST') {
      const body = parseBody(init);
      const requestArticle = body?.article && typeof body.article === 'object' ? body.article : null;
      const full = requestArticle ? fullArticleFor(requestArticle) : null;
      if (full) {
        activeArticleKey = articleKey(full);
        const shouldInspect = Boolean(full.storyPreviousV81) || sourceCount(full) >= 2 || Number(full.mergedCount || 0) >= 2;
        if (shouldInspect) {
          const intelPromise = storyIntelligence(full).catch(() => null);
          intelPromise.then(data => {
            if (data?.deltaSummary && usefulDelta(data.deltaSummary)) quickCacheBetterDelta(full, data.deltaSummary, data);
          });

          if (full.deltaEligibleV81) {
            const preview = clean(full.deltaPreviewV81 || '');
            if (usefulDelta(preview)) {
              recordMetric('résumé différentiel', performance.now() - started, 'preview');
              intelPromise.then(data => {
                if (data?.deltaSummary && usefulDelta(data.deltaSummary) && activeArticleKey === articleKey(full)) {
                  window.dispatchEvent(new CustomEvent('news-story-delta-ready-v81', { detail: { articleKey: articleKey(full), summary: data.deltaSummary, ...data } }));
                }
              });
              return syntheticDeltaResponse(full, preview, { provider: 'delta-preview-v81' });
            }

            const normalPromise = upstreamFetch(input, init);
            try {
              const data = await Promise.race([
                intelPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 1500))
              ]);
              if (data?.deltaSummary && usefulDelta(data.deltaSummary)) {
                recordMetric('résumé différentiel', performance.now() - started, 'ai');
                return syntheticDeltaResponse(full, data.deltaSummary, data);
              }
            } catch {}
            const normal = await normalPromise;
            recordMetric('résumé', performance.now() - started, normal?.status || '');
            return normal;
          }
        }
      }
      const response = await upstreamFetch(input, init);
      recordMetric('résumé', performance.now() - started, response?.status || '');
      return response;
    }

    const response = await upstreamFetch(input, init);
    if (url.origin === location.origin && url.pathname.startsWith('/api/article-summary')) {
      recordMetric(url.pathname.includes('multisource') ? 'résumé multi-sources' : 'résumé', performance.now() - started, response?.status || '');
    }
    return response;
  };

  function storyChip(article) {
    const memory = article?.storyMemoryV81;
    if (!memory || Number(memory.updateCount || 0) < 2) return '';
    const age = Number(memory.ageDays || 0);
    const updates = Number(memory.updateCount || 0);
    return `${updates} étape${updates > 1 ? 's' : ''}${age > 0 ? ` · suivi depuis ${age} j` : ''}`;
  }

  function contradictionMarkup(contradictions = []) {
    if (!Array.isArray(contradictions) || !contradictions.length) return '';
    const items = contradictions.slice(0, 3).map(item => {
      const values = Array.isArray(item.values) ? item.values.join(' / ') : '';
      return `<li><strong>${escapeHtml(item.label || 'Versions différentes selon les sources')}</strong>${values ? `<span>${escapeHtml(values)}</span>` : ''}</li>`;
    }).join('');
    return `<section class="contradiction-panel-v81"><strong>Sources en désaccord</strong><p>Les éléments ci-dessous ne sont pas présentés comme établis.</p><ul>${items}</ul></section>`;
  }

  function escapeHtml(value = '') {
    return clean(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function decorateCards() {
    const map = new Map(cachedArticles().map(article => [String(article.id || ''), article]));
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      if (card.closest('.stable-owned-list')) return;
      const article = map.get(String(card.dataset.article || ''));
      if (!article) return;
      const chipText = storyChip(article);
      let chip = card.querySelector('.story-memory-v81');
      if (chipText) {
        if (!chip) {
          chip = document.createElement('span');
          chip.className = 'story-memory-v81';
          const anchor = card.querySelector('.why-v78, .meta');
          if (anchor) anchor.insertAdjacentElement('afterend', chip);
          else (card.querySelector('.article-body') || card).appendChild(chip);
        }
        chip.textContent = chipText;
      } else chip?.remove();

      card.querySelector('.story-warning-v81')?.remove();
    });
  }

  function decorateSettings() {
    const versionSection = app.querySelector('.app-version-section');
    if (!versionSection || versionSection.querySelector('[data-diagnostic-v81]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn compact-btn diagnostic-button-v81';
    button.dataset.diagnosticV81 = '';
    button.textContent = 'Diagnostic et performances';
    versionSection.appendChild(button);
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateCards();
      decorateSettings();
      checkTimings();
    });
  }

  function checkTimings() {
    if (navStarted) {
      const active = document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
      if (active === navStarted.target) {
        recordMetric('navigation ' + active, performance.now() - navStarted.at, 'dom');
        navStarted = null;
      }
    }
    if (summaryStarted) {
      const text = document.querySelector('.quick-summary-backdrop [data-quick-summary-text]');
      if (text && clean(text.textContent || '').length >= 55 && !/en cours de préparation/i.test(text.textContent || '')) {
        recordMetric('ouverture résumé', performance.now() - summaryStarted.at, 'dom');
        summaryStarted = null;
      }
    }
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))] || 0;
  }

  function perfSummary() {
    const log = readJson(PERF_KEY, []);
    const groups = {};
    for (const item of log) {
      if (!groups[item.name]) groups[item.name] = [];
      groups[item.name].push(Number(item.duration || 0));
    }
    return Object.entries(groups).map(([name, values]) => ({ name, median: Math.round(quantile(values, .5)), p95: Math.round(quantile(values, .95)), count: values.length })).sort((a, b) => b.count - a.count);
  }

  async function apiStatus(path) {
    const started = performance.now();
    try {
      const response = await upstreamFetch(path, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok && data?.ok !== false, ms: Math.round(performance.now() - started), data };
    } catch {
      return { ok: false, ms: Math.round(performance.now() - started), data: {} };
    }
  }

  async function diagnosticData() {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const memory = readJson(STORY_KEY, { stories: [] });
    const intel = readJson(INTEL_KEY, {});
    const cacheNames = 'caches' in window ? await caches.keys().catch(() => []) : [];
    const storageBytes = [CACHE_KEY, STORY_KEY, INTEL_KEY, PERF_KEY].reduce((total, key) => total + String(localStorage.getItem(key) || '').length * 2, 0);
    const metrics = window.NewsDiagnosticsV91?.collect({
      cache,
      errors: readJson('news-client-errors-v88', []),
      imageErrors
    }) || null;
    const [groq, multi, story] = await Promise.all([
      apiStatus('/api/article-summary-groq?status=1'),
      apiStatus('/api/article-summary-multisource?status=1'),
      apiStatus('/api/article-story-intelligence?status=1')
    ]);
    return {
      articles: articles.length,
      essentials: articles.filter(article => article.essential).length,
      duplicates: Number(cache.stats?.duplicatesCollapsedV79 || 0),
      stories: Array.isArray(memory.stories) ? memory.stories.length : 0,
      intel: Object.keys(intel || {}).length,
      imageErrors,
      storageKB: Math.round(storageBytes / 1024),
      serviceWorker: Boolean(navigator.serviceWorker?.controller),
      cacheNames,
      perf: perfSummary(),
      metrics,
      apis: { groq, multi, story }
    };
  }

  async function openDiagnostic() {
    document.querySelector('.diagnostic-backdrop-v81')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'diagnostic-backdrop-v81';
    backdrop.innerHTML = `<section class="diagnostic-panel-v81" role="dialog" aria-modal="true" aria-label="Diagnostic"><header><div><small>v81</small><h2>Diagnostic et performances</h2></div><button type="button" data-diagnostic-close-v81 aria-label="Fermer">×</button></header><div class="diagnostic-content-v81"><p>Collecte des informations locales et vérification des API…</p></div></section>`;
    document.body.appendChild(backdrop);
    const content = backdrop.querySelector('.diagnostic-content-v81');
    const data = await diagnosticData();
    if (!backdrop.isConnected) return;
    const apiRow = (name, status) => `<div class="diagnostic-row-v81"><span>${escapeHtml(name)}</span><strong class="${status.ok ? 'ok' : 'bad'}">${status.ok ? 'OK' : 'Erreur'} · ${status.ms} ms</strong></div>`;
    const perf = data.perf.length ? data.perf.slice(0, 8).map(item => `<div class="diagnostic-row-v81"><span>${escapeHtml(item.name)} <small>(${item.count})</small></span><strong>${item.median} ms méd. · ${item.p95} ms p95</strong></div>`).join('') : '<p>Aucune mesure disponible pour l’instant.</p>';
    const metrics = data.metrics;
    const quality = metrics ? `<section><h3>Qualité du fil</h3><div class="diagnostic-row-v81"><span>Déduplication</span><strong>${metrics.dedup.collapsed} retirés · ${metrics.dedup.mergedArticles} regroupés · max ${metrics.dedup.largestCluster}</strong></div><div class="diagnostic-row-v81"><span>Classement</span><strong>${metrics.ranking.positiveSignals} bonus · ${metrics.ranking.negativeSignals} malus · ${metrics.ranking.lowInformation} faibles</strong></div><div class="diagnostic-row-v81"><span>Nouveauté</span><strong>${metrics.ranking.novelty.development} développements · ${metrics.ranking.novelty.repeat} répétitions</strong></div><div class="diagnostic-row-v81"><span>Images</span><strong>${metrics.images.ready} vérifiées · ${metrics.images.candidate} candidates · ${metrics.images.missing} absentes</strong></div><div class="diagnostic-row-v81"><span>Résumés</span><strong>${metrics.summaries.usable} utiles · ${metrics.summaries.missing} vides · ${metrics.summaries.generic} génériques · ${metrics.summaries.titleLike} proches du titre</strong></div><div class="diagnostic-row-v81"><span>Erreurs client</span><strong class="${metrics.errors.total ? 'bad' : 'ok'}">${metrics.errors.total} · ${metrics.errors.rejections} rejets</strong></div></section>` : '';
    content.innerHTML = `<section><h3>État du fil</h3><div class="diagnostic-grid-v81"><div><strong>${data.articles}</strong><span>articles</span></div><div><strong>${data.essentials}</strong><span>Essentiels</span></div><div><strong>${data.duplicates}</strong><span>doublons fusionnés</span></div><div><strong>${data.stories}</strong><span>événements suivis</span></div></div></section>${quality}<section><h3>Stabilité locale</h3><div class="diagnostic-row-v81"><span>Service worker</span><strong class="${data.serviceWorker ? 'ok' : 'bad'}">${data.serviceWorker ? 'Actif' : 'Inactif'}</strong></div><div class="diagnostic-row-v81"><span>Caches PWA</span><strong>${data.cacheNames.length}</strong></div><div class="diagnostic-row-v81"><span>Stockage suivi</span><strong>${data.storageKB} Ko</strong></div><div class="diagnostic-row-v81"><span>Erreurs images cette session</span><strong class="${data.imageErrors ? 'bad' : 'ok'}">${data.imageErrors}</strong></div></section><section><h3>API et latence</h3>${apiRow('Résumé Groq', data.apis.groq)}${apiRow('Résumé multi-sources', data.apis.multi)}${apiRow('Mémoire / contradictions', data.apis.story)}</section><section><h3>Performances mesurées</h3>${perf}</section><div class="diagnostic-actions-v81"><button type="button" data-diagnostic-copy-v81>Copier le diagnostic</button><button type="button" data-diagnostic-clear-v81>Effacer les mesures</button></div>`;
    backdrop.dataset.diagnosticText = JSON.stringify(data, null, 2);
  }

  window.addEventListener('news-story-intelligence-v81', event => {
    const data = event.detail || {};
    if (data.articleKey !== activeArticleKey) return;
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    modal.querySelector('.contradiction-panel-v81')?.remove();
    if (Array.isArray(data.contradictions) && data.contradictions.length) {
      const anchor = modal.querySelector('.quick-summary-text');
      anchor?.insertAdjacentHTML('afterend', contradictionMarkup(data.contradictions));
    }
  });

  window.addEventListener('news-story-delta-ready-v81', event => {
    const data = event.detail || {};
    if (data.articleKey !== activeArticleKey || !usefulDelta(data.summary || '')) return;
    const modal = document.querySelector('.quick-summary-backdrop');
    const text = modal?.querySelector('[data-quick-summary-text]');
    if (!modal || !text) return;
    text.textContent = clean(data.summary);
    let label = modal.querySelector('.delta-label-v81');
    if (!label) {
      label = document.createElement('div');
      label.className = 'delta-label-v81';
      label.textContent = 'Ce qui a changé';
      text.insertAdjacentElement('beforebegin', label);
    }
    modal.querySelector('.contradiction-panel-v81')?.remove();
    if (Array.isArray(data.contradictions) && data.contradictions.length) text.insertAdjacentHTML('afterend', contradictionMarkup(data.contradictions));
  });

  document.addEventListener('click', event => {
    const article = event.target.closest?.('[data-article]');
    if (article) {
      const full = cachedArticles().find(item => String(item.id || '') === String(article.dataset.article || ''));
      if (full) activeArticleKey = articleKey(full);
      summaryStarted = { at: performance.now() };
    }
    const nav = event.target.closest?.('.bottom-nav [data-view="home"], .bottom-nav [data-view="brief"]');
    if (nav) navStarted = { at: performance.now(), target: nav.dataset.view };

    if (event.target.closest?.('[data-diagnostic-v81]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDiagnostic();
      return;
    }
    if (event.target.closest?.('[data-diagnostic-close-v81]') || event.target.matches?.('.diagnostic-backdrop-v81')) {
      document.querySelector('.diagnostic-backdrop-v81')?.remove();
      return;
    }
    if (event.target.closest?.('[data-diagnostic-clear-v81]')) {
      writeJson(PERF_KEY, []);
      openDiagnostic();
      return;
    }
    if (event.target.closest?.('[data-diagnostic-copy-v81]')) {
      const backdrop = document.querySelector('.diagnostic-backdrop-v81');
      navigator.clipboard?.writeText(backdrop?.dataset.diagnosticText || '').catch(() => {});
      return;
    }
  }, true);

  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) imageErrors += 1;
  }, true);

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(app, { childList: true, subtree: true });
  const bodyObserver = new MutationObserver(checkTimings);
  bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('focus', scheduleDecorate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleDecorate(); });
  scheduleDecorate();
})();
