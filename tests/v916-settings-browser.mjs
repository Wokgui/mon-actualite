import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
const release = String(version.codeRelease || '').trim();
assert.match(release, /^\d+\.\d+$/, 'codeRelease is required for the settings browser test');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});

await context.route('**/api/news**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), stats: {}, articles: [] })
}));

const page = await context.newPage();
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bottom-nav [data-view="sheet"]', { timeout: 15000 });
  await page.locator('.bottom-nav [data-view="sheet"]').click();
  await page.waitForSelector('.personalization-sheet', { timeout: 5000 });
  await page.locator('[data-open-settings]').click();
  await page.waitForSelector(`.app-version-section[data-code-release="${release}"]`, { timeout: 5000 });

  const shown = await page.evaluate(() => ({
    title: document.querySelector('.app-version-row strong')?.textContent || '',
    release: document.querySelector('.app-version-row span:not(.app-version-badge)')?.textContent || '',
    badge: document.querySelector('.app-version-badge')?.textContent || ''
  }));
  assert.match(shown.title, new RegExp(`version\\s+${release.replace('.', '\\.')}$`), `settings title should show v${release}, got ${shown.title}`);
  assert.equal(shown.badge.trim(), `v${release}`, 'settings badge must show codeRelease');
  assert.doesNotMatch(shown.title, /version\s+60\b/, 'legacy technical version must not be presented as the current publication');

  await page.locator('[data-check-update]').click();
  await page.waitForFunction(expected => document.getElementById('toast')?.textContent?.includes(`Version ${expected} à jour`), release, { timeout: 5000 });
  const toast = await page.locator('#toast').textContent();
  assert.equal(String(toast || '').trim(), `Version ${release} à jour`, 'manual update check must use codeRelease');

  console.log(`v${release} mobile settings release identity checks passed.`);
} finally {
  await browser.close();
}
