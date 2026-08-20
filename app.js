import { importOpmlPreview, fetchLiveNews } from './services/source-connectors.js';

const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const toastEl = $('#toast');

const GENERAL_CATEGORIES = ['Politique', 'International', 'Économie', 'Société', 'Santé', 'Environnement', 'Science', 'Culture', 'Éducation', 'Europe'];
const PERSONAL_THEMES = ['IA', 'Tech', 'Smartphones', 'VR', 'Automobile', 'Énergie'];

const categoryMeta = {
  Politique: { icon: 'landmark', label: 'Politique' },
  International: { icon: 'globe', label: 'International' },
  Économie: { icon: 'chart', label: 'Économie' },
  Société: { icon: 'users', label: 'Société' },
  Santé: { icon: 'heart', label: 'Santé' },
  Environnement: { icon: 'leaf', label: 'Environnement' },
  Science: { icon: 'flask', label: 'Science' },
  Culture: { icon: 'book', label: 'Culture' },
  Éducation: { icon: 'school', label: 'Éducation' },
  Europe: { icon: 'globe', label: 'Europe' },
  IA: { icon: 'sparkles', label: 'IA' },
  Tech: { icon: 'cpu', label: 'Tech' },
  Smartphones: { icon: 'smartphone', label: 'Smartphones' },
  VR: { icon: 'glasses', label: 'VR' },
  Automobile: { icon: 'car', label: 'Automobile' },
  Énergie: { icon: 'sun', label: 'Énergie' },
  'À suivre': { icon: 'bookmark', label: 'À suivre' }
};

const defaultSettings = {
  notifications: true,
  webSearch: true,
  sourcePriority: true,
  autoRefresh: true,
  summaryLength: 'court',
  generalCategories: [...GENERAL_CATEGORIES],
  interests: [...PERSONAL_THEMES]
};

function safeJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

const savedSettings = safeJson('news-settings', {});
const cache = safeJson('news-live-cache', { articles: [], fetchedAt: null });
const state = {
  view: 'home', previous: [], category: 'Politique', categoryTab: 'brief', articleId: null,
  saved: new Set(safeJson('news-saved', [])),
  feedback: safeJson('news-feedback', {}),
  sources: safeJson('news-sources', []),
  keywords: safeJson('news-keywords', []),
  articles: Array.isArray(cache.articles) ? cache.articles : [],
  lastSync: cache.fetchedAt || null,
  syncStatus: 'idle', syncError: '', stats: cache.stats || null,
  newsPeriod: 'today', customFrom: todayOffset(-7), customTo: todayOffset(0),
  sheet: false, savedOnly: false, opmlName: 'Aucun fichier importé',
  settings: {
    ...defaultSettings,
    ...savedSettings,
    generalCategories: Array.isArray(savedSettings.generalCategories) ? savedSettings.generalCategories : [...GENERAL_CATEGORIES],
    interests: Array.isArray(savedSettings.interests) ? savedSettings.interests : [...PERSONAL_THEMES]
  }
};

let deferredInstallPrompt = null;
let isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let syncPromise = null;
let toastTimer;

const iconPaths = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  brief: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z"/><path d="M8 2v4M16 2v4M3 9h18"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v7H4V6h7"/>',
  sparkles: '<path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 14l.7 1.8L8 16.5l-2.3.7L5 19l-.7-1.8-2.3-.7 2.3-.7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4M10 10h4v4h-4z"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>',
  glasses: '<path d="M3 8h18l-1 9a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-3h0v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M9 14h6M5 8l2-4M19 8l-2-4"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 15v5h14v-5"/>',
  install: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 18v3h14v-3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h5l2 3h2l2-3h5"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  landmark: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  leaf: '<path d="M20 4C12 4 5 8 5 15c0 3 2 5 5 5 7 0 10-8 10-16Z"/><path d="M4 21c2-5 6-9 12-12"/>',
  book: '<path d="M4 4h6a4 4 0 0 1 4 4v12H8a4 4 0 0 0-4 1z"/><path d="M20 4h-6a4 4 0 0 0-4 4v12h6a4 4 0 0 1 4 1z"/>',
  school: '<path d="M3 10 12 4l9 6-9 6z"/><path d="M7 13v5c3 2 7 2 10 0v-5M21 10v7"/>',
  car: '<path d="M5 17h14l-1-6-2-4H8l-2 4z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 13h18"/>'
};

