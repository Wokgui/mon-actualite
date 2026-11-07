(function installNoveltyDetection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NewsNoveltyV91 = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const RECAP_RX = /\b(ce que l['’]on sait|ce qu['’]il faut savoir|récap|retour sur|tout comprendre|en images|revivez)\b/i;
  const MARKER_RULES = [
    ['investigation', /\b(enquête (?:ouverte|lancée)|perquisition|audition judiciaire)\b/i],
    ['custody', /\b(mise en examen|placé en garde à vue|arrestation|interpellation)\b/i],
    ['aid', /\b(aide humanitaire|débloque?.{0,40}\b(?:fonds|millions?|milliards?)|fonds d['’]urgence)\b/i],
    ['agreement', /\b(accord (?:signé|conclu|trouvé)|cessez[- ]le[- ]feu (?:signé|accepté)|négociations? aboutissent?)\b/i],
    ['sanctions', /\b(nouvelles sanctions?|sanctions? (?:entrent|entrée) en vigueur|paquet de sanctions?)\b/i],
    ['resignation', /\b(démissionne|démission annoncée|quitte (?:son poste|le gouvernement))\b/i],
    ['decision', /\b(adopte|vote|rejette|valide|annule|interdit|autorise|condamne|acquitte)\b/i],
    ['official', /\b(officialise|confirmation officielle|entre en vigueur)\b/i]
  ];

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function markers(value = '') {
    const text = clean(value);
    return MARKER_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  }

  function difference(values = [], previous = []) {
    const old = new Set(previous.map(normalize));
    return [...new Set(values.map(clean).filter(Boolean))].filter(value => !old.has(normalize(value)));
  }

  function timestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function classify(current = {}, previous = {}) {
    const currentFacts = Array.isArray(current.facts) ? current.facts : [];
    const previousFacts = Array.isArray(previous.facts) ? previous.facts : [];
    const newFacts = difference(currentFacts, previousFacts);
    const newActions = difference(current.actions || [], previous.actions || []);
    const newEntities = difference(current.entities || [], previous.entities || []);
    const currentMarkers = markers(current.title || current.text || '');
    const previousMarkers = Array.isArray(previous.markers) ? previous.markers : markers(previous.title || '');
    const newMarkers = difference(currentMarkers, previousMarkers);
    const currentAt = timestamp(current.publishedAt);
    const previousAt = timestamp(previous.publishedAt);
    const gapMinutes = currentAt && previousAt ? Math.round((currentAt - previousAt) / 60000) : null;
    const later = gapMinutes === null ? null : gapMinutes > 0;
    const factsChanged = currentFacts.length > 0 && previousFacts.length > 0
      && [...new Set(currentFacts.map(normalize))].sort().join('|') !== [...new Set(previousFacts.map(normalize))].sort().join('|');
    const meaningfulActions = newActions.filter(action => !/^annonc|^present|^devoil|^publi|^lanc/i.test(normalize(action)));
    const evidence = {
      gapMinutes,
      newFacts: newFacts.slice(0, 5),
      newActions: newActions.slice(0, 5),
      newEntities: newEntities.slice(0, 5),
      newMarkers
    };

    if (RECAP_RX.test(clean(current.title || ''))) {
      return { state: 'repeat', delta: -24, reason: 'Récapitulatif', confidence: 'high', evidence };
    }

    if (newMarkers.length && (later !== false || previousAt === 0)) {
      return { state: 'development', delta: 16, reason: 'Nouveau développement vérifiable', confidence: 'high', evidence };
    }

    if (factsChanged && newFacts.length && gapMinutes !== null && gapMinutes >= 60) {
      return { state: 'development', delta: 16 + Math.min(6, newFacts.length * 2), reason: 'Mise à jour factuelle postérieure', confidence: 'high', evidence };
    }

    if (meaningfulActions.length && gapMinutes !== null && gapMinutes >= 90) {
      return { state: 'development', delta: 14, reason: 'Nouvelle action postérieure', confidence: 'medium', evidence };
    }

    if (newFacts.length >= 2 && gapMinutes !== null && gapMinutes >= 90) {
      return { state: 'development', delta: 14, reason: 'Nouveaux faits postérieurs', confidence: 'medium', evidence };
    }

    if ((newFacts.length === 1 && gapMinutes !== null && gapMinutes >= 30)
      || (newEntities.length >= 2 && gapMinutes !== null && gapMinutes >= 120)) {
      return { state: 'minor-update', delta: 5, reason: 'Nouvel élément mesuré', confidence: 'medium', evidence };
    }

    const concurrent = gapMinutes !== null && Math.abs(gapMinutes) < 30 && (factsChanged || newFacts.length || newEntities.length);
    return {
      state: 'repeat',
      delta: concurrent ? -20 : -16,
      reason: concurrent ? 'Réécriture ou version concurrente' : 'Information déjà connue',
      confidence: concurrent ? 'high' : 'medium',
      evidence
    };
  }

  return Object.freeze({ classify, markers });
});
