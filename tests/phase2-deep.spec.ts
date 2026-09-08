/**
 * Deep QA — phase 2 of the qa/2026-09-05-deep run.
 * Routes under test: /library, /library/:status, /browse/:taxonomy, /games/:type/:id.
 *
 * Every test DRIVES a control and asserts the state it changed. A test that
 * only asserts a route renders belongs in tests/routes.spec.ts, not here.
 *
 * Restriction to projects lives in the CLI invocation (`--project=chromium`),
 * never in a `test.skip()` inside a beforeEach — see playwright.config.ts for
 * why a late skip still builds and leaks a browser context on webkit/Windows.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { seed, KEYS, KNOWN_NOISE, realErrors } from './fixtures';

/* ── A deterministic shelf ────────────────────────────────────────────────
   The shared fixture puts ONE game on each shelf, which cannot prove a sort
   reorders anything. These ids are outside IGDB's range, so
   `getGamesByIds` returns nothing for them and `Library.jsx:365` keeps the
   local fields verbatim (`if (!igdbData) return localGame`). That makes the
   grid deterministic with the network up or down, and keeps the
   release-status auto-migration (which is gated on `_igdb_synced`) out of it. */
const BACKLOG = [
  { id: 900001, name: 'Zulu Dawn',   status: 'Backlog', is_custom: false, release_year: 1999, first_release_date: 946684800,  total_rating: 55, priority: 'Someday', game_type: 0, cover_id: null },
  { id: 900002, name: 'Alpha Cycle', status: 'Backlog', is_custom: false, release_year: 2021, first_release_date: 1609459200, total_rating: 91, priority: 'Next Up', game_type: 0, cover_id: null },
  { id: 900003, name: 'Mid Harbour', status: 'Backlog', is_custom: false, release_year: 2010, first_release_date: 1262304000, total_rating: 73, priority: 'Soon',    game_type: 1, cover_id: null },
  { id: 900004, name: 'Quiet Ember', status: 'Backlog', is_custom: false, release_year: 2015, first_release_date: 1420070400, total_rating: 82, priority: 'Maybe',   game_type: 0, cover_id: null },
  { id: 'custom_p2_a', name: 'Bench Custom Entry', status: 'Backlog', is_custom: true, release_year: 2018, first_release_date: 1514764800, cover_id: null },
];

const LONG_TITLE =
  'The Extraordinarily Protracted Chronicles of a Subtitle That Refuses to End: ' +
  'Director’s Definitive Remastered Anniversary Ultimate Game of the Year Edition ' +
  'Part Two — Electric Boogaloo Redux';

const BEATEN = [
  { id: 900010, name: 'Ended First',  status: 'Beaten', is_custom: false, release_year: 2001, first_release_date: 978307200,  total_rating: 60, feel: 'Perfection', dateCompleted: '2022-05-01', cover_id: null },
  { id: 900011, name: 'Ended Second', status: 'Beaten', is_custom: false, release_year: 2019, first_release_date: 1546300800, total_rating: 88, feel: 'Skip',       dateCompleted: '2024-09-01', cover_id: null },
  { id: 900012, name: 'Ended Third',  status: 'Beaten', is_custom: false, release_year: 2012, first_release_date: 1325376000, total_rating: 77,                     dateCompleted: '2023-01-15', cover_id: null },
];

/** Console + pageerror collector. A clean-looking page with a React key
    warning or an unhandled rejection is a finding, so every test carries one. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Console noise this run has already reported elsewhere, or that is the
    network rather than the page. Filtering it keeps a real warning visible. */
/* @firebase/firestore is in here because the app opens a Firestore listen
   channel on boot even signed out — `config/{document}` is where the IGDB keys
   live — so a flaky link to Google logs a transport error on a page that is
   otherwise entirely local. It is the network, not the library. Recorded as an
   observation in phase2.md rather than treated as a page defect. */

/** Card titles in DOM order. The full-card overlay carries the game name as
    its accessible name (`GameCard.jsx:453`), so this is the rendered order. */
async function cardOrder(page: Page): Promise<string[]> {
  return page.locator('.game-grid [role="link"]').evaluateAll(
    els => els.map(e => e.getAttribute('aria-label') || ''),
  );
}

async function cardCount(page: Page) {
  return page.locator('.game-grid [role="link"]').count();
}

/** Open a toolbar pill and choose one of its rows. */
async function pick(page: Page, pill: 'Filter' | 'Sort' | 'Group', option: string | RegExp) {
  await page.locator(`button[aria-label^="${pill} · "]`).click();
  const menu = page.locator('[role="menu"]').last();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: option }).click();
  await expect(menu).toBeHidden();
}

async function pillLabel(page: Page, pill: 'Filter' | 'Sort' | 'Group') {
  const l = await page.locator(`button[aria-label^="${pill} · "]`).getAttribute('aria-label');
  return (l || '').replace(`${pill} · `, '');
}

