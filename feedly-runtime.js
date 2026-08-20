const GENERAL = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe'];
const PERSONAL = ['IA','Tech','Smartphones','VR','Automobile','Énergie'];
let scheduled = false;

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

function visibleArticles() {
  const cache = readJson('news-live-cache', {});
  const articles = Array.isArray(cache.articles) ? cache.articles : [];
  const settings = readJson('news-settings', {});
  const feedback = readJson('news-feedback', {});
  const general = Array.isArray(settings.generalCategories) ? settings.generalCategories : GENERAL;
  const interests = Array.isArray(settings.interests) ? settings.interests : PERSONAL;
  const allowed = new Set([...general, ...interests, 'À suivre']);
  const feedbackScore = id => ({ more: 24, less: -20, follow: 38 }[feedback[id]] || 0);
  return articles
    .filter(article => allowed.has(article.category) && feedback[article.id] !== 'not')
    .slice()
    .sort((a, b) => ((b.score || 0) + feedbackScore(b.id)) - ((a.score || 0) + feedbackScore(a.id)));
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

function expandHome() {
  if (!document.querySelector('.nav-item.active[data-view="home"]')) return;
  const savedButton = document.querySelector('.saved-filter [data-saved-filter]');
  if (savedButton && /voir toute/i.test(savedButton.textContent || '')) return;
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const articles = visibleArticles().slice(0, 40);
  const present = new Set([...feed.querySelectorAll('[data-article]')].map(el => String(el.dataset.article)));
  const missing = articles.filter(article => !present.has(String(article.id)));
  if (missing.length) feed.insertAdjacentHTML('beforeend', missing.map(compactRow).join(''));
}

function makeNewsRolling24h() {
  if (!document.querySelector('.nav-item.active[data-view="news"]')) return;
  const active = document.querySelector('.period.active[data-period="today"]');
  if (!active) return;
  active.textContent = '24 h';
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const articles = visibleArticles().filter(article => Date.parse(article.publishedAt) >= cutoff).slice(0, 60);
  if (articles.length) feed.innerHTML = articles.map(compactRow).join('');
}

function styleBrief() {
  const list = document.querySelector('.brief-points');
  if (!list) return;
  const byId = new Map(visibleArticles().map(article => [String(article.id), article]));
  list.querySelectorAll('.brief-point[data-article]').forEach(item => {
    if (item.classList.contains('feedly-brief-row')) return;
    const article = byId.get(String(item.dataset.article));
    if (!article) return;
    const title = item.querySelector('strong')?.textContent || article.title;
    item.classList.add('feedly-brief-row');
    item.innerHTML = `<div class="brief-thumb article-image article-placeholder" aria-hidden="true"></div><div class="brief-copy"><strong>${esc(title)}</strong><span class="brief-meta">${esc(article.source || 'Source')} · ${esc(timeLabel(article.publishedAt))}</span></div>`;
  });
}

function enhance() {
  scheduled = false;
  expandHome();
  makeNewsRolling24h();
  styleBrief();
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(enhance);
}

const root = document.getElementById('app');
if (root) new MutationObserver(scheduleEnhance).observe(root, { childList: true, subtree: true });
window.addEventListener('focus', scheduleEnhance);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleEnhance(); });
scheduleEnhance();