function icon(name, filled = false) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || iconPaths.sparkles}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function todayOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function timeLabel(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'À l’instant';
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
  if (diffMinutes < 24 * 60) return `Il y a ${Math.floor(diffMinutes / 60)} h`;
  if (diffMinutes < 48 * 60) return `Hier, ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date);
}

function badgeFor(article) {
  if (article.customSource) return 'Source suivie';
  if ((article.tags || []).some(tag => state.keywords.includes(tag))) return 'À suivre';
  if ((article.score || 0) >= 130) return 'Important';
  return 'Nouveau';
}

function articleVisual(article) {
  const meta = categoryMeta[article.category] || categoryMeta.Société;
  return `<div class="article-image article-placeholder">${icon(meta.icon)}<span>${escapeHtml(article.category)}</span></div>`;
}

function allowedCategories() {
  return new Set([...state.settings.generalCategories, ...state.settings.interests, 'À suivre']);
}

function visibleArticles() {
  const allowed = allowedCategories();
  return state.articles
    .filter(article => allowed.has(article.category) && state.feedback[article.id] !== 'not')
    .slice()
    .sort((a, b) => {
      const feedbackScore = article => ({ more: 24, less: -20, follow: 38 }[state.feedback[article.id]] || 0);
      return ((b.score || 0) + feedbackScore(b)) - ((a.score || 0) + feedbackScore(a));
    });
}

function nav(active = state.view) {
  const items = [['home', 'home', 'Accueil'], ['brief', 'brief', 'Brief'], ['sheet', 'plus', 'Ajouter'], ['news', 'calendar', 'Actualité'], ['settings', 'settings', 'Réglages']];
  return `<nav class="bottom-nav" aria-label="Navigation principale">${items.map(([view, ic, label]) => `<button class="nav-item ${view === 'sheet' ? 'plus' : ''} ${active === view ? 'active' : ''}" data-view="${view}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>`;
}

function articleCard(article) {
  const saved = state.saved.has(article.id);
  const badge = badgeFor(article);
  return `<article class="article-card" data-article="${escapeHtml(article.id)}" tabindex="0" aria-label="Lire : ${escapeHtml(article.title)}">
    ${articleVisual(article)}
    <div class="article-body">
      <button class="save-btn ${saved ? 'saved' : ''}" data-save="${escapeHtml(article.id)}" aria-label="${saved ? 'Retirer des sauvegardes' : 'Sauvegarder l’article'}">${icon('bookmark', saved)}</button>
      <div class="card-top"><span class="badge ${badge === 'Important' ? 'important' : ''}">${badge}</span>${article.sources?.length > 1 ? `<span class="merged-count">${article.sources.length} sources</span>` : ''}</div>
      <h2>${escapeHtml(article.title)}</h2>
      <p class="summary">${escapeHtml(article.summary)}</p>
      <div class="meta"><span class="source">${escapeHtml(article.source)}</span><i class="dot"></i><span>${timeLabel(article.publishedAt)}</span><i class="dot"></i><button class="category-link" data-category="${escapeHtml(article.category)}">${escapeHtml(article.category)}</button></div>
    </div>
  </article>`;
}

function topbar(title, back = true, right = '') {
  return `<header class="topbar">${back ? `<button class="icon-btn" data-back aria-label="Retour">${icon('back')}</button>` : '<span></span>'}<h1>${escapeHtml(title)}</h1>${right || '<span></span>'}</header>`;
}

function syncStrip() {
  const label = state.syncStatus === 'loading' ? 'Actualisation…' : state.syncStatus === 'error' ? 'Actualisation impossible' : state.lastSync ? `Mis à jour ${timeLabel(state.lastSync).toLowerCase()}` : 'Première actualisation en cours';
  return `<div class="sync-strip ${state.syncStatus}"><span class="sync-dot"></span><span>${escapeHtml(label)}</span><button data-refresh aria-label="Actualiser maintenant">${icon('refresh')}</button></div>`;
}

function renderHome() {
  const all = visibleArticles();
  const feed = state.savedOnly ? all.filter(article => state.saved.has(article.id)) : all.slice(0, 12);
  return `<main class="page">
    <header class="hero-header"><div class="hero-mark"></div><span class="eyebrow">${escapeHtml(dateLabel())}</span><h1>Mon actualité</h1><p>L’actualité générale, avec vos sujets favoris mis en avant</p></header>
    ${syncStrip()}
    ${state.saved.size ? `<div class="saved-filter"><button class="text-btn" data-saved-filter>${state.savedOnly ? 'Voir toute l’actualité' : 'Articles sauvegardés'}</button></div>` : ''}
    <section class="feed">${feed.length ? feed.map(articleCard).join('') : emptyState(state.syncStatus === 'error' ? 'Impossible de charger l’actualité' : 'Actualisation en cours', state.syncError || 'Les nouveaux articles apparaîtront ici dès que les sources auront répondu.')}</section>
  </main>${nav('home')}`;
}

function categoryArticles(category = state.category) {
  return visibleArticles().filter(article => article.category === category);
}

function categoryBrief(category) {
  const list = categoryArticles(category).slice(0, 5);
  if (!list.length) return `Aucun article récent suffisamment pertinent dans ${category}.`;
  return list.slice(0, 3).map(article => article.summary).filter(Boolean).join(' ');
}

function renderCategory() {
  const meta = categoryMeta[state.category] || { icon: 'bookmark', label: state.category };
  const list = categoryArticles();
  const content = state.categoryTab === 'brief'
    ? `<section class="brief-card"><span class="brief-label">Ce qu’il faut retenir</span><h2>Le point sur ${escapeHtml(state.category)}</h2><p>${escapeHtml(categoryBrief(state.category))}</p><div class="source-list">${[...new Set(list.flatMap(article => article.sources || [article.source]))].slice(0, 5).map(source => `<span class="source-chip">${escapeHtml(source)}</span>`).join('')}</div></section>${list.slice(0, 2).map(articleCard).join('')}`
    : `<section class="feed">${list.length ? list.map(articleCard).join('') : emptyState('Aucun article récent', 'Cette catégorie sera alimentée dès qu’une information récente correspondra.')}</section>`;
  return `<main class="page">${topbar('Catégorie')}
    <section class="title-row"><div class="category-icon">${icon(meta.icon)}</div><h1>${escapeHtml(meta.label)}</h1></section>
    <div class="tabs" role="tablist"><button class="tab ${state.categoryTab === 'brief' ? 'active' : ''}" data-tab="brief">Brief</button><button class="tab ${state.categoryTab === 'all' ? 'active' : ''}" data-tab="all">Tous les articles</button></div>
    <div class="feed">${content}</div>
  </main>${nav('')}`;
}

function renderDetail() {
  const article = state.articles.find(item => item.id === state.articleId);
  if (!article) return `<main class="page">${topbar('Article')}${emptyState('Article indisponible', 'Il n’est plus présent dans le flux actuel.')}</main>${nav('')}`;
  const saved = state.saved.has(article.id);
  const currentFeedback = state.feedback[article.id];
  const meta = categoryMeta[article.category] || categoryMeta.Société;
  return `<main class="page detail-page">${topbar('Article', true, `<button class="icon-btn save-btn-detail ${saved ? 'saved' : ''}" data-save="${escapeHtml(article.id)}" aria-label="Sauvegarder">${icon('bookmark', saved)}</button>`)}
    <div class="detail-hero article-placeholder">${icon(meta.icon)}<span>${escapeHtml(article.category)}</span></div>
    <article class="detail-content"><span class="badge ${badgeFor(article) === 'Important' ? 'important' : ''}">${badgeFor(article)}</span><h1>${escapeHtml(article.title)}</h1>
      <div class="detail-meta">${escapeHtml(article.source)} · ${timeLabel(article.publishedAt)} · <button class="category-link" data-category="${escapeHtml(article.category)}">${escapeHtml(article.category)}</button></div>
      <section class="ai-summary"><strong>${icon('sparkles')} Synthèse</strong><p>${escapeHtml(article.detail || article.summary)}</p></section>
      <div class="tags">${(article.tags || [article.category]).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <a class="primary-btn" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Lire l’article original ${icon('external')}</a>
      <p class="feedback-title">Aidez l’application à mieux hiérarchiser vos sujets</p>
      <div class="feedback-grid">${[['more', 'Plus comme ça'], ['less', 'Moins comme ça'], ['not', 'Pas intéressé'], ['follow', 'Sujet à suivre']].map(([key, label]) => `<button class="${currentFeedback === key ? 'selected' : ''}" data-feedback="${key}" data-id="${escapeHtml(article.id)}">${label}</button>`).join('')}</div>
      ${article.sources?.length > 1 ? `<div class="source-list detail-sources">${article.sources.map(source => `<span class="source-chip">${escapeHtml(source)}</span>`).join('')}</div>` : ''}
    </article>
  </main>${nav('')}`;
}

function renderBrief() {
  const picks = visibleArticles().slice(0, 6);
  const categories = [...new Set(picks.map(article => article.category))].slice(0, 4);
  const global = picks.length ? `Les sujets les plus présents actuellement concernent ${categories.join(', ')}. Les doublons provenant de plusieurs médias sont regroupés dans une seule fiche.` : 'Le brief se construira après la première synchronisation.';
  return `<main class="page">${topbar('Brief du jour', false)}${syncStrip()}
    <section class="date-card"><span class="date">${escapeHtml(dateLabel())}</span><h2>L’essentiel en quelques minutes</h2></section>
    <ol class="brief-points">${picks.map((article, index) => `<li class="brief-point" data-article="${escapeHtml(article.id)}" data-index="${index + 1}"><strong>${escapeHtml(article.title)}</strong><span>${escapeHtml(article.summary)}</span></li>`).join('')}</ol>
    <section class="brief-card"><span class="brief-label">Lecture globale</span><h2>Ce qui ressort du flux</h2><p>${escapeHtml(global)}</p><div class="source-list"><span class="source-chip">${state.stats?.feedsSucceeded ?? '—'} flux lus</span><span class="source-chip">Doublons fusionnés</span></div></section>
  </main>${nav('brief')}`;
}

function periodArticles() {
  const list = visibleArticles();
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const startWeek = startToday - 6 * 86400000;
  const startMonth = startToday - 29 * 86400000;
  if (state.newsPeriod === 'today') return list.filter(article => Date.parse(article.publishedAt) >= startToday);
  if (state.newsPeriod === 'yesterday') return list.filter(article => { const time = Date.parse(article.publishedAt); return time >= startYesterday && time < startToday; });
  if (state.newsPeriod === 'week') return list.filter(article => Date.parse(article.publishedAt) >= startWeek);
  if (state.newsPeriod === 'month') return list.filter(article => Date.parse(article.publishedAt) >= startMonth);
  const from = new Date(`${state.customFrom}T00:00:00`).getTime();
  const to = new Date(`${state.customTo}T23:59:59`).getTime();
  return list.filter(article => { const time = Date.parse(article.publishedAt); return time >= from && time <= to; });
}

function renderNews() {
  const periods = [['today', 'Aujourd’hui'], ['yesterday', 'Hier'], ['week', '7 derniers jours'], ['month', '30 derniers jours'], ['custom', 'Personnalisée']];
  const list = periodArticles();
  return `<main class="page">${topbar('Actualité', false)}${syncStrip()}
    <div class="periods">${periods.map(([key, label]) => `<button class="period ${state.newsPeriod === key ? 'active' : ''}" data-period="${key}">${label}</button>`).join('')}</div>
    ${state.newsPeriod === 'custom' ? `<div class="custom-dates"><label>Du<input type="date" data-date="from" value="${state.customFrom}"></label><label>Au<input type="date" data-date="to" value="${state.customTo}"></label></div>` : ''}
    <section class="feed">${list.length ? list.map(articleCard).join('') : emptyState('Rien sur cette période', 'Aucun article récent ne correspond aux catégories actuellement affichées.')}</section>
  </main>${nav('news')}`;
}

function settingRow(title, description, key) {
  return `<div class="setting-row"><div class="setting-label"><strong>${title}</strong><span>${description}</span></div><button class="switch ${state.settings[key] ? 'on' : ''}" data-setting-toggle="${key}" role="switch" aria-checked="${state.settings[key]}"></button></div>`;
}

function sourceRows() {
  if (!state.sources.length) return '<p class="muted-note">Aucune source personnelle ajoutée. Le flux général reste actif.</p>';
  return `<div class="source-settings-list">${state.sources.map((source, index) => `<div class="source-setting"><button class="source-state ${source.enabled !== false ? 'active' : ''}" data-source-toggle="${index}" aria-label="Activer ou désactiver la source"></button><div><strong>${escapeHtml(source.title)}</strong><span>${escapeHtml(source.url)}</span></div><button class="mini-icon-btn" data-source-delete="${index}" aria-label="Supprimer">${icon('trash')}</button></div>`).join('')}</div>`;
}

function keywordChips() {
  return state.keywords.length ? `<div class="keyword-list">${state.keywords.map((keyword, index) => `<span class="keyword-chip">${escapeHtml(keyword)}<button data-keyword-delete="${index}" aria-label="Supprimer ${escapeHtml(keyword)}">×</button></span>`).join('')}</div>` : '<p class="muted-note">Ajoutez par exemple : espace, Allemagne, archéologie, voitures électriques…</p>';
}

function renderSettings() {
  return `<main class="page">${topbar('Réglages', false)}
    <section class="settings-section install-section"><div class="install-app-icon"><img src="assets/app-icon.svg" alt="" /></div><div class="install-copy"><h2>${isInstalled ? 'Application installée' : 'Installer l’application'}</h2><p>${isInstalled ? 'Mon actualité fonctionne comme une application autonome sur cet appareil.' : 'Ajoutez Mon actualité à Android pour l’ouvrir sans la barre de Chrome.'}</p></div><button class="${isInstalled ? 'secondary-btn' : 'primary-btn'}" data-install ${isInstalled ? 'disabled' : ''}>${isInstalled ? `${icon('check')} Déjà installée` : `${icon('install')} Installer sur cet appareil`}</button></section>

    <section class="settings-section"><h2>Actualisation</h2><p>Les nouveaux articles sont chargés au démarrage, au retour dans l’application et périodiquement lorsqu’elle reste ouverte.</p>${settingRow('Actualisation automatique', 'Toutes les 15 minutes quand l’application est ouverte', 'autoRefresh')}<button class="secondary-btn compact-btn" data-refresh>${icon('refresh')} Actualiser maintenant</button></section>

    <section class="settings-section"><h2>Sources personnelles</h2><p>Elles passent avant les sources généralistes. Vous pouvez ajouter directement une adresse RSS/Atom ou importer un fichier OPML.</p>
      <div class="form-stack"><input id="source-name" class="text-input" type="text" maxlength="80" placeholder="Nom de la source"><input id="source-url" class="text-input" type="url" maxlength="600" placeholder="https://exemple.fr/feed"><button class="secondary-btn" data-add-source>${icon('plus')} Ajouter la source</button></div>
      ${sourceRows()}
      <div class="import-status">${icon('upload')}<span>${escapeHtml(state.opmlName)}</span></div><label class="secondary-btn" for="opml-input">Importer un fichier OPML</label><input id="opml-input" class="file-input" type="file" accept=".opml,.xml">
      ${settingRow('Priorité aux sources', 'Vos flux personnels sont remontés dans la sélection', 'sourcePriority')}${settingRow('Recherche web complémentaire', 'Google Actualités complète les sujets et mots-clés manquants', 'webSearch')}
    </section>

    <section class="settings-section"><h2>Actualité générale</h2><p>Ces rubriques restent présentes même si elles ne font pas partie de vos centres d’intérêt personnels.</p><div class="interest-grid">${GENERAL_CATEGORIES.map(category => `<button class="interest ${state.settings.generalCategories.includes(category) ? 'active' : ''}" data-general-category="${category}">${category}</button>`).join('')}</div></section>

    <section class="settings-section"><h2>Centres d’intérêt</h2><p>Ils servent à mettre certains sujets davantage en avant, sans supprimer l’actualité générale.</p><div class="interest-grid">${PERSONAL_THEMES.map(theme => `<button class="interest ${state.settings.interests.includes(theme) ? 'active' : ''}" data-interest="${theme}">${theme}</button>`).join('')}</div>
      <div class="inline-form"><input id="keyword-input" class="text-input" type="text" maxlength="70" placeholder="Ajouter un mot-clé"><button class="small-primary-btn" data-add-keyword>Ajouter</button></div>${keywordChips()}
    </section>

    <section class="settings-section"><h2>Sélection et résumés</h2><div class="setting-row"><div class="setting-label"><strong>Longueur des résumés</strong><span>Format affiché dans les cartes</span></div><select class="select" data-setting-select="summaryLength"><option value="très court" ${state.settings.summaryLength === 'très court' ? 'selected' : ''}>Très court</option><option value="court" ${state.settings.summaryLength === 'court' ? 'selected' : ''}>Court</option><option value="détaillé" ${state.settings.summaryLength === 'détaillé' ? 'selected' : ''}>Détaillé</option></select></div></section>
    <section class="settings-section"><h2>Notifications</h2>${settingRow('Brief du matin', 'Préférence conservée pour les futures notifications push', 'notifications')}</section>
    <button class="secondary-btn" data-reset>Réinitialiser les préférences</button>
  </main>${nav('settings')}`;
}

function emptyState(title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon('inbox')}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></div>`;
}

function renderSheet() {
  if (!state.sheet) return '';
  const available = [...GENERAL_CATEGORIES, ...PERSONAL_THEMES].filter(category => allowedCategories().has(category));
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-label="Explorer les catégories" data-sheet-panel><div class="sheet-handle"></div><h2>Explorer un sujet</h2><p>Actualité générale et sujets personnels sont réunis ici.</p><div class="category-grid">${available.map(key => { const meta = categoryMeta[key]; return `<button class="category-choice" data-category="${key}">${icon(meta.icon)}<span>${meta.label}</span></button>`; }).join('')}</div></section></div>`;
}

function render() {
  const views = { home: renderHome, category: renderCategory, detail: renderDetail, brief: renderBrief, news: renderNews, settings: renderSettings };
  app.innerHTML = (views[state.view] || renderHome)() + renderSheet();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function navigate(view, additions = {}) {
  if (view !== state.view) state.previous.push({ view: state.view, category: state.category, articleId: state.articleId, categoryTab: state.categoryTab });
  Object.assign(state, { view, ...additions });
  render();
}

function goBack() {
  const prior = state.previous.pop();
  if (prior) Object.assign(state, prior); else state.view = 'home';
  render();
}

function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function persist() {
  localStorage.setItem('news-saved', JSON.stringify([...state.saved]));
  localStorage.setItem('news-feedback', JSON.stringify(state.feedback));
  localStorage.setItem('news-settings', JSON.stringify(state.settings));
  localStorage.setItem('news-sources', JSON.stringify(state.sources));
  localStorage.setItem('news-keywords', JSON.stringify(state.keywords));
}

function persistCache() {
  localStorage.setItem('news-live-cache', JSON.stringify({ articles: state.articles, fetchedAt: state.lastSync, stats: state.stats }));
}

async function syncNews({ silent = false } = {}) {
  if (syncPromise) return syncPromise;
  state.syncStatus = 'loading'; state.syncError = '';
  if (!silent || state.view !== 'detail') render();
  syncPromise = (async () => {
    try {
      const result = await fetchLiveNews({
        sources: state.sources.filter(source => source.enabled !== false),
        keywords: state.keywords,
        preferredCategories: state.settings.interests,
        webSearch: state.settings.webSearch,
        sourcePriority: state.settings.sourcePriority
      });
      state.articles = Array.isArray(result.articles) ? result.articles : [];
      state.lastSync = result.fetchedAt || new Date().toISOString();
      state.stats = result.stats || null;
      state.syncStatus = 'idle';
      persistCache();
      render();
      if (!silent) toast(`${state.articles.length} article${state.articles.length > 1 ? 's' : ''} actualisé${state.articles.length > 1 ? 's' : ''}`);
    } catch (error) {
      state.syncStatus = 'error';
      state.syncError = error?.message || 'Connexion impossible';
      render();
      if (!silent) toast('Actualisation impossible');
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

function addSource() {
  const name = $('#source-name')?.value.trim();
  const url = $('#source-url')?.value.trim();
  if (!url || !/^https?:\/\//i.test(url)) return toast('Saisissez une adresse RSS ou Atom valide');
  if (state.sources.some(source => source.url === url)) return toast('Cette source est déjà ajoutée');
  state.sources.push({ id: crypto.randomUUID ? crypto.randomUUID() : `feed-${Date.now()}`, title: name || new URL(url).hostname, url, enabled: true });
  persist(); render(); toast('Source ajoutée'); syncNews({ silent: true });
}

function addKeyword() {
  const value = $('#keyword-input')?.value.trim();
  if (!value) return;
  if (state.keywords.some(keyword => keyword.toLowerCase() === value.toLowerCase())) return toast('Ce mot-clé est déjà suivi');
  state.keywords.push(value);
  persist(); render(); toast('Centre d’intérêt ajouté'); syncNews({ silent: true });
}

app.addEventListener('click', async event => {
  const save = event.target.closest('[data-save]');
  if (save) {
    event.preventDefault(); event.stopPropagation();
    const id = save.dataset.save;
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    persist(); render(); return;
  }
  const category = event.target.closest('[data-category]');
  if (category) { event.preventDefault(); event.stopPropagation(); state.sheet = false; navigate('category', { category: category.dataset.category, categoryTab: 'brief' }); return; }
  const article = event.target.closest('[data-article]');
  if (article) { navigate('detail', { articleId: article.dataset.article }); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    const view = viewButton.dataset.view;
    if (view === 'sheet') { state.sheet = true; render(); } else navigate(view, { savedOnly: false });
    return;
  }
  if (event.target.closest('[data-back]')) { goBack(); return; }
  if (event.target.closest('[data-refresh]')) { await syncNews(); return; }
  if (event.target.closest('[data-add-source]')) { addSource(); return; }
  if (event.target.closest('[data-add-keyword]')) { addKeyword(); return; }

  const sourceToggle = event.target.closest('[data-source-toggle]');
  if (sourceToggle) { const source = state.sources[Number(sourceToggle.dataset.sourceToggle)]; if (source) source.enabled = source.enabled === false; persist(); render(); syncNews({ silent: true }); return; }
  const sourceDelete = event.target.closest('[data-source-delete]');
  if (sourceDelete) { state.sources.splice(Number(sourceDelete.dataset.sourceDelete), 1); persist(); render(); toast('Source supprimée'); syncNews({ silent: true }); return; }
  const keywordDelete = event.target.closest('[data-keyword-delete]');
  if (keywordDelete) { state.keywords.splice(Number(keywordDelete.dataset.keywordDelete), 1); persist(); render(); syncNews({ silent: true }); return; }

  const tab = event.target.closest('[data-tab]');
  if (tab) { state.categoryTab = tab.dataset.tab; render(); return; }
  const period = event.target.closest('[data-period]');
  if (period) { state.newsPeriod = period.dataset.period; render(); return; }
  const feedback = event.target.closest('[data-feedback]');
  if (feedback) { state.feedback[feedback.dataset.id] = feedback.dataset.feedback; persist(); toast('Préférence enregistrée'); render(); return; }
  const toggle = event.target.closest('[data-setting-toggle]');
  if (toggle) { const key = toggle.dataset.settingToggle; state.settings[key] = !state.settings[key]; persist(); render(); if (['webSearch', 'sourcePriority'].includes(key)) syncNews({ silent: true }); return; }
  const interest = event.target.closest('[data-interest]');
  if (interest) { const name = interest.dataset.interest; const current = new Set(state.settings.interests); current.has(name) ? current.delete(name) : current.add(name); state.settings.interests = [...current]; persist(); render(); syncNews({ silent: true }); return; }
  const general = event.target.closest('[data-general-category]');
  if (general) { const name = general.dataset.generalCategory; const current = new Set(state.settings.generalCategories); current.has(name) ? current.delete(name) : current.add(name); state.settings.generalCategories = [...current]; persist(); render(); return; }
  if (event.target.closest('[data-saved-filter]')) { state.savedOnly = !state.savedOnly; render(); return; }
  if (event.target.closest('[data-reset]')) { state.settings = { ...defaultSettings, generalCategories: [...GENERAL_CATEGORIES], interests: [...PERSONAL_THEMES] }; state.keywords = []; persist(); render(); toast('Préférences réinitialisées'); syncNews({ silent: true }); return; }
  if (event.target.closest('[data-install]')) {
    if (isInstalled) return toast('L’application est déjà installée');
    if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); const choice = await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; toast(choice.outcome === 'accepted' ? 'Installation lancée' : 'Installation annulée'); }
    else toast('Dans Chrome : menu ⋮ puis Installer l’application');
    return;
  }
  if (event.target.closest('[data-close-sheet]') && !event.target.closest('[data-sheet-panel]')) { state.sheet = false; render(); }
});

app.addEventListener('change', async event => {
  if (event.target.matches('[data-date]')) { state[event.target.dataset.date === 'from' ? 'customFrom' : 'customTo'] = event.target.value; render(); }
  if (event.target.matches('[data-setting-select]')) { state.settings[event.target.dataset.settingSelect] = event.target.value; persist(); toast('Réglage enregistré'); }
  if (event.target.id === 'opml-input' && event.target.files[0]) {
    const file = event.target.files[0];
    try {
      const preview = await importOpmlPreview(file);
      const existing = new Set(state.sources.map(source => source.url));
      const added = preview.feeds.filter(feed => !existing.has(feed.url));
      state.sources.push(...added);
      state.opmlName = `${file.name} · ${added.length} nouvelle${added.length > 1 ? 's' : ''} source${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''}`;
      persist(); render(); toast('Sources OPML enregistrées'); syncNews({ silent: true });
    } catch {
      state.opmlName = `${file.name} · format non reconnu`; render(); toast('Impossible de lire ce fichier OPML');
    }
  }
});

app.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-article]')) event.target.click();
  if (event.key === 'Enter' && event.target.id === 'keyword-input') addKeyword();
  if (event.key === 'Enter' && event.target.id === 'source-url') addSource();
  if (event.key === 'Escape' && state.sheet) { state.sheet = false; render(); }
});

let serviceWorkerRefreshing = false;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (serviceWorkerRefreshing) return;
    serviceWorkerRefreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferredInstallPrompt = event;
  if (state.view === 'settings') render();
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; isInstalled = true; render(); toast('Mon actualité est installée'); });
window.addEventListener('online', () => syncNews({ silent: true }));
window.addEventListener('focus', () => { if (!state.lastSync || Date.now() - Date.parse(state.lastSync) > 5 * 60 * 1000) syncNews({ silent: true }); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!state.lastSync || Date.now() - Date.parse(state.lastSync) > 5 * 60 * 1000)) syncNews({ silent: true }); });

setInterval(() => { if (state.settings.autoRefresh && !document.hidden && navigator.onLine) syncNews({ silent: true }); }, 15 * 60 * 1000);

render();
syncNews({ silent: true });
