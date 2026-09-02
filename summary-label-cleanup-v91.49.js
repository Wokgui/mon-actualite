(() => {
  'use strict';

  const prefix = /^\s*Résumé\s+(?:IA\s+)?vérifié\s*(?:[:–—-]\s*)?/i;
  const centeredLabel = /^\s*Ne plus afficher un thème ou un mot\s*[.:!?]?\s*$/i;

  function polish(root = document) {
    const summaries = [];
    if (root instanceof Element && root.matches('.quick-summary-text')) summaries.push(root);
    root.querySelectorAll?.('.quick-summary-text').forEach(node => summaries.push(node));

    summaries.forEach(node => {
      const paragraph = node.querySelector('.quick-summary-paragraph');
      const target = paragraph || node;
      const before = target.textContent || '';
      const after = before.replace(prefix, '').trimStart();
      if (after !== before.trimStart()) target.textContent = after;
    });

    root.querySelectorAll?.('strong, p, span, small').forEach(node => {
      if (centeredLabel.test(String(node.textContent || '').trim())) node.classList.add('quick-center-label-v9149');
    });
  }

  function start() {
    polish(document);
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.closest?.('.quick-summary-backdrop')) polish(target.closest('.quick-summary-backdrop'));
        mutation.addedNodes?.forEach(node => {
          if (node instanceof Element && (node.matches('.quick-summary-backdrop') || node.closest('.quick-summary-backdrop'))) polish(node.closest('.quick-summary-backdrop') || node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
