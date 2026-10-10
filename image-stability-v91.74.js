(() => {
  'use strict';

  const RELEASE = '91.74';
  const LOCK_MS = 15000;
  const checking = new WeakSet();
  document.documentElement.dataset.imageStabilityV9174 = RELEASE;

  function articleImages() {
    return [...document.querySelectorAll('.article-card[data-article] img.article-image')];
  }

  function prioritizeVisibleImages() {
    const images = articleImages();
    images.forEach((image, index) => {
      const rect = image.getBoundingClientRect();
      const nearViewport = rect.bottom >= -160 && rect.top <= innerHeight + 900;
      if (index < 12 || nearViewport) image.loading = 'eager';
      if (index < 8 || rect.top <= innerHeight + 250) {
        try { image.fetchPriority = 'high'; } catch {}
      }
    });
  }

  async function classifyLoadedImage(image) {
    if (!(image instanceof HTMLImageElement) || !image.closest('.article-card[data-article]')) return;
    if (!image.complete || image.naturalWidth < 2 || checking.has(image)) return;
    checking.add(image);
    const src = image.currentSrc || image.src || '';
    if (!src || src.startsWith('data:image/svg+xml')) return;

    try {
      const url = new URL(src, location.href);
      let stable = true;
      if (url.origin === location.origin && ['/api/article-photo-fast', '/api/article-thumbnail', '/api/exact-news-thumbnail'].includes(url.pathname)) {
        const response = await fetch(url.href, { cache: 'force-cache' });
        const status = response.headers.get('X-Thumbnail-Status') || '';
        const type = response.headers.get('Content-Type') || '';
        stable = response.ok
          && !/fallback|publisher-tile|neutral/i.test(status)
          && !/image\/svg\+xml/i.test(type);
      }
      if (!stable || !image.isConnected) return;
      image.dataset.stablePhotoSrcV9174 = src;
      image.dataset.stablePhotoUntilV9174 = String(Date.now() + LOCK_MS);
      image.classList.remove('source-tile-visual', 'v42-image-pending', 'v42-image-failed');
      image.classList.add('prepared-visual');
    } catch {}
    finally { checking.delete(image); }
  }

  document.addEventListener('load', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.article-card[data-article]')) return;
    classifyLoadedImage(image);
  }, true);

  const observer = new MutationObserver(mutations => {
    let reprioritize = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length) reprioritize = true;
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'src') continue;
      const image = mutation.target;
      if (!(image instanceof HTMLImageElement)) continue;
      const locked = image.dataset.stablePhotoSrcV9174 || '';
      const until = Number(image.dataset.stablePhotoUntilV9174 || 0);
      const current = image.getAttribute('src') || '';
      if (!locked || !until || Date.now() >= until || current === locked) continue;
      // Keep an already loaded real photo stable while background enrichment
      // runs. This removes the visible blink caused by swapping valid sources.
      queueMicrotask(() => {
        if (!image.isConnected) return;
        if ((image.getAttribute('src') || '') !== locked) image.src = locked;
      });
    }
    if (reprioritize) requestAnimationFrame(prioritizeVisibleImages);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  document.addEventListener('news:stable-render', () => requestAnimationFrame(prioritizeVisibleImages));
  window.addEventListener('scroll', () => requestAnimationFrame(prioritizeVisibleImages), { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(prioritizeVisibleImages), { once: true });
  } else {
    requestAnimationFrame(prioritizeVisibleImages);
  }
})();
