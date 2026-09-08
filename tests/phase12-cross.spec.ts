/**
 * Deep QA — phase 12 of the qa/2026-09-05-deep run. CROSS-BROWSER.
 *
 * Phases 2-6 ran on chromium and Mobile Chrome only. Phase 12 re-ran all five
 * deep specs on firefox, webkit and Mobile Safari. Three of the differences it
 * found needed a probe that the original specs cannot give, because those specs
 * pin a chromium observation as the expectation and a divergence therefore
 * reads as a plain red test with no information in it.
 *
 * This file is CHARACTERISATION, not regression. Each test records what the
 * engine under test actually does and asserts the part that is engine-neutral,
 * so it stays green on all five projects while naming the divergence in its
 * output. Read the values it logs, not only its pass/fail.
 *
 * It is unrestricted: it runs on every project in playwright.config.ts, and it
 * is small enough (6 contexts) to stay under the Mobile Safari wedge threshold
 * of ~5 contexts per SHARD, not per file — run it sharded on Mobile Safari:
 *   npx playwright test tests/phase12-cross.spec.ts --project="Mobile Safari" --shard=1/2
 */
import { test, expect, type Page } from '@playwright/test';
import { KEYS } from './fixtures';

/* ── /profile ─────────────────────────────────────────────────────────────── */

/* phase6-deep.spec.ts:251 "FINDING 2 — Enter saves the name and then immediately
   re-opens the editor" fails on firefox, because firefox does not reproduce the
   defect. The spec's own comment already names the mechanism as chromium's:
   the keypress for the SAME Enter lands on the edit button that the focus
   restore effect just focused, and chromium turns that into a click.

   This probe asserts only the half that must hold everywhere — the name is
   saved and persisted — and REPORTS whether the editor re-opened. */
test('profile: Enter saves the name on every engine; whether it re-opens the editor is engine-specific', async ({ page }, testInfo) => {
  await page.goto('/profile');
  await page.getByRole('heading', { level: 1 }).getByRole('button').click();
  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByLabel('Display name').press('Enter');

  // Engine-neutral: the save half works everywhere.
  await expect(page.getByText('Name saved')).toBeVisible();
  const stored = await page.evaluate(k => window.localStorage.getItem(k), KEYS.profile);
  expect(JSON.parse(stored || '{}').name).toBe('Ada Lovelace');

  // Engine-specific: does the editor close?
  await page.waitForTimeout(500);
  const reopened = await page.getByLabel('Display name').count();
  const h1 = await page.getByRole('heading', { level: 1 }).count();
  console.log(`CROSSENGINE ${`${testInfo.project.name}: editorStillOpen=${reopened > 0} h1Count=${h1}`}`);
  // Recorded, not asserted — this is the divergence itself.
  expect([0, 1]).toContain(reopened);
});

/* ── /awards/:qid history ─────────────────────────────────────────────────── */

async function blockCloud(page: Page) {
  await page.route(/googleapis\.com|firebaseio\.com|firebaseinstallations|wdqs/, r => r.abort());
}

/* phase5-deep.spec.ts:1008 "FINDING 13: year selection replaces history" fails on
   firefox — but its setup gives the page NO prior history entry (open() is a
   single page.goto from about:blank), so `goBack()` is testing the engine's
   about:blank behaviour, not the product's. This version reaches the ceremony by
   CLICKING it from the index, so there is a real entry to go back to, and the
   product claim becomes testable on every engine. */
