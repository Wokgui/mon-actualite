const GENERAL = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe'];
const PERSONAL = ['IA','Tech','Smartphones','VR','Automobile','Énergie'];
const FRANCE_CATEGORIES = ['Politique','Économie','Société','Santé','Éducation','Environnement','Culture','Tech'];
const WORLD_CATEGORIES = ['International','Europe'];
let scheduled = false;
let briefMode = 'essential';
let briefCategory = null;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
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

function visibleArticles() {
  const cache = readJson('news-live-cache', {});
  const articles = Array.isArray(cache.articles) ? cache.articles : [];
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

function compactRow(article) {
  return `<article class="article-card runtime-row" data-article="${esc(article.id)}" tabindex="0" aria-label="Lire : ${esc(article.title)}">
    <div class="article-image article-placeholder" aria-hidden="true"></div>
    <div class="article-body">
      <h2>${esc(article.title)}</h2>
      <div class="meta"><span class="source">${esc(article.source || 'Source')}</span><span>${esc(timeLabel(article.publishedAt))}</span></div>
    </div>
  </article>`;
}

function removeRedundantUi() {
  document.querySelectorAll('.sync-strip').forEach(node => node.remove());
  document.querySelectorAll('.install-section').forEach(node => node.remove());
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    nav.querySelector('[data-view="news"]')?.remove();
    nav.classList.add('nav-four');
  });
}

function enhanceHome() {
  if (!document.querySelector('.nav-item.active[data-view="home"]')) return;
  const savedButton = document.querySelector('.saved-filter [data-saved-filter]');
  if (savedButton && /voir toute/i.test(savedButton.textContent || '')) return;
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const articles = visibleArticles();
  const signature = articles.map(article => article.id).join('|');
  if (feed.dataset.runtimeSignature === signature) return;
  feed.dataset.runtimeSignature = signature;
  if (articles.length) feed.innerHTML = articles.map(compactRow).join('');
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

function categorySummary(category) {
  const items = importanceArticles().filter(article => article.category === category).slice(0, 3);
  const texts = items.map(article => String(article.summary || '').trim()).filter(Boolean);
  if (!texts.length) return `Pas de fait marquant suffisamment récent dans ${category}.`;
  const joined = texts.join(' ');
  return joined.length > 520 ? `${joined.slice(0, 517).trim()}…` : joined;
}

function renderEssential() {
  const { france, world } = essentialBrief();
  const section = (title, items) => `<section class="journal-section"><h2 class="brief-section-title">${title}</h2><div class="feed">${items.length ? items.map(compactRow).join('') : '<p class="muted-note">Aucune information majeure récente.</p>'}</div></section>`;
  return `${section('France', france)}${section('Monde', world)}`;
}

function renderCategories() {
  const categories = selectedBriefCategories();
  if (!categories.length) return '<p class="muted-note">Choisissez des rubriques dans Réglages.</p>';
  if (!briefCategory || !categories.includes(briefCategory)) briefCategory = categories[0];
  const items = visibleArticles().filter(article => article.category === briefCategory).slice(0, 8);
  return `<div class="brief-category-tabs">${categories.map(category => `<button class="brief-category-tab ${category === briefCategory ? 'active' : ''}" data-brief-category="${esc(category)}">${esc(category)}</button>`).join('')}</div>
    <section class="brief-card runtime-category-summary"><span class="brief-label">${esc(briefCategory)}</span><h2>En bref</h2><p>${esc(categorySummary(briefCategory))}</p></section>
    <div class="feed">${items.length ? items.map(compactRow).join('') : '<p class="muted-note">Aucun article récent dans cette rubrique.</p>'}</div>`;
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
}

function enhanceSettings() {
  if (!document.querySelector('.nav-item.active[data-view="settings"]')) return;
  document.querySelectorAll('.install-section').forEach(node => node.remove());
}

function enhance() {
  scheduled = false;
  removeRedundantUi();
  enhanceHome();
  enhanceBrief();
  enhanceSettings();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhance);
}

document.addEventListener('click', event => {
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