/**
 * Long-press-to-lift, driven as real touch.
 *
 * Moving a game between shelves is the best interaction in the library and it
 * was mouse-only: HTML5 drag-and-drop does not fire on touch at all. The touch
 * route has three ways to be wrong that no static check sees —
 *
 *   1. it steals scrolling (a press that moves must scroll, never lift),
 *   2. it navigates instead of moving (the release still emits a click),
 *   3. it poisons the shelf swipe (both arm on the same pointerdown, and the
 *      lift disables the swipe before its pointerup can clear the tracked id —
 *      leaving swiping dead for the rest of the session).
 *
 * Playwright's own touchscreen helper cannot hold a press, so this drives CDP
 * touch events directly at ~16ms intervals, which is what a hand produces.
 *
 *   node scripts/verify_lift.mjs [baseUrl]
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';

/* Custom entries skip IGDB hydration, so the page reaches its rendered state
   without a network stub. */
const SEED = [
  { id: 'custom_9001', name: 'Lift Probe A', status: 'Backlog', is_custom: true },
  { id: 'custom_9002', name: 'Lift Probe B', status: 'Backlog', is_custom: true },
  { id: 'custom_9003', name: 'Lift Probe C', status: 'Backlog', is_custom: true },
];

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();

const open = async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.addInitScript((g) => localStorage.setItem('moctale_library', JSON.stringify(g)), SEED);
  await page.goto(`${BASE}/library/backlog`, { waitUntil: 'domcontentloaded' });
  await page.locator('[role="link"][aria-label="Lift Probe A"]').first()
    .waitFor({ state: 'visible', timeout: 15000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  const drag = async (from, to) => {
    let [x, y] = from;
    while (Math.hypot(to[0] - x, to[1] - y) > 8) {
      x += Math.max(-24, Math.min(24, to[0] - x));
      y += Math.max(-24, Math.min(24, to[1] - y));
      await touch('touchMove', x, y);
      await page.waitForTimeout(16);
    }
    return [x, y];
  };
  const cardCentre = async (name = 'Lift Probe A') => {
    const b = await page.locator(`[role="link"][aria-label="${name}"]`).first().boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  return { ctx, page, touch, drag, cardCentre };
};

// ── 1. A press that moves is a scroll, not a lift ────────────────────────────
{
  const { ctx, page, touch, cardCentre } = await open();
  const [cx, cy] = await cardCentre();
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', cx, cy - i * 12); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);   // well past the long-press delay
  check('a moving press scrolls, never lifts',
    (await page.evaluate(() => !document.querySelector('body > div[style*="99999"]'))));
  await touch('touchEnd', cx, cy - 96);
  await ctx.close();
}

// ── 2. A press that stays put lifts, and lands on the shelf under the finger ──
{
  const { ctx, page, touch, drag, cardCentre } = await open();
  const [cx, cy] = await cardCentre();
  await touch('touchStart', cx, cy);
  await page.waitForTimeout(700);

  check('a held press raises a ghost',
    await page.evaluate(() => !!document.querySelector('body > div[style*="99999"]')));

  const t = await page.locator('button[data-lift-target="Playing"]').boundingBox();
  const to = [t.x + t.width / 2, t.y + t.height / 2];
  await drag([cx, cy], to);
  await page.waitForTimeout(80);
  const lit = await page.evaluate(() => {
    const cell = document.querySelector('button[data-lift-target="Playing"]');
    const rm = document.querySelector('.lh-tab-remove');
    rm.classList.add('is-drop-over');
    const spread = (el) => {
      // Fourth length in the shadow is the spread; a wash uses a huge one.
      const nums = getComputedStyle(el).boxShadow.match(/(-?[\d.]+)px/g) || [];
      return nums.length >= 4 ? parseFloat(nums[3]) : 0;
    };
    const out = {
      on: cell.classList.contains('is-drop-over'),
      cellSpread: spread(cell),
      removeSpread: spread(rm),
      removeColor: getComputedStyle(rm).color,
    };
    rm.classList.remove('is-drop-over');
    return out;
  });
  check('the strip cell under the finger lights up', lit.on);
  /* A wash, not a ring: the treatment is a cell-sized inset shadow, so its
     spread is far larger than the 2px border it replaced. */
  check('it lights as a wash rather than an outline', lit.cellSpread > 100,
    `spread ${lit.cellSpread}px`);
  /* Remove keeps its own colour under the card. It used to go white, which made
     the destructive target the brightest cell in the strip at the moment a card
     was over it. */
  check('Remove keeps its destructive colour when lit',
    lit.removeSpread > 100 && /248,\s*113,\s*113/.test(lit.removeColor), lit.removeColor);

  await touch('touchEnd', ...to);
  await page.waitForTimeout(500);

  check('the game lands on that shelf',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('moctale_library'))
      .find(g => g.id === 'custom_9001')?.status)) === 'Playing');
  check('the move is undoable',
    (await page.getByRole('button', { name: 'Undo' }).count()) === 1);
  check('the ghost and highlight are cleaned up',
    (await page.locator('.is-drop-over').count()) === 0
    && await page.evaluate(() => !document.querySelector('body > div[style*="99999"]')));
  check('the release does not open the game', page.url().includes('/library/'));
  await ctx.close();
}

