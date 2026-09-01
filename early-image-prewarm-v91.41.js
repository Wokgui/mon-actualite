(() => {
  'use strict';

  const NEWS_CACHE_KEY = 'news-live-cache';
  const VISUAL_KEY = 'news-visual-backfill-v3';
  const inflight = new Set();

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  function endpoint(article = {}) {
    const params = new URLSearchParams({
      v: '19',
      url: String(article.url || '').slice(0, 1900),
      image: String(article.image || '').slice(0, 1900),
      title: String(article.title || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      category: String(article.category || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      source: String(article.source || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      custom: article.customSource ? '1' : '0'
    });
    return `/api/article-thumbnail?${params}`;
  }

  function preload(src, priority = 'high') {
    if (!src || inflight.has(src)) return;
    inflight.add(src);
    try {
      const img = new Image();
      img.decoding = 'async';
      try { img.fetchPriority = priority; } catch {}
      img.src = src;
    } catch {}
  }

  async function recover(article) {
    const id = String(article?.id || '');
    if (!id) return;
    const url = endpoint(article);
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      const status = response.headers.get('X-Thumbnail-Status') || '';
      const type = response.headers.get('Content-Type') || '';
      if (!response.ok || /fallback|publisher-tile|neutral/i.test(status) || /image\/svg\+xml/i.test(type)) return;
      const blob = await response.blob();
      if (blob.size < 512) return;
      const visuals = read(VISUAL_KEY, {});
      visuals[id] = { url, savedAt: Date.now() };
      const recent = Object.entries(visuals)
        .filter(([, item]) => item?.url && Date.now() - Number(item.savedAt || 0) < 30 * 86400000)
        .slice(-300);
      localStorage.setItem(VISUAL_KEY, JSON.stringify(Object.fromEntries(recent)));
      preload(url, 'high');
    } catch {}
  }

  function run() {
    if (!navigator.onLine) return;
    const payload = read(NEWS_CACHE_KEY, {});
    const articles = Array.isArray(payload?.articles) ? payload.articles.filter(Boolean).slice(0, 18) : [];
    if (!articles.length) return;
    const visuals = read(VISUAL_KEY, {});

    articles.slice(0, 14).forEach(article => {
      const remembered = visuals[String(article.id || '')]?.url;
      const prepared = String(article?.visual?.status || article?.visualStatus || '') === 'ready'
        ? String(article?.visual?.url || article?.image || '')
        : '';
      preload(remembered || prepared, 'high');
    });

    const missing = articles.filter(article => {
      const id = String(article.id || '');
      if (!id || visuals[id]?.url) return false;
      return String(article?.visual?.status || article?.visualStatus || '') !== 'ready';
    }).slice(0, 4);

    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length) {
        const article = missing[cursor++];
        await recover(article);
        await new Promise(resolve => setTimeout(resolve, 450));
      }
    };
    worker();
    worker();
  }

  run();
})();
