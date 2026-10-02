import { mkdir, readFile, writeFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output = process.argv[2] || 'test-results/photos-scroll-live';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/98.43' });
  await context.addInitScript(() => {
    window.__scrollPhotos = {};
    setInterval(() => {
      const overlay = document.getElementById('startup-stability-v9815');
      if (overlay && !overlay.classList.contains('leaving')) return;
      document.querySelectorAll('[data-stable-home-feed] .article-card').forEach((card, index) => {
        const image = card.querySelector('img'), rect = card.getBoundingClientRect(), key = image.dataset.photoKey;
        const item = window.__scrollPhotos[key] ||= { index, key, title: card.querySelector('h2').textContent, seenAt: null, readyAt: null, sources: [] };
        if (rect.top < innerHeight - 58 && rect.bottom > 0) item.seenAt ??= performance.now();
        if (image.dataset.photoFinal === '1') {
          item.readyAt ??= performance.now();
          if (!item.sources.includes(image.getAttribute('src'))) item.sources.push(image.getAttribute('src'));
        }
      });
    }, 80);
  });
  const page = await context.newPage(), responses = [], errors = [];
  if (process.env.PHOTO_REPLAY_REPORT) {
    // Reuse the exact before-run article URLs/titles. Only catalogue delivery is
    // fixed; every photo still comes from the live production API/publisher.
    const before = JSON.parse(await readFile(process.env.PHOTO_REPLAY_REPORT, 'utf8'));
    const articles = before.cards.filter(c => c.seenAt !== null).sort((a, b) => a.index - b.index).map((card, i) => {
      const request = before.responses.find(r => new URL(r.url).searchParams.get('url') === card.key);
      const query = new URL(request.url).searchParams;
      return { id: 'replay-' + i, url: card.key, title: query.get('title'), source: query.get('source'), category: query.get('category'), image: query.get('image') || '', publishedAt: new Date(Date.now() - i * 60000).toISOString() };
    });
    await context.addInitScript(articles => localStorage.setItem('news-live-cache', JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} })), articles);
    await page.route('**/api/news**', route => route.fulfill({ json: { articles, fetchedAt: new Date().toISOString(), stats: {} } }));
  }
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (/\/api\/article-(photo|thumbnail)/.test(new URL(response.url()).pathname)) responses.push({ url: response.url(), code: response.status(), status: response.headers()['x-thumbnail-status'], serverMs: Number(response.headers()['x-photo-resolve-ms']) });
  });
  await page.goto(process.env.PHOTO_BASE_URL || 'https://mon-actualite.vercel.app/?nativePreview=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-stable-home-feed] .article-card');
  if (process.env.PHOTO_FULL_SYNC === '1') {
    await page.waitForFunction(() => {
      try { return (JSON.parse(localStorage.getItem('news-live-cache')).stats?.mode || '') !== 'fast-startup'; } catch { return false; }
    }, null, { timeout: 45000 });
    await page.waitForFunction(() => !document.getElementById('startup-stability-v9815'));
    await page.evaluate(() => { window.__scrollPhotos = {}; });
    await page.locator('.nav-item[data-view="home"]').click();
  }
  for (let screen = 0; screen < 6; screen++) {
    await page.evaluate(screen => {
      const cards = document.querySelectorAll('[data-stable-home-feed] .article-card');
      cards[Math.min(cards.length - 1, screen * 6)]?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, screen);
    await page.waitForTimeout(screen === 0 ? 14000 : 8000);
    await page.screenshot({ path: output + `/ecran-${screen}.png`, scale: 'css' });
    const report = await page.evaluate(() => ({ metrics: window.__articlePhotoMetrics, resourceTimings: performance.getEntriesByType('resource').filter(r => /\/api\/article-(photo|thumbnail)/.test(new URL(r.name).pathname)).map(r => ({ url: r.name, start: r.startTime, end: r.responseEnd, duration: r.duration })), cards: Object.values(window.__scrollPhotos).map(({ sources, ...item }) => ({ ...item, sourceCount: sources.length, visibleWaitMs: item.seenAt == null || item.readyAt == null ? null : Math.max(0, item.readyAt - item.seenAt) })) }));
    await writeFile(output + '/verification.json', JSON.stringify({ replay: Boolean(process.env.PHOTO_REPLAY_REPORT), ...report, responses, errors }, null, 2));
    console.log(JSON.stringify({ screen, tracked: report.cards.length, seen: report.cards.filter(c => c.seenAt !== null).length, missing: report.cards.filter(c => c.seenAt !== null && c.readyAt === null).map(c => ({ index: c.index, title: c.title })), failures: responses.filter(r => r.code !== 200).length }));
  }
} finally { await browser.close(); }