// ── 3. One shelf surface, and the chrome recedes around it ──────────────
{
  const { ctx, page, touch, cardCentre } = await open();
  const [cx, cy] = await cardCentre();
  await touch('touchStart', cx, cy);
  // Past the long press AND past the 500ms opacity transition it starts.
  await page.waitForTimeout(1400);

  const state = await page.evaluate(() => {
    const strip = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string'
      && d.className.includes('sticky') && d.querySelector('.lh-tab'));
    const tab = document.querySelector('button[data-lift-target="Playing"]');
    const bar = document.querySelector('.lift-bar-enter');
    const toolbar = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string'
      && d.className.includes('grid-cols-1') && d.className.includes('mb-8'));
    return {
      stripOpacity: strip && getComputedStyle(strip).opacity,
      stripHeight: strip && Math.round(strip.getBoundingClientRect().height),
      tabColor: tab && getComputedStyle(tab).color,
      removeShown: !!document.querySelector('.lh-tab-remove:not([hidden])'),
      secondSurface: !!bar,
      toolbarOpacity: toolbar && getComputedStyle(toolbar).opacity,
      toolbarInert: toolbar ? toolbar.hasAttribute('inert') : null,

    };
  });

  check('the strip stays visible and is the only shelf surface',
    state.stripOpacity === '1' && !state.secondSurface, JSON.stringify(state.stripOpacity));
  check('no void: the strip holds no more space than it draws',
    state.stripHeight > 40, `${state.stripHeight}px`);
  check('shelf tabs come up to full white while a card is in the air',
    state.tabColor === 'rgb(255, 255, 255)', state.tabColor);
  check('Remove is offered', state.removeShown);
  check('the toolbar recedes with the grid',
    state.toolbarOpacity === '0.1' && state.toolbarInert === true,
    `${state.toolbarOpacity} inert=${state.toolbarInert}`);
  /* The bottom bar used to sit at z-9998 over this, so the app's own drag
     instruction was hidden behind the surface that replaced it. */
  const banner = page.getByText(/Drop on a/).first();
  check('the drag instruction is visible, not covered',
    (await banner.count()) === 1 && await banner.isVisible());

  await touch('touchEnd', cx, cy);
  await ctx.close();
}

// ── 4. The gesture hint is said once, then retired ───────────────────────
{
  const { ctx, page, touch, cardCentre } = await open();
  check('a first-time visitor is told the gesture exists',
    (await page.getByText(/Hold a card to move it/).count()) === 1);

  const [cx, cy] = await cardCentre();
  await touch('touchStart', cx, cy);
  await page.waitForTimeout(700);
  await touch('touchEnd', cx, cy);
  await page.waitForTimeout(400);
  check('using the gesture retires the hint',
    (await page.getByText(/Hold a card to move it/).count()) === 0
    && (await page.evaluate(() => localStorage.getItem('moctale_lift_hint_done'))) === '1');
  await ctx.close();
}

// ── 5. A cancelled lift leaves the shelf swipe working ───────────────────────
{
  const { ctx, page, touch, cardCentre } = await open();
  const [cx, cy] = await cardCentre();
  await touch('touchStart', cx, cy);
  await page.waitForTimeout(700);          // lift
  await touch('touchEnd', cx, cy);         // released over its own card: no move
  await page.waitForTimeout(400);
  check('a cancelled lift moves nothing',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('moctale_library'))
      .find(g => g.id === 'custom_9001')?.status)) === 'Backlog');

  let x = cx;
  await touch('touchStart', x, cy);
  for (let i = 0; i < 12; i++) { x -= 14; await touch('touchMove', x, cy); await page.waitForTimeout(16); }
  await touch('touchEnd', x, cy);
  await page.waitForTimeout(500);
  check('the shelf swipe still works after a lift', page.url().includes('/library/wishlist'),
    page.url().split('/library')[1]);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\nlift gate: ${fails.length} FAILURE(S)` : '\nlift gate: CLEAN');
process.exit(fails.length ? 1 : 0);
