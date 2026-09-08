/**
 * Library shelf strip on mobile.
 *
 * Below xl the strip holds ONE shape at rest: the shelf you are on, its count,
 * and a chevron into a picker. Six shelves in three rows cost 99px, 15% of an
 * iPhone viewport, for a control you touch once a session.
 *
 * The shape changes exactly once — when a card is lifted and needs somewhere to
 * land — and never while scrolling. The version this replaced folded on scroll,
 * and every defect it had came from that: cells fading to transparent on a black
 * page (which reads as them turning black), a 110ms gap before the row closed, a
 * document reflow per crossing, and a threshold that had to out-run the
 * browser's own scroll compensation.
 *
 * So this gate asserts, above all, that scrolling changes nothing.
 *
 *   node scripts/verify_strip.mjs [baseUrl]
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const SEED = Array.from({ length: 24 }, (_, i) =>
  ({ id: `custom_${9000 + i}`, name: `Strip Probe ${i}`, status: 'Backlog', is_custom: true }));

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();

const open = async (device) => {
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  await page.addInitScript((g) => localStorage.setItem('moctale_library', JSON.stringify(g)), SEED);
  await page.goto(`${BASE}/library/backlog`, { waitUntil: 'domcontentloaded' });
  await page.locator('[role="link"][aria-label="Strip Probe 0"]').first()
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
  const read = () => page.evaluate(() => {
    const strip = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string'
      && d.className.includes('sticky') && d.querySelector('.lh-tab'));
    const shown = (sel) => [...strip.querySelectorAll(sel)].filter(e => e.offsetParent !== null).length;
    const card = document.querySelector('[role="link"][aria-label="Strip Probe 4"]');
    return {
      y: Math.round(window.scrollY),
      height: Math.round(strip.getBoundingClientRect().height),
      compact: shown('.lh-strip-compact'),
      shelves: shown('.lh-tab:not(.lh-strip-compact):not(.lh-tab-remove)'),
      remove: shown('.lh-tab-remove'),
      cardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
    };
  });
  return { ctx, page, read };
};

// ── One row at rest, and scrolling does not touch it ────────────────────────
{
  const { ctx, page, read } = await open(devices['iPhone 14 Pro']);
  const top = await read();
  check('at rest it is one row: the shelf you are on',
    top.compact === 1 && top.shelves === 0 && top.height < 56,
    `${top.height}px, ${top.shelves} shelves, compact=${top.compact}`);

  /* The whole point. Scroll through the range where the old strip folded,
     unfolded and flapped, and assert the strip never changes at all — same
     height, same shape, and the grid moving exactly the scroll distance. */
  let prev = top, changes = 0, worstDrift = 0;
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(160);
    const now = await read();
    if (now.height !== prev.height || now.compact !== prev.compact) changes++;
    worstDrift = Math.max(worstDrift, Math.abs((prev.cardTop - now.cardTop) - 30));
    prev = now;
  }
  check('scrolling never changes its shape', changes === 0, `${changes} change(s)`);
  check('and never moves the grid under the finger', worstDrift <= 4, `worst drift ${worstDrift}px`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const back = await read();
  check('and it is unchanged back at the top',
    back.height === top.height && back.compact === 1, `${back.height}px`);
  await ctx.close();
}

/* Contrast of everything sitting on a filled shelf. The fill is the shelf's own
   colour and the content is black, so this has to hold across the whole ramp —
   not just the one shelf the mock was drawn on. Black at 60% clears AA on Beaten
   (5.13:1) and fails on Wishlist (3.88), Dropped (3.91) and Backlog (4.04). */
/* Tailwind v4 hands colours back as oklab(...), so a regex over the numbers
   reads the L/a/b channels as r/g/b. verify_control_borders.mjs already records
   this trap; the fix is the same one — paint the colour and read the pixel, which
   normalises whatever syntax the browser used. It only escaped notice here
   because black is 0 0 0 in both spaces. */
