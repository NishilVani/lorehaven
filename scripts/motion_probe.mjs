/* Motion probe: drives real navigations in headless Chromium and reports, for
 * each, the transition type the director chose, which view-transition groups
 * animated, when the transition was ready and finished, and frame timings, on
 * a phone-sized page with the CPU throttled 4x.
 *
 *   node scripts/motion_probe.mjs [baseUrl]
 *
 * Needs the dev server (npm run dev). Prints one JSON line per step and a
 * budget line: frame p95 <= 20ms (spec 5.2). */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await page.addInitScript(() => {
  window.__vt = [];
  const orig = document.startViewTransition;
  if (!orig) return;
  document.startViewTransition = function (cb) {
    const rec = { type: document.documentElement.dataset.vt, dir: document.documentElement.dataset.vtDir || null, groups: [] };
    const s = performance.now();
    const t = orig.call(document, cb);
    t.ready.then(() => {
      rec.ready = Math.round(performance.now() - s);
      rec.typeAfter = document.documentElement.dataset.vt;
      rec.groups = [...new Set(document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean))];
    }).catch((e) => { rec.error = String(e); });
    t.finished.then(() => { rec.finished = Math.round(performance.now() - s); }).catch(() => {});
    window.__vt.push(rec);
    return t;
  };
});

async function step(name, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__frameRun = true;
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frameRun) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__vt.length = 0;
  });
  await action();
  await page.waitForTimeout(1600);
  const out = await page.evaluate(() => {
    window.__frameRun = false;
    const f = [...window.__frames].sort((a, b) => a - b);
    const p = (q) => Math.round(f[Math.min(f.length - 1, Math.floor(q * f.length))] || 0);
    return { path: location.pathname, vt: window.__vt[0] || null, p50: p(0.5), p95: p(0.95), longFrames: f.filter((x) => x > 50).length };
  });
  console.log(JSON.stringify({ step: name, ...out }));
  return out;
}

await page.goto(base + '/');
await page.waitForSelector('.hover-game-card [data-shared^="poster:"]', { timeout: 60000 });
await page.waitForTimeout(2500);

const results = [];
results.push(await step('card -> game', () => page.locator('.hover-game-card:has([data-shared^="poster:"]) [role="link"]').first().click()));
results.push(await step('back', () => page.goBack()));
/* A collection tile's name grows into the collection page's heading. */
await page.goto(base + '/collections');
await page.waitForSelector('[data-shared-scope] [data-shared^="title:"]', { timeout: 60000 });
await page.waitForTimeout(2000);
results.push(await step('collection tile -> page', () => page.locator('[data-shared-scope]:has([data-shared^="title:"]) a').first().click()));

/* Shelves at desktop size: the six-tab row is hidden on phones. */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(base + '/library/backlog');
await page.waitForTimeout(3000);
results.push(await step('shelf -> shelf', () => page.locator('button.lh-tab').filter({ hasText: /wishlist/i }).first().click()));
results.push(await step('shelf <- shelf', () => page.locator('button.lh-tab').filter({ hasText: /playing/i }).first().click()));

const p95 = Math.max(...results.map((r) => r.p95));
/* Judge the budget on a production build (npm run build && npm run preview):
   dev React is several times slower and inflates every frame. */
console.log(JSON.stringify({ budget: 'frame p95 <= 20ms', worstP95: p95, pass: p95 <= 20 }));
await browser.close();
