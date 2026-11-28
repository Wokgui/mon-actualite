(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const MAX_STORY_GAP = 72 * 60 * 60 * 1000;
  const TITLE_MARK_RE = /\s*\[v86b\d+\]\s*$/i;
  const AGGREGATOR_HOST_RE = /(^|\.)news\.google\.|(^|\.)google\.com$|bing\.com$|feedly\.com$/i;
  const STRICT_FEED_CATEGORIES = new Set(['Science','Santé','Tech','Économie','International']);
  const SOCIETY_HARD_TITLE_RE = /\b(?:coups? de feu|fusillade|meurtre|homicide|agression|braquage|rave party|rave-party|police judiciaire|gendarmerie)\b/i;
  const SCIENCE_HARD_TITLE_RE = /\b(?:einstein|physique|quantique|cosmologie|cosmologique|astronomie|astronomique|relativite|relativité|trou noir|trous noirs|particule|particules|telescope|télescope|nasa|esa)\b/i;
  const ENERGY_HARD_TITLE_RE = /\b(?:electricite|électricité|centrale|reseau electrique|réseau électrique|eolien|éolien|solaire|hydrogene|hydrogène|gaz naturel|batterie|batteries)\b/i;
  const EUROPE_REFERENDUM_RE = /\b(?:islande|europe|ue|union europeenne)\b.*\b(?:referendum|adhesion)\b|\b(?:referendum|adhesion)\b.*\b(?:islande|europe|ue|union europeenne)\b/i;
  const CULTURE_HARD_RE = /\b(?:film|cinema|festival du film|festival francophone|acteur|actrice|comedien|comedienne|serie televisee|serie netflix)\b/i;
  const TECH_HARD_RE = /\b(?:imprimante|ordinateur|smartphone|galaxy|nvidia|dlss|cyberattaque|cybersecurite|hackers?|piratage informatique|fuite de donnees)\b/i;
  const root = typeof window !== 'undefined' ? window : globalThis;
  const upstreamFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value)
      .replace(TITLE_MARK_RE, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleCore(article = {}) {
    let title = clean(article.titleOriginalV86 || article.title || '').replace(TITLE_MARK_RE, '');
    const source = clean(article.source || '');
    if (source) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`\\s*[-–—|·:]\\s*${escaped}\\s*$`, 'i'), '').trim();
    }
    return title;
  }

  function obviousCategoryCorrection(article = {}) {
    const current = clean(article.category || '');
    const title = titleCore(article);
    const normalizedTitle = normalize(title);
    if (!current || !title) return current;

    if (STRICT_FEED_CATEGORIES.has(current) && SOCIETY_HARD_TITLE_RE.test(title)) {
      return 'Société';
    }

    if (current === 'Énergie' && SCIENCE_HARD_TITLE_RE.test(title) && !ENERGY_HARD_TITLE_RE.test(title)) {
      return 'Science';
    }

    if (current !== 'Europe' && EUROPE_REFERENDUM_RE.test(normalizedTitle)) {
      return 'Europe';
    }

    if (['Politique','Société','International'].includes(current) && CULTURE_HARD_RE.test(normalizedTitle)) {
      return 'Culture';
    }

    if (['Société','Économie','International'].includes(current) && TECH_HARD_RE.test(normalizedTitle)) {
      return 'Tech';
    }

    return current;
  }

  function canonicalUrl(value = '') {
    try {
      const base = typeof location !== 'undefined' ? location.href : 'https://local.invalid/';
      const url = new URL(value, base);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch {
      return clean(value);
    }
  }

  function publishedAt(article = {}) {
    const value = Date.parse(article.publishedAt || article.date || '');
    return Number.isFinite(value) ? value : 0;
  }

  function usefulSummary(value = '') {
    const text = clean(value);
    return text.length >= 55
      && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation|ouvrez? l[’']article|consultez? les? détails/i.test(text);
  }

  function directPublisherUrl(value = '') {
    try {
      const base = typeof location !== 'undefined' ? location.href : 'https://local.invalid/';
      const host = new URL(value, base).hostname.toLowerCase().replace(/^www\./, '');
      return Boolean(host) && !AGGREGATOR_HOST_RE.test(host);
    } catch {
      return false;
    }
  }

  function noveltyRank(value = '') {
    switch (value) {
      case 'development': return 5;
      case 'new': return 4;
      case 'minor-update': return 2;
      case 'repeat': return 0;
      default: return 1;
    }
  }

  function strongestNovelty(group) {
    return group
      .map(article => clean(article.noveltyStateV78 || article.noveltyState || ''))
      .sort((a, b) => noveltyRank(b) - noveltyRank(a))[0] || '';
  }

  function sameCandidateStory(a = {}, b = {}) {
    if (!a || !b) return false;

    const au = canonicalUrl(a.url || '');
    const bu = canonicalUrl(b.url || '');
    if (au && bu && au === bu) return true;

    const ap = publishedAt(a);
    const bp = publishedAt(b);
    if (ap && bp && Math.abs(ap - bp) > MAX_STORY_GAP) return false;

    const ak = clean(a.eventKeyV78 || '');
    const bk = clean(b.eventKeyV78 || '');
    if (ak && bk && ak === bk) return true;

    const at = normalize(titleCore(a));
    const bt = normalize(titleCore(b));
    return Boolean(at && bt && at === bt);
  }

  function leadQuality(article = {}) {
    let value = 0;
    const summary = clean(article.summary || article.detail || '');
    const sourceQuality = Number(article.sourceQualityV82 || 0);
    const sourcePreference = Number(article.sourcePreferenceV82 || 0);

    value += directPublisherUrl(article.url || '') ? 32 : -24;
    value += Math.max(-12, Math.min(32, sourceQuality * 1.6));

    if (usefulSummary(summary)) value += 10;
    if (summary.length >= 180) value += 8;
    if (summary.length >= 350) value += 4;

    if (article.titleSupportV83 === 'strong') value += 12;
    else if (article.titleSupportV83 === 'partial') value += 3;
    else if (article.titleSupportV83 === 'weak') value -= 16;

    if (article.titleSensationalV83) value -= 18;
    if (article.customSource) value += 4;
    if (clean(article.visual?.url || article.image || article.quickVisualUrl || '')) value += 2;

    if (sourcePreference <= -99) value -= 200;
    else if (sourcePreference <= -2) value -= 24;
    else if (sourcePreference < 0) value -= 10;
    else if (sourcePreference >= 2) value += 10;
    else if (sourcePreference > 0) value += 6;

    return Math.round(value * 10) / 10;
  }

  function choosePreferred(group) {
    return group.slice().sort((a, b) => {
      const quality = Number(b.leadQualityV91 || 0) - Number(a.leadQualityV91 || 0);
      if (quality) return quality;
      const baseScore = Number(b.scoreV91Base ?? b.score ?? 0) - Number(a.scoreV91Base ?? a.score ?? 0);
      if (baseScore) return baseScore;
      return publishedAt(b) - publishedAt(a);
    })[0] || null;
  }

  function transformPayload(payload) {
    if (!payload || !Array.isArray(payload.articles)) return payload;

    let categoryCorrections = 0;
    const articles = payload.articles.map(article => {
      const copy = { ...article };
      const originalCategory = clean(copy.category || '');
      const correctedCategory = obviousCategoryCorrection(copy);
      if (correctedCategory && correctedCategory !== originalCategory) {
        copy.categoryOriginalV913 = originalCategory;
        copy.category = correctedCategory;
        copy.categoryCorrectedV913 = true;
        categoryCorrections += 1;
      }
      copy.scoreV91Base = Number.isFinite(Number(copy.scoreV91Base))
        ? Number(copy.scoreV91Base)
        : Number(copy.score || 0);
      copy.leadQualityV91 = leadQuality(copy);
      copy.preferredLeadV91 = false;
      return copy;
    });

    const groups = [];
    for (const article of articles) {
      let group = groups.find(candidate => candidate.some(existing => sameCandidateStory(article, existing)));
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(article);
    }

    let comparedGroups = 0;
    let preferredDirect = 0;
    for (const group of groups) {
      if (group.length < 2) continue;
      comparedGroups += 1;

      const anyEssential = group.some(article => Boolean(article.essential));
      const novelty = strongestNovelty(group);
      const maxScore = Math.max(...group.map(article => Number(article.scoreV91Base || 0)));
      const preferred = choosePreferred(group);

      for (const article of group) {
        if (anyEssential) article.essential = true;
        if (novelty) {
          if (article.noveltyStateV78 && article.noveltyStateV78 !== novelty) {
            article.noveltyStateOriginalV91 = article.noveltyStateV78;
          }
          article.noveltyStateV78 = novelty;
        }
      }

      if (preferred) {
        preferred.preferredLeadV91 = true;
        preferred.score = maxScore + 0.001;
        preferred.leadSelectionReasonV91 = directPublisherUrl(preferred.url || '')
          ? 'direct-complete'
          : 'best-available';
        if (directPublisherUrl(preferred.url || '')) preferredDirect += 1;
      }
    }

    payload.articles = articles;
    payload.stats = {
      ...(payload.stats || {}),
      leadChoiceV91: true,
      leadComparedGroupsV91: comparedGroups,
      leadDirectPreferredV91: preferredDirect,
      categoryGuardV912: true,
      categoryGuardV913: true,
      categoryCorrectionsV913: categoryCorrections
    };
    return payload;
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  root.__leadChoiceV91 = {
    leadQuality,
    sameCandidateStory,
    obviousCategoryCorrection,
    transformPayload
  };

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.leadChoiceVersion = '91.3';
  }

  if (!upstreamFetch || typeof window === 'undefined') return;

  window.fetch = async function leadChoiceV91Fetch(input, init) {
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

  try {
    const initial = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (initial && Array.isArray(initial.articles)) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(transformPayload(initial)));
    }
  } catch {}
})();