const NORMALISE = () => {
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  cx.globalCompositeOperation = 'copy';
  return (css) => {
    cx.fillStyle = '#000';
    cx.fillStyle = css;
    cx.clearRect(0, 0, 1, 1);
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
};
const relLum = ([r, g, b]) => {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const ratio = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── Every shelf, filled: black content must clear AA on all six ─────────────
{
  const SHELVES = ['playing', 'backlog', 'wishlist', 'beaten', 'dropped', 'unreleased'];
  const worst = { label: null, ratio: Infinity, on: null, fg: null };
  for (const shelf of SHELVES) {
    const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
    const page = await ctx.newPage();
    await page.addInitScript((g) => localStorage.setItem('moctale_library', JSON.stringify(g)), SEED);
    await page.goto(`${BASE}/library/${shelf}`, { waitUntil: 'domcontentloaded' });
    // Wait for the fill itself, not a guessed timeout — measuring a row that has
    // not been painted yet reported a 1.00:1 ratio against a transparent box.
    await page.waitForFunction(() => {
      const b = document.querySelector('.lh-strip-compact');
      return b && !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(b).backgroundColor);
    }, { timeout: 15000 });

    const read = await page.evaluate((normSrc) => {
      const norm = new Function('return ' + normSrc)()();
      const btn = document.querySelector('.lh-strip-compact');
      return {
        bg: norm(getComputedStyle(btn).backgroundColor),
        parts: [...btn.querySelectorAll('.lh-label')].map(s => ({
          text: s.textContent.trim().slice(0, 12),
          raw: getComputedStyle(s).color,
          rgba: norm(getComputedStyle(s).color),
        })),
      };
    }, NORMALISE.toString());

    const bg = read.bg.slice(0, 3);
    for (const part of read.parts) {
      const r = ratio(over(part.rgba.slice(0, 3), part.rgba[3], bg), bg);
      if (r < worst.ratio) {
        Object.assign(worst, { ratio: r, label: part.text, on: shelf, fg: part.raw });
      }
    }
    await ctx.close();
  }
  check('black on a filled shelf clears AA on every shelf colour',
    worst.ratio >= 4.5,
    `worst ${worst.ratio.toFixed(2)}:1 — "${worst.label}" (${worst.fg}) on ${worst.on}`);
}

// ── The picker: a sheet at the bottom, in the thumb zone ────────────────────
{
  const { ctx, page, read } = await open(devices['iPhone 14 Pro']);
  await page.getByRole('button', { name: /Change shelf/ }).click();
  await page.waitForTimeout(400);

  const dialog = page.getByRole('dialog');
  check('tapping the row opens a picker', await dialog.isVisible());

  const box = await dialog.boundingBox();
  const vh = page.viewportSize().height;
  check('it sits at the bottom, in the thumb zone',
    box.y + box.height >= vh - 4, `bottom ${Math.round(box.y + box.height)} of ${vh}`);

  const rows = dialog.getByRole('button');
  check('every shelf is offered', (await rows.count()) === 6, `${await rows.count()} rows`);
  const heights = await rows.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  check('its rows are thumb-sized', Math.min(...heights) >= 44, `min ${Math.min(...heights)}px`);

  /* The shelf you are on is filled, not ticked — and the fill inverts the row
     to light-on-dark, so it survives greyscale rather than leaning on hue. */
  const current = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="dialog"] button')];
    const on = rows.find(r => r.getAttribute('aria-current') === 'page');
    const off = rows.find(r => r !== on);
    const lum = (css) => { const [r, g, b] = css.match(/\d+/g).slice(0, 3).map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    return {
      filled: lum(getComputedStyle(on).backgroundColor) > 60,
      others: lum(getComputedStyle(off).backgroundColor) < 30,
      ticks: document.querySelectorAll('[role="dialog"] svg').length,
      label: on.textContent.trim().slice(0, 10),
    };
  });
  check('the shelf you are on is filled with its colour, not ticked',
    current.filled && current.others && current.ticks === 0,
    `filled=${current.filled} others-dark=${current.others} icons=${current.ticks}`);

  await rows.filter({ hasText: 'Playing' }).click();
  await page.waitForTimeout(600);
  check('choosing a shelf navigates and closes',
    page.url().includes('/library/playing') && (await page.getByRole('dialog').count()) === 0,
    page.url().split('/library')[1]);
  const now = await read();
  check('and the row still shows one shelf', now.compact === 1 && now.shelves === 0);
  await ctx.close();
}

// ── A lifted card brings every shelf back ───────────────────────────────────
{
  const { ctx, page, read } = await open(devices['iPhone 14 Pro']);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  check('compact before the lift', (await read()).compact === 1);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  const spot = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="link"][aria-label^="Strip Probe"]')]
      .find(e => { const r = e.getBoundingClientRect();
        return r.top > 140 && r.bottom < window.innerHeight - 40; });
    const r = el.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  });
  await touch('touchStart', ...spot);
  await page.waitForTimeout(700);
  const lifted = await read();
  check('lifting a card opens every shelf', lifted.shelves === 6 && lifted.compact === 0,
    `${lifted.shelves} shelves, compact=${lifted.compact}`);
  check('and offers Remove', lifted.remove === 1);
  check('every shelf is a drop target',
    (await page.locator('button[data-lift-target]').count()) === 7);

  await touch('touchEnd', ...spot);
  await page.waitForTimeout(600);
  check('and it closes again on release', (await read()).compact === 1);
  await ctx.close();
}

// ── Desktop is untouched ────────────────────────────────────────────────────
{
  const { ctx, page, read } = await open({ viewport: { width: 1440, height: 900 } });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const now = await read();
  check('desktop keeps all six on one row, with no compact cell',
    now.shelves === 6 && now.compact === 0, `${now.shelves} shelves, compact=${now.compact}`);
  check('desktop still shows the page heading', await page.locator('h1').first().isVisible());
  await ctx.close();
}

// ── The heading is reclaimed on mobile but stays in the outline ─────────────
{
  const { ctx, page } = await open(devices['iPhone 14 Pro']);
  const head = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const r = h1.closest('div').parentElement.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: h1.textContent.trim() };
  });
  check('mobile reclaims the duplicated heading block', head.h <= 1 && head.w <= 1, `${head.w}x${head.h}`);
  check('but keeps it for the document outline',
    (await page.locator('h1').count()) === 1 && head.text.length > 0, head.text);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\nstrip gate: ${fails.length} FAILURE(S)` : '\nstrip gate: CLEAN');
process.exit(fails.length ? 1 : 0);
