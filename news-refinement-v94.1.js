(() => {
  const MODE_KEY = 'news-watch-sensitivity-v1';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const articleMap = () => new Map((read('news-live-cache', {}).articles || []).map(article => [String(article.id || ''), article]));
  const rules = () => (read('news-watch-rules-v1', []) || []).filter(rule => rule && String(rule.query || '').trim());
  const mode = () => ['strict','normal','large'].includes(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'normal';
  const terms = query => String(query || '').split('|').flatMap(group => group.split('+')).map(normalize).filter(Boolean);
  const contains = (text, term) => term.length <= 3 && !term.includes(' ') ? (` ${text} `).includes(` ${term} `) : text.includes(term);

  function relevant(article, rule, sensitivity) {
    const wanted = terms(rule.query);
    if (!wanted.length) return false;
    const title = normalize(article.title);
    const summary = normalize(article.summary || article.detail);
    const tags = normalize([article.category, ...(Array.isArray(article.tags) ? article.tags : []), ...(Array.isArray(article.matches) ? article.matches : [])].join(' '));
    const all = `${title} ${summary} ${tags}`;
    const excluded = String(rule.exclude || '').split(/[,|]/).map(normalize).filter(Boolean);
    if (excluded.some(term => contains(all, term))) return false;
    const titleHits = wanted.filter(term => contains(title, term)).length;
    const summaryHits = wanted.filter(term => contains(summary, term)).length;
    const allHits = wanted.filter(term => contains(all, term)).length;
    if (sensitivity === 'large') return allHits > 0;
    if (sensitivity === 'strict') return titleHits > 0 && (wanted.length === 1 ? summaryHits > 0 || normalize(article.category) === wanted[0] : titleHits >= Math.min(2, wanted.length));
    return titleHits > 0 || (summaryHits > 0 && tags && wanted.some(term => contains(tags, term)));
  }

  function refineWatchDom() {
    if (!document.querySelector('.watch-layout-v9138')) return;
    const byId = articleMap();
    const active = rules();
    const sensitivity = mode();
    document.querySelectorAll('.watch-filtered-feed-v9138 .article-card[data-article]').forEach(card => {
      const article = byId.get(String(card.dataset.article || ''));
      const keep = article && active.some(rule => relevant(article, rule, sensitivity));
      card.hidden = !keep;
    });
    document.querySelectorAll('.watch-day-v9138').forEach(day => {
      const feed = day.querySelector('.watch-filtered-feed-v9138');
      if (!feed) return;
      const visible = [...feed.querySelectorAll('.article-card[data-article]')].some(card => !card.hidden);
      let empty = day.querySelector('.watch-refined-empty-v941');
      if (!visible && !empty) {
        empty = document.createElement('p');
        empty.className = 'watch-empty-day-v9138 watch-refined-empty-v941';
        empty.textContent = 'Aucune nouveauté suffisamment centrée sur vos sujets de veille ce jour-là.';
        feed.after(empty);
      } else if (visible && empty) empty.remove();
    });
  }

  function addSettingsHelp() {
    const settings = document.querySelector('.settings-page-v9185');
    if (!settings) return;
    const sections = [...settings.querySelectorAll('.settings-accordion-v9185')];
    const find = title => sections.find(item => item.querySelector(':scope > summary')?.textContent?.trim() === title);
    const notes = {
      'Centres d’intérêt': 'Thèmes larges : ils personnalisent l’Accueil sans exclure le reste de l’actualité.',
      'Mots-clés': 'Précisions de vos centres d’intérêt : ils donnent un bonus de pertinence, ce ne sont pas des veilles.',
      'Actualité générale': 'Rubriques de base du fil général. Elles restent distinctes de vos centres d’intérêt et de vos veilles.'
    };
    Object.entries(notes).forEach(([title, text]) => {
      const body = find(title)?.querySelector('.settings-accordion-content-v9185');
      if (!body || body.querySelector('.role-note-v941')) return;
      const p = document.createElement('p'); p.className = 'muted-note role-note-v941'; p.textContent = text; body.prepend(p);
    });
    const watchBody = find('Veille')?.querySelector('.settings-accordion-content-v9185');
    if (watchBody && !watchBody.querySelector('.watch-sensitivity-v941')) {
      const box = document.createElement('div');
      box.className = 'watch-sensitivity-v941';
      box.innerHTML = '<p class="muted-note role-note-v941">Surveillance séparée : seuls les sujets ajoutés ici alimentent l’onglet Veille. Le sujet doit être réellement au centre de l’article.</p><label>Sensibilité <select data-watch-sensitivity-v941><option value="strict">Strict · information vraiment centrée sur le sujet</option><option value="normal">Normal · pertinent et centré</option><option value="large">Large · toute mention pertinente</option></select></label>';
      const select = box.querySelector('select'); select.value = mode();
      select.addEventListener('change', () => { localStorage.setItem(MODE_KEY, select.value); refineWatchDom(); });
      watchBody.prepend(box);
    }
  }

  function addBriefExplanation() {
    const title = document.querySelector('.brief-section-title');
    if (!title || title.parentElement.querySelector('.top5-note-v941')) return;
    const p = document.createElement('p');
    p.className = 'muted-note top5-note-v941';
    p.textContent = 'Sélection non personnalisée : importance, fraîcheur, portée mondiale, diversité des sources et confirmation par plusieurs sources.';
    title.after(p);
  }

  function enhance() { addSettingsHelp(); addBriefExplanation(); refineWatchDom(); }
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => requestAnimationFrame(enhance)).observe(app, { childList: true, subtree: true });
  window.addEventListener('news:stable-render', enhance);
  enhance();
})();