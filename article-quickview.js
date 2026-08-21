const QUICK_CACHE_KEY = 'news-factual-summaries-v2';
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
    const title = card.querySelector('h2, .brief-copy strong');
    if (title) title.textContent = titleWithoutSource(article.title, article.source);
    card.setAttribute('aria-label', `Lire : ${titleWithoutSource(article.title, article.source)}`);
    if (card.querySelector('[data-quick-summary]')) return;
    const meta = card.querySelector('.meta, .brief-meta');
    if (!meta) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-summary-tab';
    button.dataset.quickSummary = String(article.id);
    button.textContent = 'Résumé';
    button.setAttribute('aria-label', `Ouvrir le résumé de ${titleWithoutSource(article.title, article.source)}`);
    meta.appendChild(button);
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
    not: ['×', 'Pas intéressé', 'Masquer ce type de sujets'],
    follow: ['☆', 'Sujet à suivre', 'Faire remonter ce sujet']
  };
  const [symbol, title, text] = map[key];
  return `<button type="button" class="quick-feedback-tile ${selected === key ? 'selected' : ''}" data-quick-feedback="${key}">
    <span class="quick-feedback-symbol">${symbol}</span>
    <span><strong>${title}</strong><small>${text}</small></span>
  </button>`;
}

async function quickLoadSummary(article, modal) {
  const key = `article:${article.id}`;
  const cache = quickReadJson(QUICK_CACHE_KEY, {});
  const text = modal.querySelector('[data-quick-summary-text]');
  const label = modal.querySelector('[data-quick-summary-label]');
  if (cache[key]?.summary) {
    text.textContent = quickClean(cache[key].summary);
    label.textContent = cache[key].ai ? 'Résumé IA' : 'Résumé factuel';
    return;
  }

  try {
    const response = await fetch('/api/article-summary-groq?v=9', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        mode: 'article',
        article: {
          url: article.url,
          title: quickClean(article.title),
          summary: quickClean(article.summary)
        }
      })
    });
    const data = response.ok ? await response.json() : null;
    if (!modal.isConnected) return;
    const summary = quickClean(data?.summary || 'Résumé indisponible pour cet article.');
    text.textContent = summary;
    label.textContent = data?.ai ? 'Résumé IA' : 'Résumé factuel';
    if (data?.summary) {
      const latest = quickReadJson(QUICK_CACHE_KEY, {});
      latest[key] = { summary, ai: Boolean(data.ai), savedAt: Date.now() };
      quickWriteJson(QUICK_CACHE_KEY, Object.fromEntries(Object.entries(latest).slice(-180)));
    }
  } catch {
    if (modal.isConnected) {
      text.textContent = 'Résumé indisponible pour le moment.';
      label.textContent = 'Résumé';
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
  const backdrop = document.createElement('div');
  backdrop.className = 'quick-summary-backdrop';
  backdrop.innerHTML = `<section class="quick-summary-sheet" role="dialog" aria-modal="true" aria-label="Résumé de l’article">
    <header class="quick-summary-head">
      <div><span class="quick-summary-kicker" data-quick-summary-label>Résumé en cours…</span><h2>${quickEsc(cleanTitle)}</h2></div>
      <button type="button" class="quick-summary-close" data-quick-close aria-label="Fermer">×</button>
    </header>
    <div class="quick-summary-meta"><span>${quickEsc(article.source || '')}</span><span>${quickEsc(quickTime(article.publishedAt))}</span><span>${quickEsc(article.category || '')}</span></div>
    <div class="quick-summary-text" data-quick-summary-text>Résumé en cours…</div>
    <a class="quick-full-article" href="${quickEsc(article.url || '#')}" target="_blank" rel="noopener noreferrer">Lire l’article complet <span aria-hidden="true">↗</span></a>
    <div class="quick-feedback-grid" data-quick-feedback-grid>
      ${['more','less','not','follow'].map(key => quickFeedbackMarkup(key, current)).join('')}
    </div>
  </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('quick-summary-open');
  quickLoadSummary(article, backdrop);
}

document.addEventListener('click', event => {
  const summaryButton = event.target.closest('[data-quick-summary]');
  if (summaryButton) {
    event.preventDefault();
    event.stopPropagation();
    const article = quickArticle(summaryButton.dataset.quickSummary);
    if (article) openQuickSummary(article);
    return;
  }

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
