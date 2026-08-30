(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const SNAPSHOT_KEY = 'news-brief-facts-v87';
  const LAST_KEY = 'news-brief-last-open-v87';
  const MAX_SEMANTIC_GAP_MS = 24 * 60 * 60 * 1000;
  const BRIEF_STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux article sous'.split(' '));
  const BRIEF_EVENT_TOKENS = new Set(['outcome','vote','negotiation']);
  const upstreamFetch = window.fetch.bind(window);
  const briefStats = { version: '91.10', lastDeduped: 0, lastCandidates: 0, lastChosen: 0 };
  let queued = false;
  let lastView = '';
  let visitPrevious = null;
  let visitPreviousAt = 0;
  let visitCommitted = false;

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

  function currentView() {
    return document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function currentBriefMode() {
    return document.querySelector('.brief-mode-tab.active[data-brief-mode]')?.dataset.briefMode || 'essential';
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function eventKey(article = {}) {
    return clean(article.eventKeyV78 || article.storyMemoryV81?.key || '')
      || String(article.id || '')
      || normalize(article.title || '');
  }

  function titleText(article = {}) {
    return clean(article.title || '').replace(/\s+[-–—|]\s+[^–—|]{2,45}$/i, '').trim();
  }

  function canonicalBriefToken(word = '') {
    if (word === 'non' || /^(?:rejet|refus|emport|impos)/.test(word)) return 'outcome';
    if (/^(?:referend|scrutin|vot)/.test(word)) return 'vote';
    if (/^(?:negoci|adhes|integr)/.test(word)) return 'negotiation';
    return word;
  }

  function briefTokens(article = {}) {
    const text = normalize(titleText(article)).replace(/\bunion europeenne\b/g, 'ue');
    const tokens = [];
    for (const raw of text.split(' ')) {
      if (!raw) continue;
      const word = canonicalBriefToken(raw);
      if (!word || BRIEF_STOP.has(word) || (word.length < 4 && word !== 'ue')) continue;
      if (!tokens.includes(word)) tokens.push(word);
    }
    return tokens.slice(0, 20);
  }

  function tokenEquivalent(a = '', b = '') {
    if (a === b) return true;
    return a.length >= 6 && b.length >= 6 && a.slice(0, 5) === b.slice(0, 5);
  }

  function semanticOverlap(a = [], b = []) {
    const used = new Set();
    const matches = [];
    for (const left of a) {
      const index = b.findIndex((right, i) => !used.has(i) && tokenEquivalent(left, right));
      if (index < 0) continue;
      used.add(index);
      matches.push([left, b[index]]);
    }
    const common = matches.length;
    return {
      common,
      coverage: common / Math.max(1, Math.min(a.length, b.length)),
      jaccard: common / Math.max(1, a.length + b.length - common),
      matches
    };
  }

  function mergedIds(article = {}) {
    const values = [article.id, ...(Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : [])];
    return new Set(values.map(value => String(value || '')).filter(Boolean));
  }

  function sameBriefEvent(a = {}, b = {}) {
    const aKey = clean(a.eventKeyV78 || a.storyMemoryV81?.key || '');
    const bKey = clean(b.eventKeyV78 || b.storyMemoryV81?.key || '');
    if (aKey && bKey && aKey === bKey) return true;

    const aIds = mergedIds(a);
    const bIds = mergedIds(b);
    if ([...aIds].some(id => bIds.has(id))) return true;

    const at = publishedAt(a);
    const bt = publishedAt(b);
    if (at && bt && Math.abs(at - bt) > MAX_SEMANTIC_GAP_MS) return false;

    const left = briefTokens(a);
    const right = briefTokens(b);
    if (left.length < 3 || right.length < 3) return false;
    const overlap = semanticOverlap(left, right);
    if (overlap.common >= 5 && overlap.coverage >= 0.55) return true;
    if (overlap.common >= 4 && overlap.coverage >= 0.60 && overlap.jaccard >= 0.30) return true;

    const matched = overlap.matches.map(([token]) => token);
    const eventMatches = matched.filter(token => BRIEF_EVENT_TOKENS.has(token));
    const anchorMatches = matched.filter(token => !BRIEF_EVENT_TOKENS.has(token));
    return overlap.common >= 3
      && overlap.coverage >= 0.58
      && eventMatches.includes('outcome')
      && anchorMatches.length >= 2;
  }

  function fingerprint(article = {}) {
    return normalize(`${article.title || ''}|${String(article.deltaPreviewV81 || article.summary || '').slice(0, 500)}|${article.noveltyStateV78 || ''}`);
  }

  function sentence(value = '') {
    const text = clean(value);
    const found = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(clean).filter(Boolean) || [];
    const first = found.find(item => item.length >= 38) || found[0] || '';
    return first.slice(0, 280);
  }

  function factFor(article = {}) {
    const delta = clean(article.deltaPreviewV81 || '');
    if (delta.length >= 45) return sentence(delta) || delta.slice(0, 280);
    const summary = clean(article.summary || article.detail || '');
    if (summary.length >= 55) return sentence(summary);
    return clean(article.title || '').slice(0, 280);
  }

  function importance(article = {}) {
    let value = Number(article.score || 0);
    if (article.essential) value += 80;
    value += Number(article.editorialImportanceV78 || article.editorialImportance || 0) * 0.7;
    if (article.noveltyStateV78 === 'development') value += 24;
    else if (article.noveltyStateV78 === 'new') value += 15;
    else if (article.noveltyStateV78 === 'minor-update') value += 8;
    if (article.corroboratedV79 || Number(article.mergedCount || 0) >= 2) value += 7;
    if (Number(article.informationValueV89 || 0) >= 75) value += 8;
    if (article.lowInformationV89) value -= 18;
    return value;
  }

  function snapshotEntry(article = {}) {
    return {
      key: eventKey(article),
      fingerprint: fingerprint(article),
      publishedAt: publishedAt(article),
      title: clean(article.title || '').slice(0, 300),
      novelty: clean(article.noveltyStateV78 || '')
    };
  }

  function selectFacts(articles, previous, previousAt) {
    const previousMap = new Map((Array.isArray(previous) ? previous : []).map(item => [item.key, item]));
    const firstBrief = previousMap.size === 0;
    const pool = articles
      .filter(article => !article.seenHidden)
      .filter(article => article.noveltyStateV78 !== 'repeat')
      .filter(article => !article.lowInformationV89 || article.essential)
      .map(article => {
        const entry = snapshotEntry(article);
        const old = previousMap.get(entry.key);
        const changed = !old
          || old.fingerprint !== entry.fingerprint
          || (entry.publishedAt > Number(old.publishedAt || 0) + 120000 && ['development','minor-update','new'].includes(entry.novelty));
        const newSinceBrief = previousAt > 0 && entry.publishedAt > previousAt;
        return { article, entry, changed: firstBrief || changed || newSinceBrief, rank: importance(article) };
      });

    const candidates = (firstBrief ? pool : pool.filter(item => item.changed))
      .sort((a, b) => b.rank - a.rank || b.entry.publishedAt - a.entry.publishedAt);

    const chosen = [];
    const categoryCounts = new Map();
    const suppressedIds = new Set();
    const duplicateAlreadyChosen = item => {
      const duplicate = chosen.some(existing => sameBriefEvent(existing.article, item.article));
      if (duplicate) suppressedIds.add(String(item.article.id || item.entry.key || item.article.title || ''));
      return duplicate;
    };

    for (const item of candidates) {
      if (chosen.length >= 8) break;
      if (duplicateAlreadyChosen(item)) continue;
      const cat = clean(item.article.category || 'Autres');
      const count = categoryCounts.get(cat) || 0;
      if (count >= 2 && !item.article.essential && chosen.length >= 4) continue;
      chosen.push(item);
      categoryCounts.set(cat, count + 1);
    }
    if (firstBrief && chosen.length < Math.min(5, candidates.length)) {
      for (const item of candidates) {
        if (chosen.includes(item) || duplicateAlreadyChosen(item)) continue;
        chosen.push(item);
        if (chosen.length >= Math.min(5, candidates.length)) break;
      }
    }

    briefStats.lastDeduped = suppressedIds.size;
    briefStats.lastCandidates = candidates.length;
    briefStats.lastChosen = chosen.length;
    return { firstBrief, chosen };
  }

  window.__briefSmartV9110 = {
    version: '91.10',
    stats: briefStats,
    sameEvent: (a, b) => sameBriefEvent(a, b),
    selectIds: articles => selectFacts(Array.isArray(articles) ? articles : [], [], 0).chosen.map(item => String(item.article.id || ''))
  };

  function escapeHtml(value = '') {
    return clean(value).replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[char]));
  }

  function beginVisitIfNeeded(view) {
    if (view === 'brief' && lastView !== 'brief') {
      visitPrevious = readJson(SNAPSHOT_KEY, []);
      visitPreviousAt = Number(localStorage.getItem(LAST_KEY) || 0);
      visitCommitted = false;
    } else if (view !== 'brief' && lastView === 'brief') {
      visitPrevious = null;
      visitPreviousAt = 0;
      visitCommitted = false;
    }
    lastView = view;
  }

  function suppressWatchSummaryFetch(input, init) {
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/article-summary-groq') return null;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body?.mode !== 'category') return null;
      return new Response(JSON.stringify({ summary: '', unavailable: true, suppressedV90: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    } catch {
      return null;
    }
  }

  window.fetch = function briefAwareFetch(input, init) {
    const local = suppressWatchSummaryFetch(input, init);
    if (local) return Promise.resolve(local);
    return upstreamFetch(input, init);
  };

  function removeWatchSummary() {
    document.querySelectorAll('.runtime-category-summary').forEach(node => node.remove());
  }

  function restoreRuntimeContent(runtime) {
    if (!runtime) return;
    for (const child of [...runtime.children]) {
      if (child.classList.contains('brief-smart-v87')) continue;
      if (child.dataset.briefSmartOriginalV90 === '1') {
        child.hidden = false;
        delete child.dataset.briefSmartOriginalV90;
      }
    }
  }

  function removeSmartSections() {
    for (const section of document.querySelectorAll('.brief-smart-v87')) {
      const runtime = section.closest('.runtime-brief-content');
      if (runtime) restoreRuntimeContent(runtime);
      const legacy = section.parentElement?.querySelector('.brief-points');
      if (legacy) legacy.hidden = false;
      section.remove();
    }
  }

  function ensureRuntimeSection(runtime) {
    let section = runtime.querySelector(':scope > .brief-smart-v87');
    if (!section) {
      section = document.createElement('section');
      section.className = 'brief-smart-v87';
      runtime.prepend(section);
    }
    for (const child of [...runtime.children]) {
      if (child === section) continue;
      child.dataset.briefSmartOriginalV90 = '1';
      child.hidden = true;
    }
    return section;
  }

  function ensureLegacySection(page, originalList) {
    let section = page.querySelector('.brief-smart-v87');
    if (!section) {
      section = document.createElement('section');
      section.className = 'brief-smart-v87';
      originalList.insertAdjacentElement('beforebegin', section);
    }
    originalList.hidden = true;
    const legacyStatus = page.querySelector('.brief-diff-v80');
    if (legacyStatus) legacyStatus.hidden = true;
    return section;
  }

  function render() {
    queued = false;
    removeWatchSummary();

    const view = currentView();
    beginVisitIfNeeded(view);
    if (view !== 'brief') {
      removeSmartSections();
      return;
    }

    const page = document.querySelector('.page');
    if (!page) return;

    const runtime = page.querySelector('.runtime-brief-content');
    if (runtime && currentBriefMode() === 'watches') {
      removeSmartSections();
      removeWatchSummary();
      return;
    }

    const originalList = page.querySelector('.brief-points');
    if (!runtime && !originalList) return;

    if (visitPrevious === null) {
      visitPrevious = readJson(SNAPSHOT_KEY, []);
      visitPreviousAt = Number(localStorage.getItem(LAST_KEY) || 0);
      visitCommitted = false;
    }

    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const { firstBrief, chosen } = selectFacts(articles, visitPrevious, visitPreviousAt);

    if (!visitCommitted) {
      writeJson(SNAPSHOT_KEY, articles.slice(0, 80).map(snapshotEntry));
      try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {}
      visitCommitted = true;
    }

    const section = runtime ? ensureRuntimeSection(runtime) : ensureLegacySection(page, originalList);
    const signature = `${firstBrief ? 'first' : 'diff'}|${chosen.map(item => item.article.id).join('|')}`;
    if (section.dataset.briefSmartSignatureV90 === signature) return;
    section.dataset.briefSmartSignatureV90 = signature;

    if (!chosen.length) {
      section.innerHTML = `<div class="brief-smart-head-v87"><strong>Aucun fait majeur nouveau</strong><span>Le Brief ne répète pas les éléments déjà vus.</span></div><button type="button" class="brief-full-v87" data-brief-full-v87>Voir le Brief complet</button>`;
      return;
    }

    const label = firstBrief
      ? `${chosen.length} faits essentiels pour établir votre référence`
      : `${chosen.length} fait${chosen.length > 1 ? 's' : ''} nouveau${chosen.length > 1 ? 'x' : ''} depuis votre dernier Brief`;

    section.innerHTML = `<div class="brief-smart-head-v87"><strong>${label}</strong><span>${firstBrief ? 'Les prochaines consultations ne montreront que les changements.' : 'Uniquement les informations nouvelles ou réellement modifiées.'}</span></div>
      <div class="brief-facts-v87">${chosen.map(({ article }) => {
        const meta = clean(article.category || '');
        return `<button type="button" class="brief-fact-v87" data-article="${String(article.id || '').replace(/"/g, '&quot;')}"><span class="brief-fact-text-v87">${escapeHtml(factFor(article))}</span>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</button>`;
      }).join('')}</div>
      <button type="button" class="brief-full-v87" data-brief-full-v87>Voir le Brief complet</button>`;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  document.addEventListener('click', event => {
    const navBrief = event.target.closest?.('.bottom-nav [data-view="brief"]');
    if (navBrief) {
      setTimeout(schedule, 0);
      setTimeout(schedule, 120);
      setTimeout(schedule, 320);
    }

    const button = event.target.closest?.('[data-brief-full-v87]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const section = button.closest('.brief-smart-v87');
    if (!section) return;
    const showingFull = button.dataset.fullV90 === '1';
    const runtime = section.closest('.runtime-brief-content');
    const page = section.closest('.page');
    const legacy = page?.querySelector('.brief-points');

    if (runtime) {
      for (const child of [...runtime.children]) {
        if (child === section) continue;
        if (child.dataset.briefSmartOriginalV90 === '1') child.hidden = showingFull;
      }
    }
    if (legacy) legacy.hidden = showingFull;

    section.querySelector('.brief-smart-head-v87')?.toggleAttribute('hidden', !showingFull);
    section.querySelector('.brief-facts-v87')?.toggleAttribute('hidden', !showingFull);
    button.dataset.fullV90 = showingFull ? '0' : '1';
    button.textContent = showingFull ? 'Voir le Brief complet' : 'Revenir aux faits nouveaux';
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }, { once: true });
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
})();
