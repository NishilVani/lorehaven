/**
 * Deep QA — phase 6 of the qa/2026-09-05-deep run.
 * Routes under test: /profile (Profile + LibraryNumbers + YourTaste + YourData),
 * /wallpapers, and /import (ImportWizard, all four steps).
 *
 * Every test DRIVES a control and asserts the state it changed.
 *
 * Cases marked `FINDING n` assert the WRONG behaviour on purpose so the suite
 * stays green and the defect cannot be quietly lost between this run and the fix
 * phase. Numbers here are DISCOVERY order; qa/2026-09-05-deep/phase6.md ranks by
 * severity and carries the mapping table.
 *
 * Run:
 *   npx playwright test tests/phase6-deep.spec.ts --project=chromium --project="Mobile Chrome"
 *
 * NOTHING HERE TOUCHES PRODUCTION. Every test is signed out, so src/services/db.js
 * writes localStorage and nothing else — no Firestore read, no Firestore write.
 * Every test also aborts *.googleapis.com and stubs /api/**, so neither Firestore
 * nor IGDB is contacted. The one test that presses "Confirm Save" in the import
 * wizard writes to the throwaway browser context's localStorage; that context is
 * destroyed at the end of the test.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { seed, KEYS, SEED_LIBRARY, KNOWN_NOISE, realErrors } from './fixtures';
import path from 'node:path';

/* Tracked beside the specs. They used to live in qa/2026-09-05-deep, which
   .gitignore excludes, so on any fresh checkout -- CI included -- every /import
   case failed with ENOENT before it reached the page. */
const FIXTURES = path.resolve(process.cwd(), 'tests/data/import');
const csv = (n: string) => path.join(FIXTURES, n);

/* ── Console watch ───────────────────────────────────────────────────────── */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/* ── Offline by construction ─────────────────────────────────────────────── */
async function noFirestore(page: Page) {
  await page.route('**/*.googleapis.com/**', r => r.abort());
  await page.route('**/*.firebaseio.com/**', r => r.abort());
}

/** Credentials are raw strings — igdb.js and Wallpapers.jsx both bare-getItem them. */
async function seedCreds(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('igdb_client_id', 'qa-phase6-stub');
    localStorage.setItem('igdb_access_token', 'qa-phase6-token');
  });
}

/* ── Wallpaper payload ────────────────────────────────────────────────────
   Two library games with artworks + screenshots, plus one similar game, so the
   Aspect / Type / Source narrowings all have both sides to choose between. */
const WP_LIB = [
  {
    id: 1942, name: 'The Witcher 3: Wild Hunt',
    artworks: [
      { image_id: 'ar-w3-a', width: 1920, height: 1080 },
      { image_id: 'ar-w3-b', width: 1080, height: 1920 },
    ],
    screenshots: [
      { image_id: 'sc-w3-a', width: 1920, height: 1080 },
      { image_id: 'sc-w3-b', width: 1920, height: 1080 },
    ],
    similar_games: [7777],
  },
  {
    id: 1020, name: 'Grand Theft Auto V',
    artworks: [{ image_id: 'ar-gta-a', width: 1920, height: 1080 }],
    screenshots: [{ image_id: 'sc-gta-a', width: 1080, height: 1920 }],
    similar_games: [7777],
  },
];
const WP_SIMILAR = [
  {
    id: 7777, name: 'A Similar Stub Game',
    artworks: [{ image_id: 'ar-sim-a', width: 1920, height: 1080 }],
    screenshots: [{ image_id: 'sc-sim-a', width: 1920, height: 1080 }],
  },
];
/** 2 lib games x 4 + 1 x 2 = 6 library plates, + 2 similar = 8 total. */
const WP_TOTAL = 8;

type WpMode = 'ok' | 'errorObject' | 'throw' | 'emptyArray';

