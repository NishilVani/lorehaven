/* Long-shelf repro: seed two long shelves, scroll down one, switch to the
 * other, and save frames at quarter speed. node scripts/motion_longshelf.mjs
 * [baseUrl] [outDir] [width] */
import { chromium } from 'playwright';
import fs from 'fs';
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'qa/motion-longshelf';
const width = Number(process.argv[4]) || 1280;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.addInitScript(() => {
  if (localStorage.getItem('__seeded')) return;
  const covers = ['co1wyy', 'co4jni', 'co2lbd', 'co1r7f', 'co5vmg', 'co3p2d'];
  const lib = [];
  for (let i = 0; i < 60; i++) lib.push({ id: 900000 + i, name: `Backlog Game ${i + 1}`, status: 'Backlog', cover_id: covers[i % 6], dateAdded: Date.now() - i * 1000 });
  for (let i = 0; i < 60; i++) lib.push({ id: 910000 + i, name: `Wishlist Game ${i + 1}`, status: 'Wishlist', cover_id: covers[(i + 3) % 6], dateAdded: Date.now() - i * 1000 });
  localStorage.setItem('moctale_library', JSON.stringify(lib));
  localStorage.setItem('__seeded', '1');
});
await page.goto(base + '/library/backlog');
await page.waitForSelector('.hover-game-card', { timeout: 60000 });
await page.waitForTimeout(2000);
await page.mouse.wheel(0, 1800);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/0-before.png` });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
const tab = page.locator('button.lh-tab').filter({ hasText: /wishlist/i }).first();
const compact = page.locator('.lh-strip-compact');
if (await tab.isVisible()) await tab.click();
else { await compact.click(); await page.getByRole('dialog').getByText(/wishlist/i).first().click(); }
for (const [i, ms] of [[1, 150], [2, 700], [3, 1400]]) {
  await page.waitForTimeout(ms - (i > 1 ? [0, 150, 700][i - 1] : 0));
  await page.screenshot({ path: `${out}/${i}.png` });
}
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/4-after.png` });
console.log('ok', await page.evaluate(() => ({ path: location.pathname, scrollY: Math.round(scrollY) })));
await browser.close();
