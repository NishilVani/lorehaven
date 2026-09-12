import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, seedCollections, seedFeedback, SEED_COLLECTION_ID } from './fixtures';
import { offlineIgdb } from './igdb-stub';

/**
 * ROUTE REACHABILITY PROBE — the map every later QA phase works from.
 *
 * `src/App.jsx:131-157` declares 24 `<Route path=...>` elements (a bare
 * `grep -c '<Route'` returns 26 because `<Routes>` and `<RouteFallback>` match
 * the same string). Two of the 24 are `<Navigate>` redirects, so there are 22
 * screens. This file drives all 24.
 *
 * "The route renders" is not the assertion. Every screen here is a `lazy()`
 * chunk behind one Suspense boundary, so a 200 with an empty <main> — or a
 * <main> still showing the "Loading…" fallback — is the exact failure this
 * catches. Each case asserts the route's OWN h1, or its own copy where a state
 * renders no heading.
 *
 * SCOPE, stated rather than hidden: this spec runs on `chromium` and
 * `Mobile Chrome` only. Every route fans out to IGDB, which rate-limits at
 * 4 req/s; 24 routes across all five projects reliably produced 429s and a
 * different failure on each run. Desktop and phone are the two shapes that
 * actually differ in this app (`src/index.css:646-660` swaps the library shelf
 * tabs for a picker below 1280px), so those are the two the probe covers.
 * tests/smoke.spec.ts still runs on all five.
 *
 * PARAM ROUTES. Ids that name a fixed row are inlined and named. Ids that do
 * not (franchises, IGDB collections, events, taxonomy terms) are DERIVED at run
 * time from the index page that links to them, which also tests the index ->
 * detail hop a real user takes.
 *
 * OFFLINE. Every case answers IGDB from tests/igdb-stub.ts. This probe used to
 * read the live catalogue through the deployed Worker, so a slow IGDB failed a
 * route that was fine. playwright.config.ts now points the proxy at an origin
 * nothing listens on, and the stub is what these routes render from.
 *
 * SEEDED STATE. Nothing here signs in and nothing here touches Firestore. The
 * library, collections and feedback marks all live in localStorage, so
 * tests/fixtures.ts seeds them with `addInitScript` before first paint.
 */

const NET = { timeout: 30_000 };

/* Named rows. 1942 is The Witcher 3: Wild Hunt in tests/igdb-stub.ts, as it is
   in IGDB (also used by smoke.spec.ts). Q18642757 is The Game Awards, from the
   awards corpus shipped in src/services/wikidata/, which renders with no network. */
const GAME_ID = 1942;
const AWARD_QID = 'Q18642757';

test.beforeEach(async ({ page }) => { await offlineIgdb(page); });

/* The chromium / Mobile Chrome restriction is enforced in playwright.config.ts
   with a per-project `testIgnore`, NOT with a skip in here. It has to be:
   `test.skip()` in a `beforeEach` runs AFTER the `page` fixture has already
   built a browser context, so a "skipped" test still launches and tears down a
   browser. Doing that 37 times on the webkit worker is what made the full suite
   hang — see the workers comment in playwright.config.ts. `testIgnore` drops the
   file at collection time, so those contexts are never created at all. */

/** The route rendered its own screen, not the Suspense fallback and not nothing. */
async function expectRendered(page: Page) {
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  await expect(main.getByText('Loading…', { exact: true })).toHaveCount(0, NET);
  expect((await main.innerText()).trim().length).toBeGreaterThan(0);
}

// ── 1. Static routes, no params ──────────────────────────────────────────────

