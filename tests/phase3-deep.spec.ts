/**
 * Deep QA — phase 3 of the qa/2026-09-05-deep run.
 * Routes under test: /game/:id (GameDetail), / (Discover), /explore/:section,
 * /feedback, and the PickNext dialog reached from /library.
 *
 * Every test DRIVES a control and asserts the state it changed. A test that
 * only asserts a route renders belongs in tests/routes.spec.ts, not here.
 *
 * Eleven cases assert the WRONG behaviour on purpose, each marked `FINDING n`.
 * (The numbers run 1-12 with no 6: that case turned out to be correct behaviour
 * and was rewritten as an ordinary test rather than renumbering the rest.)
 * They are pinned so the suite stays green and the defect cannot be quietly
 * lost between this run and the fix phase. Every one is written up in
 * qa/2026-09-05-deep/phase3.md, which RANKS them by severity — so the numbers
 * here (discovery order) and the numbers there (severity order) differ, and
 * phase3.md carries the mapping table.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { seed, KEYS, KNOWN_NOISE, realErrors } from './fixtures';
import { offlineIgdb } from './igdb-stub';

/* GameDetail's Awards section asks Wikidata about every game, and no seed or
   corpus answers it. An empty result rather than no answer: an unanswered query
   is retried three times with backoff, which every game page sat through. */
async function noAwards(page: Page) {
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
}

/* ── Console watch (same contract as phase 2) ────────────────────────────── */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/* ── Stubbed IGDB ─────────────────────────────────────────────────────────
   GameDetail is the only screen in the app that cannot be driven from
   localStorage: `getGameById` is a live POST to /api/games. Stubbing it is what
   makes a status change, a rating, a note and a removal deterministic — and it
   keeps forty mutation cases off IGDB's 4 req/s budget. The credential pair is
   seeded raw (not JSON) because igdb.js reads them with a bare getItem. */
