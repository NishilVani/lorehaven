/* Screenshots motion mid-flight for a human look: Explore's cards rising in,
 * the game page arriving, the cover flight, and the Motion setting.
 *   node scripts/motion_frames.mjs [baseUrl] [outDir] */
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'qa/motion-frames';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => localStorage.setItem('lorehaven_motion', 'expressive'));
const page = await context.newPage();
await page.goto(base + '/');
await page.waitForSelector('.lh-card-enter [data-card-cover]', { timeout: 60000 });
await page.waitForTimeout(1500);
await page.locator('.lh-card-enter [data-card-cover]').first().scrollIntoViewIfNeeded();
/* Slow every animation 4x so a frame lands mid-way. */
const cdp = await context.newCDPSession(page);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
await page.locator('.lh-card-enter:has([data-card-cover]) [role="link"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/1-page-transition.png` });
await page.waitForSelector('[data-vt-cover]', { timeout: 20000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/2-cover-flight.png` });
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-game-page.png` });
await page.goto(base + '/');
await page.waitForSelector('[aria-label="Account menu"], button[aria-haspopup="menu"]', { timeout: 30000 }).catch(() => {});
await page.evaluate(() => document.querySelector('.lh-card-enter') && window.scrollTo(0, 0));
console.log('ok');
await browser.close();
