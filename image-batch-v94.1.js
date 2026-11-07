(() => {
  const warmed = new Set();
  function warm() {
    const images = [...document.querySelectorAll('.article-card img.article-image')].slice(0, 32);
    for (const img of images) {
      const src = img.currentSrc || img.src;
      if (!src || warmed.has(src)) continue;
      warmed.add(src);
      img.loading = 'eager';
      if ('fetchPriority' in img) img.fetchPriority = 'high';
      const probe = new Image();
      probe.decoding = 'async';
      probe.src = src;
    }
  }
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => requestAnimationFrame(warm)).observe(app, {childList:true,subtree:true});
  window.addEventListener('news:stable-render', warm);
  warm();
})();