import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const { chromium } = playwright;

const evidenceDir = process.argv[2] || 'test-results/v98';
await mkdir(evidenceDir, { recursive: true });
const categories = ['Politique','International','Économie','Société','Santé','Environnement','Science','Culture','Éducation','Europe'];
const now = Date.now();
const articles = Array.from({ length: 30 }, (_, index) => ({
  id: `v98-${index}`, title: `Article ${index + 1} de contrôle fonctionnel et visuel mobile`,
  summary: 'Résumé de contrôle.', source: `Source ${index % 4 + 1}`, category: categories[index % categories.length],
  publishedAt: new Date(now - index * 900000).toISOString(), url: `https://example.test/${index}`, score: 300 - index
}));
const png = await readFile(new URL('../assets/icon-192.png', import.meta.url));
const neutralSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="224"><rect width="400" height="224" fill="#eef0f4"/></svg>';
const launchOptions = { headless: true, args: ['--no-sandbox','--disable-gpu'] };
if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
else if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await context.addInitScript(payload => {
  localStorage.setItem('news-live-cache', JSON.stringify({ articles: payload, fetchedAt: new Date().toISOString(), stats: {} }));
  localStorage.setItem('news-cache-language-v98', 'fr');
}, articles);
const page = await context.newPage();
const errors = [];
const newsBodies = [];
const photoRequests = [];
let activePhotoRequests = 0;
let maxActivePhotoRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/news**', async route => {
  try { if (route.request().postData()) newsBodies.push(JSON.parse(route.request().postData())); } catch {}
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ articles, fetchedAt: new Date().toISOString(), stats: {} }) });
});
await page.route('**/api/article-photo-fast**', async route => {
  const requestUrl = route.request().url();
  photoRequests.push(requestUrl);
  activePhotoRequests += 1;
  maxActivePhotoRequests = Math.max(maxActivePhotoRequests, activePhotoRequests);
  await new Promise(resolve => setTimeout(resolve, 80));
  const isNeutralFallback = new URL(requestUrl).searchParams.get('title')?.startsWith('Article 7 ');
  try {
    if (isNeutralFallback) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'X-Thumbnail-Status': 'neutral-fallback', 'Cache-Control': 'public, max-age=90' }, body: neutralSvg });
    } else {
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'feed', 'Cache-Control': 'public, max-age=3600' }, body: png });
    }
  }
  finally { activePhotoRequests -= 1; }
});
await page.route('**/api/article-thumbnail**', route => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'X-Thumbnail-Status': 'feed', 'Cache-Control': 'public, max-age=3600' }, body: png }));
await page.route('**/version.json**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '98', codeRelease: '98.02' }) }));

const started = performance.now();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForSelector('[data-stable-home-feed] .article-card', { timeout: 10000 });
const readyMs = performance.now() - started;
assert.ok(readyMs < 2500, `local mobile first render too slow: ${readyMs.toFixed(0)}ms`);
await page.waitForTimeout(500);
const geometry = await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => cards.slice(0, 8).map(card => { const image=card.querySelector('img'); const r=image.getBoundingClientRect(); return { width:r.width,height:r.height,border:getComputedStyle(card).borderTopWidth,src:image.currentSrc||image.src }; }));
assert.ok(geometry.every(item => Math.abs(item.width-112)<.75 && Math.abs(item.height-75)<.75), 'article images must reserve the same 112x75 space');
assert.ok(geometry.every(item => item.border === '0px'), 'article separators must stay removed');
const requestCounts = [...photoRequests.reduce((map,url)=>map.set(url,(map.get(url)||0)+1),new Map()).values()];
assert.ok(Math.max(...requestCounts) <= 1, 'rerenders must share the same photo request instead of repeating it');
assert.ok(maxActivePhotoRequests <= 4, `photo concurrency exceeded the four-request budget: ${maxActivePhotoRequests}`);
await page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] .article-card img.image-ready-v98').length >= 6, null, { timeout: 3000 });
assert.equal(await page.locator('[data-stable-home-feed] .article-card img.image-ready-v98').count() >= 6, true, 'the six priority images must load first');
await page.waitForFunction(() => [...document.querySelectorAll('[data-stable-home-feed] .article-card')].find(card => card.querySelector('h2')?.textContent?.startsWith('Article 7 '))?.querySelector('img')?.classList.contains('image-fallback-v98'), null, { timeout: 3000 });
const rejectedFallback = await page.locator('[data-stable-home-feed] .article-card').filter({ hasText: 'Article 7 de contrôle' }).first().locator('img').evaluate(image => ({ src:image.currentSrc || image.src, fallback:image.classList.contains('image-fallback-v98') }));
assert.ok(rejectedFallback.fallback && rejectedFallback.src.startsWith('data:image/svg+xml'), 'a neutral HTTP 200 fallback must be replaced by the local source tile');
const initialPhotoRequests = photoRequests.length;
const initialUniquePhotoRequests = new Set(photoRequests).size;
const initialPhotoVariants = photoRequests.reduce((counts,url)=>{const key=new URL(url).searchParams.get('v')||'none';counts[key]=(counts[key]||0)+1;return counts;},{});
await page.screenshot({ path: `${evidenceDir}/home.png` });

