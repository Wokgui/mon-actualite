import { importOpmlPreview, fetchLiveNews } from './services/source-connectors.js?v=91.82';
import { articleVisualUrl, hasPreparedVisual, sourceTileUrl } from './services/article-visuals.js?v=57';

const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const toastEl = $('#toast');
const APP_VERSION = '71';
const APP_RELEASE = '24 septembre 2026';
document.documentElement.dataset.appVersion = APP_VERSION;

const GENERAL_CATEGORIES = ['Politique', 'International', 'Économie', 'Société', 'Santé', 'Environnement', 'Science', 'Culture', 'Éducation', 'Europe'];
const PERSONAL_THEMES = ['IA', 'Tech', 'Smartphones', 'VR', 'Automobile', 'Énergie'];
const WATCH_TOPICS = ['Recherche scientifique', 'Innovations', 'Progrès humains', 'Médecine', 'Espace', 'IA', 'VR', 'Tech', 'Énergie', 'Environnement', 'Mobilité', 'Éducation'];
const DEFAULT_WATCH_TOPICS = ['Recherche scientifique', 'Innovations', 'Progrès humains', 'Médecine', 'Espace', 'IA', 'Énergie', 'Environnement', 'Éducation'];
// v3 deliberately drops the old persisted failure markers. A single transient
// miss used to freeze a source tile for six hours, even when the exact image
// became available a few seconds later.
const VISUAL_BACKFILL_KEY = 'news-visual-backfill-v3';
const VISUAL_BACKFILL_MAX_AGE = 30 * 86400000;
const VISUAL_BACKFILL_RETRY_DELAY = 90 * 1000;
const VISUAL_BACKFILL_MAX_ATTEMPTS = 2;

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
  interests: [...PERSONAL_THEMES],
  briefEssentialCategories: [...GENERAL_CATEGORIES],
  briefWatchTopics: [...DEFAULT_WATCH_TOPICS]
};

function safeJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

const savedSettings = safeJson('news-settings', {});
const cache = safeJson('news-live-cache', { articles: [], fetchedAt: null });
const visualBackfills = safeJson(VISUAL_BACKFILL_KEY, {});
const state = {
  view: 'home', previous: [], category: 'Politique', categoryTab: 'brief', articleId: null,
  briefMode: 'essential', homeLimit: 36, homeOrder: [],
  saved: new Set(safeJson('news-saved', [])),
  feedback: safeJson('news-feedback', {}),
  topicPreferences: safeJson('news-topic-preferences-v1', {}),
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
    interests: Array.isArray(savedSettings.interests) ? savedSettings.interests : [...PERSONAL_THEMES],
    briefEssentialCategories: Array.isArray(savedSettings.briefEssentialCategories) ? savedSettings.briefEssentialCategories : [...GENERAL_CATEGORIES],
    briefWatchTopics: Array.isArray(savedSettings.briefWatchTopics) ? savedSettings.briefWatchTopics : [...DEFAULT_WATCH_TOPICS]
  }
};

let deferredInstallPrompt = null;
let isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let syncPromise = null;
let toastTimer;
let visualBackfillTimer = null;
let visualBackfillRunning = false;

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

function displayTitle(article = {}) {
  const title = String(article.title || '').replace(/\s+/g, ' ').trim();
  const source = String(article.source || '').replace(/\s+/g, ' ').trim();
  if (!title || !source) return title;
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*(?:[-–—|·:]\\s*)${escapedSource}\\s*$`, 'i'), '').trim();
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

function articleDateTimeLabel(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
  }).format(date);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} à ${time}`;
}

function badgeFor(article) {
  if (article.customSource) return 'Source suivie';
  const tags = Array.isArray(article.tags) ? article.tags : (typeof article.tags === 'string' ? [article.tags] : []);
  if (tags.some(tag => state.keywords.includes(tag))) return 'À suivre';
  if ((article.score || 0) >= 130) return 'Important';
  return 'Nouveau';
}

function articleVisual(article, index = 0) {
  const prepared = hasPreparedVisual(article);
  const tile = sourceTileUrl(article);
  return `<img class="article-image original-article-image stable-visual ${prepared ? 'prepared-visual' : 'source-tile-visual'}" src="${escapeHtml(articleVisualUrl(article))}" alt="" width="400" height="224" loading="${index < 4 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" style="background-image:url('${escapeHtml(tile)}');background-size:cover" ${index < 4 ? 'fetchpriority="high"' : ''}>`;
}

function visibleArticles() {
  const blocked = safeJson('news-blocked-terms-v1', []).map(normalizeTopic).filter(term => term.length >= 2);
  return state.articles
    .filter(article => article && typeof article === 'object')
    .filter(article => {
      if (state.feedback[article.id] === 'not') return false;
      if (!blocked.length) return true;
      const tags = Array.isArray(article.tags) ? article.tags : (typeof article.tags === 'string' ? [article.tags] : []);
      const text = normalizeTopic([article.title, article.summary, article.detail, article.category, article.source, ...tags].filter(Boolean).join(' '));
      return !blocked.some(term => text.includes(term));
    })
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.publishedAt || a.date || '') || 0;
      const bTime = Date.parse(b.publishedAt || b.date || '') || 0;
      if (bTime !== aTime) return bTime - aTime;
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    });
}

function diversifyBySource(articles) {
  const groups = new Map();
  articles.forEach((article, index) => {
    const source = normalizeTopic(article.source || article.feedTitle || 'source') || 'source';
    if (!groups.has(source)) groups.set(source, { first: index, items: [] });
    groups.get(source).items.push(article);
  });
  if (groups.size < 2) return articles;
  const queue = [...groups.values()].sort((a, b) => a.first - b.first);
  const result = [];
  while (queue.length) {
    const group = queue.shift();
    const article = group.items.shift();
    if (article) result.push(article);
    if (group.items.length) queue.push(group);
  }
  return result;
}

function reconcileHomeOrder() {
  const ordered = visibleArticles();
  state.homeOrder = ordered.map(article => String(article.id));
  return ordered;
}

function stableHomeArticles() {
  return visibleArticles();
}

function nav(active = state.view) {
  const items = [['home', 'home', 'Accueil'], ['sheet', 'plus', 'Personnaliser'], ['brief', 'brief', 'Brief']];
  return `<nav class="bottom-nav" aria-label="Navigation principale">${items.map(([view, ic, label]) => `<button class="nav-item ${view === 'sheet' ? 'plus' : ''} ${active === view ? 'active' : ''}" data-view="${view}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>`;
}

