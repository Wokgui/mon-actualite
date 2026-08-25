import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=45.3';

const V42_SUMMARY_CACHE = 'news-article-summaries-v4';
const V42_VISUAL_CACHE = 'news-visual-map-v5-trusted';
const configured = new WeakSet();
const failedImages = new Set();
const summaryInflight = new Map();
let press = null;
let openedAt = 0;
let closeGesture = null;
let closedAt = -Infinity;
let scanPending = false;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function articles() {
  const cache = readJson('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}
function articleById(id) {
  return articles().find(item => String(item?.id || '') === String(id || '')) || null;
}
function clean(value = '') { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function esc(value = '') { return clean(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function summaryUsable(value = '') {
  const text = clean(value);
  const lower = text.toLowerCase();
  return text.length >= 60 && !/résumé indisponible/.test(lower) && !/ouvrez?\s+l[’']article/.test(lower) && !/consultez?\s+(?:les?\s+)?détails/.test(lower) && !/détails publiés par la source/.test(lower) && !/pour\s+(?:sauvegarder|enregistrer|mémoriser|partager|commenter|lire)\s+(?:(?:cet|cette|un|une|l[’']?)\s*)?article/.test(lower);
}
function articleSummary(article = {}) {
  const value = clean(article.summary || '');
  if (!summaryUsable(value)) return '';
  try {
    if (new URL(String(article.url || ''), location.href).hostname === 'news.google.com') return '';
  } catch {}
  const lower = value.toLowerCase();
  const sources = [...new Set([article.source, ...(article.sources || [])].map(clean).filter(Boolean))];
  const sourceHits = sources.filter(source => lower.includes(source.toLowerCase())).length;
  // Google Actualités descriptions sometimes flatten a list of related
  // headlines into one paragraph. That is not a summary of the opened story.
  if (sourceHits >= 2) return '';
  return value;
}
function provisionalSummary(article = {}, card = null) {
  const factual = articleSummary(article);
  if (factual) return factual;
  const title = titleFor(article, card);
  const source = clean(article.source || '');
  if (title && source) return `Cet article de ${source} porte sur : ${title}.`;
  if (title) return `Le sujet principal de cet article est : ${title}.`;
  return 'La synthèse détaillée de cet article est en cours de préparation.';
}
function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const m = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (m < 1) return 'À l’instant';
  if (m < 60) return `Il y a ${m} min`;
  if (m < 1440) return `Il y a ${Math.floor(m / 60)} h`;
  return `Il y a ${Math.floor(m / 1440)} j`;
}
function titleFor(article, card) {
  const shown = clean(card?.querySelector('h2')?.textContent || '');
  if (shown) return shown;
  let title = clean(article?.title || '');
  const source = clean(article?.source || '');
  if (source) title = title.replace(new RegExp(`\\s*[-–—|]\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '');
  return title;
}

function validImage(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || failedImages.has(url.href)) return '';
    const host = url.hostname.toLowerCase();
    const hay = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (url.origin === location.origin && url.pathname === '/' && !url.search) return '';
    if (/(favicon|\/logo(?:[._/-]|$)|logo[-_.]|icon[-_.]|\/icon(?:[._/-]|$)|avatar|sprite|wordmark|site-logo|google[-_ ]?news|googlenews)/i.test(hay)) return '';
    if (host === 'news.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
    return url.href;
  } catch { return ''; }
}
function proxyUrl(article) {
  const params = new URLSearchParams({
    v: '12',
    url: String(article?.url || '').slice(0, 1900),
    image: validImage(article?.image || ''),
    title: clean(article?.title || '').slice(0, 280),
    category: clean(article?.category || '').slice(0, 70)
  });
  return `/api/article-thumbnail?${params}`;
}
function visuals() { return readJson(V42_VISUAL_CACHE, {}); }
function remembered(article) {
  const item = visuals()[String(article?.id || '')];
  if (!item?.src || Date.now() - Number(item.savedAt || 0) > 7 * 86400000) return '';
  return String(item.src);
}
function remember(article, src) {
  if (!article?.id || !src) return;
  const map = visuals();
  map[String(article.id)] = { src, savedAt: Date.now() };
  writeJson(V42_VISUAL_CACHE, Object.fromEntries(Object.entries(map).slice(-250)));
}
function likelyDirectImage(value = '') {
  const src = validImage(value);
  if (!src) return '';
  try {
    const u = new URL(src);
    const p = `${u.pathname}${u.search}`.toLowerCase();
    if (/\.(?:jpe?g|png|webp|avif)(?:$|[?&])/.test(p)) return src;
    if (/(image|img|photo|media|cdn|cloudinary|akamai|resize|width=|format=)/i.test(p)) return src;
  } catch {}
  return '';
}
function preconnect(src) {
  try {
    const origin = new URL(src, location.href).origin;
    if (origin === location.origin || document.querySelector(`link[data-v42-origin="${CSS.escape(origin)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect'; link.href = origin; link.crossOrigin = 'anonymous'; link.dataset.v42Origin = origin;
    document.head.appendChild(link);
  } catch {}
}

function loadCardImage(card, article, index) {
  const img = card.querySelector('img.article-image');
  if (!img || !article) return;
  if (img.dataset.v42Loaded === '1' && img.complete && img.naturalWidth > 1) {
    card.classList.remove('v42-image-pending', 'v42-image-failed');
    card.classList.add('v42-image-loaded');
    return;
  }
  if (img.dataset.v42Loaded === '1') {
    delete img.dataset.v42Loaded;
    card.classList.remove('v42-image-loaded');
  }
  img.dataset.v42Loaded = '1';
  img.alt = '';
  img.decoding = 'async';
  // The IntersectionObserver already decides when an image is useful. Once it
  // reaches this function, native lazy-loading must not defer it a second time.
  img.loading = 'eager';
  if ('fetchPriority' in img) img.fetchPriority = index < 3 ? 'high' : 'auto';
  card.classList.add('v42-image-pending');

  const prepared = preparedVisualUrl(article);
  const hasVisualState = Boolean(article.visualStatus || article.visual?.status);
  const direct = prepared || (!hasVisualState ? likelyDirectImage(article.image || '') : '');
  // Fresh article data has a definitive visual decision. If the exact prepared
  // image fails, use a stable source tile instead of starting a visible chain
  // of publisher/search replacements. The proxy remains migration-only for
  // articles stored before the prepared-visual format existed.
  const fallback = hasVisualState ? sourceTileUrl(article) : (img.dataset.perfSrc || proxyUrl(article));
  const cached = hasVisualState ? '' : remembered(article);
  let usedFallback = cached === fallback || (!cached && !direct);
  const first = cached || direct || fallback;
  if (direct) preconnect(direct);

  const loaded = () => {
    if (img.naturalWidth < 2) {
      failed();
      return;
    }
    card.classList.remove('v42-image-pending', 'v42-image-failed');
    card.classList.add('v42-image-loaded');
    if (!hasVisualState) remember(article, img.currentSrc || img.src);
  };
  const failed = () => {
    const current = img.currentSrc || img.src;
    if (direct && current === direct) failedImages.add(direct);
    if (!usedFallback && fallback) {
      usedFallback = true;
      img.src = fallback;
      return;
    }
    card.classList.remove('v42-image-pending');
    card.classList.add('v42-image-failed');
  };
  img.addEventListener('load', loaded);
  img.addEventListener('error', failed);
  img.src = first;
  if (img.complete && img.naturalWidth > 0) loaded();
}

const viewportObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    viewportObserver.unobserve(entry.target);
    loadCardImage(entry.target, articleById(entry.target.dataset.article), Number(entry.target.dataset.v42Index || 99));
  }
}, { rootMargin: '900px 0px' }) : null;

function configureCards() {
  const cards = [...document.querySelectorAll('.article-card[data-article]')];
  cards.forEach((card, index) => {
    if (configured.has(card)) return;
    configured.add(card);
    card.dataset.v42Index = String(index);
    if (index < 6 || !viewportObserver) loadCardImage(card, articleById(card.dataset.article), index);
    else viewportObserver.observe(card);
  });
}

function feedbackMarkup(key, selected) {
  const map = {
    more: ['+', 'Plus comme ça', 'Davantage de sujets similaires'],
    less: ['−', 'Moins comme ça', 'Réduire ce type de sujets'],
    not: ['×', 'Pas intéressé', 'Masquer ce type de sujets'],
    follow: ['☆', 'Sujet à suivre', 'Faire remonter ce sujet']
  };
  const [symbol, title, text] = map[key];
  return `<button type="button" class="quick-feedback-tile ${selected === key ? 'selected' : ''}" data-quick-feedback="${key}"><span class="quick-feedback-symbol">${symbol}</span><span><strong>${title}</strong><small>${text}</small></span></button>`;
}

function articleTopics(article = {}) {
  const raw = [article.category, ...(article.tags || []), ...(article.matches || [])]
    .map(clean)
    .filter(topic => topic && topic !== 'À suivre');
  return [...new Set(raw)].slice(0, 3);
}

function topicFeedbackMarkup(article) {
  const preferences = readJson('news-topic-preferences-v1', {});
  const topics = articleTopics(article);
  if (!topics.length) return '';
  return `<section class="quick-topic-feedback"><strong>Quels thèmes voulez-vous voir davantage ou moins ?</strong><p>L’application apprend thème par thème, pas seulement pour cet article.</p><div class="quick-topic-list">${topics.map(topic => {
    const value = Number(preferences[topic] || 0);
    return `<div class="quick-topic-row"><span>${esc(topic)}</span><div><button type="button" class="${value < 0 ? 'selected' : ''}" data-topic-feedback="${esc(topic)}" data-topic-direction="less" aria-label="Moins de ${esc(topic)}">−</button><button type="button" class="${value > 0 ? 'selected' : ''}" data-topic-feedback="${esc(topic)}" data-topic-direction="more" aria-label="Plus de ${esc(topic)}">+</button></div></div>`;
  }).join('')}</div></section>`;
}

function closeInstant(modal) {
  (modal || document.querySelector('.quick-summary-backdrop'))?.remove();
  document.body.classList.remove('quick-summary-open');
}

async function summaryFor(article) {
  if (!article) return null;
  const key = `article:${article.id}`;
  const initial = readJson(V42_SUMMARY_CACHE, {})[key];
  if (initial?.summary && !initial.unavailable && summaryUsable(initial.summary)) {
    return initial;
  }

  const body = JSON.stringify({ mode: 'article', article: { url: article.url, title: clean(article.title), summary: articleSummary(article), source: clean(article.source || '') } });
  const requestKey = `v42|${body}`;
  let request = summaryInflight.get(requestKey);
  if (!request) {
    request = fetch('/api/article-summary-groq?v=13', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body })
      .then(r => r.ok ? r.json() : null)
      .finally(() => summaryInflight.delete(requestKey));
    summaryInflight.set(requestKey, request);
  }
  try {
    const data = await request;
    if (!data?.summary || data?.unavailable || !summaryUsable(data.summary)) return null;
    const latest = readJson(V42_SUMMARY_CACHE, {});
    latest[key] = { summary: clean(data.summary), ai: Boolean(data.ai), unavailable: false, savedAt: Date.now() };
    writeJson(V42_SUMMARY_CACHE, Object.fromEntries(Object.entries(latest).slice(-180)));
    return latest[key];
  } catch { return null; }
}