await page.locator('[data-view="settings"]').click();
await page.waitForSelector('.settings-accordions-v9185');
const titles = await page.locator('.settings-accordion-v9185>summary').allTextContents();
assert.deepEqual(titles.slice(0,3), ['Langue','Taille et densité du texte','Affichage']);
assert.equal(titles.filter(title => title === 'Taille du texte').length, 0);
assert.ok(titles.indexOf('L’essentiel') < titles.indexOf('Veille'));
assert.equal(new Set(titles).size, titles.length, 'settings sections must not be duplicated');
await page.screenshot({ path: `${evidenceDir}/settings.png`, fullPage: true });

const open = async title => page.locator('.settings-accordion-v9185').filter({ has: page.locator(`summary:text-is("${title}")`) }).evaluate(element => { element.open = true; });
await open('Taille et densité du texte');
await page.locator('[data-ui-range="density"]').fill('0');
await page.locator('[data-view="home"]').click();
const looseGap = parseFloat(await page.locator('[data-stable-home-feed]').evaluate(element => getComputedStyle(element).rowGap));
await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="density"]').fill('100');
await page.locator('[data-view="home"]').click();
const denseGap = parseFloat(await page.locator('[data-stable-home-feed]').evaluate(element => getComputedStyle(element).rowGap));
assert.ok(denseGap < looseGap, `density must reduce article spacing (${looseGap} -> ${denseGap})`);

await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="titleSize"]').fill('70'); await page.locator('[data-view="home"]').click();
const smallTitle = await page.locator('.hero-header').evaluate(el => ({ font:parseFloat(getComputedStyle(el.querySelector('h1')).fontSize), height:el.getBoundingClientRect().height }));
await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="titleSize"]').fill('140'); await page.locator('[data-view="home"]').click();
const largeTitle = await page.locator('.hero-header').evaluate(el => ({ font:parseFloat(getComputedStyle(el.querySelector('h1')).fontSize), height:el.getBoundingClientRect().height }));
assert.ok(largeTitle.font > smallTitle.font && largeTitle.height > smallTitle.height, 'title slider must resize title and header');

await page.locator('[data-view="settings"]').click(); await open('Affichage');
await page.locator('[data-display-setting="showBadges"]').uncheck();
await page.locator('[data-display-setting="showAge"]').uncheck();
await page.locator('[data-view="home"]').click();
assert.equal(await page.locator('.article-category-badge:visible').count(), 0);
assert.equal(await page.locator('.article-age:visible').count(), 0);
assert.equal(await page.locator('[data-stable-home-feed] .meta').first().evaluate(el => getComputedStyle(el).display), 'none');
await page.locator('[data-view="settings"]').click(); await open('Affichage');
await page.locator('[data-display-setting="showBadges"]').check(); await page.locator('[data-display-setting="showAge"]').check();
await page.locator('[data-view="home"]').click();
assert.ok(await page.locator('.article-category-badge:visible').count() > 0);
assert.ok(await page.locator('.article-age:visible').count() > 0);

await page.locator('[data-view="settings"]').click(); await open('L’essentiel');
await page.locator('[data-ui-range="essentialCount"]').fill('3');
await page.locator('[data-view="brief"]').click();
assert.equal(await page.locator('.journal-section').first().locator('.article-card').count(), 3, 'essential count must be applied');
assert.equal((await page.locator('.brief-mode-tab').first().textContent()).trim(), 'L’essentiel');
await page.screenshot({ path: `${evidenceDir}/brief.png` });

await page.locator('[data-view="settings"]').click(); await open('Fonctionnement');
const auto = page.locator('[data-setting-toggle="autoRefresh"]');
const beforeAuto = await auto.getAttribute('aria-checked'); await auto.click();
assert.notEqual(await page.locator('[data-setting-toggle="autoRefresh"]').getAttribute('aria-checked'), beforeAuto);
await page.locator('[data-setting-toggle="autoRefresh"]').click();
const web = page.locator('[data-setting-toggle="webSearch"]');
const beforeWeb = await web.getAttribute('aria-checked'); await web.click();
assert.notEqual(await page.locator('[data-setting-toggle="webSearch"]').getAttribute('aria-checked'), beforeWeb);
await page.locator('[data-setting-toggle="webSearch"]').click();

await open('Langue');
page.once('dialog', dialog => dialog.accept('en'));
await page.locator('[data-add-language]').click();
await page.waitForFunction(() => document.documentElement.lang === 'en');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('news-settings')||'{}').language === 'en');
await page.waitForTimeout(250);
assert.ok(newsBodies.some(body => body.language === 'en' && body.country === 'GB'), 'language must drive the country of every default news request');
assert.equal(errors.filter(error => !/Service Worker registration blocked/.test(error)).length, 0, `browser errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ readyMs:Math.round(readyMs), settings:titles, looseGap, denseGap, smallTitle, largeTitle, initialPhotoRequests, initialUniquePhotoRequests, initialPhotoVariants, maxActivePhotoRequests, rejectedFallback, localeRequest:newsBodies.find(body=>body.language==='en') }, null, 2));
await browser.close();
