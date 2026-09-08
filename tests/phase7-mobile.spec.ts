/**
 * Deep QA — phase 7 of the qa/2026-09-05-deep run. LAYER A: browser simulation
 * of the phone.
 *
 * Phases 2-6 drove chromium and Mobile Chrome. This file adds the checks that
 * only mean anything on a phone and that no earlier phase made:
 *
 *   1. Touch target size for every visible interactive control on every screen,
 *      against the WCAG 2.5.8 AA floor of 24x24 CSS px and against the 44x44
 *      recommendation. Reported per route, not aggregated, so a regression
 *      names its own screen.
 *   2. Horizontal overflow at 280, 320 and 414 CSS px on all 22 screens.
 *      280 is the narrowest width WCAG 1.4.10 implies (320 CSS px at 400% zoom
 *      lands near it) and is where this app's own comments say things clip.
 *   3. The mobile chrome itself: the `lg:hidden` header nav (Navbar.jsx:800),
 *      its drawer (:483-660), and the library shelf strip (`lh-strip`,
 *      Library.jsx:1227) which is the one component that changes shape between
 *      1 / 2 / 3 / 6 columns as the viewport narrows.
 *
 * Project restriction lives in the CLI invocation, never in a `test.skip()`
 * inside a beforeEach — see playwright.config.ts:7-20.
 *
 *   npx playwright test tests/phase7-mobile.spec.ts --project="Mobile Chrome"
 *   npx playwright test tests/phase7-mobile.spec.ts --project="Mobile Safari"
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { seed, KEYS, SEED_LIBRARY, SEED_COLLECTIONS, SEED_REC_FEEDBACK } from './fixtures';

const NET = { timeout: 30_000 };

/* Seeding, guarded. `fixtures.ts`'s seed() is an addInitScript and therefore
   re-runs on EVERY navigation, so it overwrites anything a test wrote and then
   reloaded to verify. Phase 4 lost three results to that; this is its
   sentinel-guarded replacement (tests/phase4-deep.spec.ts:24-40). */
async function seedOnce(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((payload: Record<string, string>) => {
    if (window.localStorage.getItem('__qa_seeded')) return;
    for (const [k, v] of Object.entries(payload)) window.localStorage.setItem(k, v);
    window.localStorage.setItem('__qa_seeded', '1');
  }, Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
}

async function seedPhone(page: Page) {
  await seedOnce(page, {
    [KEYS.library]: SEED_LIBRARY,
    [KEYS.collections]: SEED_COLLECTIONS,
    [KEYS.recFeedback]: SEED_REC_FEEDBACK,
    [KEYS.profile]: { name: 'QA Seed', platforms: [], custom_platforms: [] },
  });
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
const KNOWN_NOISE = /favicon|net::ERR_|Failed to load resource|Download the React DevTools|IGDB Error|Too Many Requests|429|@firebase\/firestore/i;
const realErrors = (errs: string[]) => errs.filter(e => !KNOWN_NOISE.test(e));

/** The screen has painted its own content, not the Suspense fallback. */
async function rendered(page: Page) {
  const main = page.getByRole('main');
  await expect(main).toBeVisible(NET);
  await expect(main.getByText('Loading…', { exact: true })).toHaveCount(0, NET);
  await expect.poll(() => page.locator('.skeleton-placeholder').count(), { timeout: 25_000 }).toBe(0);
  await page.waitForTimeout(150);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOUCH TARGETS  (WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA — 24x24 CSS px)
// ═══════════════════════════════════════════════════════════════════════════

type Target = {
  label: string; tag: string; w: number; h: number;
  cls: string; inline: boolean; area: string;
};

/**
 * Every control a thumb can hit, with its rendered box.
 *
 * SC 2.5.8 exempts a target that is "in a sentence or block of text" (Inline),
 * and one whose size is determined by the user agent (native <select>, <input>).
 * `inline` marks the first so the assertion can honour the exception rather
 * than pretend it does not exist — those are still listed, just not failed on.
 */
async function auditTargets(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const SEL = 'a[href], button, [role="button"], [role="link"], [role="menuitem"],' +
      '[role="menuitemradio"], [role="tab"], [role="checkbox"], [role="radio"],' +
      'input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
    const out: Target[] = [];
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      /* Off-screen-but-rendered: the nav drawer parks at translateX(-100%) and
         the header at translateY(-56px). Those are real controls when open, so
         only skip what is fully outside the document, not what is scrolled. */
      if (r.bottom < -400 || r.right < -400) continue;
      /* sr-only is NOT a small touch target. `.sr-only` clips a control to a
         1x1 box on purpose so it exists for a screen reader and nothing else;
         the skip link then carries `focus:not-sr-only` and paints at full size
         the moment it takes focus, and the CSV `<input type="file">` is clipped
         behind a full-width visible drop zone that proxies for it. SC 2.5.8's
         target is the thing a pointer can hit, so neither is in scope. The
         first run of this spec failed all 13 routes on exactly these two
         elements — the assertion was wrong, not the app. */
      const clipped = cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
        cs.clipPath === 'inset(50%)' || cs.position === 'absolute' && r.width <= 1 && r.height <= 1;
      if (clipped) continue;

      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 60);
      /* Inline-in-text exception: an inline-displayed anchor whose parent is a
         prose block holding text beyond the link itself. */
      const parent = el.parentElement;
      const inline = el.tagName === 'A' && cs.display.startsWith('inline') &&
        !!parent && (parent.innerText || '').trim().length > (el as HTMLElement).innerText.trim().length + 3;

      /* Which region of the shell it belongs to, so a finding is locatable. */
      const area = el.closest('nav') ? 'nav'
        : el.closest('[role="dialog"]') ? 'dialog'
        : el.closest('main') ? 'main'
        : el.closest('aside') ? 'aside' : 'other';

      out.push({
        label: name || `<${el.tagName.toLowerCase()}>`,
        tag: el.tagName.toLowerCase(),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        cls: (el.getAttribute('class') || '').slice(0, 90),
        inline, area,
      });
    }
    return out;
  });
}

