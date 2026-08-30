import { articleVisualUrl, hasPreparedVisual, sourceTileUrl } from './services/article-visuals.js?v=57';

const GENERAL = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe'];
const PERSONAL = ['IA','Tech','Smartphones','VR','Automobile','Énergie'];
const SUMMARY_CACHE_KEY = 'news-article-summaries-v4';
let scheduled = false;
let briefMode = 'essential';
let briefCategory = null;
let homeLimit = 36;
const summaryRequests = new Map();

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const MOJIBAKE = [
  ['â€™','’'],['â€˜','‘'],['â€œ','“'],['â€','”'],['â€“','–'],['â€”','—'],['â€¦','…'],
  ['Â ',' '],['Â«','«'],['Â»','»'],['Ã©','é'],['Ã¨','è'],['Ãª','ê'],['Ã«','ë'],['Ã ','à'],
  ['Ã¢','â'],['Ã§','ç'],['Ã®','î'],['Ã¯','ï'],['Ã´','ô'],['Ã¹','ù'],['Ã»','û'],['Ã‰','É'],['Å“','œ']
];

function cleanText(value) {
  let text = String(value ?? '');
  for (const [bad, good] of MOJIBAKE) text = text.split(bad).join(good);
  return text.replace(/\uFFFD+/g, '').trim();
}

