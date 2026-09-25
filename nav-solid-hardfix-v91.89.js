(() => {
  'use strict';

  const icons = {
    home: '<svg class="nav-solid-hard-v9189" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8 2.8 10.4a1 1 0 0 0 .64 1.76H5v8.1A1.74 1.74 0 0 0 6.74 22h3.7v-6.2h3.12V22h3.7A1.74 1.74 0 0 0 19 20.26v-8.1h1.56a1 1 0 0 0 .64-1.76L12 2.8Z"/></svg>',
    settings: '<svg class="nav-solid-hard-v9189" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10.55 2h2.9l.5 2.05a8.2 8.2 0 0 1 1.67.7l1.8-.98 2.05 2.05-.98 1.8c.3.53.54 1.08.7 1.67l2.05.5v2.9l-2.05.5a8.2 8.2 0 0 1-.7 1.67l.98 1.8-2.05 2.05-1.8-.98a8.2 8.2 0 0 1-1.67.7l-.5 2.05h-2.9l-.5-2.05a8.2 8.2 0 0 1-1.67-.7l-1.8.98-2.05-2.05.98-1.8a8.2 8.2 0 0 1-.7-1.67l-2.05-.5v-2.9l2.05-.5c.16-.59.4-1.14.7-1.67l-.98-1.8 2.05-2.05 1.8.98a8.2 8.2 0 0 1 1.67-.7l.5-2.05ZM12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z" clip-rule="evenodd"/></svg>',
    brief: '<svg class="nav-solid-hard-v9189" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2.5" fill="currentColor"/><path d="M8 7.3h8M8 11.4h8M8 15.5h5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  function apply() {
    document.querySelectorAll('.bottom-nav [data-view]').forEach(button => {
      const view = button.getAttribute('data-view');
      if (!icons[view]) return;
      const existing = button.querySelector('svg');
      if (existing?.classList.contains('nav-solid-hard-v9189')) return;
      if (existing) existing.outerHTML = icons[view];
      else button.insertAdjacentHTML('afterbegin', icons[view]);
    });
  }

  // Keep this hard-fix deliberately limited to navigation. Feature scripts
  // must be loaded explicitly by index.html so a UI enhancement can never
  // interfere with the startup/news pipeline.
  apply();
  const target = document.getElementById('app') || document.body;
  new MutationObserver(() => requestAnimationFrame(apply)).observe(target, { childList: true, subtree: true });
  window.addEventListener('pageshow', apply);
  window.addEventListener('news:stable-render', apply);
})();