async function stubWallpapers(page: Page, mode: WpMode = 'ok') {
  await seedCreds(page);
  await page.route('**/api/**', async route => {
    const body = route.request().postData() || '';
    if (mode === 'throw') return route.abort();
    if (mode === 'errorObject') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Syntax Error', status: 400 }),
      });
    }
    if (mode === 'emptyArray') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    // Two calls: the library ids, then the similar ids.
    const isSimilar = body.includes('7777');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(isSimilar ? WP_SIMILAR : WP_LIB),
    });
  });
  // Never fetch a real plate bitmap.
  await page.route('**/images.igdb.com/**', r =>
    r.fulfill({ status: 200, contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64') }));
}

/** Wait until the wallpaper grid or one of its plates has settled. */
async function wpSettled(page: Page) {
  await expect(page.getByRole('heading', { name: 'Wallpapers', level: 1 })).toBeVisible();
  await expect(page.locator('.skeleton-placeholder')).toHaveCount(0, { timeout: 20_000 });
}

/** The header count strip. PageHeader joins `count` and `meta` into ONE line, so
 *  desktop reads "8 Plates · Hover a plate to select it" and the phone "8 Plates". */
async function plateCount(page: Page): Promise<number> {
  const t = await page.locator('div.tabular-nums').filter({ hasText: /\d+ Plates?/i })
    .first().innerText({ timeout: 5000 });
  return Number(t.match(/(\d+)\s+Plates?/i)![1]);
}

/** The plate's own corner toggle, which is the one carrying aria-pressed.
 *  The full-bleed action button beside it advertises the SAME accessible name
 *  (finding 6), so a bare getByRole picks whichever comes first in the DOM. */
const plateToggles = (page: Page) =>
  page.locator('button[aria-pressed][aria-label^="Select "], button[aria-pressed][aria-label^="Deselect "]');

/** The plate's full-bleed action button — "Open X artwork" out of select mode. */
const plateOpeners = (page: Page) =>
  page.locator('button[aria-label^="Open "][aria-label$=" artwork"], button[aria-label^="Open "][aria-label$=" screenshot"]');

/* ── IGDB search stub for the import wizard ───────────────────────────────
   searchGames POSTs `search "<name>"; fields ...` to /api/games. Every query
   gets a deterministic two-result list whose first entry is an exact-name match,
   so ImportWizard's `results.find(exact) || results[0]` picks a known id.
   HIT_IDS is what a seeded library needs to hold to force a conflict. */
const importId = (name: string) => {
  // djb2. A length+first-char hash collided on "Named Row One"/"Named Row Two"
  // and silently merged two library rows, which read as a product bug.
  let h = 5381;
  for (const c of (name || 'unnamed')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return 800000 + (h % 90000);
};

/** Checkbox renders a 0x0 sr-only <input> behind a styled span, so Playwright's
 *  check()/uncheck() cannot reach it even forced. A dispatched click still fires
 *  React's onChange, which is what the component listens to. */
const toggleCb = (l: import('@playwright/test').Locator) => l.dispatchEvent('click');

/** WizardShell hides each chip's word below sm, so the accessible name is just
 *  "01" on a phone and "01 Upload" on a desktop. */
const chip = (page: Page, num: string, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${num}( ${label})?$`) });

/** DropdownMenu rows can sit below the fold on a phone, and the menu closes on
 *  any scroll — so dispatch rather than scroll-then-click. */
const pickMenu = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitemradio', { name }).dispatchEvent('click');

/** DropdownMenu closes on ANY scroll (DropdownMenu.jsx:142), and Playwright's own
 *  scroll-into-view fires one that can land after the menu opens. Settle the
 *  trigger's position FIRST, then click it. Carried forward from phase 3. */
async function openMapRow(page: Page, name: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await trigger.click();
  await expect(page.getByRole('menuitemradio').first()).toBeVisible();
}

async function stubImportSearch(page: Page, opts: { empty?: string[]; allEmpty?: boolean } = {}) {
  await seedCreds(page);
  await page.route('**/api/**', async route => {
    const body = route.request().postData() || '';
    const m = body.match(/search "([^"]*)"/);
    if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const q = m[1];
    if (opts.allEmpty || opts.empty?.includes(q)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    const id = importId(q);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { id, name: q, game_type: 0, first_release_date: 1431993600,
          cover: { image_id: 'co1wyy', width: 264, height: 374 } },
        { id: id + 1, name: `${q} — Definitive Edition`, game_type: 8,
          first_release_date: 1600000000, cover: { image_id: 'co2lbd', width: 264, height: 374 } },
      ]),
    });
  });
  await page.route('**/images.igdb.com/**', r =>
    r.fulfill({ status: 200, contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64') }));
}

/** Load a CSV through the real <input type="file"> and land on step 2. */
async function upload(page: Page, file: string) {
  await page.setInputFiles('#csv-file-input', csv(file));
}

const ls = (page: Page, key: string) =>
  page.evaluate(k => window.localStorage.getItem(k), key);

/* ═══════════════════════════════════════════════════════════════════════════
   /profile
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('/profile', () => {
  test.beforeEach(async ({ page }) => {
    await noFirestore(page);
    await seedCreds(page);
    /* A seeded library makes YourTaste look its games up in IGDB. None of these
       cases read the answer, and an empty index is a valid one; unanswered, the
       lookup went to live IGDB. */
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  });

  test('1. the h1 IS the edit control and clicking it mounts a selected input', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    const editBtn = h1.getByRole('button');
    await expect(editBtn).toHaveAccessibleName(/Edit display name/);
    await editBtn.click();
    const input = page.getByLabel('Display name');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    // startEdit reads getUserName(), which is empty here, so there is nothing to select.
    expect(await input.inputValue()).toBe('');
    // The h1 is now the input's row — the heading control is gone while editing.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  });

  test('2. FINDING 1 — editing the name destroys the page\'s only h1', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await expect(page.getByLabel('Display name')).toBeVisible();
    const headings = await page.evaluate(() =>
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').length);
    // h2s survive (Numbers / Your data); the h1 does not.
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(0);
    expect(headings).toBeGreaterThan(0);
  });

  test('3. Enter saves the name and closes the editor', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('Ada Lovelace');
    await page.getByLabel('Display name').press('Enter');

    await expect(page.getByText('Name saved')).toBeVisible();
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').name).toBe('Ada Lovelace');
    // And the editor closes, leaving the heading with the new name.
    await expect(page.getByLabel('Display name')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada Lovelace');
  });  test('3b. the Save button path does close the editor and restore the heading', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('Ada Lovelace');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada Lovelace');
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').name).toBe('Ada Lovelace');
    // The avatar initial is derived from the same string, so the two cannot disagree.
    await expect(page.locator('header [aria-hidden="true"]').first()).toHaveText('A');
  });

  test('4. the Save (check) button commits and returns focus to the edit button', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('Saved By Button');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Saved By Button');
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('class') || '');
    expect(focus).toContain('tap-block');   // the h1's own button, not <body>
    await expect(page.getByRole('heading', { level: 1 }).getByRole('button')).toBeFocused();
  });

  test('5. Escape and the Cancel button both discard the draft', async ({ page }) => {
    await seed(page, { [KEYS.profile]: { name: 'Original Name' } });
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('Thrown Away');
    await page.getByLabel('Display name').press('Escape');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Original Name');
    await expect(page.getByRole('heading', { level: 1 }).getByRole('button')).toBeFocused();

    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('Also Thrown Away');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Original Name');
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').name).toBe('Original Name');
  });

  test('6. the name field caps at 60 characters', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    const input = page.getByLabel('Display name');
    await input.fill('x'.repeat(200));
    expect((await input.inputValue()).length).toBe(60);
  });

  test('7. clearing the name falls back to "My Profile" and toasts "Name cleared"', async ({ page }) => {
    await seed(page, { [KEYS.profile]: { name: 'To Be Cleared' } });
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Name cleared')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('My Profile');
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').name).toBe('');
  });

  test('8. a whitespace-only name is trimmed to empty, not stored as spaces', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('heading', { level: 1 }).getByRole('button').click();
    await page.getByLabel('Display name').fill('     ');
    await page.getByLabel('Display name').press('Enter');
    await expect(page.getByText('Name cleared')).toBeVisible();
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').name).toBe('');
  });

  test('9. a 60-character name does not push the page sideways', async ({ page }) => {
    await seed(page, { [KEYS.profile]: { name: 'Bartholomew Wenceslas Fitzgerald-Ashcombe The Extremely' } });
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('10. signed out, the sync line states the fact and Sign In opens the modal', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText('Not syncing — your library lives on this device')).toBeVisible();
    await expect(page.getByText('Not signed in')).toBeVisible();
    await page.getByRole('button', { name: 'Sign In to Sync' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // Still signed out. No credential of any kind was entered.
    await expect(page.getByRole('button', { name: 'Sign In to Sync' })).toBeVisible();
  });

  test('11. the three header counts equal libraryStats over the seed', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    const band = page.locator('header');
    await expect(band.getByText('In Library')).toBeVisible();
    const total = await band.locator('div', { hasText: /^In Library$/ }).count();
    expect(total).toBeGreaterThan(0);
    const texts = await page.locator('header .tabular-nums').allInnerTexts();
    expect(texts.slice(0, 3)).toEqual(['6', '1', '1']);   // total, Beaten, Playing
  });

  test('12. an empty library hides the counts and the whole taste band', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText('In Library')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /taste/i })).toHaveCount(0);
    // The data band still renders — it is how you get a library in the first place.
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
  });

  test('13. Manage Platforms and Import a Library navigate', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Manage Platforms' }).click();
    await expect(page).toHaveURL(/\/platforms$/);
    await page.goBack();
    await page.getByRole('button', { name: /Import a Library/ }).click();
    await expect(page).toHaveURL(/\/import$/);
  });

  test('14. Export on an empty library refuses with a toast and downloads nothing', async ({ page }) => {
    await page.goto('/profile');
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await page.getByRole('button', { name: /Export as CSV/ }).click();
    await expect(page.getByText('Nothing to export yet')).toBeVisible();
    expect(downloaded).toBe(false);
  });

  test('15. Export with a library builds a file and reports the row count', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    const dl = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await page.getByRole('button', { name: /Export as CSV/ }).click();
    await expect(page.getByText(/Exported 6 entries/)).toBeVisible({ timeout: 15_000 });
    const d = await dl;
    expect(d).not.toBeNull();
    expect(d!.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('16. Clear Library on an empty library refuses without opening a dialog', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('button', { name: /Clear Library/ }).click();
    await expect(page.getByText('Your library is already empty')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('17. Clear Library is phrase-gated, cancellable, and only then destructive', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    await page.getByRole('button', { name: /Clear Library/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('This removes all 6 games');
    const confirm = dlg.getByRole('button', { name: 'Clear Library' });
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    // Focus lands on Cancel, never on the destructive button.
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // A wrong phrase keeps it locked, and clicking it does nothing.
    const phrase = dlg.getByRole('textbox');
    await phrase.fill('clear');            // lowercase — not the phrase
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await confirm.click({ force: true });
    await expect(dlg).toBeVisible();
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(6);

    // Escape closes without destroying anything.
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(6);

    // Reopened, the phrase field is empty again — the gate does not stay satisfied.
    await page.getByRole('button', { name: /Clear Library/ }).click();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('');

    // Cancel is the other way out.
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(6);

    // And the real thing.
    await page.getByRole('button', { name: /Clear Library/ }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('CLEAR');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Clear Library' }))
      .toHaveAttribute('aria-disabled', 'false');
    await page.getByRole('dialog').getByRole('button', { name: 'Clear Library' }).click();
    await expect(page.getByText('Library cleared')).toBeVisible();
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(0);
  });

  test('18. the taste dials write moctale_prefs when clicked', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    const groups = page.getByRole('radiogroup');
    await expect(groups.first()).toBeVisible({ timeout: 20_000 });
    const radios = groups.first().getByRole('radio');
    const n = await radios.count();
    expect(n).toBeGreaterThan(1);
    // Pick a radio that is not already checked.
    let target = -1;
    for (let i = 0; i < n; i++) {
      if (await radios.nth(i).getAttribute('aria-checked') !== 'true') { target = i; break; }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    await radios.nth(target).click();
    await expect(radios.nth(target)).toHaveAttribute('aria-checked', 'true');
    expect(await ls(page, KEYS.prefs)).not.toBeNull();
  });

  test('18b. the numbers band and the taste band carry working links', async ({ page }) => {
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/profile');
    // A Beaten row with a dateCompleted gives the year strip something to link to.
    const year = page.getByRole('link', { name: /2024/ }).first();
    await expect(year).toHaveAttribute('href', '/profile/year/2024');
    await expect(page.getByRole('link', { name: /Interested or Not Interested/ }))
      .toHaveAttribute('href', '/feedback');
    await year.click();
    await expect(page).toHaveURL(/\/profile\/year\/2024$/);
  });

  test('18c. an empty completion history swaps the year strip for its own CTA', async ({ page }) => {
    // Same library, no dateCompleted anywhere.
    await seed(page, {
      [KEYS.library]: SEED_LIBRARY.map(g => ({ ...g, dateCompleted: undefined })),
    });
    await page.goto('/profile');
    await expect(page.getByRole('link', { name: /Your finished shelf/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^\/profile\/year/ })).toHaveCount(0);
    await page.getByRole('link', { name: /Your finished shelf/ }).click();
    await expect(page).toHaveURL(/\/library\/beaten$/);
  });

  test('19. no console error on a fully seeded profile', async ({ page }) => {
    const errs = watchConsole(page);
    /* A healthy but empty index. Without this the page reaches the real IGDB with
       no credentials and reports the 401 honestly, which is the product working,
       not the thing this case is about. */
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: SEED_LIBRARY, [KEYS.profile]: { name: 'QA' } });
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(realErrors(errs)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /wallpapers
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe('/wallpapers', () => {
  test.beforeEach(async ({ page }) => { await noFirestore(page); });

  test('20. an empty library draws the bare-print-room plate and no toolbar at all', async ({ page }) => {
    await stubWallpapers(page);
    await page.goto('/wallpapers');
    await expect(page.getByText('The Print Room Is Bare')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload wallpapers' })).toHaveCount(0);
    await expect(page.getByLabel('Search by game')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Wallpapers', level: 1 })).toBeVisible();
  });

  test('21. a seeded library draws every plate and counts them in the header', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    expect(await plateCount(page)).toBe(WP_TOTAL);
    await expect(plateOpeners(page)).toHaveCount(WP_TOTAL);
    await expect(plateToggles(page)).toHaveCount(WP_TOTAL);
  });

  test('22. the Aspect narrowing splits wide from portrait', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await page.getByRole('button', { name: /^Aspect/ }).click();
    await page.getByRole('menuitemradio', { name: 'Portrait' }).click();
    await expect(page.getByRole('button', { name: /^Aspect, Portrait/ })).toBeVisible();
    await expect.poll(() => plateCount(page)).toBe(2);       // ar-w3-b + sc-gta-a
    await page.getByRole('button', { name: /^Aspect/ }).click();
    await page.getByRole('menuitemradio', { name: 'Wide' }).click();
    await expect.poll(() => plateCount(page)).toBe(WP_TOTAL - 2);
    await page.getByRole('button', { name: /^Aspect/ }).click();
    await page.getByRole('menuitemradio', { name: 'All sizes' }).click();
    await expect.poll(() => plateCount(page)).toBe(WP_TOTAL);
  });

  test('23. the Type narrowing splits artwork from screenshots', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await page.getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('menuitemradio', { name: 'Artwork' }).click();
    await expect.poll(() => plateCount(page)).toBe(4);       // 2 + 1 lib, 1 similar
    await page.getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('menuitemradio', { name: 'Screens' }).click();
    await expect.poll(() => plateCount(page)).toBe(4);
  });

  test('24. the Source narrowing splits your library from similar games', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await page.getByRole('button', { name: /^Source/ }).click();
    await page.getByRole('menuitemradio', { name: 'Similar' }).click();
    await expect.poll(() => plateCount(page)).toBe(2);
    await page.getByRole('button', { name: /^Source/ }).click();
    await page.getByRole('menuitemradio', { name: 'Library' }).click();
    await expect.poll(() => plateCount(page)).toBe(6);
  });

  test('25. two narrowings compose, and Show All Plates releases both', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await page.getByRole('button', { name: /^Source/ }).click();
    await page.getByRole('menuitemradio', { name: 'Similar' }).click();
    await page.getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('menuitemradio', { name: 'Screens' }).click();
    await expect.poll(() => plateCount(page)).toBe(1);        // sc-sim-a alone
    // Narrow to nothing, then release.
    await page.getByRole('button', { name: /^Aspect/ }).click();
    await page.getByRole('menuitemradio', { name: 'Portrait' }).click();
    await expect(page.getByText('No Plates Match')).toBeVisible();
    await page.getByRole('button', { name: 'Show All Plates' }).click();
    await expect.poll(() => plateCount(page)).toBe(WP_TOTAL);
    await expect(page.getByRole('button', { name: /^Source, / })).toHaveCount(0);
  });

  test('26. search narrows to one game, and clearing it restores the feed', async ({ page, isMobile }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    if (isMobile) await page.getByRole('button', { name: 'Search by game' }).click();
    const input = page.getByRole('textbox', { name: 'Search by game' });
    await input.fill('Grand Theft');
    await expect.poll(() => plateCount(page)).toBe(2);
    // Case-insensitive and partial.
    await input.fill('witcher');
    await expect.poll(() => plateCount(page)).toBe(4);
    if (isMobile) {
      await page.getByRole('button', { name: 'Close search' }).click();
    } else {
      await page.getByRole('button', { name: 'Clear search' }).click();
      await expect(input).toHaveValue('');
    }
    await expect.poll(() => plateCount(page)).toBe(WP_TOTAL);
  });

  test('27. a search that matches nothing offers Show All Plates, and it clears the search', async ({ page, isMobile }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    if (isMobile) await page.getByRole('button', { name: 'Search by game' }).click();
    await page.getByRole('textbox', { name: 'Search by game' }).fill('zzzzzzz-no-such-game');
    await expect(page.getByText('No Plates Match')).toBeVisible();
    const showAll = page.getByRole('button', { name: 'Show All Plates' });
    // A search counts as a narrowing, so the escape is armed rather than inert.
    await expect(showAll).toHaveAttribute('aria-disabled', 'false');
    await showAll.click();
    await expect.poll(() => plateCount(page)).toBe(WP_TOTAL);
    if (!isMobile) {
      await expect(page.getByRole('textbox', { name: 'Search by game' })).toHaveValue('');
    }
  });

  test('28. Reload refetches from IGDB', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    let calls = 0;
    await page.route('**/api/**', async route => { calls++; await route.fallback(); });
    await page.goto('/wallpapers');
    await wpSettled(page);
    const before = calls;
    await page.getByRole('button', { name: 'Reload wallpapers' }).click();
    await expect.poll(() => calls).toBeGreaterThan(before);
    await wpSettled(page);
    expect(await plateCount(page)).toBe(WP_TOTAL);
  });

  test('29. selecting a plate raises the selection bar and persists the register', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    const first = plateToggles(page).first();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await first.click({ force: true });
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    const bar = page.getByRole('region', { name: 'Selection' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 Selected');
    expect(JSON.parse((await ls(page, 'moctale_download_bucket')) || '[]').length).toBe(1);

    // A second plate.
    await plateToggles(page).nth(1).click({ force: true });
    await expect(bar).toContainText('2 Selected');

    // Deselecting the first one takes it back out.
    await plateToggles(page).first().click({ force: true });
    await expect(bar).toContainText('1 Selected');

    // Clear selection empties both the bar and the store.
    await bar.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByRole('region', { name: 'Selection' })).toHaveCount(0);
    expect(JSON.parse((await ls(page, 'moctale_download_bucket')) || '[]').length).toBe(0);
  });

  test('30. FINDING 6 — the plate exposes two buttons with one accessible name', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    // Hold the one toggle: re-resolving `.first()` after the click can land on a
    // different plate once the grid re-renders, which made this case flaky.
    const toggle = plateToggles(page).first();
    await toggle.click({ force: true });
    const name = (await toggle.getAttribute('aria-label'))!;
    // In select mode the full-bleed action button adopts the toggle's own name,
    // so a screen-reader user meets the same control twice — once reporting a
    // pressed state and once not.
    const same = page.getByRole('button', { name, exact: true });
    await expect(same).toHaveCount(2);
    const pressed = await same.evaluateAll(els => els.map(e => e.getAttribute('aria-pressed')));
    expect(pressed.slice().sort()).toEqual([null, 'true']);
  });

  test('31. the register panel opens, its rows open a plate and remove it', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateToggles(page).nth(0).click({ force: true });
    await plateToggles(page).nth(1).click({ force: true });
    await page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('heading', { name: /^Selection — 2$/ })).toBeVisible();

    // A row opens the plate it names.
    await page.getByRole('button', { name: /^Open .* (artwork|screenshot)$/ }).last().click();
    await expect(page.getByRole('dialog', { name: 'Wallpaper preview' })).toBeVisible();
    await page.keyboard.press('Escape');

    // And a row removes itself from the register.
    await page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: /^Remove .* from the selection$/ }).first().click();
    await expect(page.getByRole('heading', { name: /^Selection — 1$/ })).toBeVisible();
    expect(JSON.parse((await ls(page, 'moctale_download_bucket')) || '[]').length).toBe(1);
    await page.getByRole('button', { name: 'Close selection' }).first().click();
    await expect(page.getByRole('heading', { name: /^Selection — 1$/ })).toBeHidden();
  });

  test('32. the register survives a reload', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateToggles(page).nth(0).click({ force: true });
    await expect(page.getByRole('region', { name: 'Selection' })).toContainText('1 Selected');
    await page.reload();
    await wpSettled(page);
    await expect(page.getByRole('region', { name: 'Selection' })).toContainText('1 Selected');
  });

  test('33. downloading the selection reports what it saved', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateToggles(page).nth(0).click({ force: true });
    await plateToggles(page).nth(1).click({ force: true });
    const bar = page.getByRole('region', { name: 'Selection' });
    const dl: unknown[] = [];
    page.on('download', d => { dl.push(d); void d.cancel(); });
    await bar.getByRole('button', { name: /Download 2|^2$/ }).click();
    await expect(page.getByText(/2 downloaded|Nothing to download|opened in a tab/)).toBeVisible({ timeout: 20_000 });
  });

  test('34. the plate menu copies a link, narrows to one game, and queues a game', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateOpeners(page).first().click();
    const viewer = page.getByRole('dialog', { name: 'Wallpaper preview' });
    await expect(viewer).toBeVisible();
    const menu = viewer.getByRole('button', { name: /^More options for / });
    if (await menu.count() === 0) test.skip(true, 'the plate menu lives in the wide viewer only');

    // Copy image link.
    await menu.click();
    await page.getByRole('menuitem', { name: 'Copy image link' }).dispatchEvent('click');
    await expect(page.getByText(/Copied image link|Failed to copy/)).toBeVisible();

    // Select all from game.
    await menu.click();
    await page.getByRole('menuitem', { name: 'Select all from game' }).click();
    expect(JSON.parse((await ls(page, 'moctale_download_bucket')) || '[]').length).toBeGreaterThan(0);

    // Only this game — writes the search box, which narrows the feed behind it.
    await menu.click();
    await page.getByRole('menuitem', { name: 'Only this game' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => plateCount(page)).toBeLessThan(WP_TOTAL);
  });

  test('35. the wide viewer previews on a device frame and opens its details', async ({ page, isMobile }) => {
    test.skip(isMobile, 'device preview and the details pane are the wide viewer only');
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateOpeners(page).first().click();
    const viewer = page.getByRole('dialog', { name: 'Wallpaper preview' });
    for (const label of ['Desktop', 'Mobile', 'Original']) {
      await viewer.getByRole('button', { name: label, exact: true }).click();
      await expect(viewer.getByRole('button', { name: label, exact: true }))
        .toHaveAttribute('aria-pressed', 'true');
    }
    const info = viewer.getByRole('button', { name: 'Plate details' });
    await info.click();
    await expect(info).toHaveAttribute('aria-pressed', 'true');
    await expect(viewer.getByText('Dimensions')).toBeVisible();
    await info.click();
    await expect(info).toHaveAttribute('aria-pressed', 'false');
    await viewer.getByRole('button', { name: 'Close preview' }).click();
    await expect(page.getByRole('dialog', { name: 'Wallpaper preview' })).toHaveCount(0);
  });

  test('36. the viewer filmstrip jumps to the plate it names', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateOpeners(page).first().click();
    const viewer = page.getByRole('dialog', { name: 'Wallpaper preview' });
    const frames = viewer.getByRole('button', { name: /^Plate \d+, / });
    await expect(frames.first()).toBeVisible();
    const target = frames.nth(3);
    const label = await target.getAttribute('aria-label');
    await target.click();
    // The header register index follows the frame that was clicked.
    const idx = label!.match(/Plate (\d+)/)![1];
    await expect(viewer).toContainText(new RegExp(`${idx}\\s*/\\s*${WP_TOTAL}|0*${idx}`));
  });


  test('37. a plate opens the viewer, pages with prev/next, and Escape closes it', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateOpeners(page).first().click();
    const viewer = page.getByRole('dialog', { name: 'Wallpaper preview' });
    await expect(viewer).toBeVisible();
    // Register index 001 on the first plate.
    const nav = viewer.getByRole('button', { name: 'Next wallpaper' });
    if (await nav.count()) {
      await nav.click();
      await expect(viewer).toBeVisible();
      await viewer.getByRole('button', { name: 'Previous wallpaper' }).click();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Wallpaper preview' })).toHaveCount(0);
  });

  test('38. the viewer can select the plate it is showing', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await plateOpeners(page).first().click();
    const viewer = page.getByRole('dialog', { name: 'Wallpaper preview' });
    await viewer.getByRole('button', { name: /^Select .* (artwork|screenshot)$/ }).first().click();
    await expect(viewer.getByRole('button', { name: /^Deselect .* (artwork|screenshot)$/ }).first())
      .toBeVisible();
    expect(JSON.parse((await ls(page, 'moctale_download_bucket')) || '[]').length).toBe(1);
  });

  test('39. an IGDB error object is reported as a failure, not as a filter problem', async ({ page }) => {
    await stubWallpapers(page, 'errorObject');
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await expect(page.getByText('The Presses Stopped')).toBeVisible();
    await expect(page.getByText('No Plates Match')).toHaveCount(0);
  });  test('40. a thrown request is reported honestly, and Try Again recovers', async ({ page }) => {
    await stubWallpapers(page, 'throw');
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await expect(page.getByText('The Presses Stopped')).toBeVisible({ timeout: 20_000 });
    // Repoint the stub at a good payload and retry.
    await page.unroute('**/api/**');
    await stubWallpapers(page, 'ok');
    await page.getByRole('button', { name: 'Try Again' }).click();
    await wpSettled(page);
    expect(await plateCount(page)).toBe(WP_TOTAL);
  });

  test('41. a failed reload clears the stale plates and says what happened', async ({ page }) => {
    await stubWallpapers(page, 'ok');
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    expect(await plateCount(page)).toBe(WP_TOTAL);
    await page.unroute('**/api/**');
    await stubWallpapers(page, 'errorObject');
    await page.getByRole('button', { name: 'Reload wallpapers' }).click();
    await wpSettled(page);
    expect(await plateCount(page)).toBe(0);
    await expect(page.getByText('The Presses Stopped')).toBeVisible();
  });  test('42. an empty IGDB answer IS reported as a press failure', async ({ page }) => {
    await stubWallpapers(page, 'emptyArray');
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await expect(page.getByText('The Presses Stopped')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('43. no horizontal overflow with a full feed', async ({ page }) => {
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('44. no console error across a full wallpapers session', async ({ page }) => {
    const errs = watchConsole(page);
    await stubWallpapers(page);
    await seed(page, { [KEYS.library]: SEED_LIBRARY });
    await page.goto('/wallpapers');
    await wpSettled(page);
    await page.getByRole('button', { name: /^Type/ }).click();
    await page.getByRole('menuitemradio', { name: 'Artwork' }).click();
    await plateToggles(page).first().click({ force: true });
    await page.waitForTimeout(800);
    expect(realErrors(errs)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   /import — the ImportWizard
   ═══════════════════════════════════════════════════════════════════════════
   This is the only surface in the app that writes the whole library at once.
   Nothing here reaches production: signed out, `saveToLibrary` is localStorage
   only, and every IGDB search is stubbed. The tests that DO press "Confirm Save"
   assert the resulting localStorage and then throw the context away.           */
test.describe('/import', () => {
  test.beforeEach(async ({ page }) => { await noFirestore(page); });

  test('45. step 1 renders the upload plate, its spec table and its two entry points', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
    await expect(page.getByText('Step 01 / 04')).toBeVisible();
    await expect(page.getByText('Drop CSV Here')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load Sample CSV' })).toBeVisible();
    await expect(page.getByLabel('Choose a CSV file to import')).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Expected Shape' })).toBeVisible();
    // Step 1 has no Back and no Next: the file is the only way forward.
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  });

  test('46. FINDING 7 — the wizard has no cancel, and no way back to where you came from', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
    // Nothing in the wizard leaves it. Not on step 1 and not later.
    for (const name of [/^Cancel$/i, /^Exit$/i, /^Close$/i, /Back to/i, /Discard/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await upload(page, 'p6-valid.csv');
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Cancel$/i })).toHaveCount(0);
    // The wizard's own "Back" on step 2 goes to step 1, not out of the wizard.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/import');
  });

  test('47. a valid CSV lands on step 2 and the column guesser maps all seven fields', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    await expect(page.getByText('6 Rows · p6-valid.csv')).toBeVisible();
    await expect(page.getByLabel('Source column for Game Name')).toHaveValue('Name');
    await expect(page.getByLabel('Source column for Status')).toHaveValue('Status');
    await expect(page.getByLabel('Source column for Priority')).toHaveValue('Priority');
    await expect(page.getByLabel('Source column for Platform(s)')).toHaveValue('Platform');
    await expect(page.getByLabel('Source column for Completion Date')).toHaveValue('Date Completed');
    await expect(page.getByLabel('Source column for Notes')).toHaveValue('Notes');
    // The select's value is the CSV header, which the fixture names 'Rating'.
    await expect(page.getByLabel('Source column for Rating (Feel)')).toHaveValue('Rating');
    await expect(page.getByText('7 / 7 Mapped')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ignored Columns' })).toHaveCount(0);
  });

  test('48. remapping a column moves it out of Ignored and updates the sample', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    const rating = page.getByLabel('Source column for Rating (Feel)');
    await rating.selectOption('Rating');
    await expect(rating).toHaveValue('Rating');
    await expect(page.getByText('7 / 7 Mapped')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ignored Columns' })).toHaveCount(0);
    // The sample is the first non-empty cell of the chosen column.
    await expect(page.getByTitle('10/10')).toBeVisible();
    // And unmapping it puts it back.
    await rating.selectOption('');
    await expect(page.getByRole('heading', { name: 'Ignored Columns' })).toBeVisible();
  });

  test('49. Continue is inert until a Game Name column is chosen', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    const next = page.getByRole('button', { name: 'Continue' });
    await expect(next).toBeEnabled();
    await page.getByLabel('Source column for Game Name').selectOption('');
    await expect(next).toBeDisabled();
    await expect(page.getByText('Required').first()).toBeVisible();
    await page.getByLabel('Source column for Game Name').selectOption('Notes');
    await expect(next).toBeEnabled();
  });

  test('50. step 3 lists every distinct CSV value with its row count and auto-maps what it can', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByLabel('Source column for Rating (Feel)').selectOption('Rating');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Mapping', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CSV Value → Status' })).toBeVisible();

    // Six statuses in the file, five of which auto-map.
    await expect(page.getByRole('button', { name: '→ Backlog: Beaten' })).toBeVisible();   // "Completed"
    await expect(page.getByRole('button', { name: '→ Backlog: Playing' })).toBeVisible();
    await expect(page.getByRole('button', { name: '→ Backlog: not set' })).toBeVisible();  // "Shelved Forever"
    await expect(page.getByText('5 / 6 Resolved')).toBeVisible();
    await expect(page.getByText('"Shelved Forever"')).toBeVisible();
    await expect(page.getByText('Unresolved values fall back to Backlog')).toBeVisible();

    // The tab strip flags the unresolved count per category.
    await expect(page.getByRole('button', { name: /^Status 1!$/ })).toBeVisible();
  });

  test('51. resolving a value by hand clears the unresolved flag', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await openMapRow(page, '→ Backlog: not set');
    await pickMenu(page, 'Unreleased');
    await expect(page.getByRole('button', { name: '→ Backlog: Unreleased' })).toBeVisible();
    await expect(page.getByText('6 / 6 Resolved')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Status 6$/ })).toBeVisible();
    // And unsetting it again puts the flag back.
    await openMapRow(page, '→ Backlog: Unreleased');
    await page.getByRole('menuitemradio', { name: '→ Backlog', exact: true }).dispatchEvent('click');
    await expect(page.getByText('5 / 6 Resolved')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Status 1!$/ })).toBeVisible();
  });

  test('52. the four mapping tabs each swap the panel', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByLabel('Source column for Rating (Feel)').selectOption('Rating');
    await page.getByRole('button', { name: 'Continue' }).click();
    for (const [tab, heading] of [
      ['Priority', 'CSV Value → Priority'],
      ['Rating', 'CSV Value → Rating'],
      ['Platforms', 'CSV Value → Platform'],
      ['Status', 'CSV Value → Status'],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`^${tab} `) }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('53. a platform row searches, maps, and can be unmapped again', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /^Platforms / }).click();
    await expect(page.getByRole('heading', { name: 'CSV Value → Platform' })).toBeVisible();

    // "Neo Geo Pocket Colour" is the one platform nothing local matches.
    const field = page.locator('input[placeholder="Search \\"Neo Geo Pocket Colour\\""]');
    await expect(field).toBeVisible();
    await field.fill('PlayStation');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await listbox.getByRole('option').first().dispatchEvent('mousedown');
    const remove = page.getByRole('button', { name: 'Remove mapping' });
    await expect(remove.first()).toBeVisible();
    const before = await remove.count();
    await remove.first().click();
    await expect(remove).toHaveCount(before - 1);
  });

  test('54. a platform row can be saved as a custom subscription', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /^Platforms / }).click();
    const field = page.locator('input[placeholder="Search \\"Neo Geo Pocket Colour\\""]');
    await field.click();
    await field.fill('Neo');
    await expect(page.getByText('Save as Custom')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Sub', exact: true }).click();
    await expect(page.locator('input[placeholder="Search \\"Neo Geo Pocket Colour\\""]')).toHaveCount(0);
  });

  test('55. step 3 writes nothing to the profile until the import is confirmed', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Mapping', level: 1 })).toBeVisible();
    // Before: nothing written.
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').custom_platforms ?? []).toEqual([]);

    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();

    // Reaching the review step writes nothing: the profile is untouched until
    // Confirm Save, which is what the manifest dialog is for.
    await expect(page.getByText(/\d+ Matched/)).toBeVisible({ timeout: 30_000 });
    expect(JSON.parse((await ls(page, KEYS.profile)) || '{}').custom_platforms ?? []).toEqual([]);
  });

  test('56. the fetch produces one review row per named CSV row', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('6 / 6 To Import')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Import / })).toHaveCount(6);
    // IGDB renamed nothing, so the sub-line shows year and type.
    await expect(page.getByText('2015 · Main Game').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save 6 Games$/ })).toBeVisible();
  });

  test('57. a row checkbox, the tri-state select-all and the type filter all move the count', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });

    const rows = page.getByRole('checkbox', { name: /^Import / });
    await toggleCb(rows.first());
    await expect(page.getByText('5 / 6 To Import')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save 5 Games$/ })).toBeVisible();
    await expect(page.getByText('Skip', { exact: true })).toBeVisible();

    // Select-all is indeterminate while some are on, and clears/fills everything.
    const all = page.getByRole('checkbox').first();
    expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
    await toggleCb(all);
    await expect(page.getByText('6 / 6 To Import')).toBeVisible();
    await toggleCb(all);
    await expect(page.getByText('0 / 6 To Import')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeVisible();
  });

  test('58. editing a row opens the matcher, and Use CSV Data Only makes it a custom entry', async ({ page, isMobile }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });

    if (!isMobile) await expect(page.getByText('No Row Selected')).toBeVisible();
    await page.getByRole('button', { name: /Half-Life 2/ }).first().click();
    await expect(page.getByText('Editing CSV Row')).toBeVisible();

    // The stub returns a base row and a "Definitive Edition"; picking the second
    // one renames the review row and marks it as renamed against the CSV.
    await page.getByRole('button', { name: /Definitive Edition/ }).first().click();
    await expect(page.getByText('CSV: Half-Life 2').first()).toBeVisible();

    // Use CSV Data Only drops the IGDB link entirely.
    await page.getByRole('button', { name: /Use CSV Data Only/ }).click();
    await expect(page.getByText('Custom', { exact: true }).first()).toBeVisible();

    // And the sidebar closes.
    await page.getByTitle('Close').click();
    if (isMobile) await expect(page.getByText('Editing CSV Row')).toBeHidden();
    else await expect(page.getByText('No Row Selected')).toBeVisible();
  });

  test('59. the per-row manual search replaces the guess', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Fortnite/ }).first().click();
    const box = page.getByRole('textbox', { name: 'Search IGDB' });
    // Pre-filled with the CSV name, which is the whole point of the control.
    await expect(box).toHaveValue('Fortnite');
    await box.fill('Something Else Entirely');
    await box.press('Enter');
    await expect(page.getByText('CSV: Fortnite').first()).toBeVisible({ timeout: 15_000 });
  });

  test('60. a row that IGDB cannot match falls through to a custom entry with No Match', async ({ page }) => {
    await stubImportSearch(page, { empty: ['A Game That Does Not Exist Anywhere'] });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No Match', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /A Game That Does Not Exist Anywhere/ }).first().click();
    await expect(page.getByText('No IGDB results — search above or keep as custom')).toBeVisible();
  });

  test('61. a row already in the library is flagged as a conflict and can be bulk-deselected', async ({ page }) => {
    await stubImportSearch(page);
    // Seed the library with the exact id the stub will return for Fortnite.
    await seed(page, {
      [KEYS.library]: [{ id: importId('Fortnite'), name: 'Fortnite', status: 'Beaten',
        is_custom: false, notes: 'A note the import must not silently destroy' }],
    });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('button', { name: '1 Conflict', exact: true })).toBeVisible();
    await expect(page.getByText('Overwrite', { exact: true })).toBeVisible();
    // The conflicts filter narrows to just it.
    await page.getByRole('button', { name: '1 Conflict', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^Import / })).toHaveCount(1);
    await page.getByRole('button', { name: '1 Conflict', exact: true }).click();

    // Deselect Conflicts is the documented way to keep what you have.
    await page.getByRole('button', { name: 'Deselect Conflicts' }).click();
    await expect(page.getByText('5 / 6 To Import')).toBeVisible();
  });

  test('62. FINDING 10 — a selected conflict overwrites even though its resolution says skip', async ({ page }) => {
    await stubImportSearch(page);
    const existing = { id: importId('Fortnite'), name: 'Fortnite', status: 'Beaten',
      is_custom: false, feel: 'Perfection', notes: 'A note the import must not silently destroy' };
    await seed(page, { [KEYS.library]: [existing] });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });

    // The conflict row's resolutionAction is 'skip' — set by the wizard itself
    // and never changeable, because StepReview never destructures the props that
    // would change it. Leave the row selected and save.
    await expect(page.getByRole('button', { name: '1 Conflict', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    const manifest = page.getByRole('dialog');
    await expect(manifest).toContainText('1 will overwrite an existing entry');
    await manifest.getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);

    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    const row = lib.find((g: { id: number }) => g.id === existing.id);
    expect(row).toBeTruthy();
    // The Beaten status, the Perfection rating and the note are all gone,
    // replaced by the CSV's Backlog row.
    expect(row.status).toBe('Backlog');
    expect(row.feel ?? null).toBeNull();
    expect(row.notes).not.toBe(existing.notes);
  });

  test('63. Back to Review and Escape both cancel the save and write nothing', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(0);

    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    const manifest = page.getByRole('dialog');
    await expect(manifest).toBeVisible();
    await expect(manifest).toContainText('Games Written');
    await expect(manifest).toContainText('IGDB Linked');
    await manifest.getByRole('button', { name: 'Back to Review' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(0);
    await expect(page).toHaveURL(/\/import$/);

    // Escape is the other way out, and it writes nothing either.
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(0);
  });

  test('64. a confirmed save writes every selected row and lands on the library', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByLabel('Source column for Rating (Feel)').selectOption('Rating');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await toggleCb(page.getByRole('checkbox', { name: 'Import Fortnite' }));
    await page.getByRole('button', { name: /^Save 5 Games$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);

    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    expect(lib.length).toBe(5);
    const witcher = lib.find((g: { id: number }) => g.id === importId('The Witcher 3: Wild Hunt'));
    expect(witcher.status).toBe('Beaten');
    expect(witcher.feel).toBe('Perfection');       // "10/10" -> Perfection
    expect(witcher.priority).toBe('Next Up');      // "High"  -> Next Up
    expect(witcher.notes).toBe('Seeded by phase 6 fixture');
    expect(witcher.user_platforms.map((p: { name: string }) => p.name)).toContain('Steam');
  });

  test('65. FINDING 11 — an unmapped priority is written verbatim as a priority the app cannot produce', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    // "Whenever" auto-maps to nothing; the step's own footnote says it is kept verbatim.
    await page.getByRole('button', { name: /^Priority / }).click();
    await expect(page.getByText('Unresolved values are kept verbatim from the CSV')).toBeVisible();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);

    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    const odd = lib.find((g: { id: number }) => g.id === importId('A Game That Does Not Exist Anywhere'));
    // Not one of the four the app defines, so no dial can select it and no
    // Priority grouping can name it.
    expect(odd.priority).toBe('Eventually');
    expect(['Someday', 'Maybe', 'Soon', 'Next Up']).not.toContain(odd.priority);
  });

  test('66. an unreadable CSV completion date is not written at all', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);

    const oddId = importId('A Game That Does Not Exist Anywhere');
    /* 32/13/2024 is not a date. The wizard used to write it verbatim and the next
       read deleted it; it normalises at the write now, so nothing unreadable
       reaches storage. The row that did carry a real date keeps it. */
    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    expect(lib.find((g: { id: number }) => g.id === oddId).dateCompleted).toBeNull();
    const goodId = importId('The Witcher 3: Wild Hunt');
    expect(lib.find((g: { id: number }) => g.id === goodId).dateCompleted).toBe('2024-03-14');
  });

  test('67. Stop Fetching: Cancel resumes, and confirming halts and keeps what arrived', async ({ page }) => {
    // Slow the search so the fetch is still running when the abort is pressed.
    await seedCreds(page);
    await page.route('**/api/**', async route => {
      const m = (route.request().postData() || '').match(/search "([^"]*)"/);
      await new Promise(r => setTimeout(r, 700));
      if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{ id: importId(m[1]), name: m[1], game_type: 0 }]) });
    });
    await page.goto('/import');
    await upload(page, 'p6-large.csv');
    await expect(page.getByText('2000 Rows · p6-large.csv')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('Fetching', { exact: true })).toBeVisible();
    // Let a few rows land, or there is nothing for the abort to keep.
    await expect(page.getByRole('checkbox', { name: /^Import / }).nth(2))
      .toBeAttached({ timeout: 30_000 });

    // While fetching, Back and the step chips are all inert.
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(chip(page, '01', 'Upload')).toBeDisabled();

    // Cancel keeps it going.
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Stop Fetching?');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Fetching', { exact: true })).toBeVisible();

    // Confirming halts it and keeps the rows already fetched.
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop Fetching' }).click();
    await expect(page.getByText(/\d+ Matched/)).toBeVisible({ timeout: 20_000 });
    const matched = Number((await page.getByText(/\d+ Matched/).innerText()).match(/\d+/)![0]);
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(2000);
    await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  test('68. FINDING 13 — leaving the wizard mid-fetch does not stop the fetch', async ({ page }) => {
    await seedCreds(page);
    let calls = 0;
    await page.route('**/api/**', async route => {
      const m = (route.request().postData() || '').match(/search "([^"]*)"/);
      if (m) calls++;
      if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{ id: importId(m[1]), name: m[1], game_type: 0 }]) });
    });
    await page.goto('/import');
    await upload(page, 'p6-large.csv');
    await expect(page.getByText('2000 Rows · p6-large.csv')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('Fetching', { exact: true })).toBeVisible();
    await page.waitForTimeout(1000);

    // Leave inside the SPA — no unload, so the loop keeps its closure.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/profile');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: /My Profile|Add a name/ })).toBeVisible({ timeout: 15_000 });
    const atLeave = calls;
    await page.waitForTimeout(2500);
    // The abandoned import is still querying IGDB from a page nobody is on.
    expect(calls).toBeGreaterThan(atLeave);
  });

  test('69. a headers-only CSV walks the whole wizard and produces an empty, harmless import', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-headers-only.csv');
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    await expect(page.getByText('0 Rows · p6-headers-only.csv')).toBeVisible();
    await expect(page.getByLabel('Source column for Game Name')).toHaveValue('Name');
    await expect(page.getByText('Column is empty').first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Nothing to translate, because no row carried a value.
    await expect(page.getByText('Nothing to Translate')).toBeVisible();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    // A header-only file has no rows at all, which is not the same as a filter hiding them.
    await expect(page.getByText('No Rows To Review')).toBeVisible();
    await expect(page.getByText('0 Matched')).toBeVisible();
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Games Written');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);
    expect(JSON.parse((await ls(page, KEYS.library)) || '[]').length).toBe(0);
  });

  test('70. FINDING 14 — a zero-byte CSV is accepted and lands on an unusable step 2', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-empty.csv');
    // The wizard advances rather than refusing the file.
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    await expect(page.getByText('0 Rows · p6-empty.csv')).toBeVisible();
    await expect(page.getByText('0 / 7 Mapped')).toBeVisible();
    // Every column select holds exactly one option: "— Unmapped —".
    const opts = await page.getByLabel('Source column for Game Name')
      .locator('option').allInnerTexts();
    expect(opts).toEqual(['— Unmapped —']);
    // So Continue can never be satisfied, and step 1 is the only way out.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByText('Required')).toBeVisible();
  });

  test('71. FINDING 15 — a malformed CSV is imported silently, ragged rows and all', async ({ page }) => {
    const errs = watchConsole(page);
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-malformed.csv');
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    // papaparse reports FieldMismatch errors for the ragged rows. The wizard
    // reads results.data and results.meta only — results.errors is never looked
    // at, so nothing on screen says the file was broken.
    await expect(page.getByText(/failed to parse|parse error|is malformed|not a valid/i))
      .toHaveCount(0);
    // Six data lines in, ONE row out — the unterminated quote on line 2 swallowed
    // the whole rest of the file into a single cell, and the header reports it as
    // a perfectly ordinary "1 Rows".
    await expect(page.getByText('1 Rows · p6-malformed.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('1 Matched')).toBeVisible({ timeout: 30_000 });

    // That one row's game name is five lines of raw CSV, offered for saving.
    const names = await page.getByRole('checkbox', { name: /^Import / })
      .evaluateAll(els => els.map(e => e.getAttribute('aria-label')!.replace(/^Import /, '')));
    expect(names).toHaveLength(1);
    expect(names[0].split('\n').length).toBeGreaterThan(4);
    await expect(page.getByRole('button', { name: /^Save 1 Games$/ })).toBeVisible();
    expect(realErrors(errs)).toEqual([]);   // not even a console warning
  });

  test('72. a non-CSV file is refused with a toast, not a native alert', async ({ page }) => {
    await stubImportSearch(page);
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(`${d.type()}: ${d.message()}`); void d.dismiss(); });
    await page.goto('/import');
    await expect(page.getByText('Drop CSV Here')).toBeVisible();
    await page.setInputFiles('#csv-file-input', csv('p6-notcsv.txt'));
    // Two polite live regions exist (the toast host and the page announcer), so
    // target the toast by its text.
    await expect(page.getByText('That file is not a CSV. Export as CSV and try again.')).toBeVisible();
    expect(dialogs).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
    await expect(page.getByText('Drop CSV Here')).toBeVisible();
  });

  test('73. a 2000-row CSV parses, counts and maps without stalling the page', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-large.csv');
    await expect(page.getByText('2000 Rows · p6-large.csv')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'CSV Value → Status' })).toBeVisible();
    // One distinct value covering every row — the count is what makes the
    // decision legible at this size.
    await expect(page.getByText('2000 Rows', { exact: true })).toBeVisible();
    await expect(page.getByText('1 / 1 Resolved')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Platforms 1$/ })).toBeVisible();
  });

  test('74. the skipped-row counter resets between fetches', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-noname.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText(/\d+ Matched/)).toBeVisible({ timeout: 30_000 });
    const n1 = Number((await page.getByText(/\d+ Skipped/).innerText()).match(/\d+/)[0]);
    expect(n1).toBeGreaterThan(0);

    // Go back a step and fetch again. Both counts reset with the fetch.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText(/\d+ Matched/)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () =>
      Number((await page.getByText(/\d+ Skipped/).innerText()).match(/\d+/)![0]),
    { timeout: 15_000 }).toBe(n1);
  });

  test('75. the review index keeps the CSV row number under a filter', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the row number is hidden below sm; the phone never shows it');
    await stubImportSearch(page);
    await seed(page, {
      [KEYS.library]: [{ id: importId('Fortnite'), name: 'Fortnite', status: 'Beaten', is_custom: false }],
    });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    // Fortnite is row 3 of 6 unfiltered.
    await expect(page.getByText('003')).toBeVisible();
    await page.getByRole('button', { name: '1 Conflict', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^Import / })).toHaveCount(1);
    // Under the filter the row keeps the number of the CSV row it came from.
    await expect(page.getByText('003')).toBeVisible();
    await expect(page.getByText('001')).toHaveCount(0);
  });

  test('75b. the conflict chip and the manifest pluralise, and the sidebar plate balances', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the sidebar plate is desktop-only');
    await stubImportSearch(page);
    await seed(page, {
      [KEYS.library]: [{ id: importId('Fortnite'), name: 'Fortnite', status: 'Beaten', is_custom: false }],
    });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '1 Conflict', exact: true })).toBeVisible();
    await expect(page.getByText('Click any title to change its IGDB match')).toHaveClass(/max-w-\[46ch\]/);
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    await expect(page.getByRole('dialog')).toContainText('1 will overwrite an existing entry');
  });

  test('76. FINDING 19 — Load Sample CSV leaves the wizard unable to say what it is holding', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await page.getByRole('button', { name: 'Load Sample CSV' }).click();
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible({ timeout: 20_000 });
    // The sample path never sets fileName, so the header that names what you
    // are holding carries only a row count, and stepping back shows an empty
    // drop zone although a file IS loaded.
    await expect(page.getByText(/Rows · /)).toHaveCount(0);
    await expect(page.getByText(/^\d+ Rows$/)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Drop CSV Here')).toBeVisible();
  });

  test('77. FINDING 20 — stepping back to Schema silently discards every value mapping', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByLabel('Source column for Rating (Feel)').selectOption('Rating');
    await page.getByRole('button', { name: 'Continue' }).click();
    await openMapRow(page, '→ Backlog: not set');
    await pickMenu(page, 'Unreleased');
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });

    // Chip back to step 2. The column choices survive, as they should.
    await chip(page, '02', 'Schema').click();
    await expect(page.getByLabel('Source column for Rating (Feel)')).toHaveValue('Rating');
    // Chips for steps you have not reached are inert, so Continue is the ONLY
    // way forward from here.
    await expect(chip(page, '04', 'Review')).toBeDisabled();
    await expect(chip(page, '03', 'Mapping')).toBeDisabled();

    await page.getByRole('button', { name: 'Continue' }).click();
    // The hand-made mapping is gone: proceedToValueMapping rebuilds the maps
    // from the auto-mapper on every pass, so "Shelved Forever" is unresolved
    // again and the tab strip is back to flagging it.
    await expect(page.getByRole('button', { name: '→ Backlog: Unreleased' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '→ Backlog: not set' })).toBeVisible();
    await expect(page.getByText('5 / 6 Resolved')).toBeVisible();
  });

  test('77b. FINDING 21 — one malformed IGDB row strands the wizard in Fetching forever', async ({ page }) => {
    await seedCreds(page);
    // Row 3 comes back without a name. searchGames only filters on `id`, and
    // ImportWizard:334 then calls r.name.toLowerCase() on it.
    await page.route('**/api/**', async route => {
      const m = (route.request().postData() || '').match(/search "([^"]*)"/);
      if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      const body = m[1] === 'Fortnite'
        ? [{ id: 424242, game_type: 0 }]                       // no name field
        : [{ id: importId(m[1]), name: m[1], game_type: 0 }];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();

    // The first two rows arrive; the third throws and the loop dies where it stands.
    await expect(page.getByRole('checkbox', { name: /^Import / })).toHaveCount(2, { timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByRole('checkbox', { name: /^Import / })).toHaveCount(2);

    // isFetchingApi is never cleared, so every exit stays shut: Back disabled,
    // all four step chips disabled, and no Save button at all. The only control
    // left is Stop, which sets the abort flag for a loop that is already dead.
    await expect(page.getByText('Fetching', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
    for (const [num, label] of [['01', 'Upload'], ['02', 'Schema'], ['03', 'Mapping'], ['04', 'Review']]) {
      await expect(chip(page, num, label)).toBeDisabled();
    }
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop Fetching' }).click();
    await expect(page.getByText('Fetching', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  test('77c. a whitespace-only name is skipped like an empty one', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-noname.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('3 Matched')).toBeVisible({ timeout: 30_000 });
    // Five CSV rows: the empty name and the three-space name are both skipped.
    await expect(page.getByText('2 Skipped · No Name')).toBeVisible();
    const named = await page.getByRole('checkbox', { name: /^Import ./ }).count();
    expect(named).toBe(3);
    // No nameless row: every Import checkbox names its game.
    await expect(page.getByRole('checkbox', { name: 'Import', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(4);   // 3 rows + select-all

    await page.getByRole('button', { name: /^Save 3 Games$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);
    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    expect(lib.length).toBe(3);
    // A matched row is stored by id (its name is resolved from IGDB later), so
    // the proof is that every saved id derives from a NAMED row and nothing else.
    const wantIds = ['Named Row One', 'Named Row Two', 'Named Row Three'].map(importId).sort();
    expect(lib.map((g: { id: number }) => g.id).sort()).toEqual(wantIds);
  });

  test('77d. FINDING 23 — two CSV rows for one game are both counted and only one is written', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-dupes.csv');
    await expect(page.getByText('3 Rows · p6-dupes.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('3 Matched')).toBeVisible({ timeout: 30_000 });

    // Both duplicate rows resolve to the same IGDB id. Neither is flagged as a
    // conflict, because `conflict` is only checked against the EXISTING library.
    await expect(page.getByRole('button', { name: /Conflicts/ })).toHaveCount(0);
    await expect(page.getByText('3 / 3 To Import')).toBeVisible();

    await page.getByRole('button', { name: /^Save 3 Games$/ }).click();
    const manifest = page.getByRole('dialog');
    // The manifest promises three.
    await expect(manifest.getByText('3', { exact: true }).first()).toBeVisible();
    await expect(manifest).toContainText('Games Written');
    await manifest.getByRole('button', { name: 'Confirm Save' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);

    // Two arrive. The second write silently replaced the first, so the status
    // that survives is whichever row came last in the CSV, with no warning.
    const lib = JSON.parse((await ls(page, KEYS.library)) || '[]');
    expect(lib.length).toBe(2);
    const dupe = lib.find((g: { id: number }) => g.id === importId('Duplicate Fixture Game'));
    expect(dupe.status).toBe('Beaten');
  });

  test('78. no console error across a full valid import', async ({ page }) => {
    const errs = watchConsole(page);
    await stubImportSearch(page);
    await page.goto('/import');
    await upload(page, 'p6-valid.csv');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Save 6 Games$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Back to Review' }).click();
    await page.waitForTimeout(800);
    expect(realErrors(errs)).toEqual([]);
  });

  test('79. no horizontal overflow on any of the four steps', async ({ page }) => {
    await stubImportSearch(page);
    await page.goto('/import');
    const overflow = () => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await expect(page.getByText('Drop CSV Here')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await upload(page, 'p6-valid.csv');
    await expect(page.getByRole('heading', { name: 'Schema', level: 1 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Mapping', level: 1 })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Fetch IGDB' }).click();
    await expect(page.getByText('6 Matched')).toBeVisible({ timeout: 30_000 });
    expect(await overflow()).toBeLessThanOrEqual(1);
  });
});