function articleCard(article, index = 0) {
  const saved = state.saved.has(article.id);
  const badge = badgeFor(article);
  const title = displayTitle(article);
  return `<article class="article-card" data-article="${escapeHtml(article.id)}" tabindex="0" aria-label="Lire : ${escapeHtml(title)}">
    ${articleVisual(article, index)}
    <div class="article-body">
      <button class="save-btn ${saved ? 'saved' : ''}" data-save="${escapeHtml(article.id)}" aria-label="${saved ? 'Retirer des sauvegardes' : 'Sauvegarder l’article'}">${icon('bookmark', saved)}</button>
      <div class="card-top"><span class="badge ${badge === 'Important' ? 'important' : ''}">${badge}</span></div>
      <h2>${escapeHtml(title)}</h2>
      <p class="summary">${escapeHtml(article.summary)}</p>
      <div class="meta"><span class="source">${escapeHtml(article.source)}</span><i class="dot"></i><span>${timeLabel(article.publishedAt)}</span><i class="dot"></i><button class="category-link" data-category="${escapeHtml(article.category)}">${escapeHtml(article.category)}</button></div>
    </div>
  </article>`;
}

function topbar(title, back = true, right = '') {
  return `<header class="topbar">${back ? `<button class="icon-btn" data-back aria-label="Retour">${icon('back')}</button>` : '<span></span>'}<h1>${escapeHtml(title)}</h1>${right || '<span></span>'}</header>`;
}

function syncStrip() {
  const label = state.syncStatus === 'loading' ? 'Actualisation…' : state.syncStatus === 'error' ? 'Actualisation impossible' : state.lastSync ? `Mis à jour ${timeLabel(state.lastSync).toLowerCase()}` : 'Chargement des dernières actualités';
  return `<div class="sync-strip ${state.syncStatus}"><span class="sync-dot"></span><span>${escapeHtml(label)}</span></div>`;
}

function renderHome() {
  const all = stableHomeArticles();
  const filtered = state.savedOnly ? all.filter(article => state.saved.has(article.id)) : all;
  const feed = filtered.slice(0, state.homeLimit);
  const remaining = Math.max(0, filtered.length - feed.length);
  return `<button type="button" class="top-reset-icon-v9138" data-reset-read aria-label="Réinitialiser les articles parcourus" title="Réinitialiser">↻</button><main class="page">
    <header class="hero-header"><div class="hero-mark"></div><span class="eyebrow">${escapeHtml(dateLabel())}</span><h1>Mon actualité</h1><p>Tous les articles, classés selon vos centres d’intérêt</p></header>
    ${state.saved.size ? `<div class="saved-filter"><button class="text-btn" data-saved-filter>${state.savedOnly ? 'Voir toute l’actualité' : 'Articles sauvegardés'}</button></div>` : ''}
    <section class="feed stable-owned-list" data-stable-home-feed>${feed.length ? feed.map(articleCard).join('') : emptyState(state.syncStatus === 'error' ? 'Impossible de charger l’actualité' : 'Actualisation en cours', state.syncError || 'Les nouveaux articles apparaîtront ici dès que les sources auront répondu.')}${remaining ? `<button type="button" class="home-more" data-home-more>Afficher ${Math.min(36, remaining)} articles de plus <small>${remaining} encore disponibles</small></button>` : ''}</section>
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
      <div class="detail-meta">${escapeHtml(article.source)} · ${articleDateTimeLabel(article.publishedAt)} · <button class="category-link" data-category="${escapeHtml(article.category)}">${escapeHtml(article.category)}</button></div>
      <section class="ai-summary source-excerpt"><strong>${icon('book')} Aperçu fourni par la source</strong><p>${escapeHtml(article.summary || 'Consultez l’article original pour lire le contenu complet.')}</p></section>
      <div class="tags">${(article.tags || [article.category]).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <a class="primary-btn" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Lire l’article original ${icon('external')}</a>
      <p class="feedback-title">Aidez l’application à mieux hiérarchiser vos sujets</p>
      <div class="feedback-grid">${[['more', 'Plus comme ça'], ['less', 'Moins comme ça'], ['not', 'Pas intéressé'], ['follow', 'Sujet à suivre']].map(([key, label]) => `<button class="${currentFeedback === key ? 'selected' : ''}" data-feedback="${key}" data-id="${escapeHtml(article.id)}">${label}</button>`).join('')}</div>
      ${article.sources?.length > 1 ? `<div class="source-list detail-sources">${article.sources.map(source => `<span class="source-chip">${escapeHtml(source)}</span>`).join('')}</div>` : ''}
    </article>
  </main>${nav('')}`;
}

