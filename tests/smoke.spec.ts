import { test, expect } from '@playwright/test';

/**
 * Route smoke tests. Each one asserts the route renders ITS OWN content — the
 * page's h1 plus something only that page has — not that the server answered.
 * Every route in this app is a lazy() chunk behind a Suspense fallback, so a
 * 200 with an empty <main> is the exact failure these catch.
 *
 * Timeouts are generous because /browse, /collections and /game/:id all wait on
 * an IGDB round trip before their body fills in.
 */

const NET = { timeout: 30_000 };

test('library redirects to a shelf and renders it', async ({ page }) => {
  await page.goto('/library');
  // The bare path is a <Navigate> to the backlog shelf; the shelf, not the path,
  // is the page.
  await expect(page).toHaveURL(/\/library\/backlog/);
  await expect(page.locator('h1')).toHaveText('Backlog');
  // The status strip is the library's own furniture — no other page has it. It
  // has two shapes, and the narrow one is not a degraded desktop: below 1280px
  // `src/index.css:649` sets `display: none` on every desktop tab and swaps in a
  // single compact button that opens the shelf picker. Asserting the desktop
  // shape on a phone viewport fails for a correct reason.
  const wide = await page.evaluate(() => window.matchMedia('(min-width: 1280px)').matches);
  if (wide) {
    for (const shelf of ['Playing', 'Wishlist', 'Beaten', 'Dropped']) {
      await expect(page.getByRole('main').getByText(shelf, { exact: true }).first()).toBeVisible();
    }
  } else {
    await expect(page.getByRole('button', { name: /Change shelf/i })).toBeVisible();
  }
});

test('browse redirects to genres and lists real terms', async ({ page }) => {
  await page.goto('/browse');
  await expect(page).toHaveURL(/\/browse\/genres/);
  await expect(page.locator('h1')).toHaveText('Genres');
  // The register, not the skeleton and not the failure state. "0 Terms" is what
  // the page shows when IGDB does not answer, so the count alone proves nothing —
  // assert the rows themselves.
  await expect(page.getByText(/\d+ Terms/i)).toBeVisible(NET);
  await expect(page.locator('a[href^="/games/genre/"]').first()).toBeVisible(NET);
  await expect(page.getByRole('link', { name: /Adventure/i }).first()).toBeVisible(NET);
});

test('games detail renders the game, not a shell', async ({ page }) => {
  // IGDB id 1942 — The Witcher 3. Stable public catalogue row.
  await page.goto('/game/1942');
  await expect(page.locator('h1')).toHaveText(/The Witcher 3/i, NET);
  await expect(page.getByText(/Before You Decide/i).first()).toBeVisible(NET);
});

test('collections renders its tabs and feed', async ({ page }) => {
  await page.goto('/collections');
  await expect(page.locator('h1')).toHaveText('Collections');
  await expect(page.getByRole('button', { name: 'Discover' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  // Feed rows arrive from IGDB; "N Titles" is the row caption. The number and
  // the word are separate spans (src/components/collections/CollectionTile.jsx:70-75),
  // so the parent's textContent is "9Titles" with no separator — JSX drops the
  // whitespace-only line between two elements. The line break is layout, not text.
  await expect(page.getByText(/\d+\s*Titles?/i).first()).toBeVisible(NET);
});

test('profile renders the signed-out state', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.locator('h1')).toContainText('My Profile');
  await expect(page.getByText('Not signed in')).toBeVisible();
  await expect(page.getByRole('button', { name: /Sign In/i }).first()).toBeVisible();
});
