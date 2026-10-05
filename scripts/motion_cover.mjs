/* Checks the expressive cover flight: after tapping a card, does the game
 * page's cover arrive with a flight animation, and how long after the tap.
 *   node scripts/motion_cover.mjs [baseUrl] */
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => localStorage.setItem('lorehaven_motion', 'expressive'));
const page = await context.newPage();
await page.goto(base + '/');
await page.waitForSelector('.lh-card-enter [data-card-cover]', { timeout: 60000 });
await page.waitForTimeout(1000);
const out = await page.evaluate(async () => {
  const t0 = performance.now();
  const seen = {};
  const watch = new MutationObserver(() => {
    const img = document.querySelector('[data-vt-cover]');
    if (img && !seen.coverAt) {
      seen.coverAt = Math.round(performance.now() - t0);
      queueMicrotask(() => {
        const a = img.getAnimations()[0];
        seen.flight = a ? Math.round(a.effect.getTiming().duration) : 0;
        seen.from = a ? a.effect.getKeyframes()[0].translate : null;
      });
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
  document.querySelector('.lh-card-enter:has([data-card-cover]) [role="link"]').click();
  await new Promise(r => setTimeout(r, 2500));
  watch.disconnect();
  return { href: location.pathname, ...seen };
});
console.log(JSON.stringify(out));
await browser.close();
