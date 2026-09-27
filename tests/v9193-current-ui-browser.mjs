import assert from 'node:assert/strict';
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const { chromium } = playwright;

const launchOptions = { headless: true };
if (process.platform === 'win32') launchOptions.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 MonActualiteAndroid/94',
  serviceWorkers: 'block'
});

const article = {
  id: 'ui-contract-1',
  title: 'Article de contrôle visuel suffisamment long pour occuper trois lignes et vérifier le centrage exact',
  summary: 'Résumé de contrôle pour stabiliser le rendu local du test.',
  source: 'Source test',
  category: 'Tech',
  publishedAt: new Date().toISOString(),
  url: 'https://example.test/article'
};

await context.addInitScript(payload => {
  localStorage.setItem('news-live-cache', JSON.stringify({
    articles: [payload],
    fetchedAt: new Date().toISOString(),
    stats: {}
  }));
  localStorage.setItem('news-grey-after-scroll-v9138-v1', JSON.stringify([payload.id]));
  localStorage.setItem('news-grey-after-scroll-v9138-v1', JSON.stringify([payload.id]));
}, article);

const page = await context.newPage();
await page.route('**/version.json**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ version: '1', codeRelease: '1.00' })
}));
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3ksAAAAASUVORK5CYII=', 'base64');
await page.route('**/api/article-photo-fast**', route => route.fulfill({
  status: 200,
  contentType: 'image/png',
  body: tinyPng
}));
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true })
}));
await page.route('**/api/news**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ articles: [article], fetchedAt: new Date().toISOString(), stats: {} })
}));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.bottom-nav.stable-bottom-nav-v9184', { timeout: 8000 });

async function snapshot(activeView) {
  await page.locator(`.nav-item[data-view="${activeView}"]`).click();
  await page.waitForFunction(view =>
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.contains('active'),
    activeView
  );
  return page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav.stable-bottom-nav-v9184');
    const navRect = nav.getBoundingClientRect();
    const items = [...nav.querySelectorAll('.nav-item')];
    return {
      nav: { x: navRect.x, y: navRect.y, width: navRect.width, height: navRect.height },
      items: items.map(item => {
        const r = item.getBoundingClientRect();
        const svg = item.querySelector('svg')?.getBoundingClientRect();
        const span = item.querySelector('span')?.getBoundingClientRect();
        const style = getComputedStyle(item);
        return {
          view: item.dataset.view,
          active: item.classList.contains('active'),
          x: r.x, y: r.y, width: r.width, height: r.height,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          transform: style.transform,
          iconY: svg ? svg.y + svg.height / 2 : null,
          labelY: span ? span.y + span.height / 2 : null
        };
      })
    };
  });
}

const states = {};
for (const view of ['home', 'settings', 'brief']) states[view] = await snapshot(view);
console.log('UI_STATE_SNAPSHOTS', JSON.stringify(states));

for (const view of ['home', 'settings', 'brief']) {
  const state = states[view];
  assert.equal(state.items.length, 3, 'bottom navigation must contain exactly three equal items');
  const expectedWidth = state.nav.width / 3;
  for (const item of state.items) {
    assert.ok(Math.abs(item.width - expectedWidth) < 0.75, `${view}: each nav item must occupy exactly one third`);
    assert.equal(item.marginTop, '0px', `${view}: nav item top margin must stay zero`);
    assert.equal(item.marginBottom, '0px', `${view}: nav item bottom margin must stay zero`);
    assert.equal(item.transform, 'none', `${view}: nav items must not transform on selection`);
  }
}

for (const target of ['home', 'settings', 'brief']) {
  const iconYs = ['home', 'settings', 'brief'].map(stateName =>
    states[stateName].items.find(item => item.view === target).iconY
  );
  const labelYs = ['home', 'settings', 'brief'].map(stateName =>
    states[stateName].items.find(item => item.view === target).labelY
  );
  assert.ok(Math.max(...iconYs) - Math.min(...iconYs) < 0.5, `${target}: icon moved vertically between active/inactive states`);
  assert.ok(Math.max(...labelYs) - Math.min(...labelYs) < 0.5, `${target}: label moved vertically between active/inactive states`);
}

await page.locator('.nav-item[data-view="home"]').click();
await page.waitForSelector('.hero-header');
const headerStyle = await page.$eval('.hero-header', el => {
  const style = getComputedStyle(el);
  return {
    borderBottomWidth: style.borderBottomWidth,
    borderBottomColor: style.borderBottomColor,
    boxShadow: style.boxShadow,
    marginBottom: style.marginBottom
  };
});
assert.ok(parseFloat(headerStyle.borderBottomWidth) <= 2, 'home header must keep only a thin separator');
assert.ok(parseFloat(headerStyle.marginBottom) >= 14, 'home header must keep breathing room before the first article');

const homeTitlePx = await page.$eval('.hero-header h1', el => parseFloat(getComputedStyle(el).fontSize));
assert.ok(homeTitlePx <= 32.5, 'home title must stay visually lighter than the previous oversized heading');

