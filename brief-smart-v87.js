(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const SNAPSHOT_KEY = 'news-brief-facts-v87';
  const LAST_KEY = 'news-brief-last-open-v87';
  let active = false;
  let queued = false;

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

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function eventKey(article = {}) {
    return clean(article.eventKeyV78 || article.storyMemoryV81?.key || '')
      || String(article.id || '')
      || normalize(article.title || '');
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
    for (const item of candidates) {
      if (chosen.length >= 8) break;
      const cat = clean(item.article.category || 'Autres');
      const count = categoryCounts.get(cat) || 0;
      if (count >= 2 && !item.article.essential && chosen.length >= 4) continue;
      chosen.push(item);
      categoryCounts.set(cat, count + 1);
    }
    if (firstBrief && chosen.length < Math.min(5, candidates.length)) {
      for (const item of candidates) {
        if (chosen.includes(item)) continue;
        chosen.push(item);
        if (chosen.length >= Math.min(5, candidates.length)) break;
      }
    }
    return { firstBrief, chosen };
  }

  function escapeHtml(value = '') {
    return clean(value).replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[char]));
  }

  function render() {
    queued = false;
    const page = document.querySelector('.page');
    const originalList = page?.querySelector('.brief-points');
    const isBrief = Boolean(originalList) || currentView() === 'brief';
    if (!isBrief) {
      active = false;
      return;
    }
    if (!page || !originalList) {
      active = false;
      return;
    }

    if (active && page.querySelector('.brief-smart-v87')) return;
    active = true;

    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const previous = readJson(SNAPSHOT_KEY, []);
    const previousAt = Number(localStorage.getItem(LAST_KEY) || 0);
    const { firstBrief, chosen } = selectFacts(articles, previous, previousAt);

    writeJson(SNAPSHOT_KEY, articles.slice(0, 80).map(snapshotEntry));
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {}

    originalList.hidden = true;
    const legacyStatus = page.querySelector('.brief-diff-v80');
    if (legacyStatus) legacyStatus.hidden = true;

    let section = page.querySelector('.brief-smart-v87');
    if (!section) {
      section = document.createElement('section');
      section.className = 'brief-smart-v87';
      originalList.insertAdjacentElement('beforebegin', section);
    }

    if (!chosen.length) {
      section.innerHTML = `<div class="brief-smart-head-v87"><strong>Aucun fait majeur nouveau</strong><span>Le Brief ne répète pas les éléments déjà vus.</span></div><button type="button" class="brief-full-v87" data-brief-full-v87>Voir le Brief complet</button>`;
      return;
    }

    const label = firstBrief
      ? `${chosen.length} faits essentiels pour établir votre référence`
      : `${chosen.length} fait${chosen.length > 1 ? 's' : ''} nouveau${chosen.length > 1 ? 'x' : ''} depuis votre dernier Brief`;

    section.innerHTML = `<div class="brief-smart-head-v87"><strong>${label}</strong><span>${firstBrief ? 'Les prochaines consultations ne montreront que les changements.' : 'Uniquement les informations nouvelles ou réellement modifiées.'}</span></div>
      <div class="brief-facts-v87">${chosen.map(({ article }) => {
        const sources = new Set([article.source, ...(Array.isArray(article.sources) ? article.sources : [])].map(clean).filter(Boolean)).size;
        const meta = [clean(article.category || ''), sources >= 2 ? `${sources} sources` : clean(article.source || '')].filter(Boolean).join(' · ');
        return `<button type="button" class="brief-fact-v87" data-article="${String(article.id || '').replace(/"/g, '&quot;')}"><span class="brief-fact-text-v87">${escapeHtml(factFor(article))}</span><small>${escapeHtml(meta)}</small></button>`;
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
      // The capture handler runs before app.js navigates. Run again just after
      // the bubbling handler has swapped the page, then once more after the
      // navigation cache has settled.
      setTimeout(schedule, 0);
      setTimeout(schedule, 120);
    }

    const button = event.target.closest?.('[data-brief-full-v87]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const page = document.querySelector('.page');
    const list = page?.querySelector('.brief-points');
    const section = page?.querySelector('.brief-smart-v87');
    if (!list || !section) return;
    const showing = !list.hidden;
    list.hidden = showing;
    section.querySelector('.brief-facts-v87')?.toggleAttribute('hidden', !showing);
    button.textContent = showing ? 'Voir le Brief complet' : 'Revenir aux faits nouveaux';
    const legacyStatus = page.querySelector('.brief-diff-v80');
    if (legacyStatus) legacyStatus.hidden = true;
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }, { once: true });
  window.addEventListener('focus', schedule);
})();