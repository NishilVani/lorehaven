/* Back keeps the page: scroll Explore, open a game, go back, and check that
 * Explore is the same page (not rebuilt), at the same scroll, with no
 * skeleton, and that the poster flew home.
 *   node scripts/motion_back.mjs [baseUrl] [chromium|firefox] */
import { chromium, firefox } from 'playwright';
const base = process.argv[2] || 'http://localhost:5173';
const engine = process.argv[3] === 'firefox' ? firefox : chromium;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: process.argv[3] !== 'firefox', hasTouch: true });
await page.addInitScript(() => {
  window.__vt = [];
  const orig = document.startViewTransition;
  if (orig) document.startViewTransition = function (cb) {
    const rec = { type: document.documentElement.dataset.vt };
    const t = orig.call(document, cb);
    t.ready.then(() => { rec.after = document.documentElement.dataset.vt; }).catch(() => {});
    window.__vt.push(rec);
    return t;
  };
});
await page.goto(base + '/');
await page.waitForSelector('.hover-game-card [data-shared^="poster:"]', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(800);
const before = await page.evaluate(() => {
  const root = document.querySelector('main [data-shared-scope]')?.closest('main > div > div, main > div');
  window.__marker = document.querySelector('main .hover-game-card');
  return { scrollY: Math.round(scrollY) };
});
const card = page.locator('.hover-game-card:has([data-shared^="poster:"])').filter({ has: page.locator(':visible') });
const target = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.hover-game-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight; });
  cards[0]?.setAttribute('data-probe', 'yes');
  return cards.length;
});
await page.locator('[data-probe="yes"] [role="link"]').click();
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__vt.length = 0; });
await page.goBack();
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  path: location.pathname,
  scrollY: Math.round(scrollY),
  sameNodes: !!window.__marker && window.__marker.isConnected,
  skeletons: document.querySelectorAll('main :not([hidden]) .skeleton-placeholder').length,
  vt: window.__vt[0] || null,
}));
console.log(JSON.stringify({ before, cardsOnScreen: target, after }));
await browser.close();
