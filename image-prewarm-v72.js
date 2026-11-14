const warmed = new Set();
const queued = new Set();
const queue = [];
let active = 0;
let scheduled = false;

const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const constrainedNetwork = Boolean(connection?.saveData) || /(^|-)2g$/i.test(String(connection?.effectiveType || ''));
const MAX_CONCURRENT = constrainedNetwork ? 2 : 6;
const INITIAL_LIMIT = constrainedNetwork ? 6 : 18;
const SCROLL_LIMIT = constrainedNetwork ? 4 : 12;

function usableUrl(img) {
  const raw = img?.currentSrc || img?.src || '';
  if (!raw || /^data:/i.test(raw)) return '';
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return '';
    if (!['/api/article-thumbnail', '/api/exact-news-thumbnail', '/api/article-photo-fast'].includes(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

async function warm(url) {
  try {
    const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
    if (response.ok) await response.blob();
  } catch {}
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const url = queue.shift();
    queued.delete(url);
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    active += 1;
    warm(url).finally(() => {
      active -= 1;
      pump();
    });
  }
}

function enqueue(limit = INITIAL_LIMIT) {
  const viewportBottom = window.scrollY + window.innerHeight;
  const candidates = [...document.querySelectorAll('img.stable-visual')]
    .map(img => ({ img, url: usableUrl(img), top: img.getBoundingClientRect().top + window.scrollY }))
    .filter(item => item.url && !warmed.has(item.url) && !queued.has(item.url))
    .filter(item => item.top <= viewportBottom + 6500)
    .sort((a, b) => a.top - b.top)
    .slice(0, limit);

  for (const item of candidates) {
    queued.add(item.url);
    queue.push(item.url);
  }
  pump();
}

function schedule(limit = INITIAL_LIMIT, delay = 90) {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    enqueue(limit);
  }, delay);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => schedule(INITIAL_LIMIT, 120), { once: true });
} else {
  schedule(INITIAL_LIMIT, 120);
}

let scrollTimer = 0;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => schedule(SCROLL_LIMIT, 20), 70);
}, { passive: true });

const app = document.getElementById('app');
if (app) {
  const observer = new MutationObserver(() => schedule(INITIAL_LIMIT, 80));
  observer.observe(app, { childList: true, subtree: true });
}

window.addEventListener('storage', event => {
  if (event.key === 'news-live-cache') schedule(INITIAL_LIMIT, 40);
});
