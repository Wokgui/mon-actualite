(() => {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;

  const svg = name => {
    const icons = {
      menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
      bookmark:'<svg viewBox="0 0 24 24"><path d="M6.5 4.5h11v15l-5.5-3.6-5.5 3.6z"/></svg>',
      search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
      check:'<svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>',
      more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
      back:'<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
      home:'<svg viewBox="0 0 24 24"><path d="m4 11 8-7 8 7v9h-6v-6h-4v6H4z"/></svg>',
      grid:'<svg viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/></svg>',
      star:'<svg viewBox="0 0 24 24"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/></svg>',
      settings:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A7 7 0 0 0 14.7 6L14.3 3h-4.6l-.4 3a7 7 0 0 0-1.7 1.1l-2.5-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1A7 7 0 0 0 9.3 18l.4 3h4.6l.4-3a7 7 0 0 0 1.7-1.1l2.5 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/></svg>',
      refresh:'<svg viewBox="0 0 24 24"><path d="M19 7v5h-5M5 17v-5h5"/><path d="M18 10a7 7 0 0 0-12-2M6 14a7 7 0 0 0 12 2"/></svg>'
    };
    return icons[name] || icons.grid;
  };

  const isHome = () => !!app.querySelector('.hero-header');
  const allCards = () => [...app.querySelectorAll('.article-card[data-article]')];
  const readKey = 'news-grey-after-scroll-v9138-v1';

  function readIds() {
    try { return new Set((JSON.parse(localStorage.getItem(readKey) || '[]') || []).map(String)); }
    catch { return new Set(); }
  }

  function persistReadIds(set) {
    localStorage.setItem(readKey, JSON.stringify([...set].slice(-2400)));
  }

  function syncReadVisuals() {
    const ids = readIds();
    allCards().forEach(card => card.classList.toggle('feedly-read', ids.has(String(card.dataset.article || ''))));
  }

  function markAllRead() {
    const ids = readIds();
    allCards().forEach(card => {
      const id = String(card.dataset.article || '');
      if (id) ids.add(id);
      card.classList.add('feedly-read');
    });
    persistReadIds(ids);
    toast('Articles marqués comme lus');
  }

  function markAllUnread() {
    localStorage.setItem(readKey, '[]');
    allCards().forEach(card => card.classList.remove('feedly-read','read-passed-v9138'));
    toast('Articles remis en non lus');
  }

  function toast(message) {
    let node = document.getElementById('feedly-shell-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'feedly-shell-toast';
      node.style.cssText = 'position:fixed;z-index:5000;left:50%;bottom:84px;transform:translateX(-50%);background:#2f2f2f;color:#fff;padding:9px 14px;border-radius:4px;font:500 12px system-ui;opacity:0;transition:.16s;pointer-events:none;white-space:nowrap';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = '1';
    clearTimeout(node._timer);
    node._timer = setTimeout(() => { node.style.opacity = '0'; }, 1700);
  }

  function sectionizeHome() {
    const feed = app.querySelector('[data-stable-home-feed]');
    if (!feed) return;
    feed.querySelectorAll(':scope > .feedly-section-label').forEach(node => node.remove());
    const cards = [...feed.querySelectorAll(':scope > .article-card[data-article]')];
    if (!cards.length) return;
    const popular = document.createElement('div');
    popular.className = 'feedly-section-label';
    popular.textContent = 'Most popular';
    feed.insertBefore(popular, cards[0]);
    if (cards.length > 3) {
      const today = document.createElement('div');
      today.className = 'feedly-section-label';
      today.textContent = 'Today';
      feed.insertBefore(today, cards[3]);
    }
  }

  function ensureHomeBar() {
    const existingBar = app.querySelector('.feedly-home-bar');
    const existingTabs = app.querySelector('.feedly-mode-tabs');
    if (!isHome()) {
      existingBar?.remove();
      existingTabs?.remove();
      return;
    }
    const main = app.querySelector('main.page');
    if (!main) return;
    if (!existingBar) {
      const bar = document.createElement('header');
      bar.className = 'feedly-home-bar';
      bar.innerHTML = '<button class="feedly-avatar" data-feedly-menu aria-label="Menu">ME</button><h1>Today</h1><div class="feedly-home-actions"><button class="feedly-action" data-feedly-mark-read aria-label="Tout marquer comme lu">'+svg('check')+'</button><button class="feedly-action" data-feedly-more aria-label="Plus d’options">'+svg('more')+'</button></div>';
      app.insertBefore(bar, main);
    }
    if (!existingTabs) {
      const tabs = document.createElement('div');
      tabs.className = 'feedly-mode-tabs';
      tabs.innerHTML = '<button class="active" type="button">Me</button><button type="button" data-view="brief">Explore</button>';
      const feed = main.querySelector('[data-stable-home-feed]');
      if (feed) main.insertBefore(tabs, feed);
    }
  }

  function ensureBottomNav() {
    app.querySelectorAll('.bottom-nav').forEach(nav => {
      if (nav.classList.contains('feedly-bottom-nav')) return;
      nav.className = 'bottom-nav feedly-bottom-nav';
      nav.innerHTML =
        '<button type="button" data-feedly-menu aria-label="Menu">'+svg('menu')+'</button>'+
        '<button type="button" class="feedly-add" data-view="sheet" aria-label="Ajouter et personnaliser">'+svg('plus')+'</button>'+
        '<button type="button" data-feedly-saved aria-label="Lire plus tard">'+svg('bookmark')+'</button>'+
        '<button type="button" data-feedly-search aria-label="Rechercher">'+svg('search')+'</button>';
    });
  }

  function drawerMarkup() {
    const categories = ['Politique','International','Europe','Économie','Société','Santé','Environnement','Science','Culture','Éducation','IA','Tech','Smartphones','VR','Automobile','Énergie'];
    const saved = (() => { try { return (JSON.parse(localStorage.getItem('news-saved') || '[]') || []).length; } catch { return 0; } })();
    return '<div class="feedly-drawer-backdrop" data-feedly-drawer-backdrop>'+
      '<aside class="feedly-drawer" role="dialog" aria-modal="true" aria-label="Navigation">'+
        '<div class="feedly-drawer-head"><strong>Mon Feed</strong><button type="button" data-open-settings aria-label="Réglages">'+svg('settings')+'</button></div>'+
        '<div class="feedly-drawer-section">'+
          '<button class="feedly-drawer-row active" type="button" data-view="home">'+svg('home')+'<span>Today</span></button>'+
          '<button class="feedly-drawer-row" type="button" data-view="brief">'+svg('star')+'<span>Brief</span></button>'+
          '<button class="feedly-drawer-row" type="button" data-view="news">'+svg('grid')+'<span>All</span></button>'+
          '<button class="feedly-drawer-row" type="button" data-feedly-saved>'+svg('bookmark')+'<span>Read Later</span><span class="feedly-count">'+saved+'</span></button>'+
          '<button class="feedly-drawer-row" type="button" data-view="sheet">'+svg('plus')+'<span>Follow sources</span></button>'+
        '</div>'+
        '<div class="feedly-drawer-section"><div class="feedly-drawer-section-title">Feeds</div>'+
          categories.map(c => '<button class="feedly-drawer-row" type="button" data-category="'+c+'">'+svg('grid')+'<span>'+c+'</span></button>').join('')+
        '</div>'+
        '<div class="feedly-drawer-section"><button class="feedly-drawer-row" type="button" data-open-settings>'+svg('settings')+'<span>Settings</span></button></div>'+
      '</aside></div>';
  }

  function ensureDrawer() {
    if (!app.querySelector('.feedly-drawer-backdrop')) app.insertAdjacentHTML('beforeend', drawerMarkup());
  }

  function closeDrawer() { document.body.classList.remove('feedly-drawer-open'); }
  function openDrawer() { ensureDrawer(); document.body.classList.add('feedly-drawer-open'); }

  function openSaved() {
    closeDrawer();
    const activate = () => {
      const filter = app.querySelector('[data-saved-filter]');
      if (!filter) { toast('Aucun article sauvegardé'); return; }
      if (!/voir toute/i.test(filter.textContent || '')) filter.click();
    };
    if (isHome()) return activate();
    const home = app.querySelector('[data-view="home"]');
    if (home) {
      home.click();
      setTimeout(activate, 60);
    }
  }

  function searchCards(query) {
    const q = String(query || '').trim().toLocaleLowerCase('fr');
    const sourceCards = [...app.querySelectorAll('main.page .article-card[data-article]')];
    return sourceCards.filter(card => !q || card.textContent.toLocaleLowerCase('fr').includes(q));
  }

  function openSearch() {
    closeDrawer();
    const launch = () => {
      app.querySelector('.feedly-search-page')?.remove();
      const page = document.createElement('section');
      page.className = 'feedly-search-page';
      page.innerHTML = '<div class="feedly-search-head"><button type="button" data-feedly-search-close aria-label="Retour">'+svg('back')+'</button><input class="feedly-search-input" type="search" autocomplete="off" placeholder="Search in your feeds"></div><div class="feedly-search-body"><p class="feedly-search-label">Search in your Feedly</p><div class="feedly-search-results"></div></div>';
      app.appendChild(page);
      const input = page.querySelector('.feedly-search-input');
      const results = page.querySelector('.feedly-search-results');
      const renderResults = () => {
        const matches = searchCards(input.value);
        results.innerHTML = '';
        if (!input.value.trim()) {
          results.innerHTML = '<div class="feedly-search-empty">Saisissez un mot-clé, une source ou un sujet.</div>';
          return;
        }
        if (!matches.length) {
          results.innerHTML = '<div class="feedly-search-empty">Aucun résultat dans les articles chargés.</div>';
          return;
        }
        matches.slice(0,40).forEach(card => results.appendChild(card.cloneNode(true)));
      };
      input.addEventListener('input', renderResults);
      renderResults();
      setTimeout(() => input.focus(), 30);
    };
    if (isHome()) return launch();
    const home = app.querySelector('[data-view="home"]');
    if (home) { home.click(); setTimeout(launch, 80); }
  }

  function closeSearch() { app.querySelector('.feedly-search-page')?.remove(); }

  function toggleMore() {
    const current = app.querySelector('.feedly-more-menu');
    if (current) { current.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'feedly-more-menu';
    menu.innerHTML =
      '<button type="button" data-refresh>'+svg('refresh')+'<span>Refresh</span></button>'+
      '<button type="button" data-feedly-mark-unread>'+svg('grid')+'<span>Mark all as unread</span></button>'+
      '<button type="button" data-open-settings>'+svg('settings')+'<span>Settings</span></button>';
    app.appendChild(menu);
  }

  function enhance() {
    ensureHomeBar();
    ensureBottomNav();
    ensureDrawer();
    sectionizeHome();
    syncReadVisuals();
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhance(); });
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-feedly-menu]')) {
      event.preventDefault(); event.stopPropagation(); openDrawer(); return;
    }
    if (event.target.closest('[data-feedly-drawer-backdrop]') && !event.target.closest('.feedly-drawer')) {
      closeDrawer(); return;
    }
    if (event.target.closest('.feedly-drawer [data-view],.feedly-drawer [data-category],.feedly-drawer [data-open-settings]')) {
      setTimeout(closeDrawer, 0);
    }
    if (event.target.closest('[data-feedly-saved]')) {
      event.preventDefault(); event.stopPropagation(); openSaved(); return;
    }
    if (event.target.closest('[data-feedly-search]')) {
      event.preventDefault(); event.stopPropagation(); openSearch(); return;
    }
    if (event.target.closest('[data-feedly-search-close]')) {
      event.preventDefault(); event.stopPropagation(); closeSearch(); return;
    }
    if (event.target.closest('[data-feedly-mark-read]')) {
      event.preventDefault(); event.stopPropagation(); markAllRead(); return;
    }
    if (event.target.closest('[data-feedly-mark-unread]')) {
      event.preventDefault(); event.stopPropagation(); markAllUnread(); app.querySelector('.feedly-more-menu')?.remove(); return;
    }
    if (event.target.closest('[data-feedly-more]')) {
      event.preventDefault(); event.stopPropagation(); toggleMore(); return;
    }
    if (!event.target.closest('.feedly-more-menu') && !event.target.closest('[data-feedly-more]')) app.querySelector('.feedly-more-menu')?.remove();
  }, true);

  window.addEventListener('news:stable-render', scheduleEnhance);
  document.addEventListener('DOMContentLoaded', scheduleEnhance, { once:true });
  new MutationObserver(scheduleEnhance).observe(app, { childList:true, subtree:false });
  scheduleEnhance();
})();