/* Motion performance probe: how long a page transition takes to start and
 * finish, and what the frames cost while it runs, on a phone-sized Chromium
 * with the CPU throttled 4x (a mid-range Android phone, roughly).
 *
 *   node scripts/motion_perf.mjs [baseUrl] [standard|expressive|reduced]
 *
 * Needs the dev server (npm run dev). Prints one JSON line per measurement.
 * Measures, does not judge: compare runs before and after a change. */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const level = process.argv[3] || 'standard';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript((lvl) => { localStorage.setItem('lorehaven_motion', lvl); }, level);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await page.goto(base + '/');
await page.waitForSelector('.lh-card-enter [role="link"]', { timeout: 60000 });
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  let running = true;
  const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const marks = {};
  const orig = document.startViewTransition;
  const s0 = performance.now();
  document.startViewTransition = function (cb) {
    const s = performance.now();
    marks.started = s - s0;
    const t = orig.call(document, cb);
    t.ready.then(() => { marks.ready = performance.now() - s; }).catch((e) => { marks.readyErr = String(e); });
    t.finished.then(() => { marks.finished = performance.now() - s; });
    return t;
  };
  document.querySelector('.lh-card-enter [role="link"]').click();
  await new Promise((r) => setTimeout(r, 2500));
  running = false;
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return {
    href: location.pathname,
    ...Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])),
    frames: frames.length,
    p50: p(0.5),
    p95: p(0.95),
    worst: Math.round(sorted[sorted.length - 1] || 0),
    over50ms: frames.filter((f) => f > 50).length,
  };
});
console.log(JSON.stringify({ level, transition: 'card -> game', ...result }));
await browser.close();
