const GENERAL = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe'];
const PERSONAL = ['IA','Tech','Smartphones','VR','Automobile','Énergie'];
const FRANCE_CATEGORIES = ['Politique','Économie','Société','Santé','Éducation','Environnement','Culture','Tech'];
const WORLD_CATEGORIES = ['International','Europe'];
const SUMMARY_CACHE_KEY = 'news-article-summaries-v4';
const IMAGE_CACHE_KEY = 'news-original-images-v3-no-google-logo';
let scheduled = false;
let briefMode = 'essential';
let briefCategory = null;
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
    interests: Array.isArray(raw.interests) ? raw.interests : PERSONAL
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
  const allowed = new Set([...current.general, ...current.interests, 'À suivre']);
  return articles
    .filter(article => allowed.has(article.category) && feedback[article.id] !== 'not')
    .slice()
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
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

function validImageUrl(value = '') {
  try {
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|brandmark|site-logo|google[-_ ]?news|googlenews|google_actualites|google-actualites)/i.test(haystack)) return '';
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
    return url.href;
  } catch {
    return '';
  }
}

function cachedImageUrl(article) {
  const cache = readJson(IMAGE_CACHE_KEY, {});
  return validImageUrl(cache[String(article?.id || '')]);
}

function directImageUrl(article) {
  return cachedImageUrl(article) || validImageUrl(article?.image);
}

function thumbnailUrl(article) {
  return `/api/article-thumbnail?v=3&url=${encodeURIComponent(article?.url || '')}`;
}

function rowImageMarkup(article, index = 0) {
  const direct = directImageUrl(article);
  const priority = index < 6;
  const fallback = thumbnailUrl(article);
  if (direct) {
    return `<img class="article-image original-article-image direct-thumb" src="${esc(direct)}" data-thumbnail-fallback="${esc(fallback)}" alt="" loading="${priority ? 'eager' : 'lazy'}" decoding="async" ${priority ? 'fetchpriority="high"' : ''} referrerpolicy="no-referrer">`;
  }
  return `<div class="article-image article-placeholder runtime-image-placeholder" data-image-priority="${priority ? 'high' : 'auto'}"></div>`;
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
    nav.replaceChildren(home, plus, brief);
    nav.classList.remove('nav-four');
    nav.classList.add('nav-three');
  });
}

function enhanceHome() {
  if (!document.querySelector('.nav-item.active[data-view="home"]')) return;
  const subtitle = document.querySelector('.hero-header p');
  if (subtitle) subtitle.textContent = 'Sélection du jour';
  const savedButton = document.querySelector('.saved-filter [data-saved-filter]');
  if (savedButton && /voir toute/i.test(savedButton.textContent || '')) return;
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const articles = visibleArticles();
  const signature = articles.map(article => article.id).join('|');
  if (feed.dataset.runtimeSignature === signature) return;
  feed.dataset.runtimeSignature = signature;
  if (articles.length) feed.innerHTML = articles.map((article, index) => compactRow(article, index)).join('');
}

function pickDiverse(source, categories, limit) {
  const selected = [];
  const used = new Set();
  for (const category of categories) {
    const article = source.find(item => item.category === category && !used.has(item.id));
    if (article) { selected.push(article); used.add(article.id); }
    if (selected.length >= limit) return selected;
  }
  for (const article of source) {
    if (!categories.includes(article.category) || used.has(article.id)) continue;
    selected.push(article); used.add(article.id);
    if (selected.length >= limit) break;
  }
  return selected;
}

function essentialBrief() {
  const ranked = importanceArticles();
  const recent = ranked.filter(article => Date.now() - Date.parse(article.publishedAt || 0) <= 72 * 3600000);
  const pool = recent.length >= 6 ? recent : ranked;
  return {
    france: pickDiverse(pool, FRANCE_CATEGORIES, 5),
    world: pickDiverse(pool, WORLD_CATEGORIES, 5)
  };
}

function selectedBriefCategories() {
  const current = currentSettings();
  return [...new Set([...current.general, ...current.interests])];
}

function renderEssential() {
  const { france, world } = essentialBrief();
  const section = (title, items) => `<section class="journal-section"><h2 class="brief-section-title">${title}</h2><div class="feed">${items.length ? items.map((article, index) => compactRow(article, index)).join('') : '<p class="muted-note">Aucune information majeure récente.</p>'}</div></section>`;
  return `${section('France', france)}${section('Monde', world)}`;
}

