(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const KNOWN_KEY = 'news-known-articles-v79';
  const LAST_VISIT_KEY = 'news-last-visit-v79';
  const SESSION_PREVIOUS_KEY = 'news-session-previous-visit-v79';
  const MODE_KEY = 'news-since-mode-v79';
  const SCROLL_KEY = 'news-view-scroll-v79';
  const MAX_KNOWN = 900;
  const MAX_STORY_GAP = 72 * 60 * 60 * 1000;
  const upstreamFetch = window.fetch.bind(window);

  const STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux'.split(' '));

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readSessionJson(key, fallback) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeSessionJson(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') {
    return String(value ?? '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function titleCore(article = {}) {
    let title = clean(article.title || '');
    const source = clean(article.source || '');
    if (source) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`\\s*[-–—|·:]\\s*${escaped}\\s*$`, 'i'), '').trim();
    }
    return title;
  }

  function tokens(article = {}) {
    const sourceWords = new Set(normalize(article.source || '').split(' ').filter(Boolean));
    return [...new Set(normalize(titleCore(article)).split(' ').filter(word => word && !STOP.has(word) && !sourceWords.has(word) && (word.length >= 4 || /\d/.test(word))))].slice(0, 20);
  }

  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }

  function overlap(a, b) {
    const bs = new Set(b);
    const common = a.filter(item => bs.has(item)).length;
    const union = new Set([...a, ...b]).size;
    return {
      common,
      coverage: common / Math.max(1, Math.min(a.length, b.length)),
      jaccard: common / Math.max(1, union)
    };
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function compatibleCategory(a = {}, b = {}) {
    const ca = clean(a.category || '');
    const cb = clean(b.category || '');
    if (!ca || !cb || ca === cb) return true;
    const families = [
      new Set(['International','Europe','Politique']),
      new Set(['IA','Tech','Smartphones','VR']),
      new Set(['Économie','Énergie','Automobile']),
      new Set(['Science','Santé','Environnement'])
    ];
    return families.some(family => family.has(ca) && family.has(cb));
  }

  function sameStory(a = {}, b = {}) {
    if (!a || !b) return false;
    const au = canonicalUrl(a.url || '');
    const bu = canonicalUrl(b.url || '');
    if (au && bu && au === bu) return true;

    const ak = clean(a.eventKeyV78 || '');
    const bk = clean(b.eventKeyV78 || '');
    if (ak && bk && ak === bk) return true;

    const an = normalize(titleCore(a));
    const bn = normalize(titleCore(b));
    if (an && bn && an === bn) return true;

    const ap = publishedAt(a);
    const bp = publishedAt(b);
    if (ap && bp && Math.abs(ap - bp) > MAX_STORY_GAP) return false;
    if (!compatibleCategory(a, b)) return false;

    const at = tokens(a);
    const bt = tokens(b);
    if (at.length < 3 || bt.length < 3) return false;
    const o = overlap(at, bt);
    if (o.common >= 5 && o.coverage >= .68 && o.jaccard >= .44) return true;
    if (o.common >= 4 && o.coverage >= .80) return true;
    return false;
  }

  function noveltyWeight(article = {}) {
    switch (article.noveltyStateV78 || article.noveltyState) {
      case 'development': return 5;
      case 'new': return 4;
      case 'minor-update': return 2;
      case 'repeat': return 0;
      default: return 1;
    }
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(text);
  }

  function chooseLead(group, savedIds) {
    return group.slice().sort((a, b) => {
      const aSaved = savedIds.has(String(a.id || '')) ? 1 : 0;
      const bSaved = savedIds.has(String(b.id || '')) ? 1 : 0;
      if (aSaved !== bSaved) return bSaved - aSaved;
      const aEssential = a.essential ? 1 : 0;
      const bEssential = b.essential ? 1 : 0;
      if (aEssential !== bEssential) return bEssential - aEssential;
      const novelty = noveltyWeight(b) - noveltyWeight(a);
      if (novelty) return novelty;
      const score = Number(b.score || 0) - Number(a.score || 0);
      if (score) return score;
      return publishedAt(b) - publishedAt(a);
    })[0];
  }

  function mergeGroup(group, savedIds) {
    if (group.length === 1) {
      const single = { ...group[0] };
      single.mergedArticleIdsV79 = [...new Set([single.id, ...(Array.isArray(single.mergedArticleIdsV79) ? single.mergedArticleIdsV79 : [])].map(value => String(value || '')).filter(Boolean))];
      single.duplicateCountV79 = Number(single.duplicateCountV79 || 1);
      return single;
    }

    const lead = chooseLead(group, savedIds);
    const copy = { ...lead };
    const sources = [...new Set(group.flatMap(article => [article.source, ...(Array.isArray(article.sources) ? article.sources : [])]).map(clean).filter(Boolean))];
    const allIds = [...new Set(group.flatMap(article => [article.id, ...(Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : [])]).map(value => String(value || '')).filter(Boolean))];
    const summaries = group.map(article => clean(article.summary || article.detail || '')).filter(usefulSummary).sort((a, b) => b.length - a.length);
    const visualOwner = group.find(article => clean(article.visual?.url || article.image || article.quickVisualUrl || ''));
    const essentialMembers = group.filter(article => article.essential);

    copy.sources = sources;
    copy.mergedArticleIdsV79 = allIds;
    copy.duplicateCountV79 = group.reduce((total, article) => total + Math.max(1, Number(article.duplicateCountV79 || 1)), 0);
    copy.mergedCount = Math.max(Number(copy.mergedCount || 0), sources.length, copy.duplicateCountV79);
    copy.corroboratedV79 = sources.length >= 2;
    copy.score = Math.max(...group.map(article => Number(article.score || 0)));
    copy.editorialImportance = Math.max(...group.map(article => Number(article.editorialImportance || 0)));
    copy.editorialImportanceV78 = Math.max(...group.map(article => Number(article.editorialImportanceV78 || 0)));
    if (essentialMembers.length) {
      copy.essential = true;
      const ranks = essentialMembers.map(article => Number(article.essentialRank || 0)).filter(rank => rank > 0);
      copy.essentialRank = ranks.length ? Math.min(...ranks) : 1;
      copy.whyV78 = 'Actualité majeure';
    }
    if (!usefulSummary(copy.summary || copy.detail || '') && summaries.length) copy.summary = summaries[0];
    if (!clean(copy.visual?.url || copy.image || '') && visualOwner) {
      if (visualOwner.visual) copy.visual = { ...visualOwner.visual };
      if (visualOwner.image) copy.image = visualOwner.image;
    }
    return copy;
  }

  let previousVisitAt = Number(sessionStorage.getItem(SESSION_PREVIOUS_KEY) || 0);
  if (!previousVisitAt) {
    previousVisitAt = Number(localStorage.getItem(LAST_VISIT_KEY) || 0);
    try { sessionStorage.setItem(SESSION_PREVIOUS_KEY, String(previousVisitAt || -1)); } catch {}
    try { localStorage.setItem(LAST_VISIT_KEY, String(Date.now())); } catch {}
  } else if (previousVisitAt < 0) {
    previousVisitAt = 0;
  }

  const knownBefore = new Set(readJson(KNOWN_KEY, []).map(value => String(value || '')).filter(Boolean));
  const freshThisVisit = new Set();

  function markFresh(group) {
    if (!previousVisitAt && knownBefore.size === 0) return;
    const fresh = group.some(article => {
      const id = String(article.id || '');
      const time = publishedAt(article);
      return (id && !knownBefore.has(id)) || (previousVisitAt > 0 && time > previousVisitAt);
    });
    if (!fresh) return;
    for (const article of group) {
      const id = String(article.id || '');
      if (id) freshThisVisit.add(id);
    }
  }

  function dedupeArticles(articles) {
    if (!Array.isArray(articles) || !articles.length) return [];
    const groups = [];
    for (const article of articles) {
      let group = null;
      for (const candidate of groups) {
        if (candidate.some(existing => sameStory(article, existing))) {
          group = candidate;
          break;
        }
      }
      if (group) group.push(article);
      else groups.push([article]);
    }

    const savedIds = new Set(readJson('news-saved', []).map(value => String(value || '')));
    const merged = groups.map(group => {
      markFresh(group);
      const lead = mergeGroup(group, savedIds);
      if (group.some(article => freshThisVisit.has(String(article.id || '')))) freshThisVisit.add(String(lead.id || ''));
      return lead;
    });

    const allKnown = [...new Set(articles.flatMap(article => [article.id, ...(Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : [])]).map(value => String(value || '')).filter(Boolean))];
    writeJson(KNOWN_KEY, [...knownBefore, ...allKnown].slice(-MAX_KNOWN));
    return merged;
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;
    const before = payload.articles.length;
    payload.articles = dedupeArticles(payload.articles);
    payload.stats = {
      ...(payload.stats || {}),
      intelligenceV79: true,
      duplicatesCollapsedV79: Math.max(0, before - payload.articles.length),
      storyCountV79: payload.articles.length
    };
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

  window.fetch = async function experienceV79Fetch(input, init) {
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

  const initialCache = readJson(CACHE_KEY, null);
  if (initialCache && Array.isArray(initialCache.articles) && initialCache.articles.length) {
    const before = initialCache.articles.length;
    initialCache.articles = dedupeArticles(initialCache.articles);
    initialCache.stats = {
      ...(initialCache.stats || {}),
      intelligenceV79: true,
      duplicatesCollapsedV79: Math.max(0, before - initialCache.articles.length),
      storyCountV79: initialCache.articles.length
    };
    writeJson(CACHE_KEY, initialCache);
  }

  let sinceMode = localStorage.getItem(MODE_KEY) || (previousVisitAt ? 'since' : 'all');
  let decorateQueued = false;
  let pendingView = '';
  const scrollPositions = readSessionJson(SCROLL_KEY, {});

  function articleMap() {
    const cache = readJson(CACHE_KEY, {});
    return new Map((Array.isArray(cache.articles) ? cache.articles : []).map(article => [String(article.id || ''), article]));
  }

  function isFreshArticle(article) {
    if (!article) return false;
    const ids = [article.id, ...(Array.isArray(article.mergedArticleIdsV79) ? article.mergedArticleIdsV79 : [])].map(value => String(value || ''));
    if (ids.some(id => freshThisVisit.has(id))) return true;
    const time = publishedAt(article);
    return previousVisitAt > 0 && time > previousVisitAt;
  }

  function currentView() {
    return document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset.view || '';
  }

  function updateEssentialFurniture(feed, visibleCards) {
    const page = feed.closest('.page');
    const visibleEssential = visibleCards.filter(card => card.classList.contains('essential-v77'));
    const banner = page?.querySelector(':scope > .essential-banner-v77');
    if (banner) banner.hidden = visibleEssential.length === 0;
    const separator = feed.querySelector(':scope > .essential-separator-v78');
    if (separator) separator.hidden = !(visibleEssential.length > 0 && visibleEssential.length < visibleCards.length);
  }

  function decorateSinceMode() {
    if (currentView() !== 'home') return;
    const map = articleMap();
    const feeds = [...document.querySelectorAll('.page .feed')];
    if (!feeds.length) return;

    for (const feed of feeds) {
      if (feed.matches('.stable-owned-list')) continue;
      const cards = [...feed.querySelectorAll(':scope > .article-card[data-article]')];
      if (!cards.length) continue;
      const freshCards = cards.filter(card => isFreshArticle(map.get(String(card.dataset.article || ''))));
      const useSince = sinceMode === 'since' && freshCards.length > 0 && previousVisitAt > 0;

      cards.forEach(card => {
        const fresh = freshCards.includes(card);
        card.hidden = useSince && !fresh;
        card.classList.toggle('new-since-visit-v79', fresh);
      });

      let bar = feed.parentElement?.querySelector(':scope > .since-last-visit-v79');
      if (!bar) {
        bar = document.createElement('section');
        bar.className = 'since-last-visit-v79';
        feed.insertAdjacentElement('beforebegin', bar);
      }
      const count = freshCards.length;
      const markup = `<div><strong>Depuis ma dernière visite</strong><small>${count ? `${count} information${count > 1 ? 's' : ''} nouvelle${count > 1 ? 's' : ''}` : 'Aucune nouvelle information pour l’instant'}</small></div><div class="since-actions-v79"><button type="button" data-since-mode-v79="since" class="${sinceMode === 'since' ? 'active' : ''}" ${previousVisitAt ? '' : 'disabled'}>Nouveaux${count ? ` (${count})` : ''}</button><button type="button" data-since-mode-v79="all" class="${sinceMode === 'all' ? 'active' : ''}">Tout</button></div>`;
      if (bar.innerHTML !== markup) bar.innerHTML = markup;

      const visibleCards = cards.filter(card => !card.hidden);
      updateEssentialFurniture(feed, visibleCards);
    }
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateSinceMode();
      if (pendingView && currentView() === pendingView) {
        const top = Number(scrollPositions[pendingView] || 0);
        pendingView = '';
        document.documentElement.classList.remove('nav-switching-v79');
        if (top > 0) requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
      }
    });
  }

  document.addEventListener('click', event => {
    const modeButton = event.target.closest?.('[data-since-mode-v79]');
    if (modeButton) {
      event.preventDefault();
      event.stopPropagation();
      sinceMode = modeButton.dataset.sinceModeV79 === 'since' ? 'since' : 'all';
      try { localStorage.setItem(MODE_KEY, sinceMode); } catch {}
      scheduleDecorate();
      return;
    }

    const navButton = event.target.closest?.('.bottom-nav [data-view="home"], .bottom-nav [data-view="brief"]');
    if (!navButton) return;
    const target = navButton.dataset.view;
    const current = currentView();

    if (current === target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.scrollTo({ top: 0, behavior: 'instant' });
      scrollPositions[target] = 0;
      writeSessionJson(SCROLL_KEY, scrollPositions);
      return;
    }

    if (current === 'home' || current === 'brief') {
      scrollPositions[current] = Math.max(0, Math.round(window.scrollY));
      writeSessionJson(SCROLL_KEY, scrollPositions);
    }
    pendingView = target;
    document.documentElement.classList.add('nav-switching-v79');
    document.querySelectorAll('.bottom-nav .nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === target));
    setTimeout(() => document.documentElement.classList.remove('nav-switching-v79'), 500);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(scheduleDecorate).observe(root, { childList: true, subtree: true });
    scheduleDecorate();
  }, { once: true });

  window.addEventListener('focus', scheduleDecorate);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleDecorate();
  });
})();
