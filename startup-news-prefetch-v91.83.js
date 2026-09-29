(() => {
  'use strict';
  try {
    const settings = JSON.parse(localStorage.getItem('news-settings') || '{}');
    const interests = Array.isArray(settings?.interests)
      ? settings.interests.map(value => String(value || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const url = new URL('/api/news', location.hostname === 'wokgui.github.io' ? 'https://mon-actualite.vercel.app' : location.origin);
    url.searchParams.set('fast', '1');
    url.searchParams.set('v', '91.83');
    url.searchParams.set('t', Date.now().toString());
    if (interests.length) url.searchParams.set('interests', interests.join(','));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2600);
    window.__STARTUP_NEWS_V9183 = fetch(url.href, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }
    }).then(response => response.ok ? response.json() : null)
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  } catch {
    window.__STARTUP_NEWS_V9183 = Promise.resolve(null);
  }
})();