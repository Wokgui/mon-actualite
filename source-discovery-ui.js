function rewriteDiscoverySourceSettings() {
  const sections = [...document.querySelectorAll('.settings-section')];
  const section = sections.find(node => /sources personnelles/i.test(node.querySelector('h2')?.textContent || ''));
  if (!section) return;

  const intro = section.querySelector(':scope > p');
  if (intro) {
    intro.textContent = 'Ces sources servent de sources de découverte : elles ajoutent des sujets possibles, mais leurs articles ne sont jamais affichés automatiquement. Les thèmes que vous favorisez sont ensuite recherchés dans de nombreux médias.';
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
    note.textContent = 'Le bouton + sur un thème signifie désormais : chercher davantage ce thème dans l’ensemble des sources disponibles, pas seulement dans le média où vous l’avez découvert.';
    section.appendChild(note);
  }
}

let scheduled = false;
function scheduleRewrite() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    rewriteDiscoverySourceSettings();
  });
}

const app = document.getElementById('app');
if (app) new MutationObserver(scheduleRewrite).observe(app, { childList: true, subtree: true });
window.addEventListener('focus', scheduleRewrite);
scheduleRewrite();