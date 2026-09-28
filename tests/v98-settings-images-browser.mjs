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
const articles = Array.from({ length: 60 }, (_, index) => {
  const day = Math.floor(index / 30);
  const slot = index % 30;
  return ({
  id: `v98-${index}`, title: `Article ${index + 1} de contrôle fonctionnel et visuel mobile`,
  summary: 'Résumé de contrôle.', source: `Source ${slot % 6 + 1}`, category: categories[Math.floor(slot / 3) % categories.length],
  publishedAt: new Date(now - day * 86400000 - slot * 900000).toISOString(), url: `https://example.test/${index}`,
  image: index === 0 ? 'https://images.example.test/external-cover.jpg' : '', score: 300 - index
  });
});
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
const directExternalPhotoRequests = [];
let activePhotoRequests = 0;
let maxActivePhotoRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (request.url().startsWith('https://images.example.test/')) directExternalPhotoRequests.push(request.url()); });
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
await page.route('**/version.json**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '98', codeRelease: '98.05' }) }));

const started = performance.now();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForSelector('[data-stable-home-feed] .article-card', { timeout: 10000 });
const readyMs = performance.now() - started;
assert.ok(readyMs < 2500, `local mobile first render too slow: ${readyMs.toFixed(0)}ms`);
await page.waitForTimeout(500);
const geometry = await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => cards.slice(0, 8).map(card => { const image=card.querySelector('img'); const r=image.getBoundingClientRect(); return { width:r.width,height:r.height,border:getComputedStyle(card).borderTopWidth,src:image.currentSrc||image.src }; }));
assert.ok(geometry.every(item => Math.abs(item.width-119)<.75 && Math.abs(item.height-80)<.75), 'article images must reserve the same adaptive default space');
assert.ok(geometry.every(item => item.border === '0px'), 'article separators must stay removed');
const requestCounts = [...photoRequests.reduce((map,url)=>map.set(url,(map.get(url)||0)+1),new Map()).values()];
assert.ok(Math.max(...requestCounts) <= 1, 'rerenders must share the same photo request instead of repeating it');
assert.ok(maxActivePhotoRequests <= 8, `photo concurrency exceeded the eight-request budget: ${maxActivePhotoRequests}`);
assert.deepEqual(directExternalPhotoRequests, [], 'external publisher images must go through the validated same-origin proxy');
await page.waitForFunction(() => document.querySelectorAll('[data-stable-home-feed] .article-card img.image-ready-v98').length >= 15, null, { timeout: 5000 });
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
assert.ok(titles.includes('Sources d’information de base'));
assert.equal(titles.includes('Sources d’information'), false);
assert.equal(titles.includes('Centres d’intérêt'), false);
assert.ok(titles.indexOf('L’essentiel') < titles.indexOf('Veille'));
assert.equal(new Set(titles).size, titles.length, 'settings sections must not be duplicated');
await page.screenshot({ path: `${evidenceDir}/settings.png`, fullPage: true });

const open = async title => page.locator('.settings-accordion-v9185').filter({ has: page.locator(`summary:text-is("${title}")`) }).evaluate(element => { element.open = true; });
await open('Sources d’information de base');
const sourceActionWidths = await page.locator('.source-actions-v9186').first().locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
assert.equal(sourceActionWidths.length, 2);
assert.ok(Math.abs(sourceActionWidths[0] - sourceActionWidths[1]) < .5, 'follow and block source buttons must have equal widths');
const physicalArticleGap = () => page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards => {
  const first = cards[0].getBoundingClientRect();
  const second = cards[1].getBoundingClientRect();
  return second.top - first.bottom;
});
const visibleArticleGeometry = async () => {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-stable-home-feed] .article-card')].some(card => card.getBoundingClientRect().width > 0));
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-stable-home-feed] .article-card')].find(item => item.getBoundingClientRect().width > 0);
    return { title:parseFloat(getComputedStyle(card.querySelector('h2')).fontSize), badge:parseFloat(getComputedStyle(card.querySelector('.article-category-badge')).fontSize), width:card.querySelector('img').getBoundingClientRect().width, height:card.querySelector('img').getBoundingClientRect().height };
  });
};
await open('Taille et densité du texte');
await page.locator('[data-ui-range="density"]').evaluate(range => {
  range.value = '0';
  range.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.locator('[data-view="home"]').click();
const looseGap = await physicalArticleGap();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-stable-home-feed] .article-card');
assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('news-settings'))).density, 0, 'the zero-density endpoint must survive reload');
assert.ok(Math.abs((await physicalArticleGap()) - looseGap) < 1, 'persisted density must keep the same physical spacing');
await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="density"]').fill('100');
await page.locator('[data-view="home"]').click();
const denseGap = await physicalArticleGap();
assert.ok(looseGap - denseGap >= 15, `density must visibly reduce physical article spacing (${looseGap} -> ${denseGap})`);

