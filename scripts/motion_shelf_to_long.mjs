/* Short shelf -> long shelf, not scrolled: the case the owner reported.
 * Records animations running on library cards during the switch, and saves
 * frames at quarter speed. node scripts/motion_shelf_to_long.mjs [url] [dir] */
import { chromium, firefox } from 'playwright';
import fs from 'fs';
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'qa/motion-shelf-long';
fs.mkdirSync(out, { recursive: true });
const ff = process.env.ENGINE === 'firefox';
const browser = await (ff ? firefox : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  if (localStorage.getItem('__seeded2')) return;
  const covers = ['co1wyy', 'co4jni', 'co2lbd', 'co1r7f', 'co5vmg', 'co3p2d'];
  const lib = [{ id: 920001, name: 'Only Playing', status: 'Playing', cover_id: 'co1wyy' }];
  for (let i = 0; i < 60; i++) lib.push({ id: 900000 + i, name: `Backlog Game ${i + 1}`, status: 'Backlog', cover_id: covers[i % 6] });
  localStorage.setItem('moctale_library', JSON.stringify(lib));
  localStorage.setItem('__seeded2', '1');
});
await page.goto(base + '/library/playing');
await page.waitForSelector('.hover-game-card', { timeout: 60000 });
await page.waitForTimeout(2500);
const result = page.evaluate(() => new Promise((resolve) => {
  const seen = { cardAnimations: 0, names: new Set(), during: 0 };
  const t0 = performance.now();
  const sample = () => {
    const vt = document.documentElement.dataset.vt;
    for (const a of document.getAnimations()) {
      const el = a.effect?.target;
      if (el instanceof Element && el.closest('.hover-game-card')) {
        seen.cardAnimations++;
        seen.names.add(a.animationName || a.constructor.name);
        if (vt) seen.during++;
      }
    }
    if (performance.now() - t0 < 2500) requestAnimationFrame(sample);
    else resolve({ cardAnimationSamples: seen.cardAnimations, duringTransition: seen.during, kinds: [...seen.names] });
  };
  requestAnimationFrame(sample);
}));
if (ff) {
  /* No slow-motion control in Firefox: real-time frames instead. */
  await page.locator('button.lh-tab').filter({ hasText: /backlog/i }).first().click();
  console.log(JSON.stringify(await result));
  await page.waitForTimeout(1500);
  await page.locator('button.lh-tab').filter({ hasText: /playing/i }).first().click();
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.locator('button.lh-tab').filter({ hasText: /backlog/i }).first().click();
  for (const [i, ms] of [[1, 60], [2, 180], [3, 320], [4, 700]]) {
    const w = ms - (Date.now() - t0);
    if (w > 0) await page.waitForTimeout(w);
    await page.screenshot({ path: `${out}/${i}.png` });
  }
  await browser.close();
  process.exit(0);
}
const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await page.locator('button.lh-tab').filter({ hasText: /backlog/i }).first().click();
console.log(JSON.stringify(await result));
await page.waitForTimeout(1500);
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
await page.locator('button.lh-tab').filter({ hasText: /playing/i }).first().click();
await page.waitForTimeout(2600);
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
await page.waitForTimeout(1500);
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
await page.locator('button.lh-tab').filter({ hasText: /backlog/i }).first().click();
for (const [i, ms] of [[1, 300], [2, 900], [3, 1600], [4, 2600]]) {
  await page.waitForTimeout(i === 1 ? ms : ms - [0, 300, 900, 1600][i - 1]);
  await page.screenshot({ path: `${out}/${i}.png` });
}
await browser.close();
