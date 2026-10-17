(function installDiagnosticMetrics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NewsDiagnosticsV91 = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const GENERIC_SUMMARY_RX = /^(?:ouvrez l['’]article|consultez l['’]article|plus d['’]informations|les détails sont disponibles|résumé indisponible)/i;
  const STOP = new Set('avec dans pour plus apres avant cette sont etre leur leurs tout mais sans vers entre une des les sur qui que aux par son ses est fait'.split(' '));

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function words(value = '') {
    return [...new Set(normalize(value).split(' ').filter(word => word.length >= 4 && !STOP.has(word)))];
  }

  function summaryState(article = {}) {
    const summary = clean(article.summary || article.detail || '');
    if (summary.length < 32) return 'missing';
    if (GENERIC_SUMMARY_RX.test(summary)) return 'generic';
    const titleWords = words(article.title || '');
    const summaryWords = words(summary);
    const summarySet = new Set(summaryWords);
    const common = titleWords.filter(word => summarySet.has(word)).length;
    const coverage = common / Math.max(1, Math.min(titleWords.length, summaryWords.length));
    if (coverage >= 0.85 && summary.length <= clean(article.title || '').length * 1.8) return 'titleLike';
    return 'usable';
  }

  function imageState(article = {}) {
    const verified = article.visualVerified === true
      || article.visualReady === true
      || article.visualStatus === 'ready'
      || article.visual?.status === 'ready';
    if (verified) return 'ready';
    const candidate = clean(article.image || article.visual?.url || article.visualUrl || '');
    return candidate ? 'candidate' : 'missing';
  }

  function countBy(items, selector, allowed) {
    const counts = Object.fromEntries(allowed.map(key => [key, 0]));
    for (const item of items) {
      const key = selector(item);
      if (Object.hasOwn(counts, key)) counts[key] += 1;
    }
    return counts;
  }

  function collect({ cache = {}, errors = [], imageErrors = 0 } = {}) {
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const stats = cache.stats && typeof cache.stats === 'object' ? cache.stats : {};
    const mergedCounts = articles.map(article => Math.max(1, Number(article.mergedCount || 0), Array.isArray(article.sources) ? article.sources.length : 1));
    const deduplicated = Number(stats.deduplicatedItems || articles.length);
    const raw = Number(stats.rawItems || deduplicated);
    const novelty = countBy(articles, article => String(article.noveltyStateV78 || article.noveltyState || ''), ['new', 'development', 'minor-update', 'repeat']);
    const images = countBy(articles, imageState, ['ready', 'candidate', 'missing']);
    const summaries = countBy(articles, summaryState, ['usable', 'missing', 'generic', 'titleLike']);
    const safeErrors = Array.isArray(errors) ? errors : [];

    return {
      dedup: {
        collapsed: Math.max(0, Number(stats.duplicatesCollapsedV79 || 0), raw - deduplicated),
        mergedArticles: mergedCounts.filter(count => count > 1).length,
        largestCluster: mergedCounts.length ? Math.max(...mergedCounts) : 0
      },
      ranking: {
        positiveSignals: Number(stats.catalogPositiveSignals || articles.filter(article => Number(article.catalogSignalV915 || 0) > 0).length),
        negativeSignals: Number(stats.catalogNegativeSignals || articles.filter(article => Number(article.catalogSignalV915 || 0) < 0).length),
        lowInformation: articles.filter(article => article.lowInformationV89).length,
        lowCategoryConfidence: articles.filter(article => ['low', 'none'].includes(article.categoryConfidenceLevel)).length,
        novelty
      },
      images: { ...images, sessionErrors: Number(imageErrors || 0) },
      summaries,
      errors: {
        total: safeErrors.length,
        script: safeErrors.filter(error => error?.kind === 'error').length,
        rejections: safeErrors.filter(error => error?.kind === 'rejection').length,
        latestAt: safeErrors.reduce((latest, error) => Math.max(latest, Number(error?.at || 0)), 0)
      }
    };
  }

  return Object.freeze({ collect, imageState, summaryState });
});
