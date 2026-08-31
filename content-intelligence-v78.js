(() => {
  'use strict';

  const SUPABASE_URL = 'https://oxdrhwveuctrorrkuurw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_o75FsFwywIFQOCyMYNYD8A_k034qpQv';
  const TABLE = 'news_article_cache';
  const PREF_KEY = 'news-topic-preferences-v1';
  const SETTINGS_KEY = 'news-settings';
  const CACHE_KEY = 'news-live-cache';
  const STORY_MEMORY_KEY = 'news-story-memory-v78';
  const SHARED_CACHE_LOCAL_KEY = 'news-shared-cache-v78';
  const MEMORY_MAX_AGE = 10 * 24 * 60 * 60 * 1000;
  const FETCH_CACHE_TIMEOUT = 600;
  const upstreamFetch = window.fetch.bind(window);
  let decorateQueued = false;
  let persistTimer = 0;

  const CATEGORIES = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe','IA','Tech','Smartphones','VR','Automobile','Énergie'];
  const CATEGORY_RULES = {
    Politique: [
      [/\b(gouvernement|assemblée nationale|sénat|député|ministre|premier ministre|elysée|élysée|matignon|parti politique|motion de censure|projet de loi|élection présidentielle|législatives?)\b/i, 5],
      [/\b(loi|réforme|majorité|opposition|parlement|vote|scrutin|président de la république)\b/i, 3]
    ],
    International: [
      [/\b(ukraine|russie|gaza|israël|iran|chine|taïwan|otan|onu|washington|moscou|pékin|guerre|cessez[- ]le[- ]feu|frappe|missile|drone militaire)\b/i, 4],
      [/\b(diplomatie|sanctions|frontière|conflit|armée|militaire|ambassade|sommet international)\b/i, 3]
    ],
    Économie: [
      [/\b(inflation|croissance|pib|récession|chômage|emploi|bourse|marchés? financiers?|banque centrale|bce|fed|taux d'intérêt|pouvoir d'achat)\b/i, 5],
      [/\b(entreprise|industrie|salaires?|prix|budget|dette|déficit|commerce|investissement)\b/i, 2.5]
    ],
    Société: [
      [/\b(police|justice|tribunal|procès|meurtre|homicide|agression|violences?|accident|incendie|disparition|immigration|logement|social|prison)\b/i, 4],
      [/\b(faits? divers|sécurité|manifestation|grève|famille|démographie|inégalités?)\b/i, 3]
    ],
    Santé: [
      [/\b(santé|hôpital|médecin|maladie|cancer|vaccin|épidémie|virus|traitement|médicament|chirurgie|patients?|diagnostic)\b/i, 5],
      [/\b(sommeil|nutrition|obésité|cardiaque|alzheimer|diabète|infection)\b/i, 3]
    ],
    Environnement: [
      [/\b(climat|réchauffement|biodiversité|pollution|sécheresse|canicule|inondation|tempête|émissions?|carbone|écologie|environnement)\b/i, 5],
      [/\b(météo|forêt|océan|espèces?|nature|recyclage)\b/i, 2.5]
    ],
    Science: [
      [/\b(scientifiques?|chercheurs?|recherche|étude scientifique|découverte|expérience|télescope|astronomie|espace|nasa|esa|spacex|mars|lune|physique|biologie)\b/i, 5],
      [/\b(laboratoire|université|publication scientifique|essai clinique)\b/i, 3]
    ],
    Culture: [
      [/\b(cinéma|film|série|livre|roman|écrivain|auteur|musique|album|concert|musée|exposition|festival|théâtre|littérature|éditeur|jeu vidéo|gta\s*(?:6|vi))\b/i, 5],
      [/\b(acteur|actrice|réalisateur|artiste|culture|prix littéraire)\b/i, 3]
    ],
    Éducation: [
      [/\b(école|collège|lycée|université|enseignants?|professeurs?|élèves?|étudiants?|éducation nationale|bac|parcoursup|rentrée scolaire)\b/i, 5],
      [/\b(enseignement|formation|diplôme|classe|scolarité)\b/i, 3]
    ],
    Europe: [
      [/\b(union européenne|commission européenne|parlement européen|conseil européen|bruxelles|zone euro|eurodéputés?)\b/i, 5],
      [/\b(ue|europe|européen|européenne)\b/i, 2.5]
    ],
    IA: [
      [/\b(openai|chatgpt|anthropic|claude|gemini|intelligence artificielle|modèle de langage|llm|agent ia|gpt[- ]?\d)\b/i, 6],
      [/\b(ia générative|machine learning|apprentissage automatique|deep learning)\b/i, 5]
    ],
    Tech: [
      [/\b(microsoft|windows|linux|nvidia|amd|intel|cybersécurité|cyberattaque|logiciel|processeur|puce|semi-conducteur|cloud|informatique)\b/i, 4],
      [/\b(apple|google|meta|amazon)\b/i, 1.5]
    ],
    Smartphones: [
      [/\b(smartphone|iphone|galaxy s\d+|pixel \d+|oppo find|xiaomi \d+|oneplus|android \d+|téléphone pliable|fold|flip)\b/i, 6],
      [/\b(samsung galaxy|google pixel|ios \d+)\b/i, 5]
    ],
    VR: [
      [/\b(meta quest|quest \d+|réalité virtuelle|casque vr|pcvr|steamvr|virtual desktop|pimax|bigscreen beyond|vision pro)\b/i, 6],
      [/\b(vr|xr|réalité mixte)\b/i, 4]
    ],
    Automobile: [
      [/\b(voiture|automobile|véhicule|renault|peugeot|citroën|tesla|bmw|mercedes|audi|porsche|fiat|volkswagen|suv|électrique|hybride)\b/i, 4],
      [/\b(permis|autoroute|borne de recharge|recharge rapide)\b/i, 3]
    ],
    Énergie: [
      [/\b(nucléaire|électricité|énergie|solaire|éolien|hydrogène|centrale|réacteur|réseau électrique|batteries? stationnaires?)\b/i, 5],
      [/\b(gaz|pétrole|renouvelables?|photovoltaïque)\b/i, 3]
    ]
  };

  const ACTION_PATTERNS = [
    ['annonce', /\b(annonce|présente|dévoile|lance|publie|officialise)\b/i],
    ['décision', /\b(adopte|vote|rejette|valide|annule|interdit|autorise|condamne|acquitte)\b/i],
    ['changement', /\b(démissionne|nomme|remplace|ferme|ouvre|suspend|reprend|cesse)\b/i],
    ['bilan', /\b(morts?|blessés?|victimes?|bilan|atteint|passe à|grimpe à|baisse à)\b/i],
    ['accord', /\b(accord|cessez[- ]le[- ]feu|traité|compromis|négociations? aboutissent?)\b/i],
    ['découverte', /\b(découvre|découverte|observe|identifie|démontre|prouve|confirme)\b/i]
  ];

  const STOP = new Set('avec dans pour plus après avant cette cet ces sont être leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore déjà très moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualité direct vidéo photos photo'.split(' '));

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function clean(value = '') { return String(value ?? '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); }
  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9%€$]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function titleText(article = {}) { return clean(article.title || '').replace(/\s+[-–—|]\s+[^–—|]{2,45}$/i, '').trim(); }
  function articleText(article = {}) { return `${titleText(article)} ${clean(article.summary || article.detail || '')} ${(article.tags || []).join(' ')} ${(article.matches || []).join(' ')}`; }

  function tokens(article = {}) {
    return [...new Set(normalize(titleText(article)).split(' ').filter(word => word && !STOP.has(word) && (word.length >= 4 || /\d/.test(word))))].slice(0, 18);
  }

  function facts(article = {}) {
    const text = articleText(article);
    const nums = text.match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|€|\$|euros?|dollars?|km|milliards?|millions?|ans?|mois|jours?|heures?))?\b/gi) || [];
    const dates = text.match(/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+\d{4})?\b/gi) || [];
    return [...new Set([...nums, ...dates].map(normalize).filter(Boolean))].slice(0, 20);
  }

  function actions(article = {}) {
    const text = articleText(article);
    return ACTION_PATTERNS.filter(([, rx]) => rx.test(text)).map(([name]) => name);
  }

  function entities(article = {}) {
    const title = titleText(article);
    const found = [];
    try {
      const matches = title.match(/\b(?:[A-ZÀ-ÖØ-Þ][\p{L}\d’'\-]{1,}|[A-Z]{2,}|[A-Z][a-z]+\d+)(?:\s+(?:[A-ZÀ-ÖØ-Þ][\p{L}\d’'\-]{1,}|[A-Z]{2,}|\d+[A-Za-z]*)){0,3}\b/gu) || [];
      for (const item of matches) {
        const value = item.replace(/^(?:Le|La|Les|Un|Une|Des|Ce|Cette|Ces)\s+/i, '').trim();
        if (value.length >= 4 && !CATEGORIES.includes(value)) found.push(value);
      }
    } catch {}
    return [...new Set(found.map(clean))].slice(0, 12);
  }

  function semanticCategory(article = {}) {
    const title = titleText(article);
    const summary = clean(article.summary || article.detail || '');
    const tags = `${(article.tags || []).join(' ')} ${(article.matches || []).join(' ')}`;
    const scores = Object.fromEntries(CATEGORIES.map(category => [category, 0]));

    for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
      for (const [rx, weight] of rules) {
        if (rx.test(title)) scores[category] += weight * 4;
        if (summary && rx.test(summary)) scores[category] += weight;
        if (tags && rx.test(tags)) scores[category] += weight * 1.4;
      }
    }

    if (/\b(iphone|galaxy|pixel|oppo|xiaomi|smartphone)\b/i.test(title)) scores.Tech *= 0.35;
    if (/\b(openai|chatgpt|anthropic|claude|gemini|intelligence artificielle)\b/i.test(title)) scores.Tech *= 0.45;
    if (/\b(jeu vidéo|gta|cinéma|film|livre|roman|musique)\b/i.test(title)) scores.Tech *= 0.3;
    if (/\b(nucléaire|solaire|éolien|centrale|réacteur)\b/i.test(title)) scores.Environnement *= 0.55;
    if (/\b(commission européenne|parlement européen|union européenne)\b/i.test(title)) scores.International *= 0.55;

    const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [bestCategory, bestScore] = ordered[0];
    const current = CATEGORIES.includes(article.category) ? article.category : '';
    const currentScore = current ? Number(scores[current] || 0) : 0;
    const confident = bestScore >= 10 && (bestScore >= currentScore + 5 || !current);
    return { category: confident ? bestCategory : (current || bestCategory), confidence: bestScore, scores };
  }

  function eventKey(article = {}) {
    const core = tokens(article).filter(word => word.length >= 5 || /\d/.test(word)).slice(0, 7).sort();
    return `${normalize(article.category || '')}:${core.join('-')}`.slice(0, 250);
  }

  function overlap(a, b) {
    const bs = new Set(b);
    const common = a.filter(item => bs.has(item));
    const union = new Set([...a, ...b]);
    return { common: common.length, coverage: common.length / Math.max(1, Math.min(a.length, b.length)), jaccard: common.length / Math.max(1, union.size) };
  }

  function storyMemory() {
    const now = Date.now();
    const memory = readJson(STORY_MEMORY_KEY, []);
    return Array.isArray(memory) ? memory.filter(item => item && now - Number(item.at || 0) <= MEMORY_MAX_AGE).slice(-320) : [];
  }

  function refineNovelty(article, memory) {
    const at = tokens(article);
    if (at.length < 3) return { state: article.noveltyState || 'new', delta: 0, reason: '' };
    let best = null;
    for (const item of memory) {
      if (!item || item.id === String(article.id || '')) continue;
      const o = overlap(at, item.tokens || []);
      if (o.common < 3 || (o.coverage < 0.56 && o.jaccard < 0.36)) continue;
      const score = o.coverage * .65 + o.jaccard * .35;
      if (!best || score > best.score) best = { item, score };
    }
    if (!best) return { state: 'new', delta: 8, reason: 'Nouvelle information' };

    const oldFacts = new Set(best.item.facts || []);
    const oldActions = new Set(best.item.actions || []);
    const oldEntities = new Set((best.item.entities || []).map(normalize));
    const newFacts = facts(article).filter(value => !oldFacts.has(value));
    const newActions = actions(article).filter(value => !oldActions.has(value));
    const newEntities = entities(article).filter(value => !oldEntities.has(normalize(value)));
    const recap = /\b(ce que l'on sait|ce qu'il faut savoir|récap|retour sur|tout comprendre|en images|revivez)\b/i.test(titleText(article));

    if (newFacts.length >= 2 || newActions.length >= 1 || newEntities.length >= 3) {
      return { state: 'development', delta: 14 + Math.min(10, newFacts.length * 2), reason: 'Nouveau développement' };
    }
    if (newFacts.length === 1 || newEntities.length >= 2) return { state: 'minor-update', delta: 5, reason: 'Nouvel élément' };
    if (recap) return { state: 'repeat', delta: -24, reason: 'Récapitulatif' };
    return { state: 'repeat', delta: -16, reason: 'Information déjà connue' };
  }

  function rememberStories(articles) {
    const now = Date.now();
    const byId = new Map(storyMemory().map(item => [item.id, item]));
    for (const article of articles) {
      const id = String(article.id || '');
      if (!id) continue;
      byId.set(id, { id, tokens: tokens(article), facts: facts(article), actions: actions(article), entities: entities(article), eventKey: article.eventKeyV78 || eventKey(article), at: now });
    }
    writeJson(STORY_MEMORY_KEY, [...byId.values()].sort((a, b) => Number(a.at || 0) - Number(b.at || 0)).slice(-320));
  }

  function whyArticle(article = {}) {
    if (article.essential) return 'Actualité majeure';
    if (article.noveltyStateV78 === 'development') return 'Nouveau développement';
    const prefs = readJson(PREF_KEY, {});
    const positives = Object.entries(prefs).filter(([, value]) => Number(value) > 0.4).sort((a, b) => Number(b[1]) - Number(a[1]));
    const haystack = normalize(`${titleText(article)} ${(article.matches || []).join(' ')} ${(article.tags || []).join(' ')}`);
    const followed = positives.find(([topic]) => haystack.includes(normalize(topic)));
    if (followed) return `Sujet suivi : ${followed[0]}`;
    const settings = readJson(SETTINGS_KEY, {});
    if (Array.isArray(settings.interests) && settings.interests.includes(article.category)) return `Centre d’intérêt : ${article.category}`;
    if (article.customSource) return `Découvert via ${clean(article.source || 'une source ajoutée')}`;
    return 'Actualité récente';
  }

  function enrichArticles(articles) {
    if (!Array.isArray(articles)) return [];
    const memory = storyMemory();
    const enriched = articles.map(article => {
      const copy = { ...article };
      const classification = semanticCategory(copy);
      if (classification.category) copy.category = classification.category;
      copy.semanticCategoryConfidence = Math.round(classification.confidence * 10) / 10;
      copy.eventKeyV78 = eventKey(copy);
      const novelty = refineNovelty(copy, memory);
      copy.noveltyStateV78 = novelty.state;
      copy.noveltyReasonV78 = novelty.reason;
      copy.score = Math.round(Number(copy.score || 0) + novelty.delta);
      copy.whyV78 = whyArticle(copy);
      return copy;
    });
    rememberStories(enriched);
    return enriched;
  }

  async function sha256(value) {
    const data = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function sharedHeaders(extra = {}) {
    return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra };
  }

  async function sharedRow(articleUrl) {
    if (!/^https?:\/\//i.test(articleUrl || '')) return null;
    const key = await sha256(articleUrl);
    const local = readJson(SHARED_CACHE_LOCAL_KEY, {});
    const cached = local[key];
    if (cached && Date.now() - Number(cached.at || 0) < 6 * 60 * 60 * 1000) return cached.row || null;

    const request = fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?cache_key=eq.${encodeURIComponent(key)}&select=cache_key,article_url,image_url,image_status,summary,summary_status,category,event_key,payload,expires_at&limit=1`, {
      headers: sharedHeaders(), cache: 'no-store'
    }).then(response => response.ok ? response.json() : []).then(rows => rows?.[0] || null).catch(() => null);
    const row = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve(null), FETCH_CACHE_TIMEOUT))]);
    if (row) {
      local[key] = { at: Date.now(), row };
      writeJson(SHARED_CACHE_LOCAL_KEY, Object.fromEntries(Object.entries(local).slice(-120)));
    }
    return row;
  }

  async function persistRows(articles) {
    const candidates = (articles || []).filter(article => /^https?:\/\//i.test(article.url || '')).slice(0, 24);
    const rows = [];
    for (const article of candidates) {
      const key = await sha256(article.url);
      let image = clean(article.visual?.url || article.image || '');
      if (image.startsWith(location.origin)) image = '';
      const summary = clean(article.summary || article.detail || '');
      rows.push({
        cache_key: key,
        article_url: article.url,
        title: clean(article.title).slice(0, 1000),
        source: clean(article.source).slice(0, 300),
        image_url: /^https?:\/\//i.test(image) ? image.slice(0, 4096) : '',
        image_status: image ? 'known' : '',
        summary: summary.length >= 55 ? summary.slice(0, 12000) : '',
        summary_status: summary.length >= 55 ? 'feed' : '',
        category: clean(article.category).slice(0, 100),
        event_key: clean(article.eventKeyV78 || '').slice(0, 256),
        payload: { why: article.whyV78 || '', novelty: article.noveltyStateV78 || '', confidence: article.semanticCategoryConfidence || 0 },
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
    if (!rows.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=cache_key`, {
      method: 'POST', headers: sharedHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows), cache: 'no-store'
    }).catch(() => {});
  }

  function schedulePersist(articles) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persistRows(articles).catch(() => {}), 1200);
  }

  function goodSummary(text = '') {
    const value = clean(text);
    return value.length >= 55 && !/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(value);
  }

  function syntheticSummaryResponse(path, row) {
    const summary = clean(row?.summary || '');
    if (!goodSummary(summary)) return null;
    const body = path.includes('article-summary-smart')
      ? { ok: true, text: summary, grounded: true, cached: true, source: 'shared-cache' }
      : { summary, unavailable: false, cached: true, source: 'shared-cache' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Summary-Cache': 'supabase' } });
  }

  async function persistSummary(article, summary, status = 'validated') {
    if (!article?.url || !goodSummary(summary)) return;
    const key = await sha256(article.url);
    const row = {
      cache_key: key,
      article_url: article.url,
      title: clean(article.title).slice(0, 1000),
      source: clean(article.source).slice(0, 300),
      summary: clean(summary).slice(0, 12000),
      summary_status: status,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=cache_key`, {
      method: 'POST', headers: sharedHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row), cache: 'no-store'
    }).catch(() => {});
  }

  function parseSummaryArticle(init) {
    try {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      return body?.article || null;
    } catch { return null; }
  }

  window.fetch = async function intelligenceV78Fetch(input, init) {
    const raw = typeof input === 'string' ? input : input?.url || '';
    let url;
    try { url = new URL(raw, location.href); } catch { return upstreamFetch(input, init); }

    if (url.origin === location.origin && /\/api\/article-summary-(?:groq|smart)/.test(url.pathname)) {
      const article = parseSummaryArticle(init);
      if (article?.url) {
        const row = await sharedRow(article.url).catch(() => null);
        const cached = syntheticSummaryResponse(url.pathname, row);
        if (cached) return cached;
      }
      const response = await upstreamFetch(input, init);
      if (article?.url && response.ok) {
        response.clone().json().then(data => {
          const summary = data?.summary || data?.text || '';
          if (goodSummary(summary)) persistSummary(article, summary).catch(() => {});
        }).catch(() => {});
      }
      return response;
    }

    const response = await upstreamFetch(input, init);
    if (url.origin === location.origin && url.pathname === '/api/news' && response.ok) {
      try {
        const payload = await response.clone().json();
        if (payload && Array.isArray(payload.articles)) {
          payload.articles = enrichArticles(payload.articles);
          payload.stats = { ...(payload.stats || {}), intelligenceV78: true };
          schedulePersist(payload.articles);
          const headers = new Headers(response.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
        }
      } catch {}
    }
    return response;
  };

  function cachedArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function decorateWhy() {
    decorateQueued = false;
    const map = new Map(cachedArticles().map(article => [String(article.id || ''), article]));
    document.querySelectorAll('.article-card[data-article]').forEach(card => {
      const article = map.get(String(card.dataset.article || ''));
      if (!article?.whyV78) return;
      let node = card.querySelector('.why-v78');
      if (!node) {
        node = document.createElement('div');
        node.className = 'why-v78';
        const body = card.querySelector('.article-body') || card;
        const meta = body.querySelector('.meta');
        if (meta) meta.insertAdjacentElement('afterend', node); else body.appendChild(node);
      }
      node.textContent = `Pourquoi : ${article.whyV78}`;
      node.title = article.noveltyReasonV78 || article.whyV78;
    });
  }

  function queueDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(decorateWhy);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('app');
    if (root) new MutationObserver(queueDecorate).observe(root, { childList: true, subtree: true });
    queueDecorate();
  }, { once: true });
  window.addEventListener('focus', queueDecorate);
})();