async function stubIgdb(page: Page, games: Record<string, unknown>[]) {
  await noAwards(page);
  await page.addInitScript(() => {
    localStorage.setItem('igdb_client_id', 'qa-phase3-stub');
    localStorage.setItem('igdb_access_token', 'qa-phase3-token');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const body = route.request().postData() || '';
    if (url.pathname === '/api/games') {
      const m = body.match(/where id = (\d+)/);
      if (m) {
        const g = games.find(x => String((x as { id: unknown }).id) === m[1]);
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(g ? [g] : []),
        });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/** A released game carrying every field GameDetail can render. */
const GAME_FULL = {
  id: 5551,
  name: 'Stub Complete Edition',
  summary: 'A stub summary long enough to occupy the Overview section of the page.',
  first_release_date: 1431993600,                    // 2015-05-19
  total_rating: 88.4,
  total_rating_count: 4200,
  cover: { image_id: 'co1wyy', width: 264, height: 374 },
  genres: [{ id: 12, name: 'Role-playing (RPG)' }, { id: 31, name: 'Adventure' }],
  themes: [{ id: 17, name: 'Fantasy' }],
  platforms: [
    { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
    { id: 48, name: 'PlayStation 4', abbreviation: 'PS4' },
  ],
  game_modes: [{ id: 1, name: 'Single player' }],
  game_engines: [{ id: 4, name: 'REDengine 3' }],
  involved_companies: [
    { company: { id: 908, name: 'Stub Studio' }, developer: true, publisher: false },
    { company: { id: 909, name: 'Stub Publishing' }, developer: false, publisher: true },
  ],
  screenshots: [
    { image_id: 'scq1', width: 1920, height: 1080 },
    { image_id: 'scq2', width: 1920, height: 1080 },
    { image_id: 'scq3', width: 1920, height: 1080 },
  ],
  artworks: [{ image_id: 'arq1', width: 1920, height: 1080, alpha_channel: false, artwork_type: 1 }],
  videos: [{ name: 'Stub Trailer', video_id: 'aqz-KE-bpKQ' }],
  franchises: [], collections: [],
};

/** Everything absent except id and name — the partial-metadata case. */
const GAME_BARE = { id: 5552, name: 'Bare Stub Entry' };

/** A released game whose cover id resolves to a 404 on the IGDB CDN. */
const GAME_BROKEN_IMG = {
  id: 5553,
  name: 'Broken Cover Stub',
  first_release_date: 1431993600,
  cover: { image_id: 'zzz_no_such_image_id', width: 264, height: 374 },
  screenshots: [{ image_id: 'zzz_no_such_shot', width: 1920, height: 1080 }],
};

/** Title long enough to test the h1's wrapping and the confirm dialog's copy. */
const LONG_NAME =
  'The Interminable Saga of a Title That Simply Will Not Stop: Director’s ' +
  'Definitive Remastered Anniversary Ultimate Game of the Year Edition Part Two';
const GAME_LONG = { id: 5554, name: LONG_NAME, first_release_date: 1431993600 };

const STUBS = [GAME_FULL, GAME_BARE, GAME_BROKEN_IMG, GAME_LONG];

/** GameDetail is done when the skeleton is gone and the h1 is the game name. */
async function detailReady(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20000 });
}

/** The status/priority/rating controls exist twice — a desktop rail (StateRow)
    and a mobile strip (StripCell). Both carry the same accessible name, so a
    role+name query matches two nodes at every width and only one is visible. */
function stateControl(page: Page, group: 'status' | 'priority' | 'rating', label: string) {
  return page.locator(`button[aria-label="Set ${group} to ${label}"]:visible`).first();
}
/** Once a status row is active its accessible name changes to the remove form. */
function activeStatus(page: Page, label: string) {
  return page.locator(`button[aria-label^="${label} — remove"]:visible`).first();
}
/** Priority and rating rows do the same, in the clear form. */
function activeState(page: Page, group: 'priority' | 'rating', label: string) {
  return page.locator(`button[aria-label="${label} — clear ${group} for ${'${'}''}"]:visible`).first();
}

async function libRow(page: Page, id: string | number) {
  return page.evaluate((gid) => {
    const raw = JSON.parse(localStorage.getItem('moctale_library') || '[]');
    return raw.find((g: { id: unknown }) => String(g.id) === String(gid)) || null;
  }, id);
}

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — entry points
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — entry points', () => {
  test('a library card opens the detail page for that game', async ({ page }) => {
    const errs = watchConsole(page);
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, {
      [KEYS.library]: [
        { id: 900101, name: 'Entry Point One', status: 'Backlog', is_custom: false, release_year: 2020, cover_id: null },
      ],
    });
    await page.goto('/library/backlog');
    const card = page.locator('.game-grid [role="link"]').first();
    await expect(card).toHaveAttribute('aria-label', 'Entry Point One');
    await card.click();
    await expect(page).toHaveURL(/\/game\/900101$/);
    expect(realErrors(errs)).toEqual([]);
  });

  test('a Discover card opens the detail page and Back returns to Discover', async ({ page }) => {
    await offlineIgdb(page);
    await page.goto('/');
    const card = page.locator('.game-grid [role="link"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const name = await card.getAttribute('aria-label');
    await card.click();
    await expect(page).toHaveURL(/\/game\/\d+/);
    await detailReady(page, name!);
    await page.getByRole('button', { name: 'Go back to previous page' }).click();
    await expect(page).toHaveURL(/localhost:5173\/$/);
  });

  test('an Index taxonomy link leaves the detail page for its category', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await page.getByRole('link', { name: 'Role-playing (RPG)' }).click();
    await expect(page).toHaveURL(/\/games\/genre\/12/);
  });

  test('the Developer link goes to that company category', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await page.getByRole('link', { name: 'Stub Studio' }).click();
    await expect(page).toHaveURL(/\/games\/company\/908/);
  });

  test('every Index row renders its value or is absent — none renders empty', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    const index = page.locator('section:has(h2:text-is("Index"))');
    await expect(index.getByText('19 May 2015'.replace('19 May 2015', 'May 19, 2015'))).toBeVisible();
    await expect(index.getByRole('link', { name: 'Stub Publishing' })).toBeVisible();
    await expect(index.getByRole('link', { name: 'PC' })).toBeVisible();
    await expect(index.getByRole('link', { name: 'Single player' })).toBeVisible();
    await expect(index.getByRole('link', { name: 'REDengine 3' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — status, priority, rating
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — library state controls', () => {
  test.beforeEach(async ({ page }) => {
    await stubIgdb(page, STUBS);
  });

  test('each of the five status rows writes that status and relabels itself', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');

    for (const status of ['Playing', 'Backlog', 'Wishlist', 'Dropped']) {
      await stateControl(page, 'status', status).click();
      await expect(page.getByText(`Moved to ${status}`)).toBeVisible();
      expect((await libRow(page, 5551) as { status: string }).status).toBe(status);
      await expect(activeStatus(page, status)).toHaveAttribute('aria-pressed', 'true');
    }
    // Beaten last: it swaps the whole rail (priority out, rating + date in).
    await stateControl(page, 'status', 'Beaten').click();
    expect((await libRow(page, 5551) as { status: string }).status).toBe('Beaten');
    expect(realErrors(errs)).toEqual([]);
  });

  test('re-clicking the active status opens the remove confirm, and Cancel keeps the row', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Playing').click();
    await expect(activeStatus(page, 'Playing')).toBeVisible();

    await activeStatus(page, 'Playing').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Remove Stub Complete Edition?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect((await libRow(page, 5551) as { status: string }).status).toBe('Playing');
  });

  test('confirming the remove deletes the row and the rail loses Priority', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Playing').click();
    await expect(stateControl(page, 'priority', 'Next Up')).toBeVisible();

    await activeStatus(page, 'Playing').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Removed from library')).toBeVisible();
    expect(await libRow(page, 5551)).toBeNull();
    await expect(stateControl(page, 'priority', 'Next Up')).toHaveCount(0);
  });

  test('each priority sets, and a second click on the same one clears it', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();

    for (const p of ['Next Up', 'Soon', 'Maybe', 'Someday']) {
      await stateControl(page, 'priority', p).click();
      await expect(page.getByText(`Priority: ${p}`)).toBeVisible();
      expect((await libRow(page, 5551) as { priority: string }).priority).toBe(p);
    }
    // The active row is named for what a click now does, so it is a different locator.
    await page.locator('button[aria-label^="Someday — clear priority"]:visible').first().click();
    await expect(page.getByText('Priority cleared')).toBeVisible();
    expect((await libRow(page, 5551) as { priority: string | null }).priority).toBeNull();
  });

  test('rating rows appear only on Beaten, set, and clear on a second click', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    await expect(stateControl(page, 'rating', 'Perfection')).toHaveCount(0);

    await stateControl(page, 'status', 'Beaten').click();
    await expect(stateControl(page, 'priority', 'Next Up')).toHaveCount(0);
    for (const f of ['Perfection', 'Go for it', 'Timepass', 'Skip']) {
      await stateControl(page, 'rating', f).click();
      await expect(page.getByText(`Rated: ${f}`)).toBeVisible();
      expect((await libRow(page, 5551) as { feel: string }).feel).toBe(f);
    }
    await page.locator('button[aria-label^="Skip — clear rating"]:visible').first().click();
    await expect(page.getByText('Rating cleared')).toBeVisible();
    expect((await libRow(page, 5551) as { feel: string | null }).feel).toBeNull();
  });

  test('the completion date input appears on Beaten, writes, and clears', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    await expect(page.locator('#completed-date-input')).toHaveCount(0);

    await stateControl(page, 'status', 'Beaten').click();
    const date = page.locator('#completed-date-input:visible').first();
    await expect(date).toBeVisible();
    await date.fill('2025-02-11');
    await expect(page.getByText('Completion date updated')).toBeVisible();
    expect((await libRow(page, 5551) as { dateCompleted: string }).dateCompleted).toBe('2025-02-11');

    await date.fill('');
    await expect(page.getByText('Completion date cleared')).toBeVisible();
    expect((await libRow(page, 5551) as { dateCompleted: string | null }).dateCompleted).toBeNull();
  });

  test('an unparseable completion date survives a read, and the guard for it is live', async ({ page }) => {
    await seed(page, {
      [KEYS.library]: [{
        id: 5551, name: 'Stub Complete Edition', status: 'Beaten', is_custom: false,
        cover_id: 'co1wyy', dateCompleted: 'sometime last spring',
      }],
    });
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');

    /* db.js normalises on READ and writes the result back, but never writes a
       derivation that failed: the raw value stays on disk untouched. */
    expect((await libRow(page, 5551) as { dateCompleted: string | null }).dateCompleted).toBe('sometime last spring');

    /* Which makes the guard in GameDetail reachable: the field shows nothing it
       can render, and clearing it is refused with an explanation instead of
       writing null over the stored value. */
    const date = page.locator('#completed-date-input:visible').first();
    await expect(date).toHaveValue('');
    /* Not fill(''). React reports an input event only when the DOM value differs
       from the last value it tracked, and for this field that depends on timing:
       on mount React tracks the browser's sanitised '' (react-dom track() reads
       node.value after assigning the unparseable string), so an empty fill is no
       change and onChange never runs; only after some later re-render has React
       written the raw string back does the same fill count. That made this case
       fail whenever the page's async sections were slow to settle, and flake 1 in
       2 CI runs once they were stubbed. So give React a tracked value first, clear
       the DOM value behind it, and fire the event: onChange('') every run, which
       is the only thing the guard below is about. */
    await date.evaluate((el: HTMLInputElement) => {
      el.value = '2000-01-01';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByText(/format this field cannot show/).first()).toBeVisible();
    expect((await libRow(page, 5551) as { dateCompleted: string | null }).dateCompleted).toBe('sometime last spring');
  });

  test('the Remove from Library button confirms, then removes', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Wishlist').click();
    await page.locator('button:text-is("Remove from Library"):visible').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/There is no undo/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    expect(await libRow(page, 5551)).toBeNull();
    await expect(page.locator('button:text-is("Remove from Library")')).toHaveCount(0);
  });

  test('FINDING 1 — a game with no release date offers only Unreleased, so it can never be Playing or Beaten', async ({ page }) => {
    await page.goto('/game/5552');
    await detailReady(page, 'Bare Stub Entry');
    // Every ordinary status control is absent.
    for (const s of ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped']) {
      await expect(stateControl(page, 'status', s)).toHaveCount(0);
    }
    // The only control offered writes the Unreleased shelf.
    await stateControl(page, 'status', 'Unreleased').click();
    await expect(page.getByText('Added to library')).toBeVisible();
    expect((await libRow(page, 5552) as { status: string }).status).toBe('Unreleased');
    // And there is no route back: re-clicking removes rather than re-shelving.
    await expect(stateControl(page, 'status', 'Playing')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — notes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — notes and review', () => {
  test.beforeEach(async ({ page }) => { await stubIgdb(page, STUBS); });

  test('the notes textarea is absent until the game is in the library', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.locator('#game-user-notes')).toHaveCount(0);
    await stateControl(page, 'status', 'Backlog').click();
    await expect(page.locator('#game-user-notes')).toBeVisible();
  });

  test('typing shows Cancel/Save, Save persists, and the counter tracks length', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    const ta = page.locator('#game-user-notes');
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await ta.fill('Left off at the second act.');
    await expect(page.getByText('27/1000')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Notes saved')).toBeVisible();
    expect((await libRow(page, 5551) as { notes: string }).notes).toBe('Left off at the second act.');
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  });

  test('Cancel reverts the textarea to the stored value and drops the draft', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    const ta = page.locator('#game-user-notes');
    await ta.fill('saved text');
    await page.getByRole('button', { name: 'Save' }).click();
    await ta.fill('unsaved edit');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(ta).toHaveValue('saved text');
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  });

  test('an unsaved draft survives a reload and announces itself', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    await page.locator('#game-user-notes').fill('a draft nobody saved');
    await page.reload();
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByText('Restored an unsaved draft of your notes')).toBeVisible();
    await expect(page.locator('#game-user-notes')).toHaveValue('a draft nobody saved');
  });

  test('the textarea is hard-capped at 1000 characters', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    const ta = page.locator('#game-user-notes');
    await ta.fill('x'.repeat(1200));
    expect((await ta.inputValue()).length).toBe(1000);
    await expect(page.getByText('1000/1000')).toBeVisible();
  });

  test('the heading and placeholder switch to Review on a Beaten game', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Beaten').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Review' })).toBeVisible();
    await expect(page.locator('#game-user-notes')).toHaveAttribute('placeholder', 'Write your review…');
    await page.locator('#game-user-notes').fill('finished it');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Review saved')).toBeVisible();
  });

  test('FINDING 2 — removing a game strands a note draft that toasts on every later visit', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    await page.locator('#game-user-notes').fill('notes that were saved');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Notes saved')).toBeVisible();

    // Remove the game. The notes section unmounts, but `notes` state is untouched
    // and notesDirty flips true against a null libEntry, so a draft is written.
    await page.locator('button:text-is("Remove from Library"):visible').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Removed from library')).toBeVisible();

    const draftKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.toLowerCase().includes('note')));
    expect(draftKeys.length).toBeGreaterThan(0);

    // Every subsequent visit announces a draft for a game that is not shelved and
    // shows no textarea to put it in.
    await page.reload();
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByText('Restored an unsaved draft of your notes')).toBeVisible();
    await expect(page.locator('#game-user-notes')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — platforms, collections
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — platforms and collections', () => {
  test.beforeEach(async ({ page }) => { await stubIgdb(page, STUBS); });

  test('a platform chip links, relabels, and unlinks', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await stateControl(page, 'status', 'Backlog').click();
    const chip = page.locator('button[aria-label^="Mark PC"]:visible').first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByText('Linked PC')).toBeVisible();
    expect((await libRow(page, 5551) as { user_platforms: unknown[] }).user_platforms).toHaveLength(1);

    const unlink = page.locator('button[aria-label^="Unmark PC"]:visible').first();
    await unlink.click();
    await expect(page.getByText('Unlinked PC')).toBeVisible();
    expect((await libRow(page, 5551) as { user_platforms: unknown[] }).user_platforms).toHaveLength(0);
  });

  test('linking a platform on an unshelved game shelves it to Backlog first', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    expect(await libRow(page, 5551)).toBeNull();
    await page.locator('button[aria-label^="Mark PC"]:visible').first().click();
    await expect(page.getByText('Added to Backlog and linked PC')).toBeVisible();
    expect((await libRow(page, 5551) as { status: string }).status).toBe('Backlog');
  });

  test('FINDING 11 — the Collections block exists only in the desktop rail, so a phone cannot file a game at all', async ({ page }) => {
    await seed(page, {
      [KEYS.collections]: [{ id: 'p3-col', name: 'Phase 3 Collection', games: [], createdAt: 1700000000000 }],
    });
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');

    const toggle = page.locator('button[aria-label="Add to collection Phase 3 Collection"]');
    // It is in the DOM at every width — the aside is `hidden lg:block`, not unmounted.
    await expect(toggle).toHaveCount(1);

    const wide = await page.evaluate(() => window.matchMedia('(min-width: 1024px)').matches);
    if (!wide) {
      /* Below lg the only render site (GameDetail.jsx:971, inside `rail`, inside
         the `hidden lg:block` aside at :1328) is display:none. Completion date
         and the Owned On chips are duplicated into the mobile block at :1219 and
         :1222; collections is the one control that was not. */
      await expect(toggle).toBeHidden();
      await expect(page.locator('.lg\\:hidden').getByText('Collections')).toHaveCount(0);
      return;
    }

    const add = page.locator('button[aria-label="Add to collection Phase 3 Collection"]:visible').first();
    await add.click();
    await expect(page.getByText('Added to "Phase 3 Collection"')).toBeVisible();
    const members = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('moctale_collections') || '[]')[0].games);
    expect(members.map(String)).toContain('5551');

    await page.locator('button[aria-label="Remove from collection Phase 3 Collection"]:visible').first().click();
    await expect(page.getByText('Removed from "Phase 3 Collection"')).toBeVisible();
  });

  test('the Collections block is absent when there are no local collections', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.locator('button[aria-label^="Add to collection"]')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — media
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — media viewer', () => {
  test.beforeEach(async ({ page }) => { await stubIgdb(page, STUBS); });

  test('the hero opens the lightbox at item 1 with the true item count', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByText('Media · 5')).toBeVisible();
    await page.getByRole('button', { name: 'Open Stub Complete Edition media' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1 / 5')).toBeVisible();
  });

  test('a thumbnail jumps to that item and the counter follows', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await page.getByRole('button', { name: 'Open Stub Complete Edition media' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'View image 3' }).click();
    await expect(dialog.getByText('3 / 5')).toBeVisible();
  });

  test('Arrow keys move through the gallery and clamp at both ends', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await page.getByRole('button', { name: 'Open Stub Complete Edition media' }).click();
    const dialog = page.getByRole('dialog');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('1 / 5')).toBeVisible();     // clamped at the head
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('2 / 5')).toBeVisible();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('5 / 5')).toBeVisible();     // clamped at the tail
  });

  test('playing the video swaps the poster for a YouTube iframe, and leaving stops it', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await page.getByRole('button', { name: 'Open Stub Complete Edition media' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('iframe')).toHaveCount(0);
    await dialog.locator('img[alt="Stub Trailer"]').click();
    const frame = dialog.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', /youtube\.com\/embed\/aqz-KE-bpKQ\?autoplay=1/);
    await dialog.getByRole('button', { name: 'View image 2' }).click();
    await expect(dialog.locator('iframe')).toHaveCount(0);
  });

  test('Close dismisses the lightbox and Escape does too', async ({ page }) => {
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    const open = page.getByRole('button', { name: 'Open Stub Complete Edition media' });
    await open.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await open.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a game with no media renders no hero stage and no media button', async ({ page }) => {
    await page.goto('/game/5552');
    await detailReady(page, 'Bare Stub Entry');
    await expect(page.locator('button[aria-label^="Open "][aria-label$=" media"]')).toHaveCount(0);
  });

  test('FINDING 3 — a broken cover leaves a bare alt string where the poster should be, with no fallback', async ({ page }) => {
    await page.goto('/game/5553');
    await detailReady(page, 'Broken Cover Stub');
    const cover = page.locator('img[alt="Broken Cover Stub"]').first();
    await expect(cover).toBeAttached();
    // The image 404s: naturalWidth stays 0 and nothing in GameDetail handles it.
    await expect.poll(() => cover.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10000 }).toBe(0);
    const handled = await cover.evaluate((el) => el.getAttribute('onerror') !== null);
    expect(handled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GAMEDETAIL — failure and edge cases
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id — failure and edges', () => {
  test('an IGDB error object renders a failure, not "does not exist"', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('igdb_client_id', 'qa-phase3-stub');
      localStorage.setItem('igdb_access_token', 'qa-phase3-token');
    });
    await page.route('**/api/**', route => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'Authorization Failure. Please provide a valid Client ID and Access Token.' }),
    }));
    await page.goto('/game/1942');
    // A failure is not an absence: the page says the index did not answer, and
    // the app-level banner offers the retry.
    await expect(page.getByText('The index did not answer')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('This entry does not exist in the index')).toHaveCount(0);
  });  test('the Go Back button on the Not Found plate returns to the previous route', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/collections');
    await page.goto('/game/99999992');
    await page.getByRole('button', { name: 'Go Back' }).click();
    await expect(page).toHaveURL(/\/collections$/);
  });

  test('a partial-metadata game renders Released TBA rather than an empty row', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5552');
    await detailReady(page, 'Bare Stub Entry');
    await expect(page.locator('section:has(h2:text-is("Index"))').getByText('TBA')).toBeVisible();
    // Rows with nothing to say are absent, not blank.
    await expect(page.getByText('Developer', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Genres', { exact: true })).toHaveCount(0);
  });

  test('a very long title stays inside the viewport and reaches the confirm copy intact', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5554');
    await detailReady(page, LONG_NAME);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await stateControl(page, 'status', 'Backlog').click();
    await page.locator('button:text-is("Remove from Library"):visible').first().click();
    await expect(page.getByRole('dialog').getByText(`Remove ${LONG_NAME}?`)).toBeVisible();
  });

  test('Before You Decide says it has too little to compare on an empty library', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByText('Not enough on your shelves yet to compare')).toBeVisible();
    await expect(page.getByText(/Too few ratings to say|\/ 100 ·/)).toBeVisible();
  });

  test('Before You Decide is hidden entirely once the game is Beaten', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByRole('heading', { name: 'Before You Decide' })).toBeVisible();
    await stateControl(page, 'status', 'Beaten').click();
    await expect(page.getByRole('heading', { name: 'Before You Decide' })).toHaveCount(0);
  });

  test('the rating floor suppresses a thin score and shows the sample size instead', async ({ page }) => {
    await stubIgdb(page, [{ ...GAME_FULL, id: 5555, name: 'Thin Sample Stub', total_rating: 97, total_rating_count: 4 }]);
    await page.goto('/game/5555');
    await detailReady(page, 'Thin Sample Stub');
    await expect(page.getByText('Too few ratings to say · 4')).toBeVisible();
    await expect(page.getByText('97 / 100')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVER — /
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/ — Discover', () => {
  /* Every section on this page is IGDB. Live, the hero, the recommendations and
     the shelf previews were whatever IGDB ranked that hour, and the hero case
     flaked on it. The FINDING 8 case overrides window.fetch on top of this. */
  test.beforeEach(async ({ page }) => { await offlineIgdb(page); });

  test('the hero title, artwork and View Game all target the same game', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/');
    const view = page.getByRole('link', { name: 'View Game →' });
    await expect(view).toBeVisible({ timeout: 30000 });
    const href = await view.getAttribute('href');
    expect(href).toMatch(/^\/game\/\d+$/);
    const titleLink = page.locator(`a[href="${href}"]`);
    expect(await titleLink.count()).toBeGreaterThanOrEqual(2);
    await view.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    expect(realErrors(errs)).toEqual([]);
  });

  test('the decorative cover twin is hidden from AT and out of the tab order', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'View Game →' })).toBeVisible({ timeout: 30000 });
    const twin = page.locator('a[aria-hidden="true"][tabindex="-1"]');
    if (await twin.count() > 0) await expect(twin.first()).toHaveAttribute('tabindex', '-1');
  });

  test('+ Wishlist writes the hero to the library and the button becomes In Library', async ({ page }) => {
    await page.goto('/');
    const wish = page.getByRole('button', { name: '+ Wishlist' });
    await expect(wish).toBeVisible({ timeout: 30000 });
    const href = await page.getByRole('link', { name: 'View Game →' }).getAttribute('href');
    const heroId = href!.split('/').pop()!;
    await wish.click();
    await expect(page.getByText('Added to Wishlist')).toBeVisible();
    const row = await libRow(page, heroId);
    expect(row).not.toBeNull();
    expect((row as { status: string }).status).toBe('Wishlist');
  });

  test('Not Interested records the verdict and advances the hero', async ({ page }) => {
    /* Three, not one: `getRecommendations` falls back to `basedOn: 'trending'`
       below two non-custom library rows (discover.js:133), and the Not Interested
       control only exists on the library-tuned hero (Discover.jsx:281). */
    await seed(page, { [KEYS.library]: [
      { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Beaten', is_custom: false, cover_id: 'co1wyy', release_year: 2015 },
      { id: 1020, name: 'Grand Theft Auto V', status: 'Playing', is_custom: false, cover_id: 'co2lbd', release_year: 2013 },
      { id: 472, name: 'Half-Life 2', status: 'Backlog', is_custom: false, cover_id: 'co2pah', release_year: 2004 },
    ] });
    await page.goto('/');
    const dismiss = page.getByRole('button', { name: /Not Interested/ });
    await expect(dismiss).toBeVisible({ timeout: 30000 });
    const before = await page.getByRole('link', { name: 'View Game →' }).getAttribute('href');
    await dismiss.click();
    await expect(page.getByText('Picking Next…')).toBeVisible();
    await expect.poll(
      () => page.getByRole('link', { name: 'View Game →' }).getAttribute('href'),
      { timeout: 20000 },
    ).not.toBe(before);
    const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('moctale_rec_feedback') || '[]'));
    expect(marks.some((m: { verdict: string }) => m.verdict === 'not_interested')).toBe(true);
  });

  test('each See All link opens its own explore section', async ({ page }) => {
    await page.goto('/');
    /* Wait for the sections to LOAD, not merely to exist: `announced === null`
       renders a SkeletonGrid with the same `.game-grid` class and
       `showSeeAll={false}`, so counting too early counts zero links on a page
       that is about to have three (Discover.jsx:314-331). */
    await expect(page.getByRole('heading', { name: 'Recently Announced' })).toBeVisible({ timeout: 30000 });
    await expect.poll(() => page.locator('.skeleton-placeholder').count(), { timeout: 30000 }).toBe(0);
    const seeAll = page.getByRole('link', { name: 'See All →' });
    const n = await seeAll.count();
    expect(n).toBeGreaterThan(0);
    const hrefs: string[] = [];
    for (let i = 0; i < n; i++) hrefs.push((await seeAll.nth(i).getAttribute('href'))!);
    for (const h of hrefs) {
      await page.goto('/');
      await page.locator(`a[href="${h}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${h}$`));
      await expect(page.locator('h1')).toBeVisible();
    }
  });

  test('a recommendation card menu records Not Interested and drops the card', async ({ page }) => {
    await page.goto('/');
    const grid = page.locator('section:has(h2:text-is("Recommended For You")), section:has(h2:text-is("More To Explore"))').last();
    const card = grid.locator('.game-grid [role="link"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const name = await card.getAttribute('aria-label');
    const before = await grid.locator('.game-grid [role="link"]').count();
    /* The ⋯ trigger's `aria-haspopup` lives on the DropdownMenu wrapper, not on
       the <button> itself (GameCard.jsx:583), so the trigger is found by name.
       Scrolled into view and settled BEFORE the click: DropdownMenu closes on
       any scroll event (DropdownMenu.jsx:142), and Playwright's own
       scroll-into-view fires one that lands after the menu has opened. */
    const trigger = grid.locator(`button[aria-label="More options for ${name}"]`).first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await trigger.click();
    const menu = page.locator('[role="menu"]').last();
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: /Not Interested/ }).click();
    await expect(page.getByText("Noted — you won't see this again")).toBeVisible();
    await expect.poll(() => grid.locator('.game-grid [role="link"]').count()).toBe(before - 1);
    await expect(grid.locator(`[role="link"][aria-label="${name}"]`)).toHaveCount(0);
  });

  test('scrolling reveals more recommendations than the first page', async ({ page }) => {
    await page.goto('/');
    const grid = page.locator('section:has(h2:text-is("Recommended For You")), section:has(h2:text-is("More To Explore"))').last();
    await expect(grid.locator('.game-grid [role="link"]').first()).toBeVisible({ timeout: 30000 });
    const first = await grid.locator('.game-grid [role="link"]').count();
    for (let i = 0; i < 4; i++) {
      await page.evaluate(n => window.scrollBy(0, n), 4000);
      await page.waitForTimeout(400);
    }
    const after = await grid.locator('.game-grid [role="link"]').count();
    expect(after).toBeGreaterThanOrEqual(first);
  });

  test('FINDING 8 — a fully consumed feed paints the same "All Caught Up" plate twice', async ({ page }) => {
    // Force the exhausted shape: no hero, no candidates.
    await page.addInitScript(() => {
      const orig = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
        if (url.includes('/api/')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return orig(input as RequestInfo, init);
      };
      localStorage.setItem('igdb_client_id', 'qa-phase3-stub');
      localStorage.setItem('igdb_access_token', 'qa-phase3-token');
    });
    await page.goto('/');
    const plate = page.getByText('You’re All Caught Up');
    await expect(plate.first()).toBeVisible({ timeout: 30000 });
    expect(await plate.count()).toBe(2);
    // Two identical links with the same accessible name and destination.
    expect(await page.getByRole('link', { name: 'Review Your Feedback →' }).count()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPLORE LIST — /explore/:section
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/explore/:section', () => {
  test.beforeEach(async ({ page }) => { await offlineIgdb(page); });

  test('announced and trending each render their own h1 and a populated grid', async ({ page }) => {
    for (const [section, title] of [['announced', 'Recently Announced'], ['trending', 'Trending']]) {
      await page.goto(`/explore/${section}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.game-grid [role="link"]').first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(/\d+\+? Titles?/)).toBeVisible();
    }
  });

  test('the count grows as paging loads a second page', async ({ page }) => {
    await page.goto('/explore/trending');
    await expect(page.locator('.game-grid [role="link"]').first()).toBeVisible({ timeout: 30000 });
    const first = await page.locator('.game-grid [role="link"]').count();
    for (let i = 0; i < 5; i++) {
      await page.evaluate(n => window.scrollBy(0, n), 6000);
      await page.waitForTimeout(500);
    }
    const after = await page.locator('.game-grid [role="link"]').count();
    expect(after).toBeGreaterThanOrEqual(first);
  });

  test('the Back to Explore header control returns to /', async ({ page }) => {
    await page.goto('/explore/trending');
    await expect(page.getByRole('heading', { level: 1, name: 'Trending' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /Explore/ }).first().click();
    await expect(page).toHaveURL(/localhost:5173\/$/);
  });

  test('/explore/updates with no stored updates shows its own empty copy and no Clear All', async ({ page }) => {
    await page.goto('/explore/updates');
    await expect(page.getByRole('heading', { level: 1, name: 'Library Updates' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Nothing Here')).toBeVisible();
    await expect(page.getByText('No tracked changes yet — check back after your games update')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear All' })).toHaveCount(0);
    await expect(page.getByText('0 Titles')).toBeVisible();
  });

  test('Clear All empties the update grid and moves focus to the heading', async ({ page }) => {
    /* The feed lives under `lh_lib_updates` (discover.js:284) and is a flat array
       of events; `updatesToCards` drops any event whose gameId is not in the
       library, so the game has to be shelved too. `lh_lib_updates_at` is set so
       the 6h re-check does not overwrite the seed on mount. */
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, {
      [KEYS.library]: [
        { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Backlog', is_custom: false, cover_id: 'co1wyy', release_year: 2015 },
      ],
      lh_lib_updates: [
        { gameId: 1942, gameName: 'The Witcher 3: Wild Hunt', cover: 'co1wyy', type: 'released', detail: 'Now released', at: 1700000000000 },
      ],
      lh_lib_updates_at: Date.now(),
    });
    await page.goto('/explore/updates');
    await expect(page.getByRole('heading', { level: 1, name: 'Library Updates' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.game-grid [role="link"]').first()).toBeVisible();
    const clear = page.getByRole('button', { name: 'Clear All' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.getByText('Nothing Here')).toBeVisible();
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(tag).toBe('H1');
  });

  test('an unknown explore section has an h1 and a way back', async ({ page }) => {
    await page.goto('/explore/not-a-section');
    await expect(page.getByRole('heading', { level: 1, name: 'Unknown Section' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Back to Explore' }).click();
    await expect(page).toHaveURL(/localhost:5173\/$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FEEDBACK — /feedback
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/feedback', () => {
  test('both grids render their seeded marks with matching counts', async ({ page }) => {
    const errs = watchConsole(page);
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, {
      [KEYS.recFeedback]: [
        { id: 1905, name: 'Fortnite', cover_id: 'co2ekt', verdict: 'not_interested' },
        { id: 472, name: 'Half-Life 2', cover_id: 'co2pah', verdict: 'interested' },
      ],
    });
    await page.goto('/feedback');
    await expect(page.getByRole('heading', { level: 1, name: 'Your Feedback' })).toBeVisible();
    const interested = page.locator('section:has(h2:text-is("Interested"))').first();
    await expect(interested.locator('[role="link"][aria-label="Half-Life 2"]')).toBeVisible();
    const not = page.locator('section:has(h2:text-is("Not Interested"))');
    await expect(not.locator('[role="link"][aria-label="Fortnite"]')).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('both empty plates render their own copy on a clean profile', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/feedback');
    await expect(page.getByText('Nothing marked Interested yet')).toBeVisible();
    await expect(page.getByText('Nothing hidden yet')).toBeVisible();
  });

  test('a card menu flips a verdict and the game moves between the two grids', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, {
      [KEYS.recFeedback]: [{ id: 472, name: 'Half-Life 2', cover_id: 'co2pah', verdict: 'interested' }],
    });
    await page.goto('/feedback');
    const interested = page.locator('section:has(h2:text-is("Interested"))').first();
    await expect(interested.locator('[role="link"][aria-label="Half-Life 2"]')).toBeVisible();
    await interested.locator('button[aria-label="More options for Half-Life 2"]').first().click();
    const menu = page.locator('[role="menu"]').last();
    await menu.getByRole('menuitemradio', { name: /^Not Interested/ }).click();
    await expect(page.getByText('Updated')).toBeVisible();
    await expect(page.locator('section:has(h2:text-is("Not Interested")) [role="link"][aria-label="Half-Life 2"]')).toBeVisible();
    await expect(page.getByText('Nothing marked Interested yet')).toBeVisible();
  });

  test('Back to Explore returns to /', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/feedback');
    await page.getByRole('button', { name: 'Go back to Explore' }).click();
    await expect(page).toHaveURL(/localhost:5173\/$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PICK NEXT — the dialog, as it currently stands in the working tree
// ═══════════════════════════════════════════════════════════════════════════

const PICK_SHELF = [
  { id: 900201, name: 'Pick Alpha',   status: 'Backlog',  is_custom: false, cover_id: 'co1wyy', release_year: 2015, total_rating: 90, priority: 'Next Up' },
  { id: 900202, name: 'Pick Bravo',   status: 'Backlog',  is_custom: false, cover_id: 'co2lbd', release_year: 2013, total_rating: 80, priority: 'Soon' },
  { id: 900203, name: 'Pick Charlie', status: 'Wishlist', is_custom: false, cover_id: 'co2ekt', release_year: 2017, total_rating: 70, priority: 'Maybe' },
  { id: 900204, name: 'Pick Delta',   status: 'Dropped',  is_custom: false, cover_id: 'co670h', release_year: 2023, total_rating: 60 },
  { id: 900205, name: 'Pick Echo',    status: 'Backlog',  is_custom: false, cover_id: 'co2pah', release_year: 2004, total_rating: 85, priority: 'Someday' },
  { id: 900206, name: 'Pick Foxtrot', status: 'Backlog',  is_custom: false, cover_id: 'co1wyy', release_year: 2011, total_rating: 75 },
];

async function openPickNext(page: Page) {
  /* The visible words are "Pick For Me" but they are `hidden md:inline`, so the
     accessible name below md is the aria-label alone (Library.jsx:1494). */
  await page.getByRole('button', { name: 'Pick a game to play next' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The dialog resolves when the primary button is armed (or the empty plate lands). */
async function pickSettled(page: Page) {
  /* Scoped to the dialog AND exact: below lg the shell's hamburger is named
     "Open navigation menu", which a substring match on "Open" also selects. */
  await expect.poll(async () => {
    const open = page.getByRole('dialog').getByRole('button', { name: 'Open', exact: true });
    if (await open.count() === 0) return 'empty';
    return await open.isDisabled() ? 'drawing' : 'ready';
  }, { timeout: 25000 }).not.toBe('drawing');
}

test.describe('PickNext dialog', () => {
  test('opens from the library toolbar, draws, and arms Open with a named pick', async ({ page }) => {
    const errs = watchConsole(page);
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await expect(dialog.getByRole('heading', { name: 'Play This Next' })).toBeVisible();
    await pickSettled(page);
    const name = await dialog.locator('[data-pick-name]').textContent();
    expect(PICK_SHELF.map(g => g.name)).toContain(name!.trim());
    await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
    expect(realErrors(errs)).toEqual([]);
  });

  test('Open navigates to the picked game and closes the dialog', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await pickSettled(page);
    const name = (await dialog.locator('[data-pick-name]').textContent())!.trim();
    const expected = PICK_SHELF.find(g => g.name === name)!.id;
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/game/${expected}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Pick Another draws a different game rather than repeating the last one', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await pickSettled(page);
    const first = (await dialog.locator('[data-pick-name]').textContent())!.trim();
    await dialog.getByRole('button', { name: 'Pick Another' }).click();
    await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toBeDisabled();   // draw is live
    await pickSettled(page);
    const second = (await dialog.locator('[data-pick-name]').textContent())!.trim();
    expect(second).not.toBe(first);
  });

  test('Pick Another keeps working past the end of the shelf — it wraps, it does not dead-end', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await pickSettled(page);
    for (let i = 0; i < PICK_SHELF.length + 2; i++) {
      await dialog.getByRole('button', { name: 'Pick Another' }).click();
      await pickSettled(page);
      await expect(dialog.locator('[data-pick-name]')).not.toBeEmpty();
    }
    await expect(dialog.getByRole('button', { name: 'Pick Another' })).toBeEnabled();
  });

  test('Close dismisses the dialog and Escape does too', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    let dialog = await openPickNext(page);
    await pickSettled(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    dialog = await openPickNext(page);
    await pickSettled(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('an empty suggestable shelf shows the plate and offers no dead primary button', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    // Beaten and Playing are NOT suggestable, so this shelf is empty to the picker.
    await seed(page, { [KEYS.library]: [
      { id: 900301, name: 'Finished Already', status: 'Beaten', is_custom: false, cover_id: 'co1wyy', release_year: 2015 },
      { id: 900302, name: 'Currently On',     status: 'Playing', is_custom: false, cover_id: 'co2lbd', release_year: 2013 },
    ] });
    await page.goto('/library/beaten');
    const dialog = await openPickNext(page);
    await expect(dialog.getByText(/Nothing on your Backlog, Wishlist or Dropped shelves yet/)).toBeVisible({ timeout: 25000 });
    await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Pick Another' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  test('the draw readout quotes one pool, and a coverless entry can win it', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    // Six suggestable games; three of them carry no cover_id.
    await seed(page, { [KEYS.library]: [
      ...PICK_SHELF.slice(0, 3),
      { id: 900211, name: 'Coverless One',   status: 'Backlog', is_custom: false, cover_id: null, release_year: 2015 },
      { id: 900212, name: 'Coverless Two',   status: 'Backlog', is_custom: false, cover_id: null, release_year: 2016 },
      { id: 900213, name: 'Coverless Three', status: 'Backlog', is_custom: false, cover_id: null, release_year: 2017 },
    ] });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await pickSettled(page);

    /* The dialog used to print two counted facts about one shelf and disagree
       with itself: a field reading "3 on your shelves", which counted only the
       entries with cover art, above a plate reading "One of 6 considered". That
       field only ever rendered while the client could not reach the index, which
       was routine when the browser held the credentials and had none seeded, and
       cannot happen now the proxy holds them. One count is left, and it is the
       true pool. */
    await expect(dialog.getByText('One of 6 considered')).toBeVisible();
    await expect(dialog.getByText(/on your shelves/i)).toHaveCount(0);
    await expect(dialog.getByText(/in contention/i)).toHaveCount(0);
  });

  test('the dialog is a modal with a trapped, labelled panel', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await expect(dialog).toHaveAttribute('aria-labelledby', 'pick-next-title');
    await pickSettled(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return !!(d && document.activeElement && d.contains(document.activeElement));
      });
      expect(inside).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REMAINING INVENTORY — connections, update badge, shelf tiles, overflow
// ═══════════════════════════════════════════════════════════════════════════

/** stubIgdb plus canned rows for the three connection endpoints. */
async function stubConnections(page: Page) {
  await noAwards(page);
  await page.addInitScript(() => {
    localStorage.setItem('igdb_client_id', 'qa-phase3-stub');
    localStorage.setItem('igdb_access_token', 'qa-phase3-token');
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postData() || '';
    const json = (v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === '/api/games' && /where id = 5561/.test(body)) {
      return json([{ ...GAME_FULL, id: 5561, name: 'Connected Stub', franchises: [24], collections: [77] }]);
    }
    if (path === '/api/franchises') return json([{ id: 24, name: 'Stub Franchise' }]);
    if (path === '/api/collections') return json([{ id: 77, name: 'Stub Collection' }]);
    if (path === '/api/events') return json([{ id: 88, name: 'Stub Showcase', games: [5561] }]);
    return json([]);
  });
}

test.describe('/game/:id — Appears In', () => {
  test('franchise, collection and event links each leave for their own route', async ({ page }) => {
    await stubConnections(page);
    await page.goto('/game/5561');
    await detailReady(page, 'Connected Stub');
    const section = page.locator('section:has(h2:text-is("Appears In"))');
    await expect(section).toBeVisible({ timeout: 20000 });

    await expect(section.getByRole('link', { name: 'Stub Franchise' })).toHaveAttribute('href', '/franchise/24');
    await expect(section.getByRole('link', { name: 'Stub Collection' })).toHaveAttribute('href', '/collection/igdb/77');
    await expect(section.getByRole('link', { name: 'Stub Showcase' })).toHaveAttribute('href', '/event/88');

    await section.getByRole('link', { name: 'Stub Franchise' }).click();
    await expect(page).toHaveURL(/\/franchise\/24$/);
  });

  test('the Appears In section is absent when a game has no connections', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    await expect(page.getByRole('heading', { name: 'Appears In' })).toHaveCount(0);
  });

  test('the Awards section lists the ceremony and its categories, both deep-linked', async ({ page }) => {
    /* Awards are keyed on the IGDB game id, not on anything the /api/games stub
       returns. This case used to lean on id 5551's real record in production
       Firestore's award_cache, which no spec may read. The same record (2011
       IGF, Nuovo Award) is answered here as Wikidata's won-award query returns
       it, and the nominee query comes back empty. */
    await stubIgdb(page, STUBS);
    await page.route('**/wdqs/**', r => {
      const won = /p%3AP166(?!\d)/.test(r.request().postData() || '');
      const bindings = won ? [{
        cat: { type: 'uri', value: 'http://www.wikidata.org/entity/Q60662069' },
        catLabel: { type: 'literal', value: 'Nuovo Award' },
        ceremony: { type: 'uri', value: 'http://www.wikidata.org/entity/Q110535947' },
        ceremonyLabel: { type: 'literal', value: 'Independent Games Festival Awards' },
        year: { type: 'literal', value: '2011' },
      }] : [];
      return r.fulfill({
        status: 200, contentType: 'application/sparql-results+json',
        body: JSON.stringify({ head: { vars: [] }, results: { bindings } }),
      });
    });
    await page.goto('/game/5551');
    await detailReady(page, 'Stub Complete Edition');
    const awards = page.locator('section:has(h2:text-is("Awards"))');
    await expect(awards).toBeVisible({ timeout: 20000 });
    await expect(awards.getByText('1 WIN · 1 CEREMONY')).toBeVisible();
    await expect(awards.getByText('2011')).toBeVisible();
    const ceremony = awards.getByRole('link', { name: 'Independent Games Festival Awards' });
    await expect(ceremony).toHaveAttribute('href', '/awards/Q110535947?year=2011');
    await expect(awards.getByRole('link', { name: 'Nuovo Award' }))
      .toHaveAttribute('href', '/awards/Q110535947?year=2011&cat=Q60662069');
    await ceremony.click();
    await expect(page).toHaveURL(/\/awards\/Q110535947\?year=2011$/);
  });

  test('a game with no award record renders no Awards section', async ({ page }) => {
    await stubIgdb(page, STUBS);
    await page.goto('/game/5554');
    await detailReady(page, LONG_NAME);
    await page.waitForTimeout(1500);
    await expect(page.locator('section:has(h2:text-is("Awards"))')).toHaveCount(0);
  });
});

test.describe('/ — Discover, library-driven sections', () => {
  /* One game, two stored events for it: enough for the In Your Library shelf
     AND for the +N badge, which only renders when `extra > 0`. */
  async function seedUpdates(page: Page) {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, {
      [KEYS.library]: [
        { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Backlog', is_custom: false, cover_id: 'co1wyy', release_year: 2015 },
        { id: 1020, name: 'Grand Theft Auto V', status: 'Playing', is_custom: false, cover_id: 'co2lbd', release_year: 2013 },
      ],
      lh_lib_updates: [
        { gameId: 1942, gameName: 'The Witcher 3: Wild Hunt', cover: 'co1wyy', type: 'released', detail: 'Now released', at: 1700000000000 },
        { gameId: 1942, gameName: 'The Witcher 3: Wild Hunt', cover: 'co1wyy', type: 'art', detail: 'New artwork', at: 1700000000001 },
      ],
      lh_lib_updates_at: Date.now(),
    });
  }

  test('the In Your Library shelf renders a stored update and its See All is withheld below seven', async ({ page }) => {
    await seedUpdates(page);
    await page.goto('/');
    const section = page.locator('section:has(h2:text-is("In Your Library"))');
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section.locator('[role="link"][aria-label="The Witcher 3: Wild Hunt"]')).toBeVisible();
    // PREVIEW is 6 and there is one card, so the section withholds its See All.
    await expect(section.getByRole('link', { name: 'See All →' })).toHaveCount(0);
  });

  test('the update-count badge opens its popover on hover and on Enter', async ({ page }) => {
    await seedUpdates(page);
    await page.goto('/');
    const section = page.locator('section:has(h2:text-is("In Your Library"))');
    await expect(section).toBeVisible({ timeout: 30000 });
    const badge = section.locator('button[aria-expanded]').first();
    await expect(badge).toHaveAttribute('aria-label', '1 additional updates');
    await expect(badge).toHaveAttribute('aria-expanded', 'false');

    await badge.hover();
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('More updates')).toBeVisible();
    await expect(page.getByText('New artwork')).toBeVisible();

    // Keyboard route: focus and Enter, with no pointer involved.
    await page.mouse.move(0, 0);
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    await badge.focus();
    await page.keyboard.press('Enter');
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
  });

  test('FINDING 12 — clicking the update-count badge closes it, because hover already opened it', async ({ page }) => {
    await seedUpdates(page);
    await page.goto('/');
    const section = page.locator('section:has(h2:text-is("In Your Library"))');
    await expect(section).toBeVisible({ timeout: 30000 });
    const badge = section.locator('button[aria-expanded]').first();

    /* Playwright's click is hover → mousedown → mouseup → click, which is what a
       mouse does. `handleMouseEnter` (UpdateCountBadge.jsx:23-27) sets open=true,
       then `onClick` (:80-85) toggles it back to false in the same gesture. */
    await badge.click();
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('More updates')).toHaveCount(0);

    /* And it stays shut while the pointer is still on it: no further mouseenter
       fires, so the only recovery is to move away and come back. */
    await page.waitForTimeout(400);
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
    await badge.click();
    await expect(badge).toHaveAttribute('aria-expanded', 'true');   // second click re-opens
  });
});

test.describe('/ — Discover, Shelves For You', () => {
  test('Save to Shelves stores the shelf and removes its tile', async ({ page }) => {
    /* Live IGDB will not reliably produce a "mostly owned" shelf for any seed we
       can write, so the two endpoints the section is built from are stubbed:
       `getGamesProfile` supplies two library games sharing collection 101, and
       `getCollectionsByIds` supplies that collection with three entries —
       owned 2 / total 3 = 0.66, past the 0.4 ratio gate at discover.js:276. */
    await page.addInitScript(() => {
      localStorage.setItem('igdb_client_id', 'qa-phase3-stub');
      localStorage.setItem('igdb_access_token', 'qa-phase3-token');
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postData() || '';
      const json = (v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
      if (path === '/api/games' && /collections/.test(body) && /where id = \(/.test(body)) {
        return json([
          { id: 1942, name: 'The Witcher 3: Wild Hunt', collections: [101], franchises: [] },
          { id: 1020, name: 'Grand Theft Auto V', collections: [101], franchises: [] },
        ]);
      }
      if (path === '/api/collections') {
        return json([{
          id: 101, name: 'Stub Shelf', type: { id: 1, name: 'Series' },
          games: [
            { id: 1942, name: 'The Witcher 3: Wild Hunt', game_type: 0, cover: { image_id: 'co1wyy' } },
            { id: 1020, name: 'Grand Theft Auto V', game_type: 0, cover: { image_id: 'co2lbd' } },
            { id: 472, name: 'Half-Life 2', game_type: 0, cover: { image_id: 'co2pah' } },
          ],
        }]);
      }
      return json([]);
    });
    await seed(page, {
      [KEYS.library]: [
        { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Beaten', is_custom: false, cover_id: 'co1wyy', release_year: 2015 },
        { id: 1020, name: 'Grand Theft Auto V', status: 'Playing', is_custom: false, cover_id: 'co2lbd', release_year: 2013 },
      ],
      [KEYS.savedIgdbCollections]: [],
    });
    await page.goto('/');
    const section = page.locator('section:has(h2:text-is("Shelves For You"))');
    await expect(section).toBeVisible({ timeout: 30000 });
    const tile = section.locator('a[href="/collection/igdb/101"]');
    await expect(tile).toBeVisible();
    await expect(section.getByText('2/3 In Library')).toBeVisible();

    /* DropdownMenu closes on ANY scroll (DropdownMenu.jsx:147). This section sits
       under the hero and the recommendations, which are still settling when the
       tile appears, and both Playwright's scroll-into-view and the browser's
       scroll anchoring fire a scroll that shut the menu the instant it opened:
       6 of 6 runs timed out waiting for a row in a menu that was no longer
       there. Settle the page, settle the trigger, then open it -- and open it
       again if a late scroll still closed it. */
    await expect.poll(() => page.locator('.skeleton-placeholder').count(), { timeout: 30000 }).toBe(0);
    const trigger = section.getByRole('button', { name: 'Collection options' }).first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const saveRow = page.locator('[role="menu"]').last().getByRole('menuitem', { name: 'Save to Shelves' });
    await expect(async () => {
      if (!(await saveRow.isVisible())) await trigger.click();
      await expect(saveRow).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await saveRow.click();
    await expect(page.getByText('Saved to Shelves')).toBeVisible();
    await expect(tile).toHaveCount(0);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('moctale_saved_igdb_collections') || '[]'));
    expect(saved.map(String)).toContain('101');
  });
});

test.describe('no horizontal overflow at phone widths', () => {
  const WIDTHS = [280, 320, 414];
  for (const w of WIDTHS) {
    test(`/game/:id fits ${w}px`, async ({ page }) => {
      await stubIgdb(page, STUBS);
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/game/5554');                       // the long-title stub
      await detailReady(page, LONG_NAME);
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
    });

    test(`/feedback fits ${w}px`, async ({ page }) => {
      await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      await seed(page, { [KEYS.recFeedback]: [{ id: 472, name: LONG_NAME, cover_id: null, verdict: 'interested' }] });
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/feedback');
      await expect(page.getByRole('heading', { level: 1, name: 'Your Feedback' })).toBeVisible();
      const over = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
    });
  }

  test('the PickNext dialog fits 320px and its buttons stay reachable', async ({ page }) => {
    await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await seed(page, { [KEYS.library]: PICK_SHELF });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/library/backlog');
    const dialog = await openPickNext(page);
    await pickSettled(page);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    for (const name of ['Open', 'Pick Another', 'Close']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });
});
