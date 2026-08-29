const QUICK_CACHE_KEY = 'news-article-summaries-v7';
let quickScheduled = false;

function quickReadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function quickWriteJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function quickClean(value = '') {
  return String(value ?? '')
    .replace(/&rsquo;/gi, '’').replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“').replace(/&rdquo;/gi, '”')
    .replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/\uFFFD+/g, '').trim();
}

function quickEsc(value = '') {
  return quickClean(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function quickUnavailable(value = '') {
  const text = quickClean(value).toLowerCase();
  return !text
    || /résumé indisponible/.test(text)
    || /ouvrez?\s+l[’']article/.test(text)
    || /consultez?\s+(?:les?\s+)?détails/.test(text)
    || /détails publiés par la source/.test(text)
    || /pour\s+(?:sauvegarder|enregistrer|mémoriser|partager|commenter|lire)\s+(?:(?:cet|cette|un|une|l[’']?)\s*)?article/.test(text);
}

function quickArticleSummary(article = {}) {
  const value = quickClean(article.summary || '');
  if (quickUnavailable(value) || value.length < 60) return '';
  try {
    if (new URL(String(article.url || ''), location.href).hostname === 'news.google.com') return '';
  } catch {}
  const lower = value.toLowerCase();
  const sources = [...new Set([article.source, ...(article.sources || [])].map(quickClean).filter(Boolean))];
  if (sources.filter(source => lower.includes(source.toLowerCase())).length >= 2) return '';
  return value;
}

function quickProvisionalSummary(article = {}) {
  const factual = quickArticleSummary(article);
  if (factual) return factual;
  const title = titleWithoutSource(article.title, article.source);
  const source = quickClean(article.source || '');
  if (title && source) return `Cet article de ${source} porte sur : ${title}.`;
  if (title) return `Le sujet principal de cet article est : ${title}.`;
  return 'La synthèse détaillée de cet article est en cours de préparation.';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleWithoutSource(title = '', source = '') {
  let result = quickClean(title).replace(/\s+/g, ' ').trim();
  const cleanSource = quickClean(source).replace(/\s+/g, ' ').trim();
  if (!result) return result;
  if (cleanSource) {
    const variants = [...new Set([
      cleanSource,
      cleanSource.replace(/^www\./i, ''),
      cleanSource.replace(/\.(com|fr|eu|org|net)$/i, '')
    ].filter(Boolean))];
    for (const variant of variants) {
      const rx = new RegExp(`\\s*(?:[-–—|·:]\\s*)${escapeRegExp(variant)}\\s*$`, 'i');
      const stripped = result.replace(rx, '').trim();
      if (stripped !== result) return stripped;
    }
  }
  const trailing = result.match(/^(.*\S)\s+[-–—|]\s+([^–—|]{2,42})$/);
  if (trailing) {
    const suffix = trailing[2].trim();
    if (/\.(?:com|fr|eu|org|net|be|ch|co\.uk)$/i.test(suffix) || /^(?:le |la |les |l['’])?[A-ZÀ-ÖØ-Ý][\wÀ-ÿ.'’ -]{1,35}$/u.test(suffix)) {
      return trailing[1].trim();
    }
  }
  return result;
}

function quickArticles() {
  const cache = quickReadJson('news-live-cache', {});
  return Array.isArray(cache.articles) ? cache.articles : [];
}

function quickArticle(id) {
  return quickArticles().find(article => String(article.id) === String(id || '')) || null;
}

function quickTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (minutes < 1440) return `Il y a ${Math.floor(minutes / 60)} h`;
  return `Il y a ${Math.floor(minutes / 1440)} j`;
}

function enhanceArticleTitlesAndTabs() {
  document.querySelectorAll('[data-article]').forEach(card => {
    const article = quickArticle(card.dataset.article);
    if (!article) return;
    const cleanTitle = titleWithoutSource(article.title, article.source);
    const title = card.querySelector('h2, .brief-copy strong');
    if (title) title.textContent = cleanTitle;
    card.setAttribute('aria-label', `Ouvrir le résumé : ${cleanTitle}`);
    card.querySelectorAll('[data-quick-summary]').forEach(node => node.remove());
  });

  const detail = document.querySelector('.detail-page');
  if (detail) {
    const id = detail.querySelector('[data-save]')?.dataset.save;
    const article = quickArticle(id);
    const h1 = detail.querySelector('.detail-content > h1');
    if (article && h1) h1.textContent = titleWithoutSource(article.title, article.source);
  }
}

function quickFeedbackMarkup(key, selected) {
  const map = {
    more: ['+', 'Plus comme ça', 'Davantage de sujets similaires'],
    less: ['−', 'Moins comme ça', 'Réduire ce type de sujets'],
    not: ['×', 'Pas intéressé', 'Masquer cet article et ses sujets proches'],
    follow: ['☆', 'Sujet à suivre', 'Suivre précisément le sujet de cet article']
  };
  const [symbol, title, text] = map[key];
  return `<button type="button" class="quick-feedback-tile ${selected === key ? 'selected' : ''}" data-quick-feedback="${key}">
    <span class="quick-feedback-symbol">${symbol}</span>
    <span><strong>${title}</strong><small>${text}</small></span>
  </button>`;
}

function quickTopicFeedbackMarkup(article) {
  const preferences = quickReadJson('news-topic-preferences-v1', {});
  const topics = [...new Set([article?.category, ...(article?.tags || []), ...(article?.matches || [])]
    .map(value => String(value || '').trim())
    .filter(value => value && value !== 'À suivre'))].slice(0, 3);
  if (!topics.length) return '';
  return `<section class="quick-topic-feedback"><strong>Réglage général des thèmes</strong><p>Les boutons − / + modifient toute une catégorie (par exemple Politique), dans tous les articles. Ils ne concernent pas uniquement cet article.</p><div class="quick-topic-list">${topics.map(topic => {
    const value = Number(preferences[topic] || 0);
    return `<div class="quick-topic-row"><span>${quickEsc(topic)}</span><div><button type="button" class="${value < 0 ? 'selected' : ''}" data-topic-feedback="${quickEsc(topic)}" data-topic-direction="less" aria-label="Moins de ${quickEsc(topic)}">−</button><button type="button" class="${value > 0 ? 'selected' : ''}" data-topic-feedback="${quickEsc(topic)}" data-topic-direction="more" aria-label="Plus de ${quickEsc(topic)}">+</button></div></div>`;
  }).join('')}</div></section>`;
}

async function quickLoadSummary(article, modal) {
  const key = `article:${article.id}`;
  const cache = quickReadJson(QUICK_CACHE_KEY, {});
  const text = modal.querySelector('[data-quick-summary-text]');
  const fallback = quickProvisionalSummary(article);
  const cached = cache[key];
  if (cached?.summary && !cached.unavailable && !quickUnavailable(cached.summary)) {
    text.textContent = quickClean(cached.summary);
    return;
  }

  try {
    const response = await fetch('/api/article-summary-groq?v=16', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        mode: 'article',
        article: {
          url: article.url,
          title: quickClean(article.title),
          summary: quickArticleSummary(article),
          source: quickClean(article.source || '')
        }
      })
    });
    const data = response.ok ? await response.json() : null;
    if (!modal.isConnected) return;

    if (data?.unavailable || quickUnavailable(data?.summary)) {
      text.textContent = fallback;
      return;
    }

    const summary = quickClean(data?.summary || '');
    if (!summary) {
      text.textContent = fallback;
      return;
    }

    text.textContent = summary;
    const latest = quickReadJson(QUICK_CACHE_KEY, {});
    latest[key] = { summary, ai: Boolean(data.ai), unavailable: false, savedAt: Date.now() };
    quickWriteJson(QUICK_CACHE_KEY, Object.fromEntries(Object.entries(latest).slice(-180)));
  } catch {
    if (modal.isConnected) {
      text.textContent = fallback;
    }
  }
}

function closeQuickSummary() {
  document.querySelector('.quick-summary-backdrop')?.remove();
  document.body.classList.remove('quick-summary-open');
}

function openQuickSummary(article) {
  closeQuickSummary();
  const feedback = quickReadJson('news-feedback', {});
  const current = feedback[article.id] || '';
  const cleanTitle = titleWithoutSource(article.title, article.source);
  const immediate = quickProvisionalSummary(article);
  const visualUrl = quickClean(article.quickVisualUrl || article.visual?.url || article.image || '');
  const backdrop = document.createElement('div');
  backdrop.className = 'quick-summary-backdrop';
  backdrop.innerHTML = `<section class="quick-summary-sheet" role="dialog" aria-modal="true" aria-label="Résumé de l’article">
    <header class="quick-summary-head">
      <h2>${quickEsc(cleanTitle)}</h2>
      <button type="button" class="quick-summary-close" data-quick-close aria-label="Fermer">×</button>
    </header>
    ${visualUrl ? `<img class="quick-summary-image" src="${quickEsc(visualUrl)}" alt="" referrerpolicy="no-referrer" decoding="async">` : ''}
    <div class="quick-summary-meta"><span>${quickEsc(article.source || '')}</span><span>${quickEsc(quickTime(article.publishedAt))}</span><span>${quickEsc(article.category || '')}</span></div>
    <div class="quick-summary-text" data-quick-summary-text>${quickEsc(immediate)}</div>
    <a class="quick-full-article" href="${quickEsc(article.url || '#')}" target="_blank" rel="noopener noreferrer">Lire l’article complet <span aria-hidden="true">↗</span></a>
    ${quickTopicFeedbackMarkup(article)}
    <p class="quick-feedback-help"><strong>Choix sur cet article</strong> « Pas intéressé » réduit les sujets semblables ; « Sujet à suivre » surveille au contraire ce sujet précis.</p>
    <div class="quick-feedback-grid quick-feedback-secondary" data-quick-feedback-grid>
      ${['not','follow'].map(key => quickFeedbackMarkup(key, current)).join('')}
    </div>
  </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('quick-summary-open');
  quickLoadSummary(article, backdrop);
}

document.addEventListener('click', event => {
  if (event.target.matches('.quick-summary-backdrop') || event.target.closest('[data-quick-close]')) {
    event.preventDefault();
    closeQuickSummary();
    return;
  }

  const feedbackButton = event.target.closest('[data-quick-feedback]');
  if (feedbackButton) {
    event.preventDefault();
    const modal = feedbackButton.closest('.quick-summary-backdrop');
    const title = modal?.querySelector('.quick-summary-head h2')?.textContent || '';
    const article = quickArticles().find(item => titleWithoutSource(item.title, item.source) === title);
    if (!article) return;
    const feedback = quickReadJson('news-feedback', {});
    feedback[article.id] = feedbackButton.dataset.quickFeedback;
    quickWriteJson('news-feedback', feedback);
    modal.querySelectorAll('[data-quick-feedback]').forEach(button => button.classList.toggle('selected', button === feedbackButton));
    window.dispatchEvent(new Event('focus'));
    return;
  }

  const topicButton = event.target.closest('[data-topic-feedback]');
  if (topicButton) {
    event.preventDefault();
    const topic = quickClean(topicButton.dataset.topicFeedback || '');
    const direction = topicButton.dataset.topicDirection;
    if (!topic || !['less', 'more'].includes(direction)) return;
    const preferences = quickReadJson('news-topic-preferences-v1', {});
    const next = direction === 'more' ? 1 : -1;
    preferences[topic] = Number(preferences[topic] || 0) === next ? 0 : next;
    quickWriteJson('news-topic-preferences-v1', preferences);
    const row = topicButton.closest('.quick-topic-row');
    row?.querySelectorAll('[data-topic-feedback]').forEach(button => button.classList.toggle('selected', Number(preferences[topic] || 0) === (button.dataset.topicDirection === 'more' ? 1 : -1)));
    window.dispatchEvent(new CustomEvent('news-topic-preferences-changed', { detail: preferences }));
    return;
  }

  const card = event.target.closest('[data-article]');
  if (card && !event.target.closest('button, input, select, textarea')) {
    const article = quickArticle(card.dataset.article);
    if (!article) return;
    event.preventDefault();
    event.stopPropagation();
    const renderedImage = card.querySelector('img.article-image');
    openQuickSummary({ ...article, quickVisualUrl: renderedImage?.currentSrc || renderedImage?.getAttribute('src') || '' });
  }
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.querySelector('.quick-summary-backdrop')) closeQuickSummary();
});

function scheduleQuickEnhance() {
  if (quickScheduled) return;
  quickScheduled = true;
  requestAnimationFrame(() => {
    quickScheduled = false;
    enhanceArticleTitlesAndTabs();
  });
}

const quickRoot = document.getElementById('app');
if (quickRoot) new MutationObserver(scheduleQuickEnhance).observe(quickRoot, { childList: true, subtree: true });
window.addEventListener('focus', scheduleQuickEnhance);
scheduleQuickEnhance();