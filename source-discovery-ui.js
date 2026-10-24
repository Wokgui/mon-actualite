function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wantedThemes() {
  const settings = readJson('news-settings', {});
  const preferences = readJson('news-topic-preferences-v1', {});
  const keywords = readJson('news-keywords', []);
  const interests = Array.isArray(settings?.interests) ? settings.interests : [];
  const learned = Object.entries(preferences)
    .filter(([, value]) => Number(value) > 0)
    .map(([topic]) => topic);
  return [...new Set([...interests, ...learned, ...(Array.isArray(keywords) ? keywords : [])].map(String).filter(Boolean))];
}

function discoveryArticleRelevant(article, themes = wantedThemes()) {
  if (!article?.customSource) return true;
  if (!themes.length) return false;
  const category = normalize(article.category || '');
  const tags = [...(Array.isArray(article.tags) ? article.tags : []), ...(Array.isArray(article.matches) ? article.matches : [])]
    .map(normalize);
  const text = normalize([article.title, article.summary, article.detail, article.category, ...tags].filter(Boolean).join(' '));
  const words = new Set(text.split(' ').filter(Boolean));

  return themes.some(theme => {
    const wanted = normalize(theme);
    if (!wanted) return false;
    if (category === wanted || tags.includes(wanted)) return true;
    if (wanted.length <= 3) return words.has(wanted);
    if (text.includes(wanted)) return true;
    const tokens = wanted.split(' ').filter(token => token.length >= 4);
    return tokens.length > 0 && tokens.some(token => words.has(token));
  });
}

function filterDiscoverySourceArticles() {
  const cache = readJson('news-live-cache', {});
  if (!Array.isArray(cache.articles)) return;
  const themes = wantedThemes();
  const keep = cache.articles.filter(article => discoveryArticleRelevant(article, themes));
  if (keep.length !== cache.articles.length) {
    try { localStorage.setItem('news-live-cache', JSON.stringify({ ...cache, articles: keep })); } catch {}
  }

  document.querySelectorAll('[data-article]').forEach(card => {
    if (card.closest('.stable-owned-list')) return;
    const article = cache.articles.find(item => String(item?.id || '') === String(card.dataset.article || ''));
    if (article?.customSource && !discoveryArticleRelevant(article, themes)) card.remove();
  });
}

function rewriteDiscoverySourceSettings() {
  const sections = [...document.querySelectorAll('.settings-section')];
  const section = sections.find(node => /sources personnelles/i.test(node.querySelector('h2')?.textContent || ''));
  if (!section) return;

  const intro = section.querySelector(':scope > p');
  if (intro) {
    intro.textContent = 'Ces sources servent de radars : seuls leurs articles correspondant à vos centres d’intérêt, à un thème marqué + ou à un mot-clé sont retenus. Ces mêmes thèmes sont ensuite recherchés dans de nombreux médias.';
  }

  const priorityToggle = section.querySelector('[data-setting-toggle="sourcePriority"]');
  if (priorityToggle) {
    const row = priorityToggle.closest('.setting-row, .settings-row, .setting-item, label') || priorityToggle.parentElement;
    if (row) row.style.display = 'none';
  }

  const addButton = section.querySelector('[data-add-source]');
  if (addButton && !/découverte/i.test(addButton.textContent || '')) {
    const icon = addButton.querySelector('svg')?.outerHTML || '';
    addButton.innerHTML = `${icon} Ajouter comme source de découverte`;
  }

  if (!section.querySelector('[data-discovery-explainer]')) {
    const note = document.createElement('p');
    note.dataset.discoveryExplainer = '1';
    note.className = 'settings-help';
    note.textContent = 'Le bouton + signifie : chercher davantage ce thème dans l’ensemble des sources disponibles, pas seulement dans le média où vous l’avez découvert.';
    section.appendChild(note);
  }
}

let scheduled = false;
function applyDiscoveryRules() {
  filterDiscoverySourceArticles();
  rewriteDiscoverySourceSettings();
}
function scheduleRewrite() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyDiscoveryRules();
  });
}

const app = document.getElementById('app');
if (app) new MutationObserver(scheduleRewrite).observe(app, { childList: true, subtree: true });
window.addEventListener('focus', scheduleRewrite);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRewrite(); });
scheduleRewrite();