test('awards: a year click leaves a history entry, so Back returns to the ceremony', async ({ page }) => {
  await blockCloud(page);
  await page.route('**/api/games', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/awards');
  const row = page.locator('a[href^="/awards/Q"]').first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.click();
  await expect(page).toHaveURL(/\/awards\/Q/);

  const strip = page.getByRole('group', { name: 'Ceremony year' });
  const year = strip.getByRole('button').nth(3);
  await year.click();
  await expect(page).toHaveURL(/[?&]year=/);

  await page.goBack();
  // The year click pushes an entry, so Back returns to the ceremony.
  await expect(page).toHaveURL(/\/awards\/Q/);
  await expect(page).not.toHaveURL(/[?&]year=/);
});
/* ── the xl breakpoint vs the scrollbar ───────────────────────────────────── */

/* phase2-deep.spec.ts:116 branches on `page.viewportSize().width >= 1280` and
   then asserts which shelf control is showing. It fails on desktop webkit at a
   1280-wide viewport, which is the size playwright.config.ts gives BOTH Desktop
   Chrome and Desktop Safari — so the two engines disagree about whether
   `xl:` (min-width:1280px) is in force at the same nominal width.

   The cause to confirm or kill is the classic scrollbar: a non-overlay
   scrollbar takes its width out of the layout viewport, so the media query sees
   less than innerWidth. This records all three numbers and asserts the thing
   that must be true whatever the numbers are — the page never shows the desktop
   tab strip and the mobile shelf picker at the same time. */
test('library: the xl shelf control never double-renders, whatever the scrollbar does', async ({ page }, testInfo) => {
  await page.route('**/api/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  /* The library MUST have content. An empty shelf is short enough not to scroll,
     so no scrollbar is laid out and the very effect under test disappears —
     the first version of this probe measured clientWidth=1280 on every engine
     and proved nothing. Ids are outside IGDB's range so nothing is fetched. */
  await page.addInitScript((payload: string) => {
    window.localStorage.setItem('moctale_library', payload);
  }, JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
    id: 990000 + i, name: `Shelf Filler ${i}`, status: 'Backlog',
    is_custom: false, release_year: 2020, cover_id: null,
  }))));
  await page.goto('/library/backlog');
  // NOT networkidle: signed out, igdb.js still holds a Firestore Listen channel
  // open, so networkidle never fires and the test dies at its own timeout.
  await page.waitForSelector('main, [role="main"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => ({
    inner: window.innerWidth,
    docClient: document.documentElement.clientWidth,
    xlMatches: window.matchMedia('(min-width: 1280px)').matches,
  }));
  const picker = await page.getByRole('button', { name: /Change shelf$/ }).isVisible().catch(() => false);
  const tabs = await page.locator('button:has(span:text-is("Wishlist"))').first()
    .isVisible().catch(() => false);

  console.log(`CROSSENGINE ${`${testInfo.project.name}: viewport=${page.viewportSize()?.width} inner=${m.inner} `
      + `clientWidth=${m.docClient} xlMatches=${m.xlMatches} pickerVisible=${picker} tabsVisible=${tabs}`}`);

  // The invariant: exactly one of the two shelf controls is on screen.
  expect(picker && tabs, 'both the desktop tab strip and the mobile shelf picker are visible').toBe(false);
  expect(picker || tabs, 'neither shelf control is visible').toBe(true);
  // And the media query is what decides, not the nominal viewport number.
  expect(m.xlMatches).toBe(tabs);
});

/* ── /game/:id ────────────────────────────────────────────────────────────── */

const GAME = {
  id: 5551,
  name: 'Stub Complete Edition',
  summary: 'A stub summary long enough to occupy the Overview section.',
  first_release_date: 1431993600,
  total_rating: 88.4,
  total_rating_count: 4200,
  cover: { image_id: 'co1wyy', width: 264, height: 374 },
  genres: [{ id: 12, name: 'Role-playing (RPG)' }],
  platforms: [{ id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' }],
  franchises: [], collections: [],
};

async function stubIgdb(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('igdb_client_id', 'qa-phase12-stub');
    localStorage.setItem('igdb_access_token', 'qa-phase12-token');
  });
  await page.route('**/api/**', route => {
    const body = route.request().postData() || '';
    const m = body.match(/where id = (\d+)/);
    const hit = m && m[1] === String(GAME.id) ? [GAME] : [];
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(hit),
    });
  });
}

/* phase3-deep.spec.ts:687 "Before You Decide is hidden entirely once the game is
   Beaten" fails on firefox. Two candidate causes, and they need separating: the
   status click did not take, or the section does not react to it. This probe
   reads the persisted library row FIRST, so the log says which. */
test('game detail: setting Beaten persists, and Before You Decide reacts to it', async ({ page }, testInfo) => {
  await stubIgdb(page);
  await page.goto(`/game/${GAME.id}`);
  await expect(page.getByRole('heading', { level: 1, name: GAME.name }))
    .toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Before You Decide' })).toBeVisible();

  await page.locator('button[aria-label="Set status to Beaten"]:visible').first().click();

  // Did the click take at all? This is the half that must hold everywhere.
  await expect
    .poll(async () => {
      const row = await page.evaluate((k) => {
        const raw = JSON.parse(window.localStorage.getItem(k) || '[]');
        return raw.find((g: { id: unknown }) => String(g.id) === '5551') || null;
      }, KEYS.library);
      return row?.status ?? null;
    }, { timeout: 10000 })
    .toBe('Beaten');

  // And does the section react? Recorded per engine.
  await page.waitForTimeout(1000);
  const still = await page.getByRole('heading', { name: 'Before You Decide' }).count();
  console.log(`CROSSENGINE ${`${testInfo.project.name}: beforeYouDecideAfterBeaten=${still}`}`);
  expect([0, 1]).toContain(still);
});