const STATIC: Array<{ path: string; h1: RegExp | string; note?: string }> = [
  { path: '/', h1: 'Explore' },
  { path: '/feedback', h1: 'Your Feedback' },
  { path: '/profile', h1: /My Profile/ },
  { path: '/schedule', h1: 'Schedule' },
  { path: '/import', h1: 'Upload', note: 'WizardShell titles the header with the STEP name' },
  { path: '/collections', h1: 'Collections' },
  { path: '/platforms', h1: 'Manage Platforms' },
  { path: '/events', h1: 'Events' },
  { path: '/wallpapers', h1: 'Wallpapers' },
  { path: '/awards', h1: 'Awards' },
];

for (const r of STATIC) {
  test(`route ${r.path} renders its own screen`, async ({ page }) => {
    await page.goto(r.path);
    await expectRendered(page);
    await expect(page.locator('h1')).toHaveText(r.h1, NET);
  });
}

// ── 2. Redirects ─────────────────────────────────────────────────────────────

test('route /library redirects to the backlog shelf', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library\/backlog$/);
  await expect(page.locator('h1')).toHaveText('Backlog');
});

test('route /browse redirects to the genres index', async ({ page }) => {
  await page.goto('/browse');
  await expect(page).toHaveURL(/\/browse\/genres$/);
  await expect(page.locator('h1')).toHaveText('Genres');
});

// ── 3. Enumerated params ─────────────────────────────────────────────────────

for (const status of ['playing', 'backlog', 'wishlist', 'beaten', 'dropped', 'unreleased']) {
  test(`route /library/${status} renders that shelf`, async ({ page }) => {
    await seedLibrary(page);
    await page.goto(`/library/${status}`);
    await expectRendered(page);
    // The h1 is the shelf name in title case; the URL param is lower case.
    await expect(page.locator('h1')).toHaveText(new RegExp(`^${status}$`, 'i'));
  });
}

for (const taxonomy of ['genres', 'themes', 'modes']) {
  test(`route /browse/${taxonomy} lists real terms`, async ({ page }) => {
    await page.goto(`/browse/${taxonomy}`);
    await expect(page.locator('h1')).toHaveText(new RegExp(`^${taxonomy}$`, 'i'));
    await expect(page.getByText(/\d+ Terms?/i)).toBeVisible(NET);
    await expect(page.locator('a[href^="/games/"]').first()).toBeVisible(NET);
  });
}

for (const section of [
  { id: 'updates', h1: 'Library Updates' },
  { id: 'announced', h1: 'Recently Announced' },
  { id: 'trending', h1: 'Trending' },
]) {
  test(`route /explore/${section.id} renders`, async ({ page }) => {
    await page.goto(`/explore/${section.id}`);
    await expectRendered(page);
    await expect(page.locator('h1')).toHaveText(section.h1, NET);
  });
}