async function updateSummary(article, modal) {
  if (!article || !modal) return;
  const text = modal.querySelector('[data-quick-summary-text]');
  const label = modal.querySelector('[data-quick-summary-label]');
  const result = await summaryFor(article);
  if (!modal.isConnected) return;
  if (!result) {
    text.textContent = provisionalSummary(article);
    label.textContent = 'Synthèse provisoire';
    return;
  }
  text.textContent = clean(result.summary);
  label.textContent = result.ai ? 'Résumé IA' : 'Résumé factuel';
}

function openInstant(card, article) {
  closeInstant();
  const title = titleFor(article, card);
  const feedback = readJson('news-feedback', {});
  const selected = feedback[article.id] || '';
  const cached = readJson(V42_SUMMARY_CACHE, {})[`article:${article.id}`];
  const factual = articleSummary(article);
  const immediate = cached?.summary && !cached.unavailable && summaryUsable(cached.summary)
    ? clean(cached.summary)
    : factual || provisionalSummary(article, card);
  const immediateLabel = cached?.summary && !cached.unavailable && summaryUsable(cached.summary)
    ? (cached.ai ? 'Résumé IA' : 'Résumé factuel')
    : factual ? 'Résumé factuel · IA en cours…' : 'Synthèse provisoire · IA en cours…';

  const img = card.querySelector('img.article-image');
  const visual = img?.complete && img.naturalWidth > 0
    ? (img.currentSrc || img.src)
    : preparedVisualUrl(article) || (!article.visualStatus ? remembered(article) || likelyDirectImage(article.image || '') : sourceTileUrl(article));
  const modal = document.createElement('div');
  modal.className = 'quick-summary-backdrop v42-instant-modal';
  modal.innerHTML = `<section class="quick-summary-sheet" role="dialog" aria-modal="true" aria-label="Résumé de l’article">
    <header class="quick-summary-head"><div><span class="quick-summary-kicker" data-quick-summary-label>${esc(immediateLabel)}</span><h2>${esc(title)}</h2></div><button type="button" class="quick-summary-close" data-quick-close aria-label="Fermer">×</button></header>
    <div class="quick-summary-meta"><span>${esc(article.source || '')}</span><span>${esc(timeLabel(article.publishedAt))}</span><span>${esc(article.category || '')}</span></div>
    ${visual ? `<div class="quick-summary-v42-image"><img src="${esc(visual)}" alt="" decoding="async" fetchpriority="high"></div>` : ''}
    <div class="quick-summary-text" data-quick-summary-text>${esc(immediate)}</div>
    <a class="quick-full-article" href="${esc(article.url || '#')}" target="_blank" rel="noopener noreferrer">Lire l’article complet <span aria-hidden="true">↗</span></a>
    ${topicFeedbackMarkup(article)}
    <div class="quick-feedback-grid quick-feedback-secondary" data-quick-feedback-grid>${['not','follow'].map(k => feedbackMarkup(k, selected)).join('')}</div>
  </section>`;
  document.body.appendChild(modal);
  document.body.classList.add('quick-summary-open');
  openedAt = performance.now();
  updateSummary(article, modal);
}

