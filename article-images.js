function readCachedArticles() {
  try {
    const cached = JSON.parse(localStorage.getItem('news-live-cache') || '{}');
    return Array.isArray(cached.articles) ? cached.articles : [];
  } catch {
    return [];
  }
}

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function loadOriginalImage(placeholder, article, detail = false) {
  if (!placeholder || placeholder.dataset.imageAttempted === '1') return;
  placeholder.dataset.imageAttempted = '1';

  const src = validImageUrl(article?.image);
  if (!src) return;

  const image = new Image();
  image.className = detail ? 'detail-hero original-article-image' : 'article-image original-article-image';
  image.alt = '';
  image.loading = detail ? 'eager' : 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    if (placeholder.isConnected) placeholder.replaceWith(image);
  };
  image.src = src;
}

function applyOriginalArticleImages() {
  const articles = readCachedArticles();
  if (!articles.length) return;
  const byId = new Map(articles.map(article => [String(article.id), article]));

  document.querySelectorAll('.article-card[data-article]').forEach(card => {
    const article = byId.get(String(card.dataset.article));
    loadOriginalImage(card.querySelector('.article-placeholder'), article, false);
  });

  const detailPage = document.querySelector('.detail-page');
  if (detailPage) {
    const id = detailPage.querySelector('.save-btn-detail[data-save]')?.dataset.save;
    loadOriginalImage(detailPage.querySelector('.detail-hero.article-placeholder'), byId.get(String(id || '')), true);
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new MutationObserver(() => applyOriginalArticleImages()).observe(appRoot, { childList: true, subtree: true });
}

window.addEventListener('storage', event => {
  if (event.key === 'news-live-cache') applyOriginalArticleImages();
});

applyOriginalArticleImages();