test('route /explore/:section rejects an unknown section', async ({ page }) => {
  await page.goto('/explore/not-a-section');
  await expect(page.getByText('Unknown Section')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Explore' })).toBeVisible();
});

// ── 4. Id params — inlined, stable rows ──────────────────────────────────────

test('route /game/:id renders the game', async ({ page }) => {
  await page.goto(`/game/${GAME_ID}`);
  await expect(page.locator('h1')).toHaveText(/The Witcher 3/i, NET);
});

test('route /game/:id/collections renders the disabled stub', async ({ page }) => {
  /* This route is ORPHANED: nothing under src/ links to it (verified by grep),
     so it is reachable only by typing the URL. The assertion records what it
     actually serves rather than what the path promises. */
  await page.goto(`/game/${GAME_ID}/collections`);
  await expect(page.locator('h1')).toHaveText('Game Collections');
  await expect(page.getByText('Collections Disabled')).toBeVisible();
});

test('route /awards/:awardQid renders a ceremony', async ({ page }) => {
  await page.goto(`/awards/${AWARD_QID}`);
  await expectRendered(page);
  await expect(page.locator('h1')).toContainText(/Game Awards/i, NET);
});

test('route /profile/year/:year renders a year', async ({ page }) => {
  await seedLibrary(page);
  // The seeded Beaten row has dateCompleted 2024-03-14.
  await page.goto('/profile/year/2024');
  await expectRendered(page);
  await expect(page.locator('h1').first()).toContainText(/2024|Year in Review/, NET);
});

test('route /collection/:id renders a local collection', async ({ page }) => {
  await seedCollections(page);
  await page.goto(`/collection/${SEED_COLLECTION_ID}`);
  await expectRendered(page);
  await expect(page.locator('h1')).toHaveText('Seeded Collection', NET);
});

// ── 5. Id params — derived from the index that links to them ─────────────────

test('route /games/:type/:id opens from the genres index', async ({ page }) => {
  await page.goto('/browse/genres');
  const first = page.locator('a[href^="/games/genre/"]').first();
  await expect(first).toBeVisible(NET);
  /* textContent, NOT innerText. The register row sets the term in `.lh-display`,
     which is uppercased by CSS, so innerText returns "ADVENTURE" while the
     destination h1 renders "Adventure" — the same string through two different
     text-transforms. textContent is the untransformed source text. */
  const label = ((await first.locator('span').first().textContent()) || '').trim();
  expect(label.length).toBeGreaterThan(0);
  await first.click();
  await expect(page).toHaveURL(/\/games\/genre\/\d+/);
  await expect(page.locator('h1')).toHaveText(new RegExp(`^${label}$`, 'i'), NET);
});

test('route /collection/igdb/:id opens from the collections feed', async ({ page }) => {
  await page.goto('/collections');
  const first = page.locator('a[href^="/collection/igdb/"]').first();
  await expect(first).toBeVisible(NET);
  await first.click();
  await expect(page).toHaveURL(/\/collection\/igdb\/\d+/);
  await expectRendered(page);
});

test('route /franchise/:franchiseId opens from the collections feed', async ({ page }) => {
  await page.goto('/collections');
  const first = page.locator('a[href^="/franchise/"]').first();
  await expect(first).toBeVisible(NET);
  await first.click();
  await expect(page).toHaveURL(/\/franchise\/\d+/);
  await expectRendered(page);
});

test('route /event/:id opens from the events index', async ({ page }) => {
  await page.goto('/events');
  await expect(page.locator('h1')).toHaveText('Events');
  /* AllEvents.jsx:194 (hero) and :262 (list row) render each event as a <button>
     that calls navigate(), not as a link, so this hop cannot be done by reading
     an href — and neither button carries an aria-label, so it cannot be reached
     by accessible name either. Every OTHER button on the page does carry one of
     `aria-pressed` (the Upcoming/Past tabs, AllEvents.jsx:139) or `aria-label`
     (clear-search, and the app shell's nav controls), so "in main, and labelled
     by neither" is the only handle an event row actually offers. That it takes a
     CSS selector to find a primary navigation control is itself a finding —
     see qa/2026-09-05-deep/inventory.md, /events. */
  const row = page.locator('main button:not([aria-pressed]):not([aria-label])');
  await expect(row.first()).toBeVisible(NET);
  await row.first().click();
  await expect(page).toHaveURL(/\/event\/\d+/, NET);
  await expectRendered(page);
});

// ── 6. The catch-all ─────────────────────────────────────────────────────────

test('an unmatched URL renders the not-found screen', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Page Not Found' })).toBeVisible();
  await expect(page.getByText('/this-route-does-not-exist')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Explore' }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

// ── 7. Seeded state actually lands ───────────────────────────────────────────

test('the library seed reaches the shelf it seeds', async ({ page }) => {
  await seedLibrary(page);
  await page.goto('/library/beaten');
  await expect(page.getByRole('link', { name: 'The Witcher 3: Wild Hunt' })).toBeVisible(NET);
});

test('the feedback seed reaches /feedback', async ({ page }) => {
  await seedFeedback(page);
  await page.goto('/feedback');
  await expect(page.getByRole('link', { name: 'The Elder Scrolls V: Skyrim' })).toBeVisible(NET);
});
