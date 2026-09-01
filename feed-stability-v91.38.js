(() => {
  'use strict';

  let settleTimer = 0;
  let warmQueued = false;

  function homeActive() {
    return Boolean(document.querySelector('.bottom-nav .nav-item.active[data-view="home"]'));
  }

  function distanceFromViewport(card) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom >= -200 && rect.top <= innerHeight + 200) return 0;
    if (rect.top > innerHeight) return rect.top - innerHeight;
    return Math.abs(rect.bottom);
  }

  function warmNearbyImages() {
    warmQueued = false;
    const cards = [...document.querySelectorAll('.article-card[data-article]')]
      .map(card => ({ card, distance: distanceFromViewport(card) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 14);

    cards.forEach(({ card }, index) => {
      const image = card.querySelector('img.article-image');
      if (!image) return;
      image.loading = 'eager';
      image.decoding = 'async';
      if ('fetchPriority' in image) image.fetchPriority = index < 6 ? 'high' : 'auto';
    });
  }

  function queueWarm() {
    if (warmQueued) return;
    warmQueued = true;
    requestAnimationFrame(warmNearbyImages);
  }

  function settleHome() {
    if (!homeActive()) { queueWarm(); return; }
    const feed = document.querySelector('.page .feed');
    if (!feed || !feed.querySelector('.article-card[data-article]')) { queueWarm(); return; }

    feed.classList.add('feed-settling-v9138');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        warmNearbyImages();
        feed.classList.remove('feed-settling-v9138');
      }));
    }, 0);
  }

  const style = document.createElement('style');
  style.textContent = `
    .article-card.new-since-visit-v79::after,
    .article-card.essential-v77::before,
    .article-card.essential-v77::after {
      content: none !important;
      display: none !important;
    }
    .article-card.essential-v77 {
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    .article-card.essential-v77 .article-body { background: transparent !important; }
    .feed.feed-settling-v9138 { visibility: hidden !important; }
  `;
  document.head.appendChild(style);

  const root = document.getElementById('app');
  if (root) new MutationObserver(settleHome).observe(root, { childList: true, subtree: true });

  window.addEventListener('scroll', queueWarm, { passive: true });
  window.addEventListener('resize', queueWarm, { passive: true });
  window.addEventListener('focus', settleHome);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settleHome(); });
  document.addEventListener('DOMContentLoaded', settleHome, { once: true });
  settleHome();
})();