await page.waitForSelector('[data-stable-home-feed] .article-card', { timeout: 8000 });
assert.ok(await page.locator('[data-stable-home-feed] .article-card').first().evaluate(el => el.classList.contains('read-passed-v9138')), 'fixture article should start greyed');
const homeReset = page.locator('.nav-item[data-view="home"]');
await homeReset.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: 80, clientY: 820 });
await page.waitForTimeout(700);
await homeReset.dispatchEvent('pointerup', { pointerType: 'touch', button: 0, clientX: 80, clientY: 820 });
assert.ok(!(await page.locator('[data-stable-home-feed] .article-card').first().evaluate(el => el.classList.contains('read-passed-v9138'))), 'long press on Home must clear greyed articles');
assert.equal(await page.evaluate(() => localStorage.getItem('news-grey-after-scroll-v9138-v1')), '[]', 'long press reset must clear persisted grey state');

const rowAlignment = await page.$eval('[data-stable-home-feed] .article-card', card => {
  const img = card.querySelector('.article-image').getBoundingClientRect();
  const title = card.querySelector('h2').getBoundingClientRect();
  return {
    imageCenter: img.top + img.height / 2,
    titleCenter: title.top + title.height / 2,
    imageHeight: img.height,
    borderBottomWidth: getComputedStyle(card).borderBottomWidth,
    borderTopWidth: getComputedStyle(card).borderTopWidth
  };
});
assert.ok(Math.abs(rowAlignment.imageCenter - rowAlignment.titleCenter) < 24, 'title must stay vertically balanced beside the fixed image while metadata remains visible');
assert.ok(Math.abs(rowAlignment.imageHeight - 75) < 0.75, 'article image must keep the 75px compact height');
assert.equal(rowAlignment.borderBottomWidth, '0px', 'articles must not have bottom separators');
assert.equal(rowAlignment.borderTopWidth, '0px', 'articles must not have top separators');
const firstImage = page.locator('[data-stable-home-feed] .article-image').first();
const firstImageSrc = await firstImage.getAttribute('src');
await page.waitForTimeout(350);
assert.equal(await firstImage.getAttribute('src'), firstImageSrc, 'article image source must not be reassigned after initial render');

await page.locator('.nav-item[data-view="settings"]').click();
await page.waitForSelector('.settings-page-v9185>.page-masthead-v9186 h1');
const settingsTitlePx = await page.$eval('.settings-page-v9185>.page-masthead-v9186 h1', el => parseFloat(getComputedStyle(el).fontSize));
assert.ok(settingsTitlePx <= 25.5, 'settings title must use the refined compact size');

const generalAccordion = page.locator('.settings-accordion-v9185').filter({ hasText: 'Actualité générale' });
await generalAccordion.evaluate(el => { el.open = true; });
assert.ok(await generalAccordion.evaluate(el => el.open), 'settings accordion must open');
await generalAccordion.locator('[data-general-category]').first().click();
await page.waitForTimeout(100);
const generalAccordionAfter = page.locator('.settings-accordion-v9185').filter({ hasText: 'Actualité générale' });
assert.ok(await generalAccordionAfter.evaluate(el => el.open), 'settings accordion must stay open after an action');
await page.waitForTimeout(2100);
assert.ok(await page.locator('.nav-item[data-view="settings"]').evaluate(el => el.classList.contains('active')), 'native settings view must not be reset by release polling');
assert.equal(await page.evaluate(() => sessionStorage.getItem('news-active-view-v9204')), 'settings', 'native view must survive delayed app update check');

const keywordAccordion = page.locator('.settings-accordion-v9185').filter({ hasText: 'Mots-clés' }).first();
await keywordAccordion.locator(':scope > summary').click();
await keywordAccordion.locator('#keyword-input').fill('test réglages');
await keywordAccordion.locator('[data-add-keyword]').click();
assert.ok(await page.locator('.settings-accordion-v9185').filter({ hasText: 'Mots-clés' }).first().evaluate(el => el.open), 'Mots-clés accordion must stay open after adding a keyword');

const watchAccordion = page.locator('.settings-accordion-v9185').filter({ hasText: 'Veille' }).first();
await watchAccordion.locator(':scope > summary').click();
await watchAccordion.locator('#watch-query-input').fill('test veille');
await watchAccordion.locator('[data-add-watch-rule]').click();
assert.ok(await page.locator('.settings-accordion-v9185').filter({ hasText: 'Veille' }).first().evaluate(el => el.open), 'Veille accordion must stay open after adding a rule');

await page.locator('.nav-item[data-view="brief"]').click();
await page.waitForSelector('.page:has(.brief-mode-tabs)>.page-masthead-v9186 h1');
const briefTitlePx = await page.$eval('.page:has(.brief-mode-tabs)>.page-masthead-v9186 h1', el => parseFloat(getComputedStyle(el).fontSize));
assert.ok(briefTitlePx <= 25.5, 'brief title must use the refined compact size');

await browser.close();
console.log('v98.01 current UI browser contract passed.');