// Capture the close gesture without removing the sheet yet. On Android, if the
// DOM disappears during pointerdown, the following synthetic click can be
// retargeted to the article that has just appeared underneath the finger.
document.addEventListener('pointerdown', event => {
  const close = event.target.closest('[data-quick-close]');
  if (close) {
    const modal = close.closest('.quick-summary-backdrop');
    if (modal) {
      event.preventDefault();
      event.stopImmediatePropagation();
      press = null;
      closeGesture = { pointerId: event.pointerId, modal };
      return;
    }
  }
  const card = event.target.closest('.article-card[data-article]');
  if (!card || event.target.closest('button, input, select, textarea')) { press = null; return; }
  press = { card, x: event.clientX, y: event.clientY, t: performance.now() };
}, true);

// Open immediately on pointer-up after a normal tap. This bypasses the slower
// legacy click path but does not open while the user is scrolling.
document.addEventListener('pointerup', event => {
  if (closeGesture && closeGesture.pointerId === event.pointerId) {
    const { modal } = closeGesture;
    closeGesture = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeInstant(modal);
    closedAt = performance.now();
    return;
  }
  if (!press) return;
  const { card, x, y, t } = press;
  press = null;
  if (!card.isConnected || Math.hypot(event.clientX - x, event.clientY - y) > 12 || performance.now() - t > 700) return;
  if (!card.contains(event.target)) return;
  const article = articleById(card.dataset.article);
  if (!article) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openInstant(card, article);
}, true);