const WATCH_ALIASES = {
  'recherche scientifique': ['recherche', 'science', 'scientifique', 'laboratoire', 'etude', 'decouverte'],
  innovations: ['innovation', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
  innovation: ['innovation', 'startup', 'brevet', 'recherche', 'nouvelle technologie'],
  'progres humains': ['progres', 'avancee', 'decouverte', 'qualite de vie', 'education', 'droits humains'],
  medecine: ['medecine', 'medical', 'sante', 'traitement', 'therapie', 'vaccin', 'chirurgie'],
  espace: ['espace', 'spatial', 'astronomie', 'nasa', 'esa', 'satellite', 'lune', 'mars'],
  energie: ['energie', 'electricite', 'nucleaire', 'solaire', 'eolien', 'batterie', 'hydrogene'],
  environnement: ['environnement', 'climat', 'biodiversite', 'pollution', 'ecologie'],
  education: ['education', 'ecole', 'universite', 'apprentissage', 'formation'],
  vr: ['vr', 'realite virtuelle', 'virtual reality', 'quest', 'steamvr'],
  ia: ['ia', 'intelligence artificielle', 'openai', 'chatgpt', 'gemini', 'anthropic']
};

function normalizeTopic(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueTopics(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    const key = normalizeTopic(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function watchMatches(article, topic) {
  const wanted = normalizeTopic(topic);
  if (normalizeTopic(article.category) === wanted) return true;
  const tags = Array.isArray(article.tags) ? article.tags : (typeof article.tags === 'string' ? [article.tags] : []);
  const matches = Array.isArray(article.matches) ? article.matches : (typeof article.matches === 'string' ? [article.matches] : []);
  const text = ` ${normalizeTopic([article.title, article.summary, article.detail, article.category, article.source, ...tags, ...matches].filter(Boolean).join(' '))} `;
  return uniqueTopics([wanted, ...(WATCH_ALIASES[wanted] || [])]).map(normalizeTopic).some(term => term.length <= 3 && !term.includes(' ') ? text.includes(` ${term} `) : text.includes(term));
}

function dayDelta(value) {
  const date = new Date(value);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return 999;
  return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
}

function fullDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dayLabel(value) {
  const delta = dayDelta(value);
  if (delta === 0) return 'Aujourd’hui';
  if (delta === 1) return 'Hier';
  if (delta === 2) return 'Avant-hier';
  return fullDay(value);
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function clockLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function compactArticleRow(article, index = 0) {
  const title = displayTitle(article);
  return `<article class="article-card runtime-row" data-article="${escapeHtml(article.id)}" tabindex="0" aria-label="Lire : ${escapeHtml(title)}">
    ${articleVisual(article, index)}
    <div class="article-body"><h2>${escapeHtml(title)}</h2><div class="meta"><span class="source">${escapeHtml(article.source || 'Source')}</span><span>${escapeHtml(clockLabel(article.publishedAt))}</span></div></div>
  </article>`;
}

function historyBriefMarkup() {
  const major = /guerre|attaque|cessez-le-feu|élection|gouvernement|président|premier ministre|attentat|catastrophe|séisme|inondation|incendie|crise|accord|sommet|justice|condamn|budget|déficit|croissance|inflation|chômage|épidémie|climat|diplomatie|nucléaire|réforme|retraite/i;
  const low = /football|match|mercato|tennis|formule 1|promotion|bon plan|soldes|réduction|console|jeu vidéo|gta|people|célébrité|télé-réalité/i;
  const editorial = new Set(['Politique', 'International', 'Europe', 'Économie', 'Société', 'Santé', 'Environnement', 'Science']);
  const impact = article => Number(article.score || 0) + (editorial.has(article.category) ? 65 : 0) + (major.test(`${article.title || ''} ${article.summary || ''}`) ? 80 : 0) + Math.max(0, (article.sources?.length || 1) - 1) * 25 - (low.test(`${article.title || ''} ${article.summary || ''}`) ? 180 : 0);
  const days = new Map();
  for (const article of state.articles) {
    const delta = dayDelta(article.publishedAt);
    if (delta < 1 || delta > 8 || state.feedback[article.id] === 'not') continue;
    const key = dayKey(article.publishedAt);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(article);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7).map(([, items], dayIndex) => {
    const selected = items.sort((a, b) => impact(b) - impact(a)).slice(0, 5);
    return `<section class="brief-history-day-v9138"><div class="brief-history-date-v9138">${escapeHtml(dayLabel(selected[0]?.publishedAt))}${dayDelta(selected[0]?.publishedAt) <= 2 ? ` · ${escapeHtml(fullDay(selected[0]?.publishedAt))}` : ''}</div><div class="feed stable-owned-list">${selected.map((article, index) => compactArticleRow(article, dayIndex * 10 + index)).join('')}</div></section>`;
  }).join('');
}

function renderWatchesFinal() {
  const topics = uniqueTopics(state.settings.briefWatchTopics || []);
  const recent = state.articles.filter(article => state.feedback[article.id] !== 'not').slice().sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 220);
  const order = [];
  const days = new Map();
  for (const article of recent) {
    const key = dayKey(article.publishedAt);
    if (!days.has(key)) { days.set(key, []); order.push(key); }
    days.get(key).push(article);
  }
  const groups = order.slice(0, 9).map((key, dayIndex) => {
    const dayArticles = days.get(key) || [];
    const watched = topics.length ? dayArticles.filter(article => topics.some(topic => watchMatches(article, topic))) : [];
    const filtered = watched.length ? `<div class="feed stable-owned-list watch-filtered-feed-v9138">${watched.slice(0, 30).map((article, index) => compactArticleRow(article, dayIndex * 40 + index)).join('')}</div>` : '<p class="watch-empty-day-v9138">Aucune nouvelle de vos veilles ce jour-là.</p>';
    const all = `<div class="feed stable-owned-list watch-all-feed-v9138" hidden>${dayArticles.map((article, index) => compactArticleRow(article, dayIndex * 40 + index)).join('')}</div>`;
    return `<section class="watch-day-v9138"><h3>${escapeHtml(dayLabel(dayArticles[0]?.publishedAt))}</h3>${filtered}<button type="button" class="watch-all-band-v9138" data-watch-all-toggle><span>Toute l’actualité</span><small>${dayArticles.length} article${dayArticles.length > 1 ? 's' : ''}</small></button>${all}</section>`;
  }).join('');
  return `<section class="watches-by-day-v9138 watch-layout-v9138"><div class="watches-head-v9138"><strong>Mes veilles</strong><button type="button" class="watch-edit-button-v9138" data-watch-edit-open>Modifier veilles</button></div>${groups || '<p class="muted-note">Aucune actualité récente.</p>'}</section>`;
}

function renderBrief() {
  const majorTerms = /guerre|attaque|cessez-le-feu|élection|gouvernement|président|premier ministre|attentat|catastrophe|séisme|inondation|incendie|disparu|crise|accord|sommet|justice|condamn|cour des comptes|budget|retraite|déficit|croissance|inflation|chômage|épidémie|climat|diplomatie|nucléaire/i;
  const lowPriorityTerms = /\bpsg\b|ligue 1|football|match|composition|mercato|tennis|formule 1|prix en chute|promotion|bon plan|soldes?|réduction|stations?-service|carburant|diesel|essence à \d|console|smartphone|windows|gta|jeu vidéo|montre connectée|audiences? télé|people|célébrité|télé-réalité|pyramide des présidents|classement.{0,30}président|réseau social.{0,80}président/i;
  const worldTerms = /ukraine|russie|népal|tibet|gaza|israël|iran|chine|états[- ]unis|donald trump|fed\b|otan|onu\b|royaume-uni|allemagne|italie|espagne|autriche|grèce|inde|pakistan|japon|corée|afrique|moyen-orient|amérique|brésil|canada/i;
  const editorialCategories = new Set(['Politique', 'International', 'Europe', 'Économie', 'Société', 'Santé', 'Environnement']);
  const scopeOf = article => worldTerms.test(String(article.title || '')) || ['International', 'Europe'].includes(article.category) ? 'Monde' : 'France';
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
  const ranked = visibleArticles().map(article => {
    const haystack = `${article.title || ''} ${article.summary || ''}`;
    const age = Math.max(0, (Date.now() - Date.parse(article.publishedAt || 0)) / 3600000);
    const editorial = editorialCategories.has(article.category) ? 70 : -35;
    const corroboration = Math.max(0, (article.sources?.length || 1) - 1) * 30;
    const headline = majorTerms.test(haystack) ? 55 : 0;
    const lightweight = lowPriorityTerms.test(haystack) ? -220 : 0;
    const weakSignal = !majorTerms.test(haystack) && corroboration === 0 ? -65 : 0;
    // Do not use article.score: it includes personal-source and interest
    // boosts, while L’essentiel must remain publisher-neutral.
    return { article, score: 100 + editorial + corroboration + headline + lightweight + weakSignal - Math.min(age, 72), scope: scopeOf(article), newsworthy: headline > 0 || corroboration > 0 };
  }).sort((a, b) => b.score - a.score);
  const recent = ranked.filter(item => Date.now() - Date.parse(item.article.publishedAt || 0) <= 72 * 3600000);
  const candidates = recent.length >= 6 ? recent : ranked;
  const headlineCandidates = candidates.filter(item => item.newsworthy && item.score >= 150);
  const primaryCandidates = headlineCandidates.length >= 5 ? headlineCandidates : candidates;
  const picks = [];
  for (const scope of ['France', 'Monde']) {
    const candidate = primaryCandidates.find(item => item.scope === scope && !picks.includes(item));
    if (candidate) picks.push(candidate);
  }
  const sourceCounts = new Map();
  picks.forEach(item => {
    const source = item.article.source || 'Source';
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  });
  for (const candidate of primaryCandidates) {
    if (picks.length >= 5) break;
    const source = candidate.article.source || 'Source';
    if (picks.includes(candidate) || Number(sourceCounts.get(source) || 0) >= 2 || picks.some(item => sameEvent(item.article, candidate.article))) continue;
    picks.push(candidate);
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  }
  for (const candidate of candidates) {
    if (picks.length >= 5) break;
    const source = candidate.article.source || 'Source';
    if (picks.includes(candidate) || Number(sourceCounts.get(source) || 0) >= 2) continue;
    picks.push(candidate);
    sourceCounts.set(source, Number(sourceCounts.get(source) || 0) + 1);
  }
  for (const candidate of candidates) {
    if (picks.length >= 5) break;
    if (!picks.includes(candidate)) picks.push(candidate);
  }
  const essential = `<section class="journal-section"><div class="brief-day-v9138">${escapeHtml(fullDay(new Date()))}</div><h2 class="brief-section-title">Les 5 événements majeurs</h2><div class="feed stable-owned-list">${picks.length ? picks.map(({ article }, index) => compactArticleRow(article, index)).join('') : '<p class="muted-note">Aucune information majeure récente.</p>'}</div></section><section class="brief-history-v9138">${historyBriefMarkup()}</section>`;
  return `<button type="button" class="top-reset-icon-v9138" data-reset-read aria-label="Réinitialiser les articles parcourus" title="Réinitialiser">↻</button><main class="page">${topbar('Brief du jour', false)}
    <div class="brief-mode-tabs"><button class="brief-mode-tab ${state.briefMode === 'essential' ? 'active' : ''}" data-brief-mode="essential">L’essentiel</button><button class="brief-mode-tab ${state.briefMode === 'watches' ? 'active' : ''}" data-brief-mode="watches">Mes veilles</button></div>
    <div class="runtime-brief-content" data-stable-brief-content>${state.briefMode === 'essential' ? essential : renderWatchesFinal()}</div>
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

    <section class="settings-section"><h2>Notifications</h2>${settingRow('Brief du matin', 'Préférence conservée pour les futures notifications push', 'notifications')}</section>
    <section class="settings-section app-version-section"><h2>Version de l’application</h2><p>Ce numéro permet de vérifier immédiatement que le smartphone utilise bien la dernière publication.</p><div class="app-version-row"><div><strong>Mon actualité · version ${APP_VERSION}</strong><span>Publication du ${APP_RELEASE}</span></div><span class="app-version-badge">v${APP_VERSION}</span></div><button class="secondary-btn compact-btn" data-check-update>${icon('refresh')} Vérifier et mettre à jour</button></section>
    <button class="secondary-btn" data-reset>Réinitialiser les préférences</button>
  </main>${nav('settings')}`;
}

function emptyState(title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon('inbox')}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></div>`;
}

function renderSheet() {
  if (!state.sheet) return '';
  const chips = (items, selected, attribute) => `<div class="personalize-chips">${items.map(item => `<button type="button" class="personalize-chip ${selected.includes(item) ? 'active' : ''}" ${attribute}="${escapeHtml(item)}" aria-pressed="${selected.includes(item)}">${escapeHtml(item)}</button>`).join('')}</div>`;
  const watchTopics = [...new Set([...WATCH_TOPICS, ...state.keywords])];
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet personalization-sheet" role="dialog" aria-modal="true" aria-label="Personnaliser mon actualité" data-sheet-panel>
    <div class="sheet-handle"></div>
    <header class="personalize-head"><div><span>Votre sélection</span><h2>Personnaliser</h2></div><button type="button" class="personalize-close" data-dismiss-sheet aria-label="Fermer">×</button></header>
    <section class="personalize-section"><h3>Accueil</h3><p>Tous les articles restent accessibles. Ces choix déterminent ceux qui remontent en premier.</p>${chips(GENERAL_CATEGORIES, state.settings.generalCategories, 'data-general-category')}${chips(PERSONAL_THEMES, state.settings.interests, 'data-interest')}</section>
    <section class="personalize-section"><h3>Brief · Essentiel</h3><p>Choisissez les rubriques utilisées pour le point d’actualité France et Monde.</p>${chips(GENERAL_CATEGORIES, state.settings.briefEssentialCategories, 'data-brief-essential')}</section>
    <section class="personalize-section"><h3>Brief · Mes veilles</h3><p>Une veille large sur toute la recherche, les innovations de tous domaines et les progrès humains. Affinez librement les thèmes suivis.</p>${chips(watchTopics, state.settings.briefWatchTopics, 'data-brief-watch')}
      <div class="inline-form personalize-add"><input id="keyword-input" class="text-input" type="text" maxlength="70" placeholder="Ajouter une veille précise"><button class="small-primary-btn" data-add-keyword>Ajouter</button></div>
    </section>
    <button type="button" class="secondary-btn personalize-settings" data-open-settings>Réglages avancés</button>
  </section></div>`;
}

function renderLoadingScreen() {
  app.innerHTML = `<main class="fresh-loading-v9182" role="status" aria-live="polite">
    <div class="fresh-loading-v9182__brand">Mon actualité</div>
    <div class="fresh-loading-v9182__spinner" aria-hidden="true"></div>
    <h1>Chargement des dernières actualités…</h1>
    <p>Les articles les plus récents arrivent en premier.</p>
    <div class="fresh-loading-v9182__rows" aria-hidden="true">
      ${Array.from({ length: 5 }, (_, index) => `<div class="fresh-loading-v9182__row" style="--i:${index}"><div></div><span></span></div>`).join('')}
    </div>
  </main>`;
}

function render({ resetScroll = false, scrollTop = null } = {}) {
  const preservedScroll = Number.isFinite(scrollTop) ? scrollTop : (resetScroll ? 0 : window.scrollY);
  const views = { home: renderHome, category: renderCategory, detail: renderDetail, brief: renderBrief, news: renderNews, settings: renderSettings };
  app.innerHTML = (views[state.view] || renderHome)() + renderSheet();
  window.scrollTo({ top: preservedScroll, behavior: 'instant' });
  if (preservedScroll > 0) requestAnimationFrame(() => window.scrollTo({ top: preservedScroll, behavior: 'instant' }));
  notifyStableRender('view');
}

function notifyStableRender(reason = 'update') {
  window.dispatchEvent(new CustomEvent('news:stable-render', { detail: { reason, view: state.view } }));
  scheduleVisualBackfill(80);
}

function refreshSheet() {
  const current = app.querySelector('.sheet-backdrop');
  if (!state.sheet) { current?.remove(); return; }
  const template = document.createElement('template');
  template.innerHTML = renderSheet();
  const next = template.content.firstElementChild;
  if (!next) return;
  if (current) current.replaceWith(next); else app.appendChild(next);
  notifyStableRender('sheet');
}

function openSheet() {
  state.sheet = true;
  refreshSheet();
}

function closeSheet() {
  state.sheet = false;
  app.querySelector('.sheet-backdrop')?.remove();
  notifyStableRender('sheet-close');
}

function watchEditorMarkup() {
  const topics = uniqueTopics(state.settings.briefWatchTopics || []);
  return `<div class="watch-editor-form-v9138"><input class="text-input" data-watch-editor-input maxlength="80" autocomplete="off" placeholder="Ex. fusion nucléaire, Alzheimer, Quest 4…"><button type="button" class="small-primary-btn" data-watch-editor-add>Ajouter</button></div><div class="watch-editor-list-v9138">${topics.length ? topics.map(topic => `<div class="watch-editor-item-v9138"><span>${escapeHtml(topic)}</span><button type="button" data-watch-editor-remove="${escapeHtml(topic)}" aria-label="Supprimer ${escapeHtml(topic)}">×</button></div>`).join('') : '<p class="muted-note">Aucune veille définie.</p>'}</div>`;
}

function openWatchEditor() {
  app.querySelector('.watch-editor-backdrop-v9138')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'watch-editor-backdrop-v9138';
  backdrop.innerHTML = `<section class="watch-editor-sheet-v9138" role="dialog" aria-modal="true"><header><div><span>Mes veilles</span><h2>Modifier veilles</h2></div><button type="button" data-watch-editor-close aria-label="Fermer">×</button></header><p>Ajoutez ou retirez ici les sujets suivis.</p><div data-watch-editor-body>${watchEditorMarkup()}</div></section>`;
  app.appendChild(backdrop);
  backdrop.querySelector('[data-watch-editor-input]')?.focus({ preventScroll: true });
}

function updateWatchTopic(value, remove = false) {
  const topic = String(value || '').replace(/\s+/g, ' ').trim();
  if (!topic) return;
  const key = normalizeTopic(topic);
  const topics = uniqueTopics(state.settings.briefWatchTopics || []);
  state.settings.briefWatchTopics = remove ? topics.filter(item => normalizeTopic(item) !== key) : uniqueTopics([...topics, topic]);
  state.keywords = remove ? state.keywords.filter(item => normalizeTopic(item) !== key) : uniqueTopics([...state.keywords, topic]);
  persist();
  const body = app.querySelector('[data-watch-editor-body]');
  if (body) body.innerHTML = watchEditorMarkup();
}

function appendHomeToLimit({ increment = false } = {}) {
  if (increment) state.homeLimit += 36;
  const feed = app.querySelector('[data-stable-home-feed]');
  if (!feed || state.view !== 'home') return;
  const articles = (state.savedOnly ? stableHomeArticles().filter(article => state.saved.has(article.id)) : stableHomeArticles()).slice(0, state.homeLimit);
  const currentIds = new Set([...feed.querySelectorAll(':scope > .article-card[data-article]')].map(card => String(card.dataset.article || '')));
  feed.querySelector(':scope > [data-home-more]')?.remove();
  if (!currentIds.size && articles.length) feed.replaceChildren();
  const template = document.createElement('template');
  template.innerHTML = articles.filter(article => !currentIds.has(String(article.id))).map((article, index) => articleCard(article, currentIds.size + index)).join('');
  feed.append(...template.content.childNodes);
  const remaining = Math.max(0, (state.savedOnly ? stableHomeArticles().filter(article => state.saved.has(article.id)) : stableHomeArticles()).length - articles.length);
  if (remaining) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-more';
    button.dataset.homeMore = '';
    button.innerHTML = `Afficher ${Math.min(36, remaining)} articles de plus <small>${remaining} encore disponibles</small>`;
    feed.appendChild(button);
  }
  notifyStableRender('home-append');
}

function refreshAfterNewsChange() {
  reconcileHomeOrder();
  if (state.view === 'home') {
    const scrollTop = window.scrollY;
    render({ scrollTop });
    return;
  }
  if (state.view === 'brief') {
    render({ scrollTop: window.scrollY });
    return;
  }
  render();
}

function navigate(view, additions = {}) {
  if (view !== state.view) state.previous.push({ view: state.view, category: state.category, articleId: state.articleId, categoryTab: state.categoryTab, scrollTop: window.scrollY });
  Object.assign(state, { view, sheet: false, ...additions });
  render({ resetScroll: true });
}

function goBack() {
  const prior = state.previous.pop();
  if (prior) {
    const { scrollTop = 0, ...priorState } = prior;
    Object.assign(state, priorState);
    render({ scrollTop });
  } else {
    state.view = 'home';
    render({ resetScroll: true });
  }
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
  localStorage.setItem('news-topic-preferences-v1', JSON.stringify(state.topicPreferences));
  localStorage.setItem('news-settings', JSON.stringify(state.settings));
  localStorage.setItem('news-sources', JSON.stringify(state.sources));
  localStorage.setItem('news-keywords', JSON.stringify(state.keywords));
}

function persistCache() {
  localStorage.setItem('news-live-cache', JSON.stringify({ articles: state.articles, fetchedAt: state.lastSync, stats: state.stats }));
}

function applyDownloadedNews(payload) {
  if (!payload || !Array.isArray(payload.articles)) return false;
  state.articles = payload.articles.map(applyRememberedVisual);
  state.lastSync = payload.fetchedAt || new Date().toISOString();
  state.stats = payload.stats || null;
  state.syncStatus = 'idle';
  state.syncError = '';
  persistCache();
  refreshAfterNewsChange();
  return true;
}

window.__applyNewsPayloadV9128 = applyDownloadedNews;

function articleThumbnailUrl(article) {
  const params = new URLSearchParams({
    v: '19',
    url: String(article?.url || '').slice(0, 1900),
    // When a Google CDN image works on desktop but is refused on the phone,
    // let our same-origin endpoint fetch and serve that exact image.
    image: String(article?.image || '').slice(0, 1900),
    title: String(article?.title || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    category: String(article?.category || '').replace(/\s+/g, ' ').trim().slice(0, 70),
    source: String(article?.source || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    custom: article?.customSource ? '1' : '0'
  });
  return `/api/article-thumbnail?${params}`;
}

function saveVisualBackfills() {
  const recent = Object.entries(visualBackfills)
    // Only successful recoveries survive an app restart. Failed attempts are
    // session-local so a temporary Google/publisher miss never poisons the
    // next launch on the phone.
    .filter(([, item]) => item?.url && Date.now() - Number(item.savedAt || 0) < VISUAL_BACKFILL_MAX_AGE)
    .slice(-300);
  try { localStorage.setItem(VISUAL_BACKFILL_KEY, JSON.stringify(Object.fromEntries(recent))); } catch {}
}

function applyRememberedVisual(article) {
  const remembered = visualBackfills[String(article?.id || '')];
  if (!remembered?.url || Date.now() - Number(remembered.savedAt || 0) > VISUAL_BACKFILL_MAX_AGE) return article;
  article.image = remembered.url;
  article.visualStatus = 'ready';
  article.visual = { status: 'ready', url: remembered.url, source: 'article-enrichment' };
  return article;
}

function installRecoveredVisual(article, endpoint) {
  const live = state.articles.find(item => String(item?.id || '') === String(article?.id || ''));
  if (!live) return;
  live.image = endpoint;
  live.visualStatus = 'ready';
  live.visual = { status: 'ready', url: endpoint, source: 'article-enrichment' };
  visualBackfills[String(live.id)] = { url: endpoint, savedAt: Date.now() };
  document.querySelectorAll('.article-card[data-article]').forEach(card => {
    if (String(card.dataset.article || '') !== String(live.id)) return;
    const image = card.querySelector('img.article-image');
    if (!image) return;
    image.classList.remove('source-tile-visual');
    image.classList.add('prepared-visual');
    image.loading = 'eager';
    image.src = endpoint;
  });
}

async function recoverArticleVisual(article) {
  const endpoint = articleThumbnailUrl(article);
  try {
    const response = await fetch(endpoint, { cache: 'force-cache' });
    const status = response.headers.get('X-Thumbnail-Status') || '';
    const type = response.headers.get('Content-Type') || '';
    const bytes = await response.arrayBuffer();
    if (!response.ok || status === 'fallback' || /image\/svg\+xml/i.test(type) || bytes.byteLength < 256) throw new Error('visual unavailable');
    installRecoveredVisual(article, endpoint);
  } catch {
    const key = String(article.id);
    const previous = visualBackfills[key];
    visualBackfills[key] = {
      attemptedAt: Date.now(),
      attempts: Math.min(VISUAL_BACKFILL_MAX_ATTEMPTS, Number(previous?.attempts || 0) + 1)
    };
  }
}

function visualCardDistance(card) {
  const rect = card.getBoundingClientRect();
  if (rect.bottom >= -120 && rect.top <= window.innerHeight + 120) return 0;
  if (rect.top > window.innerHeight) return rect.top - window.innerHeight;
  return Math.abs(rect.bottom);
}

async function backfillVisibleVisuals() {
  if (visualBackfillRunning || !navigator.onLine || document.hidden) return;
  const cardEntries = [...document.querySelectorAll('.article-card[data-article]')]
    .map(card => {
      const image = card.querySelector('img.article-image');
      const src = image?.currentSrc || image?.src || '';
      const needsRecovery = Boolean(image && (
        image.classList.contains('source-tile-visual')
        || card.classList.contains('v42-image-failed')
        || src.startsWith('data:image/svg+xml')
        || (image.complete && image.naturalWidth < 2)
      ));
      return { id: String(card.dataset.article || ''), distance: visualCardDistance(card), needsRecovery };
    })
    .sort((a, b) => a.distance - b.distance)
  // Only recover cards close to the Android viewport. Processing every card
  // already rendered (including hundreds below the fold) flooded Google and
  // turned otherwise valid Parisien images into HTTP 429 fallbacks.
  const nearbyEntries = cardEntries.filter(item => item.distance <= Math.max(1400, window.innerHeight * 1.5));
  const recoveryIds = new Set(nearbyEntries.filter(item => item.needsRecovery).map(item => item.id));
  const visibleIds = nearbyEntries.map(item => item.id);
  const orderedArticles = [...new Set(visibleIds)]
    .map(id => state.articles.find(article => String(article?.id || '') === id))
    .filter(Boolean);
  const candidates = orderedArticles
    .filter(article => {
      if (hasPreparedVisual(article) && !recoveryIds.has(String(article.id))) return false;
      const attempt = visualBackfills[String(article.id)];
      const attempts = Number(attempt?.attempts || 0);
      return attempts < VISUAL_BACKFILL_MAX_ATTEMPTS
        && (!attempt?.attemptedAt || Date.now() - Number(attempt.attemptedAt) >= VISUAL_BACKFILL_RETRY_DELAY);
    })
    .slice(0, 2);
  if (!candidates.length) {
    const retryWaits = orderedArticles
      .filter(article => !hasPreparedVisual(article) || recoveryIds.has(String(article.id)))
      .map(article => visualBackfills[String(article.id)])
      .filter(attempt => Number(attempt?.attempts || 0) > 0 && Number(attempt.attempts) < VISUAL_BACKFILL_MAX_ATTEMPTS)
      .map(attempt => VISUAL_BACKFILL_RETRY_DELAY - (Date.now() - Number(attempt.attemptedAt || 0)))
      .filter(wait => wait > 0);
    if (retryWaits.length) scheduleVisualBackfill(Math.max(350, Math.min(...retryWaits) + 50));
    return;
  }
  visualBackfillRunning = true;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const article = candidates[cursor++];
      await recoverArticleVisual(article);
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  };
  try {
    await worker();
    persistCache();
    saveVisualBackfills();
  } finally {
    visualBackfillRunning = false;
    // Continue gently for the few cards near the viewport; scrolling schedules
    // another pass for newly visible rows.
    scheduleVisualBackfill(1200);
  }
}

function scheduleVisualBackfill(delay = 350) {
  clearTimeout(visualBackfillTimer);
  visualBackfillTimer = setTimeout(() => backfillVisibleVisuals(), delay);
}

// Image errors do not add/remove DOM nodes. Capture the failure and immediately
// schedule the same-origin recovery used for articles without a prepared visual.
document.addEventListener('error', event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.closest('.article-card[data-article]')) {
    scheduleVisualBackfill(100);
  }
}, true);

async function syncNews({ silent = false } = {}) {
  if (syncPromise) return syncPromise;
  state.syncStatus = 'loading'; state.syncError = '';
  // Background refreshes keep the current DOM in place until fresh data is
  // ready. Re-rendering here made every cached thumbnail disappear briefly.
  if (!silent && !app.querySelector('[data-article]')) render();
  syncPromise = (async () => {
    try {
      const result = await fetchLiveNews({
        sources: state.sources.filter(source => source.enabled !== false),
        keywords: state.keywords,
        preferredCategories: state.settings.interests,
        webSearch: state.settings.webSearch,
        sourcePriority: state.settings.sourcePriority
      });
      state.articles = Array.isArray(result.articles) ? result.articles.map(applyRememberedVisual) : [];
      state.lastSync = result.fetchedAt || new Date().toISOString();
      state.stats = result.stats || null;
      state.syncStatus = 'idle';
      persistCache();
      refreshAfterNewsChange();
      if (!silent) toast(`${state.articles.length} article${state.articles.length > 1 ? 's' : ''} actualisé${state.articles.length > 1 ? 's' : ''}`);
      return result;
    } catch (error) {
      state.syncStatus = 'error';
      state.syncError = error?.message || 'Connexion impossible';
      if (!['home', 'brief'].includes(state.view) || !app.querySelector('[data-article]')) render();
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
  if (!state.settings.briefWatchTopics.includes(value)) state.settings.briefWatchTopics.push(value);
  persist(); state.sheet ? refreshSheet() : render(); toast('Centre d’intérêt ajouté'); syncNews({ silent: true });
}

async function checkAppUpdate({ announce = false } = {}) {
  try {
    const versionUrl = new URL('./version.json', location.href);
    versionUrl.searchParams.set('t', Date.now().toString());
    const response = await fetch(versionUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('version unavailable');
    const published = await response.json();
    const publishedVersion = String(published?.version || '').trim();
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    await registration?.update();
    if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    if (publishedVersion && publishedVersion !== APP_VERSION) {
      if (announce) toast(`Mise à jour vers la version ${publishedVersion}…`);
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set('app-version', publishedVersion);
      nextUrl.searchParams.set('update', Date.now().toString());
      window.setTimeout(() => window.location.replace(nextUrl.href), 250);
      return;
    }
    if (announce) toast(`Version ${APP_VERSION} à jour`);
  } catch {
    if (announce) toast('Vérification impossible pour le moment');
  }
}

app.addEventListener('click', async event => {
  if (event.target.closest('[data-reset-read]')) {
    event.preventDefault();
    greyArticleIds.clear();
    localStorage.setItem('news-grey-after-scroll-v9138-v1', '[]');
    document.querySelectorAll('.article-card.read-passed-v9138').forEach(card => card.classList.remove('read-passed-v9138'));
    return;
  }
  const more = event.target.closest('[data-home-more]');
  if (more) { event.preventDefault(); event.stopPropagation(); appendHomeToLimit({ increment: true }); return; }
  const briefMode = event.target.closest('[data-brief-mode]');
  if (briefMode) { event.preventDefault(); state.briefMode = briefMode.dataset.briefMode === 'watches' ? 'watches' : 'essential'; render({ scrollTop: 0 }); return; }
  const watchAll = event.target.closest('[data-watch-all-toggle]');
  if (watchAll) {
    event.preventDefault();
    const day = watchAll.closest('.watch-day-v9138');
    const filtered = day?.querySelector('.watch-filtered-feed-v9138');
    const empty = day?.querySelector('.watch-empty-day-v9138');
    const all = day?.querySelector('.watch-all-feed-v9138');
    const opening = Boolean(all?.hidden);
    if (all) all.hidden = !opening;
    if (filtered) filtered.hidden = opening;
    if (empty) empty.hidden = opening;
    watchAll.classList.toggle('open', opening);
    const label = watchAll.querySelector('span');
    if (label) label.textContent = opening ? 'Mes veilles seulement' : 'Toute l’actualité';
    notifyStableRender('watch-toggle');
    return;
  }
  if (event.target.closest('[data-watch-edit-open]')) { event.preventDefault(); openWatchEditor(); return; }
  if (event.target.closest('[data-watch-editor-close]') || event.target.classList.contains('watch-editor-backdrop-v9138')) { event.preventDefault(); app.querySelector('.watch-editor-backdrop-v9138')?.remove(); if (state.view === 'brief') render({ scrollTop: 0 }); return; }
  if (event.target.closest('[data-watch-editor-add]')) {
    event.preventDefault();
    const input = app.querySelector('[data-watch-editor-input]');
    updateWatchTopic(input?.value || '');
    if (input) input.value = '';
    return;
  }
  const watchRemove = event.target.closest('[data-watch-editor-remove]');
  if (watchRemove) { event.preventDefault(); updateWatchTopic(watchRemove.dataset.watchEditorRemove || '', true); return; }
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
  if (article) {
    event.preventDefault();
    event.stopPropagation();
    navigate('detail', { articleId: article.dataset.article });
    return;
  }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    const view = viewButton.dataset.view;
    if (view === 'sheet') openSheet(); else navigate(view, { savedOnly: false });
    return;
  }
  if (event.target.closest('[data-back]')) { goBack(); return; }
  if (event.target.closest('[data-dismiss-sheet]')) { closeSheet(); return; }
  if (event.target.closest('[data-open-settings]')) { state.sheet = false; navigate('settings', { savedOnly: false }); return; }
  if (event.target.closest('[data-check-update]')) { await checkAppUpdate({ announce: true }); return; }
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
  if (feedback) {
    const id = feedback.dataset.id;
    const next = feedback.dataset.feedback;
    const previous = state.feedback[id] || '';
    const article = state.articles.find(item => String(item.id) === String(id));
    if (article) window.NewsPersonalizationV91?.recordFeedback(article, next, previous);
    state.feedback[id] = next;
    persist();
    toast('Préférence enregistrée');
    render();
    return;
  }
  const toggle = event.target.closest('[data-setting-toggle]');
  if (toggle) { const key = toggle.dataset.settingToggle; state.settings[key] = !state.settings[key]; persist(); render(); if (['webSearch', 'sourcePriority'].includes(key)) syncNews({ silent: true }); return; }
  const interest = event.target.closest('[data-interest]');
  if (interest) { const name = interest.dataset.interest; const current = new Set(state.settings.interests); current.has(name) ? current.delete(name) : current.add(name); state.settings.interests = [...current]; persist(); reconcileHomeOrder({ reset: true }); state.sheet ? refreshSheet() : render(); syncNews({ silent: true }); return; }
  const general = event.target.closest('[data-general-category]');
  if (general) { const name = general.dataset.generalCategory; const current = new Set(state.settings.generalCategories); current.has(name) ? current.delete(name) : current.add(name); state.settings.generalCategories = [...current]; persist(); reconcileHomeOrder({ reset: true }); state.sheet ? refreshSheet() : render(); return; }
  const briefEssential = event.target.closest('[data-brief-essential]');
  if (briefEssential) { const name = briefEssential.dataset.briefEssential; const current = new Set(state.settings.briefEssentialCategories); current.has(name) ? current.delete(name) : current.add(name); state.settings.briefEssentialCategories = [...current]; persist(); state.sheet ? refreshSheet() : render(); return; }
  const briefWatch = event.target.closest('[data-brief-watch]');
  if (briefWatch) { const name = briefWatch.dataset.briefWatch; const current = new Set(state.settings.briefWatchTopics); current.has(name) ? current.delete(name) : current.add(name); state.settings.briefWatchTopics = [...current]; persist(); state.sheet ? refreshSheet() : render(); return; }
  if (event.target.closest('[data-saved-filter]')) { state.savedOnly = !state.savedOnly; render(); return; }
  if (event.target.closest('[data-reset]')) { state.settings = { ...defaultSettings, generalCategories: [...GENERAL_CATEGORIES], interests: [...PERSONAL_THEMES], briefEssentialCategories: [...GENERAL_CATEGORIES], briefWatchTopics: [...DEFAULT_WATCH_TOPICS] }; state.keywords = []; state.topicPreferences = {}; window.NewsPersonalizationV91?.reset(); persist(); render(); toast('Préférences réinitialisées'); syncNews({ silent: true }); return; }
  if (event.target.closest('[data-install]')) {
    if (isInstalled) return toast('L’application est déjà installée');
    if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); const choice = await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; toast(choice.outcome === 'accepted' ? 'Installation lancée' : 'Installation annulée'); }
    else toast('Dans Chrome : menu ⋮ puis Installer l’application');
    return;
  }
  if (event.target.closest('[data-close-sheet]') && !event.target.closest('[data-sheet-panel]')) closeSheet();
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
  if (event.key === 'Escape' && state.sheet) closeSheet();
});

const greyArticleIds = new Set(safeJson('news-grey-after-scroll-v9138-v1', []).map(String));
const observedGreyCards = new WeakSet();
let scrollingDown = false;
let lastScrollY = window.scrollY;
let scrollFrame = 0;
let continuousBusy = false;
const greyObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.intersectionRatio >= .55) entry.target.dataset.greyEligibleV9138 = '1';
}), { threshold: [.55] });

