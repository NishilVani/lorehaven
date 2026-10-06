/* Mid-transition screenshots for a human look, with every animation slowed
 * 4x so a frame lands inside each beat.
 *
 *   node scripts/motion_frames.mjs [baseUrl] [outDir]
 *
 * Writes carry-*.png (card to game page, phone size) and side-*.png (library
 * shelf change, desktop size) at 15%, 40%, 70% of the transition and settled. */
import { chromium } from 'playwright';
import fs from 'fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'qa/motion-frames';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const SLOW = 4;
/* Real transition is about 520ms; slowed it is about 2100ms. */
const marks = [0.15, 0.4, 0.7].map((f) => Math.round(f * 520 * SLOW));

async function capture(page, prefix, act) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  const t0 = Date.now();
  await act();
  for (const [i, ms] of marks.entries()) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${prefix}-${i + 1}.png` });
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${prefix}-4.png` });
}

const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
await phone.goto(base + '/');
await phone.waitForSelector('.hover-game-card [data-shared^="poster:"]', { timeout: 60000 });
await phone.waitForTimeout(2500);
await phone.locator('.hover-game-card:has([data-shared^="poster:"])').first().scrollIntoViewIfNeeded();
await capture(phone, 'carry', () => phone.locator('.hover-game-card:has([data-shared^="poster:"]) [role="link"]').first().click());
await capture(phone, 'home', () => phone.goBack());

const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(base + '/library/backlog');
await desk.waitForTimeout(3500);
await capture(desk, 'side', () => desk.locator('button.lh-tab').filter({ hasText: /wishlist/i }).first().click());

console.log('ok', out);
await browser.close();