document.addEventListener('pointercancel', event => {
  if (closeGesture?.pointerId === event.pointerId) closeGesture = null;
  press = null;
}, true);

// Suppress the synthetic click that follows our pointer-up so article-quickview
// cannot create a second modal.
document.addEventListener('click', event => {
  if (performance.now() - closedAt < 900) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const topicButton = event.target.closest('[data-topic-feedback]');
  if (topicButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const topic = clean(topicButton.dataset.topicFeedback || '');
    const direction = topicButton.dataset.topicDirection;
    if (!topic || !['more', 'less'].includes(direction)) return;
    const preferences = readJson('news-topic-preferences-v1', {});
    const current = Number(preferences[topic] || 0);
    preferences[topic] = direction === 'more' ? Math.min(3, Math.max(1, current + 1)) : Math.max(-3, Math.min(-1, current - 1));
    writeJson('news-topic-preferences-v1', preferences);
    window.dispatchEvent(new CustomEvent('news-topic-preferences-changed', { detail: preferences }));
    const row = topicButton.closest('.quick-topic-row');
    row?.querySelectorAll('[data-topic-feedback]').forEach(button => button.classList.toggle('selected', button === topicButton));
    return;
  }
  const card = event.target.closest('.article-card[data-article]');
  if (card && performance.now() - openedAt < 900) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

function scan() {
  scanPending = false;
  configureCards();
}
function scheduleScan() {
  if (scanPending) return;
  scanPending = true;
  requestAnimationFrame(scan);
}
const root = document.getElementById('app');
if (root) new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
window.addEventListener('focus', scheduleScan);
scheduleScan();

let warmScheduled = false;
let warmAttempts = 0;
function warmTopSummaries() {
  if (warmScheduled || warmAttempts >= 5) return;
  warmScheduled = true;
  const run = async () => {
    const visibleIds = [...document.querySelectorAll('.article-card[data-article]')]
      .slice(0, 3)
      .map(card => card.dataset.article);
    const targets = visibleIds.map(articleById).filter(Boolean);
    if (!targets.length) {
      warmScheduled = false;
      warmAttempts += 1;
      setTimeout(warmTopSummaries, 700);
      return;
    }
    for (const article of targets) {
      const cached = readJson(V42_SUMMARY_CACHE, {})[`article:${article.id}`];
      if (cached?.summary && summaryUsable(cached.summary)) continue;
      await summaryFor(article);
    }
  };
  setTimeout(run, 450);
}
warmTopSummaries();