await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
const articleRange = page.locator('[data-ui-range="textSize"]');
assert.equal(await articleRange.getAttribute('min'), '100');
assert.equal(await articleRange.getAttribute('max'), '175');
await articleRange.fill('100'); await page.locator('[data-view="home"]').click();
const smallArticle = await visibleArticleGeometry();
await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="textSize"]').fill('175'); await page.locator('[data-view="home"]').click();
const largeArticle = await visibleArticleGeometry();
assert.ok(largeArticle.title > smallArticle.title && largeArticle.badge > smallArticle.badge, `article text slider must resize titles and badges (${JSON.stringify({smallArticle,largeArticle})})`);
assert.ok(largeArticle.width > smallArticle.width && largeArticle.height > smallArticle.height, 'article photos must grow with article text');

await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="interfaceTextSize"]').fill('85');
const smallInterface = await page.locator('.settings-accordion-v9185>summary').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
await page.locator('[data-view="home"]').click();
const heroAtSmallInterface = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hero-header h1')).fontSize));
await page.locator('[data-view="settings"]').click(); await open('Taille et densité du texte');
await page.locator('[data-ui-range="interfaceTextSize"]').fill('150');
const largeInterface = await page.locator('.settings-accordion-v9185>summary').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
await page.locator('[data-view="home"]').click();
const heroAtLargeInterface = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hero-header h1')).fontSize));
assert.ok(largeInterface > smallInterface, 'interface text slider must resize the rest of the interface');
assert.equal(heroAtLargeInterface, heroAtSmallInterface, 'interface text slider must not resize the main title');

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

await page.locator('[data-view="settings"]').click(); await open('Affichage');
await page.locator('[data-accent]').evaluate(input => { input.value = '#e8345f'; input.dispatchEvent(new Event('input', { bubbles:true })); });
await page.locator('[data-view="home"]').click();
const accentHome = await page.evaluate(() => ({ mark:getComputedStyle(document.querySelector('.hero-header .hero-mark')).backgroundColor, headerBorder:getComputedStyle(document.querySelector('.hero-header')).borderBottomColor, nav:getComputedStyle(document.querySelector('.bottom-nav .nav-item.active')).color }));
assert.equal(accentHome.mark, 'rgb(232, 52, 95)', 'accent must recolor the main interface, not only the date');
assert.equal(accentHome.headerBorder, 'rgb(232, 52, 95)', 'accent must recolor the home header line');
assert.equal(accentHome.nav, 'rgb(232, 52, 95)', 'accent must recolor active navigation');
await page.locator('[data-view="brief"]').click();
assert.equal(await page.locator('.brief-mode-tab.active').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 52, 95)', 'selected Brief tab must be fully filled with the accent color');
assert.equal(await page.locator('.page-masthead-v9186').evaluate(el => getComputedStyle(el).borderBottomColor), 'rgb(232, 52, 95)', 'accent must recolor the page header line');

await page.locator('[data-view="settings"]').click(); await open('L’essentiel');
await open('Actualité générale');
const domainLayouts = await page.evaluate(() => {
  const general = document.querySelector('[data-general-category]');
  const essential = document.querySelector('[data-brief-essential]');
  const style = element => { const css=getComputedStyle(element); return { borderRadius:css.borderRadius,padding:css.padding,fontSize:css.fontSize,fontWeight:css.fontWeight }; };
  return {
    general: style(general), essential: style(essential),
    generalJustify:getComputedStyle(general.parentElement).justifyContent,
    essentialJustify:getComputedStyle(essential.parentElement).justifyContent
  };
});
assert.deepEqual(domainLayouts.essential, domainLayouts.general, 'essential domain buttons must match general-news buttons');
assert.equal(domainLayouts.essentialJustify, 'center', 'essential domains must be centered');
await page.locator('[data-ui-range="essentialCount"]').fill('3');
await page.locator('[data-view="brief"]').click();
assert.equal(await page.locator('.brief-history-day-v9138').count(), 2, 'L’essentiel must restore the available previous days');
assert.deepEqual(await page.locator('.brief-history-day-v9138').evaluateAll(days => days.map(day => day.querySelectorAll('.article-card').length)), [3,3], 'essential count must be strict for every day');
assert.equal(await page.getByText('Sélection récente', { exact:true }).count(), 0);
assert.equal(await page.locator('.brief-section-title').count(), 0);
assert.equal((await page.locator('.brief-mode-tab').first().textContent()).trim(), 'L’essentiel');
await page.screenshot({ path: `${evidenceDir}/brief.png` });

