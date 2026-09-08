/**
 * Full-screen overlays vs the desktop nav rail.
 *
 * The rail is `position: fixed`, 220px of opaque black, at z-[9999]. An overlay
 * that spans the viewport has exactly two honest options:
 *
 *   COVER  — paint above the rail, so the whole overlay is visible and the
 *            backdrop dims the rail like everything else.
 *   INSET  — start at the rail's right edge (`lg:left-[220px]`), so the rail
 *            stays visible beside it.
 *
 * The failure is the third case: reach into the rail's 220px AND sit under it.
 * That is what the media lightbox did at z-3000 — the left of every screenshot
 * was clipped and the backdrop dimmed everything except the one element still
 * lit. The skip link in App.jsx hit the same wall and records the same cause.
 *
 * Below lg the rail is translated off-screen, which is why this only ever shows
 * up on a wide window — so this gate is desktop-only by nature.
 *
 *   node scripts/verify_layers.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/* Pixels, not hit tests. elementFromPoint SKIPS inert subtrees, and a Dialog
   inerts everything outside itself — so a rail sitting visibly on top of the
   overlay still reported the overlay as the topmost element. This is the same
   trap App.jsx records: computed style said the skip link was visible while
   screenshots of its exact rect came back byte-identical.

   So: shoot the rail's strip with the overlay closed, shoot it again with the
   overlay open, and compare. If the bytes match, nothing about the overlay —
   not even its backdrop — reached that strip, and an overlay that geometrically
   overlaps the rail but changes none of its pixels is behind it. */
const geometry = (page) => page.evaluate(() => {
  const rail = [...document.querySelectorAll('aside')].find(a => getComputedStyle(a).position === 'fixed');
  const panel = document.querySelector('[role="dialog"]');
  if (!rail) return { error: 'no rail' };
  const r = rail.getBoundingClientRect();
  return {
    railWidth: Math.round(r.width),
    railRight: Math.round(r.right),
    panelLeft: panel ? Math.round(panel.getBoundingClientRect().left) : null,
  };
});

async function verdict(page, open) {
  const before = await page.screenshot({ clip: { x: 0, y: 0, width: 220, height: 800 } });
  await open();
  await page.waitForTimeout(900);
  const g = await geometry(page);
  if (g.error) return { verdict: g.error, ...g };
  if (g.panelLeft === null) return { verdict: 'no overlay', ...g };
  // Sitting entirely clear of the rail is the other honest option.
  if (g.panelLeft >= g.railRight - 1) return { verdict: 'INSET', ...g };
  const after = await page.screenshot({ clip: { x: 0, y: 0, width: 220, height: 800 } });
  return { verdict: before.equals(after) ? 'CLIPPED' : 'COVER', ...g };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// ── The game media lightbox ────────────────────────────────────────────────
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/game/1942`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: /^Open .* media$/ });
  await trigger.waitFor({ timeout: 30000 });
  const v = await verdict(page, () => trigger.first().click());
  check('the media lightbox is not clipped by the rail', v.verdict !== 'CLIPPED',
    `${v.verdict} — panel left ${v.panelLeft}, rail ends ${v.railRight}`);
  await page.close();
}

// ── The search overlay, which takes the other option ───────────────────────
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const v = await verdict(page, async () => {
    await page.goto(`${BASE}/?search=true`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });
  check('the search overlay is not clipped by the rail', v.verdict !== 'CLIPPED',
    `${v.verdict} — panel left ${v.panelLeft}, rail ends ${v.railRight}`);
  await page.close();
}

await browser.close();
console.log(fails.length ? `\nlayers gate: ${fails.length} FAILURE(S)` : '\nlayers gate: CLEAN');
process.exit(fails.length ? 1 : 0);
