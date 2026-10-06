/* Repro: open a game from a card, let it load, scroll, and record whether the
 * page falls back to skeletons, plus every view transition and every time
 * the route's main content is replaced. node scripts/motion_repro.mjs [url] */
import { chromium, firefox } from 'playwright';
const base = process.argv[2] || 'http://localhost:5173';
const browser = await (process.env.ENGINE === 'firefox' ? firefox : chromium).launch();
const page = await browser.newPage({ viewport: Number(process.argv[3]) ? { width: Number(process.argv[3]), height: 900 } : { width: 1280, height: 900 } });
const logs = [];
page.on('console', (m) => { if (/\[repro\]/.test(m.text())) logs.push(m.text()); });
await page.addInitScript(() => {
  const t0 = performance.now();
  const log = (...a) => console.log('[repro]', Math.round(performance.now() - t0), ...a);
  const orig = document.startViewTransition;
  if (orig) document.startViewTransition = function (cb) { log('VT start', document.documentElement.dataset.vt, location.pathname); const t = orig.call(document, cb); t.finished.then(() => log('VT end', location.pathname)); return t; };
  new MutationObserver(() => {
    const sk = document.querySelectorAll('main [aria-busy="true"], main .skeleton-placeholder').length;
    if (sk !== window.__sk) { window.__sk = sk; log('skeletons', sk, location.pathname); }
  }).observe(document, { childList: true, subtree: true });
  const push = history.pushState, rep = history.replaceState;
  history.pushState = function (...a) { log('pushState', a[2]); return push.apply(this, a); };
  history.replaceState = function (...a) { log('replaceState', a[2]); return rep.apply(this, a); };
});
await page.goto(base + '/');
await page.waitForSelector('.hover-game-card [data-shared^="poster:"]', { timeout: 60000 });
await page.waitForTimeout(2500);
logs.push('--- click card');
await page.locator('.hover-game-card:has([data-shared^="poster:"]) [role="link"]').first().click();
await page.waitForTimeout(4000);
logs.push('--- scroll');
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(300); }
await page.waitForTimeout(3000);
console.log(logs.join('\n'));
await browser.close();