function categoryCacheKey(category, items) {
  return `category:${category}:${items.map(item => item.id).join(',')}`;
}

async function requestSummary(key, payload) {
  const cache = readJson(SUMMARY_CACHE_KEY, {});
  if (cache[key]?.summary && !cache[key]?.unavailable && !isUnavailableSummary(cache[key].summary)) return cache[key];
  if (summaryRequests.has(key)) return summaryRequests.get(key);
  const request = fetch('/api/article-summary?v=4', {
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
  if (label) label.textContent = result?.ai ? `${category} · Résumé IA` : `${category} · Résumé factuel`;
}

function renderCategories() {
  const categories = selectedBriefCategories();
  if (!categories.length) return '<p class="muted-note">Choisissez des rubriques dans Réglages.</p>';
  if (!briefCategory || !categories.includes(briefCategory)) briefCategory = categories[0];
  const items = importanceArticles().filter(article => article.category === briefCategory).slice(0, 8);
  const summaryItems = items.slice(0, 4);
  const key = categoryCacheKey(briefCategory, summaryItems);
  const cached = readJson(SUMMARY_CACHE_KEY, {})[key];
  return `<div class="brief-category-tabs">${categories.map(category => `<button class="brief-category-tab ${category === briefCategory ? 'active' : ''}" data-brief-category="${esc(category)}">${esc(category)}</button>`).join('')}</div>
    <section class="brief-card runtime-category-summary"><span class="brief-label">${esc(briefCategory)}${cached?.ai ? ' · Résumé IA' : ''}</span><h2>En bref</h2><p data-runtime-category-summary data-summary-key="${esc(key)}">${esc(cached?.summary || 'Résumé en cours…')}</p></section>
    <div class="feed">${items.length ? items.map((article, index) => compactRow(article, index)).join('') : '<p class="muted-note">Aucun article récent dans cette rubrique.</p>'}</div>`;
}

function enhanceBrief() {
  if (!document.querySelector('.nav-item.active[data-view="brief"]')) return;
  const page = document.querySelector('.page');
  const topbar = page?.querySelector('.topbar');
  if (!page || !topbar) return;
  const articles = visibleArticles();
  const signature = `${briefMode}|${briefCategory || ''}|${articles.map(article => article.id).join('|')}`;
  if (page.dataset.runtimeBriefSignature === signature) return;
  page.dataset.runtimeBriefSignature = signature;
  [...page.children].forEach(child => { if (child !== topbar) child.remove(); });
  page.insertAdjacentHTML('beforeend', `<div class="brief-mode-tabs"><button class="brief-mode-tab ${briefMode === 'essential' ? 'active' : ''}" data-brief-mode="essential">Essentiel</button><button class="brief-mode-tab ${briefMode === 'categories' ? 'active' : ''}" data-brief-mode="categories">Mes rubriques</button></div><div class="runtime-brief-content">${briefMode === 'essential' ? renderEssential() : renderCategories()}</div>`);
  if (briefMode === 'categories' && briefCategory) {
    const items = importanceArticles().filter(article => article.category === briefCategory).slice(0, 4);
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
    image.className = 'detail-hero original-article-image runtime-detail-image direct-thumb';
    image.alt = '';
    const direct = directImageUrl(article);
    image.src = direct || thumbnailUrl(article);
    image.dataset.thumbnailFallback = thumbnailUrl(article);
    image.decoding = 'async';
    image.loading = 'eager';
    image.fetchPriority = 'high';
    if (direct) image.referrerPolicy = 'no-referrer';
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
  if (!sheet || sheet.querySelector('.runtime-sheet-tabs')) return;
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

document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains('direct-thumb')) return;
  const fallback = image.dataset.thumbnailFallback;
  if (!fallback || image.dataset.fallbackApplied === '1' || image.src.includes('/api/article-thumbnail')) return;
  image.dataset.fallbackApplied = '1';
  image.removeAttribute('referrerpolicy');
  image.src = fallback;
}, true);

document.addEventListener('click', event => {
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleEnhance(); });
scheduleEnhance();