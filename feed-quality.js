const BLOCK_KEY = 'news-blocked-terms-v1';
const SUMMARY_CACHE_KEY = 'news-factual-summaries-v2';
const SUMMARY_MIGRATION = 'news-smart-summary-v3';
const previousFetch = window.fetch.bind(window);
let qualityScheduled = false;
let qualityApplying = false;

function qRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function qWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function qNormalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function qEsc(value = '') {
  return String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function articles() {
  const cache = qRead('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}

function articleById(id) {
  return articles().find(article => String(article.id) === String(id || '')) || null;
}

function blockedTerms() {
  return [...new Set(qRead(BLOCK_KEY, []).map(term => String(term || '').trim()).filter(term => term.length >= 2))];
}

function articleHaystack(article) {
  return qNormalize([
    article?.title,
    article?.summary,
    article?.detail,
    article?.category,
    article?.source,
    ...(Array.isArray(article?.tags) ? article.tags : [])
  ].filter(Boolean).join(' '));
}

function blockedBy(article, terms = blockedTerms()) {
  if (!article || !terms.length) return '';
  const haystack = articleHaystack(article);
  return terms.find(term => haystack.includes(qNormalize(term))) || '';
}

function validDirectImage(value = '') {
  try {
    const url = new URL(String(value || ''), location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    const text = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (/logo|avatar|icon|sprite|tracking|pixel|wordmark|favicon|site-logo|google-news|googlenews|google_actualites|google-actualites/i.test(text)) return '';
    if (host === 'news.google.com' || host === 'www.google.com' || host.endsWith('.gstatic.com') || host.endsWith('.googleusercontent.com')) return '';
    return url.href;
  } catch { return ''; }
}

function cachedPublisherImage(article) {
  try {
    const cache = qRead('news-original-images-v3-no-google-logo', {});
    return validDirectImage(cache[String(article?.id || '')] || '');
  } catch { return ''; }
}

function fallbackIllustrationUrl(article) {
  const params = new URLSearchParams({
    v: '4',
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70)
  });
  return `/api/article-photo-fast?${params}`;
}

function smartIllustrationUrl(article) {
  return cachedPublisherImage(article) || validDirectImage(article?.image || '') || fallbackIllustrationUrl(article);
}

function purgeWeakSummaryCache() {
  try {
    if (localStorage.getItem(SUMMARY_MIGRATION) === '1') return;
    for (const key of ['news-factual-summaries-v2', 'news-article-summaries-v4']) {
      const cache = qRead(key, {});
      for (const [entryKey, value] of Object.entries(cache)) {
        const summary = String(value?.summary || '');
        if (value?.unavailable || /résumé indisponible|ouvrez l.article pour consulter|flux ne fournit pas assez/i.test(summary) || summary.length < 55) delete cache[entryKey];
      }
      qWrite(key, cache);
    }
    localStorage.setItem(SUMMARY_MIGRATION, '1');
  } catch {}
}

window.fetch = function smartSummaryFetch(input, init) {
  const raw = typeof input === 'string' ? input : input?.url || '';
  try {
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && ['/api/article-summary', '/api/article-summary-v3', '/api/article-summary-groq'].includes(url.pathname)) {
      const next = new URL('/api/article-summary-smart', location.origin);
      next.searchParams.set('v', '2');
      const nextInput = typeof input === 'string' ? `${next.pathname}${next.search}` : new Request(next.href, input);
      return previousFetch(nextInput, init);
    }
  } catch {}
  return previousFetch(input, init);
};

function ensureCardImage(card) {
  let image = card.querySelector('img.article-image, img.brief-thumb, img.original-article-image, img.direct-thumb');
  if (image) return image;
  const placeholder = card.querySelector('.article-placeholder, .brief-thumb.article-placeholder');
  if (!placeholder) return null;
  image = document.createElement('img');
  image.alt = '';
  image.className = placeholder.classList.contains('brief-thumb')
    ? 'brief-thumb article-image original-article-image'
    : 'article-image original-article-image';
  placeholder.replaceWith(image);
  return image;
}

function enhanceImages() {
  document.querySelectorAll('[data-article]').forEach((card, index) => {
    const article = articleById(card.dataset.article);
    if (!article) return;
    const image = ensureCardImage(card);
    if (!image) return;

    if (image.dataset.imageStableV4 === '1') return;

    const direct = cachedPublisherImage(article) || validDirectImage(article?.image || '');
    const fallback = fallbackIllustrationUrl(article);
    const wanted = direct || fallback;

    image.classList.remove('direct-thumb');
    image.removeAttribute('data-thumbnail-fallback');
    image.removeAttribute('data-fallback-applied');
    image.removeAttribute('referrerpolicy');

    if (index < 6) image.loading = 'eager';
    else image.loading = 'lazy';
    if (index < 3) image.fetchPriority = 'high';
    image.decoding = 'async';

    image.dataset.imageStableV4 = '1';
    image.dataset.imageFallbackV4 = direct ? '0' : '1';

    image.onerror = () => {
      if (image.dataset.imageFallbackV4 === '1') return;
      image.dataset.imageFallbackV4 = '1';
      image.src = fallback;
    };

    image.src = wanted;
  });
}

function applyBlockedCards() {
  const terms = blockedTerms();
  if (!terms.length) return;
  document.querySelectorAll('[data-article]').forEach(card => {
    const article = articleById(card.dataset.article);
    const term = blockedBy(article, terms);
    if (!term) return;
    card.remove();
  });
}

function canonicalArticleUrl(article) {
  try {
    const url = new URL(article?.url || '');
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch { return ''; }
}

function removeDuplicateCards() {
  document.querySelectorAll('.feed').forEach(feed => {
    const seenTitles = new Set();
    const seenUrls = new Set();
    [...feed.querySelectorAll(':scope > .article-card[data-article], :scope > .brief-point[data-article]')].forEach(card => {
      const article = articleById(card.dataset.article);
      if (!article) return;
      const titleKey = qNormalize(article.title || '').replace(/\b(le parisien|le monde|le figaro|ouest france|rmc sport|radio classique)\b$/i, '').trim();
      const urlKey = canonicalArticleUrl(article);
      const duplicate = (titleKey && seenTitles.has(titleKey)) || (urlKey && seenUrls.has(urlKey));
      if (duplicate) {
        card.remove();
        return;
      }
      if (titleKey) seenTitles.add(titleKey);
      if (urlKey) seenUrls.add(urlKey);
    });
  });
}

function diversifyHome() {
  if (!document.querySelector('.nav-item.active[data-view="home"]')) return;
  const feed = document.querySelector('.page .feed');
  if (!feed) return;
  const cards = [...feed.children].filter(node => node.matches?.('.article-card[data-article]'));
  if (cards.length < 3) return;
  const signature = cards.map(card => card.dataset.article).join('|');
  if (feed.dataset.qualityOrder === signature) return;

  const groups = new Map();
  cards.forEach((card, index) => {
    const article = articleById(card.dataset.article);
    const source = qNormalize(article?.source || article?.feedTitle || 'source') || 'source';
    if (!groups.has(source)) groups.set(source, { source, cards: [], first: index });
    groups.get(source).cards.push(card);
  });

  if (groups.size < 2) {
    feed.dataset.qualityOrder = signature;
    return;
  }

  const queue = [...groups.values()].sort((a, b) => a.first - b.first);
  const ordered = [];
  while (queue.length) {
    const group = queue.shift();
    const card = group.cards.shift();
    if (card) ordered.push(card);
    if (group.cards.length) queue.push(group);
  }
  ordered.forEach(card => feed.appendChild(card));
  feed.dataset.qualityOrder = ordered.map(card => card.dataset.article).join('|');
}

function chipsMarkup() {
  const terms = blockedTerms();
  if (!terms.length) return '<span class="block-empty">Aucun thème masqué.</span>';
  return terms.map(term => `<span class="block-chip">${qEsc(term)}<button type="button" data-remove-block="${qEsc(term)}" aria-label="Réafficher ${qEsc(term)}">×</button></span>`).join('');
}

function managerMarkup(compact = false) {
  return `<div class="block-manager ${compact ? 'compact' : ''}" data-block-manager>
    ${compact ? '' : '<h3>Ne plus afficher</h3><p>Ajoutez un thème, un nom ou un mot. Les articles qui le contiennent seront écartés.</p>'}
    <form class="block-form" data-block-form><input type="text" maxlength="70" placeholder="Ex. football, faits divers, people…" data-block-input><button type="submit">Masquer</button></form>
    <div class="block-chips" data-block-chips>${chipsMarkup()}</div>
  </div>`;
}

function updateManagers() {
  document.querySelectorAll('[data-block-chips]').forEach(node => { node.innerHTML = chipsMarkup(); });
}

function injectManagers() {
  const sheet = document.querySelector('.sheet');
  if (sheet && !sheet.querySelector('[data-block-manager]')) sheet.insertAdjacentHTML('beforeend', managerMarkup(false));

  const page = document.querySelector('.page');
  if (page?.querySelector('.settings-section') && !page.querySelector('.settings-block-section')) {
    const section = document.createElement('section');
    section.className = 'settings-section settings-block-section';
    section.innerHTML = managerMarkup(false);
    const reset = page.querySelector('[data-reset]');
    if (reset) reset.insertAdjacentElement('beforebegin', section); else page.appendChild(section);
  }

  const quick = document.querySelector('.quick-summary-sheet');
  if (quick && !quick.querySelector('[data-block-manager]')) {
    const grid = quick.querySelector('.quick-feedback-grid');
    if (grid) grid.insertAdjacentHTML('afterend', managerMarkup(true));
  }
}

function addBlockedTerm(raw) {
  const term = String(raw || '').trim().replace(/\s+/g, ' ');
  if (term.length < 2) return;
  const terms = blockedTerms();
  if (!terms.some(existing => qNormalize(existing) === qNormalize(term))) terms.push(term);
  qWrite(BLOCK_KEY, terms.slice(0, 40));
  updateManagers();
  applyBlockedCards();
  removeDuplicateCards();
  diversifyHome();
  const quick = document.querySelector('.quick-summary-backdrop');
  if (quick) {
    quick.remove();
    document.body.classList.remove('quick-summary-open');
  }
}

function removeBlockedTerm(term) {
  const normalized = qNormalize(term);
  qWrite(BLOCK_KEY, blockedTerms().filter(item => qNormalize(item) !== normalized));
  window.location.reload();
}

function applyQuality() {
  if (qualityApplying) return;
  qualityApplying = true;
  try {
    injectManagers();
    applyBlockedCards();
    removeDuplicateCards();
    enhanceImages();
    diversifyHome();
  } finally {
    qualityApplying = false;
  }
}

function scheduleQuality() {
  if (qualityScheduled) return;
  qualityScheduled = true;
  requestAnimationFrame(() => {
    qualityScheduled = false;
    applyQuality();
  });
}

document.addEventListener('submit', event => {
  const form = event.target.closest?.('[data-block-form]');
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector('[data-block-input]');
  addBlockedTerm(input?.value || '');
  if (input) input.value = '';
}, true);

document.addEventListener('click', event => {
  const remove = event.target.closest?.('[data-remove-block]');
  if (!remove) return;
  event.preventDefault();
  event.stopPropagation();
  removeBlockedTerm(remove.dataset.removeBlock || '');
}, true);

purgeWeakSummaryCache();
const root = document.getElementById('app');
if (root) new MutationObserver(scheduleQuality).observe(root, { childList: true, subtree: true });
window.addEventListener('focus', scheduleQuality);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleQuality(); });
scheduleQuality();
