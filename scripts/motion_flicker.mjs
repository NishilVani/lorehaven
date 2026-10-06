/* Flicker check. Two failure modes the owner saw:
 *  1. content that finished revealing inside a transition fading out and in
 *     again once it ends (an entrance restarting);
 *  2. the transition playing and then the route's skeleton fallback showing
 *     before the page (code chunk not loaded yet).
 * Loads the app cold, navigates at once (before idle prefetch), and reports
 * any reveal animation that starts after a transition ended and any frame
 * where the route skeleton ("Loading page") is on screen.
 *   node scripts/motion_flicker.mjs [baseUrl] [chromium|firefox] */
import { chromium, firefox } from 'playwright';
const base = process.argv[2] || 'http://localhost:5173';
const engine = process.argv[3] === 'firefox' ? firefox : chromium;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.__report = { lateReveals: [], fallbackSeen: [], transitions: 0, timeline: [] };
  const T = () => Math.round(performance.now());
  let lastEnd = -1;
  const orig = document.startViewTransition;
  if (orig) document.startViewTransition = function (cb) {
    window.__report.transitions++;
    window.__report.timeline.push(`${T()} vt-start ${location.pathname}`);
    const t = orig.call(document, cb);
    t.updateCallbackDone.then(() => window.__report.timeline.push(`${T()} vt-updated`));
    t.finished.then(() => { lastEnd = performance.now(); window.__report.timeline.push(`${T()} vt-end`); });
    return t;
  };
  document.addEventListener('animationstart', (e) => {
    if (/m-reveal|m-rise|wp-enter/.test(e.animationName) && lastEnd > 0 && performance.now() - lastEnd < 400) {
      window.__report.lateReveals.push(`${e.animationName} on ${e.target.className.toString().slice(0, 60)}`);
    }
  }, true);
  new MutationObserver(() => {
    if ([...document.querySelectorAll('[aria-busy="true"] .sr-only')].some((n) => n.textContent === 'Loading page')) {
      if (!window.__fb) window.__report.timeline.push(`${T()} fallback-on ${location.pathname}`);
      window.__fb = true;
      window.__report.fallbackSeen.push(location.pathname);
    } else if (window.__fb) {
      window.__fb = false;
      window.__report.timeline.push(`${T()} fallback-off ${location.pathname}`);
    }
  }).observe(document, { childList: true, subtree: true });
});

/* Cold: straight from a fresh load to another route, before idle prefetch. */
await page.goto(base + '/');
await page.waitForSelector('nav a[href="/collections"], a[href="/collections"]', { timeout: 60000 });
await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="/collections"]')].find((x) => x.getClientRects().length); a?.click(); });
await page.waitForTimeout(3500);
await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="/library"], a[href^="/library"]')].find((x) => x.getClientRects().length); a?.click(); });
await page.waitForTimeout(3500);
await page.evaluate(() => { const a = [...document.querySelectorAll('a[href="/schedule"]')].find((x) => x.getClientRects().length); a?.click(); });
await page.waitForTimeout(3500);
const report = await page.evaluate(() => window.__report);
console.log(report.timeline.join(String.fromCharCode(10)));
await browser.close();