/** Routes worth a target audit — every screen a phone user actually reaches. */
const TARGET_ROUTES: Array<{ path: string; note?: string }> = [
  { path: '/' },
  { path: '/library/backlog' },
  { path: '/collections' },
  { path: '/profile' },
  { path: '/schedule' },
  { path: '/events' },
  { path: '/awards' },
  { path: '/wallpapers' },
  { path: '/browse/genres' },
  { path: '/platforms' },
  { path: '/feedback' },
  { path: '/import' },
  { path: '/game/1942' },
];

for (const r of TARGET_ROUTES) {
  test(`T1 touch targets on ${r.path} clear the 24px WCAG 2.5.8 floor`, async ({ page }) => {
    await seedPhone(page);
    await page.goto(r.path);
    await rendered(page);

    const all = await auditTargets(page);
    expect(all.length, `${r.path} exposed no interactive controls at all`).toBeGreaterThan(0);

    const under24 = all.filter(t => !t.inline && (t.w < 24 || t.h < 24));
    const under44 = all.filter(t => !t.inline && (t.w < 44 || t.h < 44));

    console.log(
      `[targets] ${r.path} total=${all.length} under24=${under24.length} under44=${under44.length}`,
    );
    for (const t of under24) {
      console.log(`  UNDER-24 ${r.path} ${t.area} <${t.tag}> "${t.label}" ${t.w}x${t.h} :: ${t.cls}`);
    }
    /* Recorded, not asserted: 44px is a recommendation (AAA is SC 2.5.5), and
       failing on it would bury the AA floor under noise. */
    for (const t of under44.filter(t => !under24.includes(t))) {
      console.log(`  under-44 ${r.path} ${t.area} <${t.tag}> "${t.label}" ${t.w}x${t.h}`);
    }

    expect(
      under24.map(t => `${t.area} <${t.tag}> "${t.label}" ${t.w}x${t.h}`),
      `${r.path}: controls below the 24x24 WCAG 2.5.8 AA floor`,
    ).toEqual([]);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HORIZONTAL OVERFLOW  (WCAG 2.2 SC 1.4.10 Reflow)
// ═══════════════════════════════════════════════════════════════════════════

const WIDTHS = [280, 320, 414];

/** Every screen. Param routes use ids this run has already proven resolve. */
const OVERFLOW_ROUTES = [
  '/', '/explore/trending', '/feedback', '/profile', '/schedule',
  '/game/1942', '/library', '/library/backlog', '/import',
  '/franchise/24', '/collections', '/browse', '/browse/genres',
  '/collection/seed-collection-1', '/collection/igdb/1', '/game/1942/collections',
  '/platforms', '/events', '/wallpapers', '/games/genre/12',
  '/awards', '/awards/Q18642757',
];

for (const path of OVERFLOW_ROUTES) {
  test(`T2 ${path} does not scroll sideways at 280 / 320 / 414`, async ({ page }) => {
    await seedPhone(page);
    const offenders: string[] = [];

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 740 });
      await page.goto(path);
      await rendered(page);
      /* Settle a beat: several screens size a sticky strip from a CSS var the
         header writes on mount, so measuring the same frame reads the pre-var
         layout. */
      await page.waitForTimeout(250);

      const res = await page.evaluate(() => {
        const de = document.documentElement;
        const over = de.scrollWidth - de.clientWidth;
        const wide: string[] = [];
        if (over > 1) {
          /* Name the widest offenders rather than reporting a bare number —
             a document 40px too wide is one element, and the fix needs it. */
          for (const el of Array.from(document.querySelectorAll('body *'))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (getComputedStyle(el).position === 'fixed') continue;
            if (r.right > de.clientWidth + 1) {
              wide.push(
                `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') || '').slice(0, 70)}"> right=${Math.round(r.right)}`,
              );
            }
          }
        }
        return { over, wide: wide.slice(0, 6), scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
      });

      if (res.over > 1) {
        offenders.push(`${w}px: document is ${res.over}px too wide (${res.scrollWidth} vs ${res.clientWidth}) — ${res.wide.join(' | ')}`);
      }
    }

    expect(offenders, `${path}: horizontal overflow`).toEqual([]);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MOBILE HEADER NAV  (Navbar.jsx:800-871) AND ITS DRAWER (:483-660)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('mobile header nav', () => {
  test('N1 the header is fixed, 56px tall, and is the only nav below lg', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);

    const bar = page.locator('nav.lg\\:hidden.fixed');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.height), 'the mobile header is h-14 = 56px').toBe(56);
    expect(Math.round(box.y), 'pinned to the top edge').toBe(0);

    /* The 220px desktop rail must not be painted next to the phone header.
       Measured by width, not by `aside a[href^="/library"]` — the mobile DRAWER
       is an <aside> too, so that selector matched the thing under test and
       failed on run 1 for the wrong reason. */
    const railWidth = await page.evaluate(() => {
      const el = document.querySelector('.hidden.lg\\:block, aside.lg\\:block');
      return el ? Math.round(el.getBoundingClientRect().width) : 0;
    });
    expect(railWidth, 'the 220px desktop rail is not laid out on a phone').toBeLessThan(100);
  });

  test('N2 the hamburger opens the drawer, the drawer holds real links, and Close closes it', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);

    const open = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(open).toBeVisible();
    expect(await open.getAttribute('aria-expanded')).toBe('false');

    await open.click();
    expect(await open.getAttribute('aria-expanded')).toBe('true');

    const close = page.getByRole('button', { name: 'Close navigation menu' });
    await expect(close).toBeVisible();

    /* Something to navigate with, not just a panel that appeared. */
    const links = page.locator('a[href="/library/backlog"], a[href^="/library"], a[href="/collections"], a[href="/schedule"]');
    expect(await links.count(), 'the drawer exposes navigation links').toBeGreaterThan(0);

    await close.click();
    await page.waitForTimeout(400);
    /* aria-expanded, not toBeHidden: the drawer closes by sliding to
       translateX(-100%), and a translated element is still "visible" to
       Playwright. Run 1 failed here for that reason, which was the assertion's
       fault; the state it should have been reading is the one the trigger
       publishes. */
    expect(await open.getAttribute('aria-expanded'), 'Close returns the drawer to closed').toBe('false');
  });

  test('N3 Escape closes the drawer', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);
    const open = page.getByRole('button', { name: 'Open navigation menu' });
    await open.click();
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const state = await open.getAttribute('aria-expanded');
    console.log(`[nav] aria-expanded after Escape = ${state}`);
    expect(state, 'Escape closes the mobile navigation drawer').toBe('false');
  });

  test('N4 the scrim closes the drawer', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);
    const open = page.getByRole('button', { name: 'Open navigation menu' });
    await open.click();
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toBeVisible();
    /* The scrim is the fixed inset-0 bg-black/60 at Navbar.jsx:483. Tap inside
       its own box, right of the 220px panel. Headless WebKit on Windows keeps a
       12px classic scrollbar, so viewport width minus 6 lands on the scrollbar
       strip where elementFromPoint is null, not on the scrim. */
    const box = (await page.locator('[class*="z-[9997]"]').boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, 400);
    await page.waitForTimeout(400);
    const state = await open.getAttribute('aria-expanded');
    console.log(`[nav] aria-expanded after scrim tap = ${state}`);
    expect(state, 'tapping the scrim closes the drawer').toBe('false');
  });

  test('N5 focus returns to the hamburger after the drawer closes', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);
    const open = page.getByRole('button', { name: 'Open navigation menu' });
    await open.click();
    await page.getByRole('button', { name: 'Close navigation menu' }).click();
    await page.waitForTimeout(400);
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}:${a.getAttribute('aria-label') || (a as HTMLElement).innerText?.slice(0, 30) || ''}` : 'none';
    });
    console.log(`[nav] activeElement after close = ${focused}`);
    expect(focused, 'WCAG 2.4.3 — focus returns to the control that opened the drawer').toContain('Open navigation menu');
  });

  test('N6 the search control opens the overlay and closes again', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);
    const search = page.locator('nav.lg\\:hidden').getByTitle('Search');
    await expect(search).toBeVisible();
    await search.click();
    await expect(page.locator('input[type="search"], input[placeholder*="earch" i]').first()).toBeVisible(NET);
    const closer = page.locator('nav.lg\\:hidden').getByTitle('Close Search');
    await expect(closer).toBeVisible();
    await closer.click();
    await expect(page.locator('input[type="search"], input[placeholder*="earch" i]').first()).toBeHidden(NET);
  });

  test('N7 the header hides on scroll down and returns on scroll up', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/');
    await rendered(page);
    const bar = page.locator('nav.lg\\:hidden.fixed');
    const before = (await bar.boundingBox())!;

    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(600);
    const hidden = (await bar.boundingBox())!;

    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(600);
    const back = (await bar.boundingBox())!;

    console.log(`[nav] header y: rest=${Math.round(before.y)} scrolled-down=${Math.round(hidden.y)} scrolled-up=${Math.round(back.y)}`);
    expect(hidden.y, 'the header translates out of the way on scroll down').toBeLessThan(before.y);
    expect(Math.round(back.y), 'and comes back on scroll up').toBe(Math.round(before.y));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE LIBRARY SHELF STRIP  (Library.jsx:1227 — `lh-strip`)
// ═══════════════════════════════════════════════════════════════════════════

const SHELVES = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped', 'Unreleased'];

/* WHAT THE MOBILE STRIP ACTUALLY IS. Run 1 of this spec asserted six shelf
   tabs and failed: `src/index.css:646-651` sets
   `.lh-strip > .lh-tab:not(.lh-strip-compact) { display: none }` below 1280px,
   so on a phone the six tabs are in the DOM but not laid out, and the strip is
   ONE control — `.lh-strip-compact` (Library.jsx:1312-1332), a 44px-min bar
   filled with the shelf colour that opens a shelf-picker Dialog. That is the
   component under test here; the six-tab row belongs to the desktop pass. */
const compact = (page: Page) => page.locator('.lh-strip-compact');

test.describe('mobile shelf strip', () => {
  test('S1 the strip is the compact picker, not the six-tab row, and it names its shelf', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/library/backlog');
    await rendered(page);

    await expect(page.locator('.lh-strip')).toBeVisible();
    await expect(compact(page), 'the compact shelf bar is the phone control').toBeVisible();

    const laidOut = await page.locator('.lh-strip > .lh-tab:not(.lh-strip-compact)')
      .evaluateAll(els => els.filter(e => e.getBoundingClientRect().width > 0).length);
    expect(laidOut, 'none of the six desktop tabs is laid out below xl').toBe(0);

    /* It has to say which shelf you are on: Library.jsx:1300-1301 notes the h1
       is screen-reader-only here, so this bar IS the page's shelf identity. */
    const name = await compact(page).getAttribute('aria-label');
    console.log(`[strip] compact aria-label = ${name}`);
    expect(name).toMatch(/^Backlog, \d+ games?\. Change shelf$/);
    expect(await compact(page).getAttribute('aria-haspopup')).toBe('dialog');
    expect(await compact(page).getAttribute('aria-expanded')).toBe('false');

    const box = (await compact(page).boundingBox())!;
    console.log(`[strip] compact box = ${Math.round(box.width)}x${Math.round(box.height)}`);
    expect(box.height, 'the compact bar meets the 44px recommended target').toBeGreaterThanOrEqual(44);
  });

  test('S2 the compact bar opens the picker, and every one of the six shelves selects from it', async ({ page }) => {
    await seedPhone(page);
    const errs = watchConsole(page);
    await page.goto('/library/backlog');
    await rendered(page);

    for (const shelf of SHELVES) {
      await compact(page).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog, `the picker opens for ${shelf}`).toBeVisible();
      expect(await compact(page).getAttribute('aria-expanded')).toBe('true');

      const row = dialog.getByRole('button', { name: new RegExp(`^${shelf}`, 'i') }).first();
      await expect(row, `${shelf} is offered in the picker`).toBeVisible();
      await row.click();

      await expect(page).toHaveURL(new RegExp(`/library/${shelf.toLowerCase()}`), NET);
      await rendered(page);
      await expect(dialog, 'the picker closes on selection').toBeHidden();
      expect(
        await compact(page).getAttribute('aria-label'),
        `the bar now names ${shelf}`,
      ).toMatch(new RegExp(`^${shelf}, `, 'i'));
    }
    expect(realErrors(errs)).toEqual([]);
  });

  test('S3 the picker marks the current shelf and Escape closes it without navigating', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/library/wishlist');
    await rendered(page);

    await compact(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const current = await dialog.locator('[aria-current="page"]').allInnerTexts();
    console.log(`[strip] picker aria-current rows = ${JSON.stringify(current)}`);
    expect(current.length, 'exactly one row is marked current').toBe(1);
    expect(current[0]).toMatch(/wishlist/i);

    await page.keyboard.press('Escape');
    await expect(dialog, 'Escape closes the shelf picker').toBeHidden();
    await expect(page).toHaveURL(/\/library\/wishlist/);
    expect(await compact(page).getAttribute('aria-expanded')).toBe('false');
  });

  test('S4 the compact bar does not clip its own label or count at 280px', async ({ page }) => {
    await seedPhone(page);
    await page.setViewportSize({ width: 280, height: 740 });
    await page.goto('/library/unreleased');
    await rendered(page);
    /* Library.jsx:1202-1205 documents the exact failure this catches: a cell
       clipping INSIDE itself overflows nothing, so the responsive gate — which
       only reads document scrollWidth — cannot see it. Unreleased is the
       longest shelf name and therefore the one that clips first. */
    const clipped = await page.locator('.lh-strip button:visible').evaluateAll(els =>
      els.filter(e => e.scrollWidth > e.clientWidth + 1)
        .map(e => `${(e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()} (scroll ${e.scrollWidth} > client ${e.clientWidth})`),
    );
    console.log(`[strip] clipped cells at 280 = ${JSON.stringify(clipped)}`);
    expect(clipped, 'no shelf cell clips its own contents at 280px').toEqual([]);
  });

  test('S5 the strip stays pinned below the header and travels with it', async ({ page }) => {
    await seedPhone(page);
    await page.goto('/library/backlog');
    await rendered(page);
    const strip = page.locator('.lh-strip');
    const bar = page.locator('nav.lg\\:hidden.fixed');

    const gapAt = async () => {
      const b = (await bar.boundingBox())!;
      const s = (await strip.boundingBox())!;
      return Math.round(s.y - (b.y + b.height));
    };

    const rest = await gapAt();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(700);
    const scrolled = await gapAt();
    console.log(`[strip] gap under the header: rest=${rest} scrolled=${scrolled}`);
    /* Library.jsx:1210-1217: the strip must not leave a 56px hole with cover art
       scrolling through it once the header hides. */
    expect(Math.abs(scrolled - rest), 'the strip tracks the header rather than holding its reserved gap').toBeLessThanOrEqual(4);
  });
});