function bindStableCards() {
  document.querySelectorAll('.stable-owned-list .article-card[data-article]').forEach(card => {
    if (!observedGreyCards.has(card)) { observedGreyCards.add(card); greyObserver.observe(card); }
    card.classList.toggle('read-passed-v9138', greyArticleIds.has(String(card.dataset.article || '')));
  });
}

function markPassedCards() {
  if (!scrollingDown || document.querySelector('.quick-summary-backdrop')) return;
  let changed = false;
  document.querySelectorAll('.stable-owned-list .article-card[data-grey-eligible-v9138="1"]:not(.read-passed-v9138)').forEach(card => {
    const rect = card.getBoundingClientRect();
    if (rect.top < 0 && rect.bottom <= Math.max(20, innerHeight * .05)) {
      const id = String(card.dataset.article || '');
      if (id) { greyArticleIds.add(id); card.classList.add('read-passed-v9138'); changed = true; }
    }
  });
  if (changed) localStorage.setItem('news-grey-after-scroll-v9138-v1', JSON.stringify([...greyArticleIds].slice(-1600)));
}

function pumpContinuousHome() {
  if (continuousBusy || state.view !== 'home' || document.hidden) return;
  if (document.documentElement.scrollHeight - (window.scrollY + innerHeight) >= Math.max(2200, innerHeight * 3.6)) return;
  if (!app.querySelector('[data-home-more]')) return;
  continuousBusy = true;
  appendHomeToLimit({ increment: true });
  requestAnimationFrame(() => { continuousBusy = false; pumpContinuousHome(); });
}

