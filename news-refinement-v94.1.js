(() => {
  'use strict';
  const MODE_KEY = 'news-watch-sensitivity-v1';
  const mode = () => ['strict','normal','large'].includes(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'normal';

  function sections() {
    return [...document.querySelectorAll('.settings-page-v9185 .settings-accordion-v9185')];
  }
  function findSection(title) {
    return sections().find(item => item.querySelector(':scope > summary')?.textContent?.trim() === title);
  }
  function addSettingsHelp() {
    if (!document.querySelector('.settings-page-v9185')) return;
    const notes = {
      'Centres d’intérêt': 'Thèmes larges : ils personnalisent l’Accueil sans exclure le reste de l’actualité.',
      'Mots-clés': 'Précisions de vos centres d’intérêt : ils renforcent la pertinence, sans devenir une veille.',
      'Actualité générale': 'Rubriques de base du fil général, indépendantes de la Veille.'
    };
    Object.entries(notes).forEach(([title, text]) => {
      const body = findSection(title)?.querySelector('.settings-accordion-content-v9185');
      if (!body || body.querySelector('.role-note-v941')) return;
      const p = document.createElement('p');
      p.className = 'muted-note role-note-v941';
      p.textContent = text;
      body.prepend(p);
    });

    const watchBody = findSection('Veille')?.querySelector('.settings-accordion-content-v9185');
    if (!watchBody || watchBody.querySelector('.watch-sensitivity-v941')) return;
    const box = document.createElement('div');
    box.className = 'watch-sensitivity-v941';
    box.innerHTML = '<p class="muted-note role-note-v941">Seuls les sujets ajoutés ici alimentent la Veille. La sensibilité règle à quel point l’article doit être centré sur le sujet.</p><label>Sensibilité<select data-watch-sensitivity-v941><option value="strict">Strict · sujet principal uniquement</option><option value="normal">Normal · article clairement pertinent</option><option value="large">Large · lien pertinent avec le sujet</option></select></label>';
    const select = box.querySelector('select');
    select.value = mode();
    select.addEventListener('change', () => localStorage.setItem(MODE_KEY, select.value));
    watchBody.prepend(box);
  }

  function addBriefExplanation() {
    const title = document.querySelector('.brief-section-title');
    if (!title || title.parentElement.querySelector('.top5-note-v941')) return;
    const p = document.createElement('p');
    p.className = 'muted-note top5-note-v941';
    p.textContent = 'Sélection non personnalisée : importance, fraîcheur, portée mondiale et diversité des sources.';
    title.after(p);
  }

  // This enhancement never removes, hides or rewrites article/source data.
  // Filtering remains in app.js so a presentation preference cannot empty feeds.
  function enhance() { addSettingsHelp(); addBriefExplanation(); }
  const app = document.getElementById('app');
  let pending = false;
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; enhance(); });
  }).observe(app, { childList: true, subtree: true });
  window.addEventListener('news:stable-render', enhance);
  enhance();
})();