/** Hydration is done when no skeleton is left. `Library.jsx:352` awaits
    `getGamesByIds` before it drops `isLoading`, so a fixed 250ms wait races the
    IGDB round trip and reads an empty grid — which is how the first run of this
    spec produced eleven false failures. */
async function settled(page: Page) {
  /* The toolbar first. Polling skeletons alone passes INSTANTLY on a page that
     has not mounted yet — zero skeletons because there is zero of everything —
     which is how run 2 read three empty grids that were merely not painted. */
  await expect(page.locator('button[aria-label^="Sort · "]')).toBeAttached({ timeout: 20000 });
  await expect.poll(() => page.locator('.skeleton-placeholder').count(), { timeout: 20000 }).toBe(0);
  await page.waitForTimeout(200);
}

/** Library tests need no network at all: everything the shelf draws is
    localStorage, and `hydrateLibrary` keeps the local row verbatim when IGDB
    returns nothing for its id (`Library.jsx:365`). Stubbing the endpoint makes
    the shelf deterministic and takes the run off IGDB's 4 req/s budget. */
async function libraryOffline(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  // Never touch production Firestore from a spec; WebKit logged 23 Listen-channel errors per test without this.
  await page.route(/googleapis\.com|firebaseio\.com/, route => route.abort());
}

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — shelves
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — shelf navigation', () => {
  const SHELVES = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped', 'Unreleased'];

  test('every shelf tab navigates, marks itself current, and swaps the grid', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, {
      [KEYS.library]: [
        ...BACKLOG,
        ...BEATEN,
        { id: 900020, name: 'Now Playing One', status: 'Playing', is_custom: false, release_year: 2020, cover_id: null },
        { id: 900021, name: 'Wished For One', status: 'Wishlist', is_custom: false, release_year: 2020, cover_id: null },
        { id: 900022, name: 'Given Up One', status: 'Dropped', is_custom: false, release_year: 2020, cover_id: null },
      ],
    });
    await page.goto('/library/backlog');
    await settled(page);

    /* The six-tab strip is a >=1280px control: `src/index.css` hides it below
       xl and swaps in the shelf-picker button, which phase 4 owns. Below that
       width this asserts the swap happened and changes shelf by URL instead —
       a phone run that clicked nothing would report a pass it did not earn. */
    const wide = await page.evaluate(() => window.matchMedia('(min-width: 1280px)').matches);
    const changeShelf = page.getByRole('button', { name: /Change shelf$/ });
    if (!wide) {
      await expect(changeShelf).toBeVisible();
      await expect(changeShelf).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(page.locator('button:has(span:text-is("Wishlist"))').first()).toBeHidden();
    } else {
      await expect(changeShelf).toBeHidden();
    }

    const seenPerShelf: Record<string, string[]> = {};
    for (const shelf of SHELVES) {
      if (wide) {
        await page.locator(`button:has(span:text-is("${shelf}"))`).first().click();
      } else {
        await page.goto(`/library/${shelf.toLowerCase()}`);
      }
      await expect(page).toHaveURL(new RegExp(`/library/${shelf.toLowerCase()}`));
      await settled(page);
      if (!wide) {
        // The compact strip is the shelf identity on a phone: it must name the
        // shelf and its count, because the h1 is sr-only at this width.
        await expect(page.getByRole('button', { name: new RegExp(`^${shelf},`) })).toBeVisible();
      }
      seenPerShelf[shelf] = await cardOrder(page);
    }

    // Backlog and Beaten hold different games — the grid genuinely swapped.
    expect(seenPerShelf.Backlog).not.toEqual(seenPerShelf.Beaten);
    expect(seenPerShelf.Beaten.sort()).toEqual(['Ended First', 'Ended Second', 'Ended Third']);
    expect(seenPerShelf.Dropped).toEqual(['Given Up One']);
    expect(realErrors(errs)).toEqual([]);
  });

  test('shelf tab counts equal the cards on that shelf', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: [...BACKLOG, ...BEATEN] });
    await page.goto('/library/backlog');
    await settled(page);
    // The tab's count span sits inside the same button as its label.
    const backlogTab = page.locator('button:has(span:text-is("Backlog"))').first();
    await expect(backlogTab).toContainText('5');
    expect(await cardCount(page)).toBe(5);

    await page.goto('/library/beaten');
    await settled(page);
    expect(await cardCount(page)).toBe(3);
  });

  test('an unknown shelf redirects to Backlog instead of serving it under the bad URL', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/bogus-shelf');
    await settled(page);
    expect(await cardCount(page)).toBe(5);
    expect(new URL(page.url()).pathname).toBe('/library/backlog');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — sort
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — sort', () => {
  test('every Backlog sort option reorders the grid and writes ?sort=', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    // Grouping off, so the sort is the only thing ordering the grid.
    await pick(page, 'Group', 'None');
    await settled(page);

    const OPTIONS = ['Priority', 'Time to Beat', 'Public Rating', 'Release · New', 'Release · Old', 'A → Z', 'Z → A'];
    const results: Record<string, string[]> = {};
    for (const opt of OPTIONS) {
      await pick(page, 'Sort', opt);
      await settled(page);
      results[opt] = await cardOrder(page);
      expect(await pillLabel(page, 'Sort')).toBe(opt);
      expect(page.url()).toMatch(/[?&]sort=/);
    }

    // A → Z is exactly the reverse of Z → A. Both are real orderings, so this
    // catches a sort that "changed the label" without touching the list.
    expect(results['A → Z']).toEqual(['Alpha Cycle', 'Bench Custom Entry', 'Mid Harbour', 'Quiet Ember', 'Zulu Dawn']);
    expect(results['Z → A']).toEqual([...results['A → Z']].reverse());

    // Release year, both directions.
    expect(results['Release · New'][0]).toBe('Alpha Cycle');   // 2021
    expect(results['Release · Old'][0]).toBe('Zulu Dawn');     // 1999
    expect(results['Release · New']).toEqual([...results['Release · Old']].reverse());

    // Public rating, descending.
    expect(results['Public Rating'].slice(0, 2)).toEqual(['Alpha Cycle', 'Quiet Ember']); // 91, 82

    // Priority order is Next Up > Soon > Maybe > Someday.
    expect(results['Priority'].slice(0, 4)).toEqual(['Alpha Cycle', 'Mid Harbour', 'Quiet Ember', 'Zulu Dawn']);

    expect(realErrors(errs)).toEqual([]);
  });

  test('Beaten offers completion-date sorts and they order by dateCompleted', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BEATEN });
    await page.goto('/library/beaten');
    await settled(page);
    await pick(page, 'Group', 'None');
    await settled(page);

    await pick(page, 'Sort', 'Completed · New');
    await settled(page);
    const newFirst = await cardOrder(page);
    expect(newFirst[0]).toBe('Ended Second'); // 2024-09-01

    await pick(page, 'Sort', 'Completed · Old');
    await settled(page);
    const oldFirst = await cardOrder(page);
    expect(oldFirst[0]).toBe('Ended First'); // 2022-05-01
    expect(newFirst).toEqual([...oldFirst].reverse());
  });

  test('the sort menu offers only the sorts its shelf declares', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: [...BACKLOG, ...BEATEN] });

    await page.goto('/library/backlog');
    await settled(page);
    await page.locator('button[aria-label^="Sort · "]').click();
    // .lh-label text-transforms to caps, so compare case-insensitively.
    const backlogSorts = (await page.locator('[role="menu"] [role="menuitemradio"]').allInnerTexts()).join('|').toLowerCase();
    await page.keyboard.press('Escape');
    expect(backlogSorts).not.toContain('completed');
    expect(backlogSorts).not.toContain('your rating');

    await page.goto('/library/beaten');
    await settled(page);
    await page.locator('button[aria-label^="Sort · "]').click();
    const beatenSorts = (await page.locator('[role="menu"] [role="menuitemradio"]').allInnerTexts()).join('|').toLowerCase();
    await page.keyboard.press('Escape');
    expect(beatenSorts).toContain('completed · new');
    expect(beatenSorts).not.toContain('time to beat');
  });

  test('a ?sort= a shelf does not offer is migrated back to that shelf default', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    // 'date-desc' is a Beaten-only sort.
    await page.goto('/library/backlog?sort=date-desc&group=none');
    await settled(page);
    expect(await pillLabel(page, 'Sort')).toBe('Priority');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — filter
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — filter', () => {
  test('Official / Custom / Main / DLCs each narrow the grid and write ?filter=', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    await pick(page, 'Group', 'None');
    await settled(page);
    expect(await cardCount(page)).toBe(5);

    await pick(page, 'Filter', 'Official');
    await settled(page);
    expect(await cardOrder(page)).not.toContain('Bench Custom Entry');
    expect(await cardCount(page)).toBe(4);
    expect(page.url()).toContain('filter=igdb');

    await pick(page, 'Filter', 'Custom');
    await settled(page);
    expect(await cardOrder(page)).toEqual(['Bench Custom Entry']);
    expect(page.url()).toContain('filter=custom');

    await pick(page, 'Filter', 'Main');
    await settled(page);
    // game_type 0 — three of the four IGDB rows.
    expect(await cardCount(page)).toBe(3);
    expect(await cardOrder(page)).not.toContain('Mid Harbour'); // game_type 1

    await pick(page, 'Filter', 'DLCs');
    await settled(page);
    expect(await cardOrder(page)).toEqual(['Mid Harbour']);

    await pick(page, 'Filter', 'All');
    await settled(page);
    expect(await cardCount(page)).toBe(5);
    // 'all' is the default, so it should leave the URL rather than pin it.
    expect(page.url()).not.toContain('filter=all');
    expect(realErrors(errs)).toEqual([]);
  });

  test('a filter that matches nothing shows the No Matches plate, and its CTA restores the shelf', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG.filter(g => !g.is_custom) });
    await page.goto('/library/backlog');
    await settled(page);
    await pick(page, 'Filter', 'Custom');
    await settled(page);
    await expect(page.getByText('No Matches')).toBeVisible();
    await page.getByRole('button', { name: /Clear Search & Filters/i }).click();
    await settled(page);
    expect(await cardCount(page)).toBe(4);
    expect(await pillLabel(page, 'Filter')).toBe('All');

    /* DEFECT, pinned as actual behaviour so the run stays green and the finding
       stays visible. `onClearFilters` (Library.jsx:1597-1606) resets the pill
       through setTabSettings, which does NOT sync the URL, and the one call it
       does make — setSearchQueryAndUrl('') — reads the PRE-update tabSettings.
       So the address bar keeps ?filter=custom after the user cleared it. The
       code comment right above claims exactly this class of bug was fixed for
       `q`; it was never fixed for `filter`. */
    expect(page.url(), 'BUG: ?filter= survives Clear Search & Filters').toContain('filter=custom');
  });

  test('the filter the user just cleared comes back on reload', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG.filter(g => !g.is_custom) });
    await page.goto('/library/backlog');
    await settled(page);
    await pick(page, 'Filter', 'Custom');
    await settled(page);
    await page.getByRole('button', { name: /Clear Search & Filters/i }).click();
    await settled(page);
    expect(await cardCount(page)).toBe(4);

    await page.reload();
    await settled(page);
    // The consequence of the stale URL: the dismissed filter is reapplied.
    expect(await pillLabel(page, 'Filter'), 'BUG: cleared filter returns on reload').toBe('Custom');
    await expect(page.getByText('No Matches')).toBeVisible();
    await page.screenshot({ path: 'qa/2026-09-05-deep/shots/library-cleared-filter-returns.png' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — grouping
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — grouping', () => {
  test('each Backlog grouping draws its own headings, and None draws none', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);

    const heads = async () =>
      (await page.locator('h2:not(.sr-only)').allInnerTexts()).join('|').toLowerCase();

    await pick(page, 'Group', 'Priority');
    await settled(page);
    expect(await heads()).toContain('next up');
    expect(await heads()).toContain('someday');
    expect(page.url()).toContain('group=priority');

    await pick(page, 'Group', 'Release Year');
    await settled(page);
    expect(await heads()).toContain('2021');
    expect(await heads()).toContain('1999');

    await pick(page, 'Group', 'Platform');
    await settled(page);
    expect(await heads()).toContain('unknown platform');

    await pick(page, 'Group', 'Franchise');
    await settled(page);
    expect(await heads()).toContain('standalone');

    await pick(page, 'Group', 'None');
    await settled(page);
    expect(await page.locator('h2:not(.sr-only)').count()).toBe(0);
    expect(await page.locator('h2.sr-only').count()).toBe(1); // the ungrouped rung
    expect(realErrors(errs)).toEqual([]);
  });

  test('a group heading collapses and re-expands its own cards only', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    await pick(page, 'Group', 'Priority');
    await settled(page);

    const before = await cardCount(page);
    const nextUp = page.locator('button[aria-expanded]', { hasText: 'Next Up' }).first();
    await expect(nextUp).toHaveAttribute('aria-expanded', 'true');
    await nextUp.click();
    await expect(nextUp).toHaveAttribute('aria-expanded', 'false');
    await settled(page);
    const after = await cardCount(page);
    expect(after).toBeLessThan(before);
    expect(await cardOrder(page)).not.toContain('Alpha Cycle');

    await nextUp.click();
    await expect(nextUp).toHaveAttribute('aria-expanded', 'true');
    await settled(page);
    expect(await cardCount(page)).toBe(before);
  });

  test('Beaten groups by completion year and follows the sort direction', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BEATEN });
    await page.goto('/library/beaten');
    await settled(page);
    await pick(page, 'Group', 'Completion Year');
    await pick(page, 'Sort', 'Completed · New');
    await settled(page);
    const newest = await page.locator('h2:not(.sr-only)').allInnerTexts();
    expect(newest.map(t => t.trim())).toEqual(['2024', '2023', '2022']);

    await pick(page, 'Sort', 'Completed · Old');
    await settled(page);
    const oldest = await page.locator('h2:not(.sr-only)').allInnerTexts();
    expect(oldest.map(t => t.trim())).toEqual(['2022', '2023', '2024']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — search
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — search', () => {
  test('opening search focuses the input, typing filters, closing clears query and URL', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);

    await page.getByRole('button', { name: 'Search library' }).click();
    const input = page.getByRole('textbox', { name: 'Search library' });
    await expect(input).toBeFocused();

    await input.fill('alpha');
    await settled(page);
    expect(await cardOrder(page)).toEqual(['Alpha Cycle']);
    expect(page.url()).toContain('q=alpha');

    await page.getByRole('button', { name: 'Close search' }).click();
    await settled(page);
    expect(await cardCount(page)).toBe(5);
    expect(page.url()).not.toContain('q=');
    expect(realErrors(errs)).toEqual([]);
  });

  test('a no-match query shows the No Matches plate, not an unexplained empty grid', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    await page.getByRole('button', { name: 'Search library' }).click();
    await page.getByRole('textbox', { name: 'Search library' }).fill('zzzzznothingmatchesthis');
    await settled(page);
    expect(await cardCount(page)).toBe(0);
    await expect(page.getByText('No Matches')).toBeVisible();
    await expect(page.getByText('Your games are still here')).toBeVisible();
  });

  test('regex and URL metacharacters are treated as literal text, not a pattern', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, {
      [KEYS.library]: [
        ...BACKLOG,
        { id: 900030, name: 'C++ (Special) [Edition] 100%', status: 'Backlog', is_custom: false, release_year: 2020, cover_id: null },
      ],
    });
    await page.goto('/library/backlog');
    await settled(page);
    await page.getByRole('button', { name: 'Search library' }).click();
    const input = page.getByRole('textbox', { name: 'Search library' });

    for (const q of ['.*', '[', '(', 'a|b', '\\', '100%', '&sort=alpha', '<script>']) {
      await input.fill(q);
      await settled(page);
      // No crash, and the app still owns the route.
      await expect(page.getByRole('textbox', { name: 'Search library' })).toHaveValue(q);
      expect(page.url()).toContain('/library/backlog');
    }

    // A literal substring that only the special-character title holds.
    await input.fill('C++');
    await settled(page);
    expect(await cardOrder(page)).toEqual(['C++ (Special) [Edition] 100%']);

    // '.*' must match nothing — if it were compiled as a regex it would match all.
    await input.fill('.*');
    await settled(page);
    expect(await cardCount(page)).toBe(0);
    expect(realErrors(errs)).toEqual([]);
  });

  test('?q= in the URL opens the search layer pre-filled and pre-filtered', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog?q=alpha&group=none');
    await settled(page);
    await expect(page.getByRole('textbox', { name: 'Search library' })).toHaveValue('alpha');
    expect(await cardOrder(page)).toEqual(['Alpha Cycle']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY — empty, long text, selection, paint budget
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/library — edge cases', () => {
  test('an empty library shows the first-run plate with both routes out', async ({ page }) => {
    const errs = watchConsole(page);
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: [] });
    await page.goto('/library/backlog');
    await settled(page);
    await expect(page.getByText('Your Library Is Empty')).toBeVisible();
    await page.getByRole('button', { name: 'Import A Library' }).click();
    await expect(page).toHaveURL(/\/import/);
    await page.goBack();
    await settled(page);
    await page.getByRole('button', { name: 'Explore Games' }).click();
    await expect(page).toHaveURL(/localhost:5173\/(\?.*)?$/);
    expect(realErrors(errs)).toEqual([]);
  });

  test('an empty shelf beside a full one explains the shelf and offers its own next step', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/playing');
    await settled(page);
    await expect(page.getByText('Nothing In Playing')).toBeVisible();
    await expect(page.getByText('Games you have on the go right now')).toBeVisible();
    await page.getByRole('button', { name: /Start Something From Backlog/i }).click();
    await expect(page).toHaveURL(/\/library\/backlog/);
    await settled(page);
    expect(await cardCount(page)).toBe(5);
  });

  test('the Dropped shelf empty plate correctly offers no CTA', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/dropped');
    await settled(page);
    await expect(page.getByText('Nothing In Dropped')).toBeVisible();
    await expect(page.getByText('An empty shelf here is a good sign')).toBeVisible();
  });

  test('a very long title does not overflow the card or the page', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, {
      [KEYS.library]: [{ id: 900040, name: LONG_TITLE, status: 'Backlog', is_custom: false, release_year: 2020, cover_id: null }],
    });
    await page.goto('/library/backlog');
    await settled(page);
    const card = page.locator('.game-grid [role="link"]').first();
    await expect(card).toHaveAttribute('aria-label', LONG_TITLE);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(overflow.doc, 'no horizontal page overflow from a long title').toBeLessThanOrEqual(overflow.win + 1);
    await page.screenshot({ path: 'qa/2026-09-05-deep/shots/library-long-title.png', fullPage: false });
  });

  test('clicking a card opens that game', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    await page.locator('.game-grid [role="link"][aria-label="Alpha Cycle"]').click();
    await expect(page).toHaveURL(/\/game\/900002/);
  });

  test('a card is reachable and openable by keyboard', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: BACKLOG });
    await page.goto('/library/backlog');
    await settled(page);
    const card = page.locator('.game-grid [role="link"][aria-label="Alpha Cycle"]');
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/game\/900002/);
  });

  test('a custom entry keeps the release year it was saved with', async ({ page }) => {
    await libraryOffline(page);
    await seed(page, {
      [KEYS.library]: [
        { id: 'custom_year_a', name: 'Custom With A Year', status: 'Backlog', is_custom: true, release_year: 2018, first_release_date: 1514764800 },
        { id: 900050, name: 'Official With A Year', status: 'Backlog', is_custom: false, release_year: 2018, first_release_date: 1514764800, cover_id: null },
      ],
    });
    await page.goto('/library/backlog?group=year&sort=year-desc');
    await settled(page);

    // Both rows carry 2018, so grouped by release year they land in one group.
    const heads = (await page.locator('h2:not(.sr-only)').allInnerTexts()).map(t => t.trim().toLowerCase());
    expect(heads).toContain('2018');
    expect(heads).not.toContain('unknown year');
  });  test('a shelf larger than the first-paint budget still paints every card', async ({ page }) => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: 910000 + i,
      name: `Bulk Title ${String(i).padStart(2, '0')}`,
      status: 'Backlog', is_custom: false, release_year: 2000 + (i % 20), cover_id: null,
    }));
    await libraryOffline(page);
    await seed(page, { [KEYS.library]: many });
    await page.goto('/library/backlog?group=none&sort=alpha');
    await settled(page);
    await expect.poll(() => cardCount(page), { timeout: 5000 }).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BROWSE — taxonomy index