await page.locator('[data-view="settings"]').click(); await open('L’essentiel');
for (const category of categories.filter(category => category !== 'Politique')) {
  const button = page.locator(`[data-brief-essential="${category}"]`);
  if (await button.getAttribute('aria-pressed') === 'true') await button.click();
}
await page.locator('[data-view="brief"]').click();
assert.deepEqual(await page.locator('.brief-history-day-v9138').evaluateAll(days => days.map(day => day.querySelectorAll('.article-card').length)), [3,3], 'domain filtering must preserve the requested strict count per day');
assert.deepEqual(await page.locator('[data-stable-brief-content] .article-category-badge').allTextContents(), ['Politique','Politique','Politique','Politique','Politique','Politique'], 'L’essentiel must strictly follow selected domains');

await page.locator('[data-view="settings"]').click(); await open('Veille');
await page.locator('#watch-query-input').fill('Article 1');
await page.locator('[data-add-watch-rule]').click();
await page.locator('[data-view="brief"]').click();
await page.locator('[data-brief-mode="watches"]').click();
assert.equal(await page.locator('.brief-mode-tab.active').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 52, 95)', 'selected Watch tab must be fully filled with the accent color');
assert.equal(await page.getByText(/Aucune nouveauté correspondant/).count(), 0, 'empty watch-day messages must be removed');
const watchDateAlignments = await page.locator('.watch-day-v9138>h3').evaluateAll(headings => headings.map(heading => getComputedStyle(heading).textAlign));
assert.ok(watchDateAlignments.length > 0 && watchDateAlignments.every(value => value === 'center'), 'watch dates must be centered');
await page.screenshot({ path: `${evidenceDir}/watch.png`, fullPage: true });

await page.locator('.bottom-nav [data-view="settings"]').click(); await open('Fonctionnement');
const auto = page.locator('[data-setting-toggle="autoRefresh"]');
const beforeAuto = await auto.getAttribute('aria-checked'); await auto.click();
assert.notEqual(await page.locator('[data-setting-toggle="autoRefresh"]').getAttribute('aria-checked'), beforeAuto);
await page.locator('[data-setting-toggle="autoRefresh"]').click();
const web = page.locator('[data-setting-toggle="webSearch"]');
const beforeWeb = await web.getAttribute('aria-checked'); await web.click();
assert.notEqual(await page.locator('[data-setting-toggle="webSearch"]').getAttribute('aria-checked'), beforeWeb);
await page.locator('[data-setting-toggle="webSearch"]').click();

await open('Version');
await page.locator('[data-check-update]').click();
await page.waitForSelector('#toast.show');
const updateOverlay = await page.evaluate(() => { const toast=document.querySelector('#toast').getBoundingClientRect(); const nav=document.querySelector('.bottom-nav').getBoundingClientRect(); return { toastBottom:toast.bottom, navTop:nav.top }; });
assert.ok(updateOverlay.toastBottom < updateOverlay.navTop, `update result must stay above bottom navigation (${JSON.stringify(updateOverlay)})`);

await open('Langue');
await page.locator('[data-add-language]').click();
assert.ok(await page.locator('[data-language-install]').count() >= 20, 'language catalog must offer a broad selection in-app');
await page.screenshot({ path: `${evidenceDir}/languages.png` });
await page.locator('[data-language-install="ja"]').click();
await page.waitForFunction(() => document.documentElement.lang === 'ja');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('news-settings')||'{}').language === 'ja');
await page.waitForTimeout(250);
assert.ok(newsBodies.some(body => body.language === 'ja' && body.country === 'JP'), 'language must drive the country of every default news request');
assert.equal(errors.filter(error => !/Service Worker registration blocked/.test(error)).length, 0, `browser errors: ${errors.join(' | ')}`);

console.log(JSON.stringify({ readyMs:Math.round(readyMs), settings:titles, looseGap, denseGap, smallArticle, largeArticle, smallInterface, largeInterface, smallTitle, largeTitle, initialPhotoRequests, initialUniquePhotoRequests, initialPhotoVariants, maxActivePhotoRequests, rejectedFallback, localeRequest:newsBodies.find(body=>body.language==='ja') }, null, 2));
await browser.close();