function esc(value) {
  return cleanText(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (minutes < 24 * 60) return `Il y a ${Math.floor(minutes / 60)} h`;
  const days = Math.floor(minutes / (24 * 60));
  return `Il y a ${days} j`;
}

function currentSettings() {
  const raw = readJson('news-settings', {});
  return {
    general: Array.isArray(raw.generalCategories) ? raw.generalCategories : GENERAL,
    interests: Array.isArray(raw.interests) ? raw.interests : PERSONAL,
    briefEssential: Array.isArray(raw.briefEssentialCategories) ? raw.briefEssentialCategories : GENERAL,
    briefWatches: Array.isArray(raw.briefWatchTopics) ? raw.briefWatchTopics : ['Recherche scientifique', 'Innovations', 'Progrès humains', 'Médecine', 'Espace', 'IA', 'Énergie', 'Environnement', 'Éducation'],
    topicPreferences: readJson('news-topic-preferences-v1', {})
  };
}

function allCachedArticles() {
  const cache = readJson('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}

function visibleArticles() {
  const articles = allCachedArticles();
  const current = currentSettings();
  const feedback = readJson('news-feedback', {});
  return articles
    .filter(article => feedback[article.id] !== 'not')
    .slice()
    .sort((a, b) => {
      const score = article => {
        const topics = [...new Set([article.category, ...(article.tags || []), ...(article.matches || [])].filter(Boolean))];
        const learned = topics.reduce((total, topic) => total + Number(current.topicPreferences[topic] || 0) * 12, 0);
        const chosen = current.interests.includes(article.category) ? 22 : current.general.includes(article.category) ? 8 : 0;
        const articleFeedback = ({ more: 24, less: -20, follow: 38 }[feedback[article.id]] || 0);
        const recency = Math.max(0, 72 - ((Date.now() - Date.parse(article.publishedAt || 0)) / 3600000));
        return Number(article.score || 0) + learned + chosen + articleFeedback + recency * .35;
      };
      return score(b) - score(a);
    });
}

function importanceArticles() {
  const feedback = readJson('news-feedback', {});
  return visibleArticles().slice().sort((a, b) => {
    const pref = id => ({ more: 24, less: -20, follow: 38 }[feedback[id]] || 0);
    const recencyA = Math.max(0, 72 - ((Date.now() - Date.parse(a.publishedAt || 0)) / 3600000));
    const recencyB = Math.max(0, 72 - ((Date.now() - Date.parse(b.publishedAt || 0)) / 3600000));
    return ((b.score || 0) + pref(b.id) + recencyB * .35) - ((a.score || 0) + pref(a.id) + recencyA * .35);
  });
}

function rowImageMarkup(article, index = 0) {
  const priority = index < 4;
  const prepared = hasPreparedVisual(article);
  const tile = sourceTileUrl(article);
  return `<img class="article-image original-article-image stable-visual ${prepared ? 'prepared-visual' : 'source-tile-visual'}" src="${esc(articleVisualUrl(article))}" alt="" width="400" height="224" loading="${priority ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" style="background-image:url('${esc(tile)}');background-size:cover" ${index < 4 ? 'fetchpriority="high"' : ''}>`;
}

function compactRow(article, index = 0) {
  return `<article class="article-card runtime-row" data-article="${esc(article.id)}" tabindex="0" aria-label="Lire : ${esc(article.title)}">
    ${rowImageMarkup(article, index)}
    <div class="article-body">
      <h2>${esc(article.title)}</h2>
      <div class="meta"><span class="source">${esc(article.source || 'Source')}</span><span>${esc(timeLabel(article.publishedAt))}</span></div>
    </div>
  </article>`;
}

function isUnavailableSummary(value = '') {
  const text = cleanText(value).toLowerCase();
  return !text
    || /résumé indisponible/.test(text)
    || /ouvrez?\s+l[’']article/.test(text)
    || /consultez?\s+(?:les?\s+)?détails/.test(text)
    || /détails publiés par la source/.test(text);
}

function removeRedundantUi() {
  document.querySelectorAll('.sync-strip').forEach(node => node.remove());
  document.querySelectorAll('.install-section').forEach(node => node.remove());
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    const home = nav.querySelector('[data-view="home"]');
    const plus = nav.querySelector('[data-view="sheet"]');
    const brief = nav.querySelector('[data-view="brief"]');
    if (!home || !plus || !brief) return;
    const expected = [home, plus, brief];
    const current = [...nav.children];
    const alreadyStable = current.length === expected.length && expected.every((item, index) => current[index] === item);
    if (!alreadyStable) nav.replaceChildren(...expected);
    nav.classList.remove('nav-four');
    nav.classList.add('nav-three');
  });
}

function enhanceHome() {
  if (!document.querySelector('.nav-item.active[data-view="home"]')) return;
  const subtitle = document.querySelector('.hero-header p');
  if (subtitle) subtitle.textContent = 'Tous les articles, personnalisés pour vous';
  const savedButton = document.querySelector('.saved-filter [data-saved-filter]');
  if (savedButton && /voir toute/i.test(savedButton.textContent || '')) return;
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const articles = visibleArticles();
  const settings = currentSettings();
  const signature = `${homeLimit}|${JSON.stringify(settings.interests)}|${JSON.stringify(settings.topicPreferences)}|${articles.map(article => article.id).join('|')}`;
  if (feed.dataset.runtimeSignature === signature) return;
  feed.dataset.runtimeSignature = signature;
  if (articles.length) {
    const shown = articles.slice(0, homeLimit);
    const remaining = Math.max(0, articles.length - shown.length);
    feed.innerHTML = `${shown.map((article, index) => compactRow(article, index)).join('')}${remaining ? `<button type="button" class="home-more" data-home-more>Afficher ${Math.min(36, remaining)} articles de plus <small>${remaining} encore disponibles</small></button>` : ''}`;
  }
}

function essentialBrief() {
  const selected = new Set(currentSettings().briefEssential);
  const majorTerms = /guerre|attaque|cessez-le-feu|élection|gouvernement|président|premier ministre|attentat|catastrophe|séisme|inondation|incendie|disparu|crise|accord|sommet|justice|condamn|budget|déficit|croissance|inflation|chômage|épidémie|climat|diplomatie|nucléaire/i;
  const lowPriorityTerms = /\bpsg\b|ligue 1|football|match|composition|mercato|tennis|formule 1|prix en chute|promotion|bon plan|soldes?|réduction|stations?-service|carburant|diesel|essence à \d|console|smartphone|windows|gta|jeu vidéo|montre connectée|audiences? télé|people|célébrité|télé-réalité/i;
  const worldTerms = /ukraine|russie|népal|tibet|gaza|israël|iran|chine|états[- ]unis|donald trump|fed\b|otan|onu\b|royaume-uni|allemagne|italie|espagne|autriche|grèce|inde|pakistan|japon|corée|afrique|moyen-orient|amérique|brésil|canada/i;
  const editorialCategories = new Set(['Politique', 'International', 'Europe', 'Économie', 'Société', 'Santé', 'Environnement']);
  const scopeOf = article => {
    const title = String(article.title || '');
    if (worldTerms.test(title) || article.category === 'International' || article.category === 'Europe') return 'Monde';
    return 'France';
  };
  const topicWords = article => new Set(String(article.title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .match(/[a-z0-9]{4,}/g)?.filter(word => !/^(avec|apres|avant|dans|depuis|direct|entre|leurs|nouveau|nouvelle|pour|plus|selon|sont|cette|comme|tout|tous|toute|vers)$/.test(word)) || []);
  const sameEvent = (left, right) => {
    const a = topicWords(left);
    const b = topicWords(right);
    const shared = [...a].filter(word => b.has(word)).length;
    const overlap = shared / Math.max(1, Math.min(a.size, b.size));
    return (shared >= 2 && overlap >= .38) || (shared >= 3 && overlap >= .24);
  };
  const scoreOf = article => {
    const text = `${article.title || ''} ${article.summary || ''}`;
    const editorial = editorialCategories.has(article.category) ? 70 : -35;
    const headline = majorTerms.test(text) ? 55 : 0;
    const corroboration = Math.max(0, (article.sources?.length || 1) - 1) * 30;
    const lightweight = lowPriorityTerms.test(text) ? -220 : 0;
    const weakSignal = !majorTerms.test(text) && corroboration === 0 ? -65 : 0;
    const age = Math.max(0, (Date.now() - Date.parse(article.publishedAt || 0)) / 3600000);
    // Deliberately ignore article.score here: that score contains personal
    // source and interest boosts. L’essentiel must be publisher-neutral.
    return 100 + editorial + headline + corroboration + lightweight + weakSignal - Math.min(age, 72);
  };
  const ranked = importanceArticles().filter(article => selected.has(article.category)).sort((a, b) => scoreOf(b) - scoreOf(a));
  const recent = ranked.filter(article => Date.now() - Date.parse(article.publishedAt || 0) <= 72 * 3600000);
  const pool = recent.length >= 6 ? recent : ranked;
  const headlinePool = pool.filter(article => {
    const text = `${article.title || ''} ${article.summary || ''}`;
    return (majorTerms.test(text) || (article.sources?.length || 1) > 1) && scoreOf(article) >= 150;
  });
  const primaryPool = headlinePool.length >= 5 ? headlinePool : pool;
  const candidates = primaryPool.map(article => ({ article, scope: scopeOf(article) }));
  const fallbackCandidates = pool.map(article => ({ article, scope: scopeOf(article) }));
  const selectedItems = [];
  const firstFrance = candidates.find(item => item.scope === 'France');
  const firstWorld = candidates.find(item => item.scope === 'Monde');
  if (firstFrance) selectedItems.push(firstFrance);
  if (firstWorld && firstWorld.article.id !== firstFrance?.article.id) selectedItems.push(firstWorld);
  const sourceCounts = new Map();
  selectedItems.forEach(item => {
    const source = item.article.source || 'Source';
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  });
  for (const candidate of candidates) {
    if (selectedItems.length >= 5) break;
    const source = candidate.article.source || 'Source';
    if (selectedItems.some(item => item.article.id === candidate.article.id || sameEvent(item.article, candidate.article)) || Number(sourceCounts.get(source) || 0) >= 2) continue;
    selectedItems.push(candidate);
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  }
  for (const candidate of fallbackCandidates) {
    if (selectedItems.length >= 5) break;
    if (!selectedItems.some(item => item.article.id === candidate.article.id || sameEvent(item.article, candidate.article))) selectedItems.push(candidate);
  }
  for (const candidate of fallbackCandidates) {
    if (selectedItems.length >= 5) break;
    if (!selectedItems.some(item => item.article.id === candidate.article.id)) selectedItems.push(candidate);
  }
  return selectedItems;
}

function selectedBriefCategories() {
  const current = currentSettings();
  return [...new Set(current.briefWatches)];
}

function watchItems(topic, limit = 10) {
  const normalize = value => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const aliases = {
    innovation: ['innovation', 'start-up', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
    innovations: ['innovation', 'start-up', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
    'recherche scientifique': ['recherche', 'science', 'scientifique', 'laboratoire', 'étude', 'découverte'],
    'progres humains': ['progrès', 'avancée', 'découverte', 'qualité de vie', 'éducation', 'droits humains', 'développement humain'],
    medecine: ['médecine', 'médical', 'santé', 'traitement', 'thérapie', 'vaccin', 'chirurgie'],
    espace: ['espace', 'spatial', 'astronomie', 'nasa', 'esa', 'satellite', 'lune', 'mars'],
    energie: ['énergie', 'électricité', 'nucléaire', 'solaire', 'éolien', 'batterie', 'hydrogène'],
    environnement: ['environnement', 'climat', 'biodiversité', 'pollution', 'écologie'],
    education: ['éducation', 'école', 'université', 'apprentissage', 'formation'],
    vr: ['vr', 'réalité virtuelle', 'virtual reality', 'quest', 'steamvr'],
    ia: ['intelligence artificielle', ' ia ', 'openai', 'chatgpt', 'gemini', 'anthropic']
  };
  const wanted = normalize(topic);
  const terms = [wanted, ...(aliases[wanted] || [])].map(normalize);
  return importanceArticles().filter(article => {
    if (normalize(article.category) === wanted) return true;
    const text = ` ${normalize([article.title, article.summary, article.category, ...(article.tags || []), ...(article.matches || [])].filter(Boolean).join(' '))} `;
    return terms.some(term => term.length >= 2 && text.includes(term));
  }).slice(0, limit);
}

function renderEssential() {
  const items = essentialBrief();
  return `<section class="journal-section"><h2 class="brief-section-title">Les 5 événements majeurs · France & Monde</h2><p class="muted-note">Une sélection resserrée des faits dignes de l’ouverture d’un journal télévisé.</p><div class="feed">${items.length ? items.map(({ article, scope }, index) => `<div class="runtime-essential-item"><span class="brief-scope">${scope}</span>${compactRow(article, index)}</div>`).join('') : '<p class="muted-note">Aucune information majeure récente.</p>'}</div></section>`;
}

function categoryCacheKey(category, items) {
  return `category:${category}:${items.map(item => item.id).join(',')}`;
}

async function requestSummary(key, payload) {
  const cache = readJson(SUMMARY_CACHE_KEY, {});
  if (cache[key]?.summary && !cache[key]?.unavailable && !isUnavailableSummary(cache[key].summary)) return cache[key];
  if (summaryRequests.has(key)) return summaryRequests.get(key);
  const request = fetch('/api/article-summary-groq?v=13', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload)
  }).then(response => response.ok ? response.json() : null)
    .then(data => {
      if (data?.summary && !data?.unavailable && !isUnavailableSummary(data.summary)) {
        const latest = readJson(SUMMARY_CACHE_KEY, {});
        latest[key] = { summary: cleanText(data.summary), ai: Boolean(data.ai), unavailable: false, savedAt: Date.now() };
        const entries = Object.entries(latest).slice(-180);
        writeJson(SUMMARY_CACHE_KEY, Object.fromEntries(entries));
      }
      return data;
    })
    .catch(() => null)
    .finally(() => summaryRequests.delete(key));
  summaryRequests.set(key, request);
  return request;
}

async function loadCategorySummary(category, items) {
  const target = document.querySelector('[data-runtime-category-summary]');
  if (!target) return;
  const key = categoryCacheKey(category, items);
  const result = await requestSummary(key, {
    mode: 'category',
    category,
    articles: items.slice(0, 4).map(article => ({ url: article.url, title: cleanText(article.title), summary: isUnavailableSummary(article.summary) ? '' : cleanText(article.summary) }))
  });
  if (!target.isConnected || target.dataset.summaryKey !== key) return;
  target.textContent = cleanText(result?.summary || 'Résumé indisponible pour cette rubrique.');
  const label = document.querySelector('.runtime-category-summary .brief-label');
  if (label) label.textContent = result?.ai ? `Veille · ${category} · Résumé IA` : `Veille · ${category} · Résumé factuel`;
}

function renderCategories() {
  const categories = selectedBriefCategories();
  if (!categories.length) return '<p class="muted-note">Touchez Personnaliser pour choisir vos veilles.</p>';
  if (!briefCategory || !categories.includes(briefCategory)) briefCategory = categories[0];
  const items = watchItems(briefCategory, 10);
  const summaryItems = items.slice(0, 4);
  const key = categoryCacheKey(briefCategory, summaryItems);
  const cached = readJson(SUMMARY_CACHE_KEY, {})[key];
  return `<div class="brief-category-tabs">${categories.map(category => `<button class="brief-category-tab ${category === briefCategory ? 'active' : ''}" data-brief-category="${esc(category)}">${esc(category)}</button>`).join('')}</div>
    <section class="brief-card runtime-category-summary"><span class="brief-label">Veille · ${esc(briefCategory)}${cached?.ai ? ' · Résumé IA' : ''}</span><h2>Ce qui évolue</h2><p data-runtime-category-summary data-summary-key="${esc(key)}">${esc(cached?.summary || 'Résumé en cours…')}</p></section>
    <div class="feed">${items.length ? items.map((article, index) => compactRow(article, index)).join('') : '<p class="muted-note">Aucun article récent dans cette veille.</p>'}</div>`;
}

function enhanceBrief() {
  if (!document.querySelector('.nav-item.active[data-view="brief"]')) return;
  const page = document.querySelector('.page');
  const topbar = page?.querySelector('.topbar');
  if (!page || !topbar) return;
  const articles = visibleArticles();
  const settings = currentSettings();
  const signature = `${briefMode}|${briefCategory || ''}|${JSON.stringify(settings.briefEssential)}|${JSON.stringify(settings.briefWatches)}|${JSON.stringify(settings.topicPreferences)}|${articles.map(article => article.id).join('|')}`;
  if (page.dataset.runtimeBriefSignature === signature) return;
  page.dataset.runtimeBriefSignature = signature;
  [...page.children].forEach(child => { if (child !== topbar) child.remove(); });
  page.insertAdjacentHTML('beforeend', `<div class="brief-mode-tabs"><button class="brief-mode-tab ${briefMode === 'essential' ? 'active' : ''}" data-brief-mode="essential">L’essentiel</button><button class="brief-mode-tab ${briefMode === 'watches' ? 'active' : ''}" data-brief-mode="watches">Mes veilles</button></div><div class="runtime-brief-content">${briefMode === 'essential' ? renderEssential() : renderCategories()}</div>`);
  if (briefMode === 'watches' && briefCategory) {
    const items = watchItems(briefCategory, 4);
    loadCategorySummary(briefCategory, items);
  }
}

function feedbackMarkup(key) {
  const map = {
    more: ['+', 'Plus comme ça', 'Montre davantage de sujets similaires'],
    less: ['−', 'Moins comme ça', 'Réduis ce type d’articles'],
    not: ['×', 'Pas intéressé', 'Masque les sujets de ce type'],
    follow: ['☆', 'Sujet à suivre', 'Fais remonter ce sujet à l’avenir']
  };
  const [symbol, title, text] = map[key] || ['', key, ''];
  return `<span class="feedback-symbol">${symbol}</span><span class="feedback-copy"><strong>${title}</strong><small>${text}</small></span>`;
}

async function loadArticleSummary(article, box) {
  const key = `article:${article.id}`;
  const cached = readJson(SUMMARY_CACHE_KEY, {})[key];
  const paragraph = box.querySelector('p');
  const label = box.querySelector('strong');
  if (cached?.summary && !cached.unavailable && !isUnavailableSummary(cached.summary)) {
    paragraph.textContent = cleanText(cached.summary);
    label.textContent = cached.ai ? 'Résumé IA' : 'Résumé factuel';
    return;
  }
  paragraph.textContent = 'Résumé en cours…';
  const result = await requestSummary(key, {
    mode: 'article',
    article: {
      url: article.url,
      title: cleanText(article.title),
      summary: isUnavailableSummary(article.summary) ? '' : cleanText(article.summary)
    }
  });
  if (!box.isConnected) return;
  if (result?.unavailable || isUnavailableSummary(result?.summary)) {
    paragraph.textContent = 'Résumé indisponible pour cet article.';
    label.textContent = 'Résumé indisponible';
    return;
  }
  paragraph.textContent = cleanText(result?.summary || 'Résumé indisponible pour cet article.');
  label.textContent = result?.ai ? 'Résumé IA' : 'Résumé factuel';
}

function enhanceDetail() {
  const page = document.querySelector('.detail-page');
  if (!page) return;
  const id = page.querySelector('.save-btn-detail[data-save]')?.dataset.save;
  const article = allCachedArticles().find(item => String(item.id) === String(id || ''));
  if (!article) return;
  if (page.dataset.runtimeDetailId === article.id) return;
  page.dataset.runtimeDetailId = article.id;

  const hero = page.querySelector('.detail-hero');
  if (hero) {
    const image = document.createElement('img');
    image.className = 'detail-hero original-article-image runtime-detail-image stable-visual';
    image.alt = '';
    image.style.backgroundImage = `url("${sourceTileUrl(article)}")`;
    image.style.backgroundSize = 'cover';
    image.onerror = () => { image.onerror = null; image.src = sourceTileUrl(article); };
    image.src = articleVisualUrl(article);
    image.decoding = 'async';
    image.loading = 'eager';
    image.fetchPriority = 'high';
    image.referrerPolicy = 'no-referrer';
    hero.replaceWith(image);
  }

  const summary = page.querySelector('.ai-summary');
  if (summary) {
    summary.classList.add('runtime-summary');
    summary.innerHTML = '<strong>Résumé</strong><p>Résumé en cours…</p>';
    const meta = page.querySelector('.detail-meta');
    if (meta) meta.insertAdjacentElement('afterend', summary);
    loadArticleSummary(article, summary);
  }

  page.querySelector('.feedback-title')?.remove();
  page.querySelectorAll('.feedback-grid [data-feedback]').forEach(button => {
    button.classList.add('runtime-feedback-card');
    button.innerHTML = feedbackMarkup(button.dataset.feedback);
  });
}

function enhanceSheet() {
  const sheet = document.querySelector('.sheet');
  if (!sheet || sheet.classList.contains('personalization-sheet') || sheet.querySelector('.runtime-sheet-tabs')) return;
  const handle = sheet.querySelector('.sheet-handle');
  const tabs = document.createElement('div');
  tabs.className = 'runtime-sheet-tabs';
  tabs.innerHTML = '<button class="runtime-sheet-tab active">Ajouter</button><button class="runtime-sheet-tab" data-runtime-settings>Réglages</button>';
  handle?.insertAdjacentElement('afterend', tabs);
}

function followedTopicsMarkup() {
  const feedback = readJson('news-feedback', {});
  const followedIds = Object.keys(feedback).filter(id => feedback[id] === 'follow');
  if (!followedIds.length) return '<p class="muted-note runtime-no-followed">Aucun sujet marqué « Sujet à suivre ».</p>';
  const byId = new Map(allCachedArticles().map(article => [String(article.id), article]));
  return `<div class="runtime-followed-list">${followedIds.map(id => {
    const article = byId.get(String(id));
    const title = article?.title || 'Sujet suivi';
    return `<div class="runtime-followed-item"><span>${esc(title)}</span><button type="button" data-runtime-follow-delete="${esc(id)}" aria-label="Supprimer ce sujet">×</button></div>`;
  }).join('')}</div>`;
}

function enhanceSettings() {
  const sections = [...document.querySelectorAll('.page .settings-section')];
  if (!sections.length) return;
  document.querySelectorAll('.install-section').forEach(node => node.remove());
  if (document.querySelector('.runtime-followed-section')) return;
  const interests = sections.find(section => /centres d[’']intérêt/i.test(section.querySelector('h2')?.textContent || ''));
  if (!interests) return;
  const section = document.createElement('section');
  section.className = 'settings-section runtime-followed-section';
  section.innerHTML = `<h2>Sujets suivis</h2><p>Les sujets marqués « Sujet à suivre » peuvent être retirés ici.</p>${followedTopicsMarkup()}`;
  interests.insertAdjacentElement('afterend', section);
}

function enhance() {
  scheduled = false;
  removeRedundantUi();
  enhanceHome();
  enhanceBrief();
  enhanceDetail();
  enhanceSheet();
  enhanceSettings();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhance);
}

function openSettingsFromSheet() {
  const backdrop = document.querySelector('.sheet-backdrop[data-close-sheet]');
  if (backdrop) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  setTimeout(() => {
    const app = document.getElementById('app');
    if (!app) return;
    const button = document.createElement('button');
    button.hidden = true;
    button.dataset.view = 'settings';
    app.appendChild(button);
    button.click();
    button.remove();
  }, 0);
}

document.addEventListener('click', event => {
  const more = event.target.closest('[data-home-more]');
  if (more) {
    event.preventDefault();
    event.stopPropagation();
    homeLimit += 36;
    const feed = document.querySelector('.page .feed');
    if (feed) feed.dataset.runtimeSignature = '';
    scheduleEnhance();
    return;
  }
  const deleteFollowed = event.target.closest('[data-runtime-follow-delete]');
  if (deleteFollowed) {
    event.preventDefault();
    event.stopPropagation();
    const feedback = readJson('news-feedback', {});
    delete feedback[deleteFollowed.dataset.runtimeFollowDelete];
    writeJson('news-feedback', feedback);
    window.location.reload();
    return;
  }
  const settings = event.target.closest('[data-runtime-settings]');
  if (settings) {
    event.preventDefault();
    event.stopPropagation();
    openSettingsFromSheet();
    return;
  }
  const mode = event.target.closest('[data-brief-mode]');
  if (mode) {
    event.preventDefault();
    briefMode = mode.dataset.briefMode;
    const page = document.querySelector('.page');
    if (page) page.dataset.runtimeBriefSignature = '';
    scheduleEnhance();
    return;
  }
  const category = event.target.closest('[data-brief-category]');
  if (category) {
    event.preventDefault();
    briefCategory = category.dataset.briefCategory;
    const page = document.querySelector('.page');
    if (page) page.dataset.runtimeBriefSignature = '';
    scheduleEnhance();
  }
}, true);

const root = document.getElementById('app');
if (root) new MutationObserver(scheduleEnhance).observe(root, { childList: true, subtree: true });
window.addEventListener('focus', scheduleEnhance);
window.addEventListener('news-topic-preferences-changed', scheduleEnhance);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleEnhance(); });
scheduleEnhance();
