(() => {
  const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22112%22 height=%2275%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23f1f1f1%22/%3E%3C/svg%3E';

  // Feedly-runtime used detached Image() objects to warm every proxy thumbnail.
  // On Android this caused a burst of slow serverless requests. Suppress only
  // those detached proxy warmups; visible cards are loaded by performance-v42.
  const NativeImage = window.Image;
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  window.Image = function(width, height) {
    const image = new NativeImage(width, height);
    try {
      Object.defineProperty(image, 'src', {
        configurable: true,
        enumerable: true,
        get() { return srcDescriptor.get.call(this); },
        set(value) {
          const next = String(value || '');
          if (next.includes('/api/article-thumbnail')) return;
          srcDescriptor.set.call(this, value);
        }
      });
    } catch {}
    return image;
  };
  window.Image.prototype = NativeImage.prototype;

  // Visible rows now rely on the browser's native loading="lazy" behavior.
  // An earlier bootstrap replaced their proxy URL with PLACEHOLDER and stored
  // it in data-perf-src for performance-v42. That loader is no longer part of
  // the page, so those rows remained grey forever.
  window.__NEWS_IMAGE_PLACEHOLDER__ = PLACEHOLDER;
})();