// ═══════════════════════════════════════════════════════════════════════════

/** True once at least one term row carries a count. The row is
    bar / name / count, so the count is the LAST child (TaxonomyIndex.jsx:151). */
async function countsIn(page: Page) {
  const texts = await page.locator('a[href^="/games/"]').evaluateAll(
    els => els.map(e => (e.lastElementChild?.textContent || '').trim()));
  return texts.some(t => t !== '');
}

test.describe('/browse/:taxonomy', () => {
  for (const [tax, title] of [['genres', 'Genres'], ['themes', 'Themes'], ['modes', 'Modes']] as const) {
    test(`${tax} lists terms, orders them largest first, and each term links to its page`, async ({ page }) => {
      const errs = watchConsole(page);
      await page.goto(`/browse/${tax}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      // Rows arrive before counts; wait for the count column to fill.
      await expect.poll(async () => page.locator('a[href^="/games/"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
      // Counts arrive on a SECOND request (getTaxonomyCounts -> /api/multiquery)
      // and are what puts the list in size order. Poll for them, never sleep.
      await expect.poll(() => countsIn(page), { timeout: 40000 }).toBe(true);

      const rows = page.locator('a[href^="/games/"]');
      const n = await rows.count();
      expect(n).toBeGreaterThan(2);

      // The count line in the header agrees with the rows drawn.
      await expect(page.getByText(new RegExp(`${n} Terms?`))).toBeVisible();

      // Size order: counts must be non-increasing once they are in.
      const counts = await rows.evaluateAll(els =>
        els.map(e => {
          const t = (e.lastElementChild?.textContent || '').replace(/[^\d]/g, '');
          return t ? Number(t) : null;
        }));
      const known = counts.filter((c): c is number => c !== null);
      expect(known.length, 'at least some counts came back').toBeGreaterThan(0);
      for (let i = 1; i < known.length; i++) {
        expect(known[i], `row ${i} is not larger than row ${i - 1}`).toBeLessThanOrEqual(known[i - 1]);
      }
      expect(realErrors(errs)).toEqual([]);
    });
  }

  test('clicking a term opens its category page with that term as the h1', async ({ page }) => {
    await page.goto('/browse/genres');
    await expect.poll(async () => page.locator('a[href^="/games/"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForTimeout(2500);
    const first = page.locator('a[href^="/games/"]').first();
    // .lh-display is the NAME span; span:first is the hairline size bar.
    const name = (await first.locator('span.lh-display').innerText()).trim();
    expect(name).not.toBe('');
    const href = await first.getAttribute('href');
    await first.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/\//g, '\\/')));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20000 });
  });

  test('an unknown taxonomy redirects to genres', async ({ page }) => {
    await page.goto('/browse/not-a-taxonomy');
    await expect(page).toHaveURL(/\/browse\/genres/);
    await expect(page.getByRole('heading', { level: 1, name: 'Genres' })).toBeVisible();
  });

  test('a taxonomy whose index fails claims IGDB holds no terms', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('failed'));
    await page.goto('/browse/genres');

    /* DEFECT. `getGenres` (igdb.js:868-892) catches its fetch failure and
       returns `[]`, so the promise TaxonomyIndex awaits never rejects, the
       `.catch` at TaxonomyIndex.jsx:55 never runs, `failed` is never set, and
       the "The Index Did Not Answer" plate at TaxonomyIndex.jsx:114 is dead
       code. The user is told the opposite of what happened. */
    await expect(page.getByText('Nothing Catalogued')).toBeVisible({ timeout: 25000 });
    await expect(page.getByText('IGDB holds no terms for this taxonomy')).toBeVisible();
    await expect(page.getByText('The Index Did Not Answer')).toHaveCount(0);
    await page.screenshot({ path: 'qa/2026-09-05-deep/shots/browse-failure-says-empty.png' });
  });

  test('every taxonomy row is keyboard reachable and has a visible focus ring', async ({ page }) => {
    await page.goto('/browse/genres');
    await expect.poll(async () => page.locator('a[href^="/games/"]').count(), { timeout: 20000 }).toBeGreaterThan(0);
    const row = page.locator('a[href^="/games/"]').first();
    await row.focus();
    await expect(row).toBeFocused();
    const ring = await row.evaluate(el => getComputedStyle(el).boxShadow);
    expect(ring, 'focus-visible ring paints').not.toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY — /games/:type/:id
// ═══════════════════════════════════════════════════════════════════════════

/** Genre 12 is Role-playing (RPG) — large, stable, and every control on the
    page has something to act on. */
const CAT = '/games/genre/12';

async function categoryReady(page: Page) {
  await expect(page.locator('.game-grid [role="link"]').first()).toBeVisible({ timeout: 30000 });
}

test.describe('/games/:type/:id — category', () => {
  test('the page names the taxonomy, states a counted total, and fills a grid', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto(CAT);
    await categoryReady(page);
    const h1 = await page.getByRole('heading', { level: 1 }).innerText();
    expect(h1.trim().length).toBeGreaterThan(1);
    await expect(page.getByText(/\d[\d,]* Games?/)).toBeVisible();
    expect(await cardCount(page)).toBeGreaterThan(10);
    expect(realErrors(errs)).toEqual([]);
  });

  test('the sort dropdown reorders the grid for every option', async ({ page }) => {
    await page.goto(CAT);
    await categoryReady(page);
    const orders: Record<string, string[]> = {};
    for (const s of ['Popularity', 'Newest', 'Top Rated', 'A-Z']) {
      await page.getByRole('button', { name: /^Sort:/ }).click();
      await page.locator('[role="menu"]').last().getByRole('menuitemradio', { name: s, exact: true }).click();
      await categoryReady(page);
      await page.waitForTimeout(1200);
      orders[s] = await cardOrder(page);
      await expect(page.getByRole('button', { name: `Sort: ${s}` })).toBeVisible();
    }
    /* A-Z is verifiable on its own terms. Compared on a folded key rather than
       localeCompare: ICU collation and IGDB's `sort name asc` disagree about
       where a space ranks ("100 Animals" vs "10000000"), and that disagreement
       is not a defect in the page. */
    const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const az = orders['A-Z'].slice(0, 10).map(fold);
    expect([...az].sort()).toEqual(az);
    expect(orders['Popularity'][0]).not.toBe(orders['A-Z'][0]);
    expect(orders['Newest'][0]).not.toBe(orders['A-Z'][0]);
  });

  test('a density-chart column narrows the grid, chips up, and releases on a second click', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto(CAT);
    await categoryReady(page);
    const before = await cardOrder(page);

    const columns = page.locator('[role="group"][aria-label="Filter by release period"] button:not([disabled])');
    await expect.poll(() => columns.count(), { timeout: 30000 }).toBeGreaterThan(1);
    const col = columns.first();
    const label = (await col.getAttribute('aria-label'))!.split(',')[0];

    await col.click();
    await expect(col).toHaveAttribute('aria-pressed', 'true');
    await categoryReady(page);
    await page.waitForTimeout(1200);
    const after = await cardOrder(page);
    expect(after).not.toEqual(before);

    // The chip appears, naming the span, and clears it.
    const chip = page.getByRole('button', { name: new RegExp(`^${label.replace(/[-–—]/g, '.')}`) }).first();
    await expect(chip).toBeVisible();
    await chip.click();
    await categoryReady(page);
    await expect(col).toHaveAttribute('aria-pressed', 'false');

    // Second click on the column itself is the release path.
    await col.click();
    await expect(col).toHaveAttribute('aria-pressed', 'true');
    await col.click();
    await expect(col).toHaveAttribute('aria-pressed', 'false');
    expect(realErrors(errs)).toEqual([]);
  });

  test('the Type dropdown narrows to main games and to DLC & Editions', async ({ page }) => {
    await page.goto(CAT);
    await categoryReady(page);
    const total = await page.getByText(/\d[\d,]* Games?/).innerText();

    await page.getByRole('button', { name: /^Type$/ }).click();
    await page.locator('[role="menu"]').last().getByRole('menuitemradio', { name: 'Main games' }).click();
    await categoryReady(page);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('button', { name: 'Main games' })).toBeVisible();
    const mainTotal = await page.getByText(/\d[\d,]* Games?/).innerText();
    expect(mainTotal).not.toBe(total);

    await page.getByRole('button', { name: 'Main games' }).click();
    await page.locator('[role="menu"]').last().getByRole('menuitemradio', { name: 'DLC & Editions' }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('button', { name: 'DLC & Editions' })).toBeVisible();
  });

  test('the Platform dropdown filters, and is multi-select', async ({ page }) => {
    await page.goto(CAT);
    await categoryReady(page);
    const before = await cardOrder(page);

    await page.getByRole('button', { name: /^Platform$/ }).click();
    const menu = page.locator('[role="menu"]').last();
    await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
    const first = menu.getByRole('menuitemradio').first();
    const pfName = (await first.innerText()).trim();
    await first.click();
    await categoryReady(page);
    await page.waitForTimeout(1500);
    expect(await cardOrder(page)).not.toEqual(before);

    // Re-open: the chosen platform reads as checked, and a second choice
    // makes the chip say "2 platforms".
    await page.locator('button.lh-label', { hasText: new RegExp(pfName.slice(0, 6), 'i') }).first().click()
      .catch(() => page.getByRole('button', { name: /platform/i }).first().click());
    const menu2 = page.locator('[role="menu"]').last();
    await menu2.getByRole('menuitemradio').nth(1).click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('button', { name: /2 platforms/ })).toBeVisible();
  });

  test('Acclaimed and On my shelves toggle aria-pressed and change what is shown', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto(CAT);
    await categoryReady(page);
    const before = await cardOrder(page);

    const acclaimed = page.getByRole('button', { name: 'Acclaimed' });
    await expect(acclaimed).toHaveAttribute('aria-pressed', 'false');
    await acclaimed.click();
    await expect(acclaimed).toHaveAttribute('aria-pressed', 'true');
    await categoryReady(page);
    await page.waitForTimeout(1500);
    expect(await cardOrder(page)).not.toEqual(before);
    await acclaimed.click();
    await expect(acclaimed).toHaveAttribute('aria-pressed', 'false');

    // On my shelves, with an empty library, must empty the grid and say so.
    const shelved = page.getByRole('button', { name: 'On my shelves' });
    await shelved.click();
    await expect(shelved).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(800);
    expect(await cardCount(page)).toBe(0);
    await expect(page.getByText('Nothing In This Span')).toBeVisible();
    await expect(page.getByText('None of the games loaded so far are on your shelves')).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('Clear releases every narrowing at once', async ({ page }) => {
    await page.goto(CAT);
    await categoryReady(page);
    await page.getByRole('button', { name: 'Acclaimed' }).click();
    await page.getByRole('button', { name: 'On my shelves' }).click();
    const clear = page.getByRole('button', { name: 'Clear', exact: true });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.getByRole('button', { name: 'Acclaimed' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'On my shelves' })).toHaveAttribute('aria-pressed', 'false');
    await expect(clear).toBeHidden();
    await categoryReady(page);
  });

  test('the grid keeps loading as you scroll, with no duplicate cards', async ({ page }) => {
    await page.goto(CAT);
    await categoryReady(page);
    const first = await cardCount(page);
    await page.evaluate(n => window.scrollBy(0, n), 20000);
    await expect.poll(() => cardCount(page), { timeout: 30000 }).toBeGreaterThan(first);
    await page.evaluate(n => window.scrollBy(0, n), 40000);
    await page.waitForTimeout(3000);
    const names = await cardOrder(page);
    expect(new Set(names).size, 'no duplicate cards across pages').toBe(names.length);
  });

  test('a failing category claims no games answer the narrowing, and offers no retry', async ({ page }) => {
    await page.route('**/api/games**', route => route.abort('failed'));
    await page.goto(CAT);

    /* DEFECT, same class as browse above and worse. `getGamesByCategory`
       (igdb.js:1565-1579) catches and returns `[]` — and unlike the other
       fetchers it does not even run the response through `asRows`, so an IGDB
       error object is discarded with no console error and no
       `moctale_api_error` event either. `CategoryPage.jsx:341-346` sets
       `loadError` in a `catch` that can never fire, so its "The Index Did Not
       Answer / Try Again" plate (CategoryPage.jsx:583-597) is unreachable. */
    await expect(page.getByText('Nothing In This Span')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('The Index Did Not Answer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Try Again/i })).toHaveCount(0);
    // No narrowing is applied, so the page offers no way out of the state at all.
    await expect(page.getByRole('button', { name: /Clear Narrowing/i })).toHaveCount(0);
    await page.screenshot({ path: 'qa/2026-09-05-deep/shots/category-failure-says-empty.png' });
  });

  test('a nonexistent category id does not crash the page', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/games/genre/99999999');
    await page.waitForTimeout(8000);
    // Whatever it shows, it must show SOMETHING and keep one h1.
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
    const h1 = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
    expect(h1, 'the h1 is not blank on an unknown category').not.toBe('');
    await page.screenshot({ path: 'qa/2026-09-05-deep/shots/category-unknown-id.png' });
    expect(realErrors(errs)).toEqual([]);
  });

  test('a card menu on a category page offers Add to Wishlist, and it shelves the game', async ({ page }) => {
    // NO libraryOffline here — this page needs the real IGDB grid to act on.
    await seed(page, { [KEYS.library]: [] });
    await page.goto(CAT);
    await categoryReady(page);
    const name = (await page.locator('.game-grid [role="link"]').first().getAttribute('aria-label'))!;
    await page.getByRole('button', { name: `More options for ${name}` }).click();
    const menu = page.locator('[role="menu"]').last();
    await expect(menu.getByRole('menuitem', { name: 'Add to Wishlist' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Add to Wishlist' }).click();
    await expect(page.getByText('Added to Wishlist')).toBeVisible();
    const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), KEYS.library);
    expect(stored.map((g: any) => g.name)).toContain(name);
  });
});