window.addEventListener('news:stable-render', () => {
  bindStableCards();
  requestAnimationFrame(pumpContinuousHome);
});
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  scrollingDown = y > lastScrollY + 1 ? true : y < lastScrollY - 1 ? false : scrollingDown;
  lastScrollY = y;
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    bindStableCards();
    markPassedCards();
    pumpContinuousHome();
  });
}, { passive: true });
window.addEventListener('resize', () => requestAnimationFrame(pumpContinuousHome), { passive: true });

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
window.addEventListener('focus', () => {
  state.feedback = safeJson('news-feedback', state.feedback);
  state.topicPreferences = safeJson('news-topic-preferences-v1', state.topicPreferences);
  if (!state.lastSync || Date.now() - Date.parse(state.lastSync) > 5 * 60 * 1000) syncNews({ silent: true });
});
window.addEventListener('news-topic-preferences-changed', event => {
  state.topicPreferences = event.detail && typeof event.detail === 'object'
    ? { ...event.detail }
    : safeJson('news-topic-preferences-v1', {});
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!state.lastSync || Date.now() - Date.parse(state.lastSync) > 5 * 60 * 1000)) syncNews({ silent: true }); });

setInterval(() => { if (state.settings.autoRefresh && !document.hidden && navigator.onLine) syncNews({ silent: true }); }, 15 * 60 * 1000);

async function bootLatestNews() {
  renderLoadingScreen();
  const cachedArticles = Array.isArray(state.articles) ? state.articles.slice() : [];
  const cachedSync = state.lastSync;
  state.articles = [];
  state.homeOrder = [];
  let result = null;
  try {
    result = await syncNews({ silent: true });
  } catch {}
  if (!state.articles.length && cachedArticles.length) {
    state.articles = cachedArticles;
    state.lastSync = cachedSync;
  }
  state.homeOrder = [];
  render({ resetScroll: true });
  scheduleVisualBackfill(40);
  if (result?.stats?.mode === 'fast-startup' && navigator.onLine) {
    window.setTimeout(() => syncNews({ silent: true }), 300);
  }
}

bootLatestNews();
window.setTimeout(() => checkAppUpdate(), 1200);
