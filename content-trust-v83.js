(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const INTEL_KEY = 'news-story-intelligence-cache-v81';
  const MAX_STORY_GAP = 72 * 60 * 60 * 1000;
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const upstreamFetch = window.fetch.bind(window);
  const STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux article'.split(' '));
  const SENSATIONAL = /vous ne (?:croirez|devinerez)|incroyable|hallucinant|coup de tonnerre|coup de théâtre|scandale|choc|fait polémique|la raison va vous|voici pourquoi|ce qui va changer|tout ce qu['’]il faut savoir|personne ne s['’]y attendait/i;
  let decorateQueued = false;

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
    return clean(value).replace(TITLE_MARK_RE, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function storyBucket(value) {
    return Math.floor(Number(value || 0) / MAX_STORY_GAP);
  }

  function prepareStoryBoundaries(articles) {
    const prepared = (Array.isArray(articles) ? articles : []).map(article => {
      const copy = { ...article };
      const at = publishedAt(copy);
      const rawKey = clean(copy.eventKeyV78OriginalV86 || copy.eventKeyV78 || '').replace(/:v86b\d+$/i, '');
      if (rawKey && at) {
        copy.eventKeyV78OriginalV86 = rawKey;
        copy.eventKeyV78 = `${rawKey}:v86b${storyBucket(at)}`.slice(0, 300);
      }
      if (copy.titleOriginalV86) copy.title = copy.titleOriginalV86;
      else copy.title = clean(copy.title || '').replace(TITLE_MARK_RE, '');
      return copy;
    });

    const byTitle = new Map();
    for (const article of prepared) {
      const key = normalize(article.title || '');
      if (!key) continue;
      const list = byTitle.get(key) || [];
      list.push(article);
      byTitle.set(key, list);
    }

    let markedTitles = 0;
    for (const group of byTitle.values()) {
      const times = group.map(publishedAt).filter(Boolean);
      if (times.length < 2 || Math.max(...times) - Math.min(...times) <= MAX_STORY_GAP) continue;
      for (const article of group) {
        const at = publishedAt(article);
        if (!at) continue;
        const original = clean(article.title || '').replace(TITLE_MARK_RE, '');
        article.titleOriginalV86 = original;
        article.title = `${original} [v86b${storyBucket(at)}]`;
        markedTitles += 1;
      }
    }

    return {
      articles: prepared,
      boundedKeys: prepared.filter(article => article.eventKeyV78OriginalV86).length,
      markedTitles
    };
  }

  function tokens(value = '', source = '') {
    const sourceWords = new Set(normalize(source).split(' ').filter(Boolean));
    return [...new Set(normalize(value).split(' ').filter(word => word && !STOP.has(word) && !sourceWords.has(word) && (word.length >= 4 || /\d/.test(word))))].slice(0, 28);
  }

  function titleSupport(article = {}) {
    const title = clean(article.titleOriginalV86 || article.title || '').replace(TITLE_MARK_RE, '');
    const summary = clean(article.summary || article.detail || '');
    const titleTokens = tokens(title, article.source || '');
    if (summary.length < 120 || titleTokens.length < 4) {
      return { level: 'insufficient', coverage: 0, penalty: 0, sensational: SENSATIONAL.test(title) };
    }
    const summarySet = new Set(tokens(summary));
    const hits = titleTokens.filter(token => summarySet.has(token)).length;
    const coverage = hits / Math.max(1, titleTokens.length);
    const sensational = SENSATIONAL.test(title) || /!{2,}/.test(title);
    let level = 'strong';
    let penalty = 0;
    if (coverage < .28) { level = 'weak'; penalty = -12; }
    else if (coverage < .46) { level = 'partial'; penalty = -3; }
    if (sensational && level !== 'strong') penalty -= 7;
    return { level, coverage: Math.round(coverage * 100) / 100, penalty, sensational };
  }

  function distinctSources(article = {}) {
    return [...new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(normalize).filter(Boolean))].length;
  }

  function transformArticle(article = {}) {
    const copy = { ...article };
    const support = titleSupport(copy);
    const originalBase = Number.isFinite(Number(copy.scoreV83Base))
      ? Number(copy.scoreV83Base)
      : Number.isFinite(Number(copy.scoreV82Base))
        ? Number(copy.scoreV82Base)
        : Number(copy.score || 0);
    copy.scoreV83Base = originalBase;
    copy.titleSupportV83 = support.level;
    copy.titleSupportCoverageV83 = support.coverage;
    copy.titleSensationalV83 = support.sensational;
    copy.scoreV82Base = originalBase + support.penalty;
    copy.score = copy.scoreV82Base;
    copy.verificationSourceCountV83 = distinctSources(copy);
    return copy;
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const prepared = prepareStoryBoundaries(payload.articles);
    let weak = 0;
    payload.articles = prepared.articles.map(article => {
      const next = transformArticle(article);
      if (next.titleSupportV83 === 'weak') weak += 1;
      return next;
    });
    payload.stats = {
      ...(payload.stats || {}),
      contentTrustV83: true,
      weakTitlesV83: weak,
      storyBoundaryPrepareV86: true,
      boundedEventKeysV86: prepared.boundedKeys,
      markedDuplicateTitlesV86: prepared.markedTitles
    };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function contentTrustV83Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
        const payload = await response.clone().json();
        return responseFromPayload(response, transformPayload(payload));
      }
    } catch {}
    return response;
  };

  const initial = readJson(CACHE_KEY, null);
  if (initial && Array.isArray(initial.articles)) writeJson(CACHE_KEY, transformPayload(initial));

  function articleMap() {
    const cache = readJson(CACHE_KEY, {});
    return new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
  }

  function intelFor(article = {}) {
    const cache = readJson(INTEL_KEY, {});
    const id = String(article.id || '');
    const item = cache[id];
    if (item) return item;
    const url = clean(article.url || '');
    const title = normalize(article.titleOriginalV86 || article.title || '');
    return Object.values(cache).find(value => value && ((url && clean(value.url || '') === url) || (title && normalize(value.title || '') === title))) || null;
  }

  function verification(article = {}) {
    const intel = intelFor(article);
    const contradictionCount = Number(intel?.contradictionCount || (Array.isArray(intel?.contradictions) ? intel.contradictions.length : 0) || 0);
    if (contradictionCount > 0) return { level: 'disputed', label: 'Sources en désaccord' };
    const count = Math.max(distinctSources(article), Number(article.mergedCount || 0) > 1 ? distinctSources(article) : 0);
    if (count >= 3) return { level: 'multi', label: `${count} sources croisées` };
    if (count === 2) return { level: 'crossed', label: '2 sources croisées' };
    return { level: 'single', label: 'Source unique' };
  }

  function ensureTrustLine(card, article) {
    let line = card.querySelector('.trust-line-v83');
    const weak = article.titleSupportV83 === 'weak';
    const partial = article.titleSupportV83 === 'partial';
    const caution = weak
      ? '<span class="title-support-v83 weak">Titre peu étayé par le résumé disponible</span>'
      : partial && article.titleSensationalV83
        ? '<span class="title-support-v83 partial">Titre à interpréter avec prudence</span>'
        : '';
    if (!caution) {
      line?.remove();
      return;
    }
    if (!line) {
      line = document.createElement('div');
      line.className = 'trust-line-v83';
      const title = card.querySelector('h2');
      if (title) title.insertAdjacentElement('afterend', line);
      else card.querySelector('.article-body')?.prepend(line);
    }
    line.innerHTML = caution;
  }

  function decorateCards() {
    const map = articleMap();
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      const article = map.get(String(card.dataset.article || ''));
      if (article) ensureTrustLine(card, article);
    });
  }

  function decorateModal() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal) return;
    const map = articleMap();
    const title = normalize(modal.querySelector('.quick-summary-head h2')?.textContent || '');
    const source = normalize(modal.querySelector('.quick-summary-meta span')?.textContent || '');
    const article = [...map.values()].find(item => normalize(item.titleOriginalV86 || item.title || '').includes(title) && (!source || normalize(item.source || '') === source))
      || [...map.values()].find(item => normalize(item.titleOriginalV86 || item.title || '').includes(title));
    if (!article) return;
    const verify = verification(article);
    let note = modal.querySelector('.verification-note-v83');
    if (!note) {
      note = document.createElement('div');
      note.className = 'verification-note-v83';
      modal.querySelector('.quick-summary-meta')?.insertAdjacentElement('afterend', note);
    }
    const titleNote = article.titleSupportV83 === 'weak' ? ' · titre peu étayé par le résumé disponible' : '';
    note.className = `verification-note-v83 ${verify.level}`;
    note.textContent = `Vérification : ${verify.label}${titleNote}`;
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateCards();
      decorateModal();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
    scheduleDecorate();
  }, { once: true });
  window.addEventListener('news-story-intelligence-v81', scheduleDecorate);
  window.addEventListener('focus', scheduleDecorate);
})();
