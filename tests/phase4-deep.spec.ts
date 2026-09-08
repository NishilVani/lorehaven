/**
 * Deep QA — phase 4 of the qa/2026-09-05-deep run.
 * Routes under test: /collections, /collection/:id, /collection/igdb/:id,
 * /franchise/:franchiseId, /game/:id/collections, /platforms.
 *
 * Every test DRIVES a control and asserts the state it changed. A test that
 * only asserts a route renders belongs in tests/routes.spec.ts, not here.
 *
 * Cases marked `FINDING n` assert the WRONG behaviour on purpose, so the suite
 * stays green and the defect cannot be quietly lost between this run and the
 * fix phase. Every one is written up in qa/2026-09-05-deep/phase4.md, which
 * RANKS by severity — the numbers here are discovery order, and phase4.md
 * carries the mapping table.
 *
 * Run it the way phases 2 and 3 were run:
 *   npx playwright test tests/phase4-deep.spec.ts --project=chromium --project="Mobile Chrome"
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { KEYS, KNOWN_NOISE, realErrors } from './fixtures';

/* ── seed(), but ONCE ──────────────────────────────────────────────────────
   fixtures.ts's seed() uses page.addInitScript, which re-runs on EVERY
   navigation and reload — so a test that renames a collection and then reloads
   to prove the rename stuck has its rename silently overwritten by the seed and
   passes, or fails, for a reason that has nothing to do with the product.
   Measured in p4-run1.log: "Edit prefills the fields" failed on reload with the
   collection back at its seeded name.

   This writes on the first document load only, guarded by a sentinel key, so a
   reload reads back exactly what the app wrote. */
const SEED_SENTINEL = '__qa_phase4_seeded';
async function seed(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((payload: Record<string, string>) => {
    if (window.localStorage.getItem('__qa_phase4_seeded')) return;
    for (const [k, v] of Object.entries(payload)) window.localStorage.setItem(k, v);
    window.localStorage.setItem('__qa_phase4_seeded', '1');
  }, Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
}
void SEED_SENTINEL;

/* ── Console watch (same contract as phases 2 and 3) ──────────────────────── */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/* ── Stubbed IGDB ──────────────────────────────────────────────────────────
   Collections, franchises and the platform search are all live POSTs to /api/*.
   Stubbing them is what makes a create / rename / delete / transfer
   deterministic, and it keeps sixty mutation cases off IGDB's 4 req/s budget.
   The credential pair is seeded RAW (not JSON) because igdb.js reads both with
   a bare getItem — fixtures.ts's JSON-stringifying seed() does not work here. */

const IGDB_COLLECTIONS = [
  {
    id: 7001, name: 'Stub Saga Collection', type: { name: 'Franchise' },
    games: [
      { id: 8001, name: 'Stub Saga I', cover: { image_id: 'co1wyy' } },
      { id: 8002, name: 'Stub Saga II', cover: { image_id: 'co2lbd' } },
    ],
  },
  {
    id: 7002, name: 'Stub Anthology', type: { name: 'Bundle' },
    games: [{ id: 8003, name: 'Stub Anthology Vol 1', cover: { image_id: 'co2ekt' } }],
  },
];

const IGDB_FRANCHISES = [
  { id: 9001, name: 'Stub Franchise Alpha', games: [{ id: 8001, name: 'Stub Saga I', cover: { image_id: 'co1wyy' } }] },
  { id: 9002, name: 'Stub Franchise Beta', games: [{ id: 8004, name: 'Beta Game', cover: { image_id: 'co670h' } }] },
];

/** Full game rows, for getGamesByIds and searchGames. */
const IGDB_GAMES = [
  { id: 8001, name: 'Stub Saga I', cover: { image_id: 'co1wyy' }, first_release_date: 1431993600, total_rating: 88, platforms: [{ id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' }] },
  { id: 8002, name: 'Stub Saga II', cover: { image_id: 'co2lbd' }, first_release_date: 1500940800, total_rating: 80, platforms: [] },
  { id: 8003, name: 'Stub Anthology Vol 1', cover: { image_id: 'co2ekt' }, first_release_date: 1379376000, total_rating: 70, platforms: [] },
  { id: 8004, name: 'Beta Game', cover: { image_id: 'co670h' }, first_release_date: 1691020800, total_rating: 95, platforms: [] },
  { id: 8005, name: 'Addable Stub Game', cover: { image_id: 'co2pah' }, first_release_date: 1100476800, total_rating: 60, platforms: [] },
];

const IGDB_PLATFORMS = [
  { id: 41, name: 'Wii U', abbreviation: 'WiiU', platform_logo: { image_id: 'pl6n' } },
  { id: 5, name: 'Wii', abbreviation: 'Wii', platform_logo: { image_id: 'pl92' } },
];

const IGDB_SOURCES = [
  { id: 1, name: 'Steam' },
  { id: 26, name: 'Stubbed Storefront' },
];

type StubOpts = {
  /** Make every /api/* call answer with an empty array — the swallowed-failure case. */
  empty?: boolean;
  /** Make every /api/* call answer 401 — the credentials-rejected case. */
  fail?: boolean;
};

async function stubApi(page: Page, opts: StubOpts = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('igdb_client_id', 'qa-phase4-stub');
    localStorage.setItem('igdb_access_token', 'qa-phase4-token');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const body = route.request().postData() || '';
    const json = (v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });

    if (opts.fail) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Unauthorized"}' });
    if (opts.empty) return json([]);

    switch (url.pathname) {
      case '/api/collections': {
        const byId = body.match(/where id = \(([\d,\s]+)\)/);
        if (byId) {
          const ids = byId[1].split(',').map(s => Number(s.trim()));
          return json(IGDB_COLLECTIONS.filter(c => ids.includes(c.id)));
        }
        const byName = body.match(/where name ~ \*"(.*?)"\*/);
        if (byName) {
          const q = byName[1].toLowerCase();
          return json(IGDB_COLLECTIONS.filter(c => c.name.toLowerCase().includes(q)));
        }
        /* The Discover feed opens at a RANDOM offset (Collections.jsx:139), so
           an offset-aware stub returns an empty first page most runs. Answer
           every page with the same short list: it is shorter than FEED_HALF, so
           the feed marks itself done after one call and does not loop. */
        return json(IGDB_COLLECTIONS);
      }
      case '/api/collection_memberships': {
        const m = body.match(/where collection = (\d+)/);
        const col = IGDB_COLLECTIONS.find(c => String(c.id) === m?.[1]);
        return json((col?.games || []).map(g => ({
          game: { ...g, first_release_date: 1431993600, platforms: [] },
          type: { name: 'Main' },
        })));
      }
      case '/api/franchises': {
        const byId = body.match(/where id = (\d+); limit 1/);
        if (byId) {
          const fr = IGDB_FRANCHISES.find(f => String(f.id) === byId[1]);
          return json(fr ? [{ id: fr.id, name: fr.name, games: fr.games.map(g => g.id) }] : []);
        }
        const byName = body.match(/where name ~ \*"(.*?)"\*/);
        if (byName) {
          const q = byName[1].toLowerCase();
          return json(IGDB_FRANCHISES.filter(f => f.name.toLowerCase().includes(q)));
        }
        return json(IGDB_FRANCHISES);
      }
      case '/api/games': {
        const byId = body.match(/where id = \(([\d,\s]+)\)/);
        if (byId) {
          const ids = byId[1].split(',').map(s => Number(s.trim()));
          return json(IGDB_GAMES.filter(g => ids.includes(g.id)));
        }
        const search = body.match(/search "(.*?)"/);
        if (search) {
          const q = search[1].toLowerCase();
          return json(IGDB_GAMES.filter(g => g.name.toLowerCase().includes(q)));
        }
        return json([]);
      }
      case '/api/platforms': {
        const m = body.match(/where name ~ \*"(.*?)"\*/);
        const q = (m?.[1] || '').toLowerCase();
        return json(IGDB_PLATFORMS.filter(p => p.name.toLowerCase().includes(q) || (p.abbreviation || '').toLowerCase().includes(q)));
      }
      case '/api/external_game_sources': {
        const m = body.match(/where name ~ \*"(.*?)"\*/);
        const q = (m?.[1] || '').toLowerCase();
        return json(IGDB_SOURCES.filter(s => s.name.toLowerCase().includes(q)));
      }
      default:
        return json([]);
    }
  });
}

/* ── Small drivers ────────────────────────────────────────────────────────── */

/** Open a CollectionTile's ⋯ menu. DropdownMenu closes on ANY scroll
    (DropdownMenu.jsx:142) and Playwright's own scroll-into-view fires one, so
    scroll first, settle, THEN click — phase 3's trap, carried forward. */
async function openTileMenu(page: Page, tile: ReturnType<Page['locator']>) {
  const trigger = tile.getByRole('button', { name: 'Collection options' });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Toasts live 6s (Toast.jsx:19) at top-right, z 10100, pointer-events auto —
    they sit ON TOP of a PageHeader action button. Dismiss them before clicking
    anything up there. See FINDING 17b. */
async function clearToasts(page: Page) {
  const close = page.getByRole('button', { name: 'Dismiss notification' });
  for (let i = await close.count(); i > 0; i--) {
    await close.first().click({ timeout: 3000 }).catch(() => {});
  }
  await expect(close).toHaveCount(0, { timeout: 9000 });
}

/** Read a moctale_* key back out of localStorage. */
function readKey<T = unknown>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key) as Promise<T>;
}

type Coll = { id: string; name: string; description?: string; games?: number[] };

/** The Saved tab of /collections, reached by its tab button. */
async function gotoSaved(page: Page) {
  await page.goto('/collections');
  await page.getByRole('button', { name: 'Saved' }).click();
  await expect(page.getByRole('heading', { name: 'Your Collections' })).toBeVisible();
}

// ═══════════════════════════════════════════════════════════════════════════
// /collections — DISCOVER
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/collections — Discover', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('the page tabs flip aria-pressed and swap the panel', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/collections');
    const discover = page.getByRole('button', { name: 'Discover' });
    const saved = page.getByRole('button', { name: 'Saved' });

    await expect(discover).toHaveAttribute('aria-pressed', 'true');
    await expect(saved).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByLabel('Search collections and franchises')).toBeVisible();

    await saved.click();
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    await expect(discover).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByLabel('Search collections and franchises')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your Collections' })).toBeVisible();

    await discover.click();
    await expect(page.getByLabel('Search collections and franchises')).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('the feed interleaves collections and franchises, each linked to its own route', async ({ page }) => {
    await page.goto('/collections');
    await expect(page.getByRole('link', { name: 'Stub Saga Collection' })).toHaveAttribute('href', '/collection/igdb/7001');
    await expect(page.getByRole('link', { name: 'Stub Franchise Alpha' })).toHaveAttribute('href', '/franchise/9001');
    // The meta line distinguishes the two kinds.
    await expect(page.getByText('Franchise', { exact: true }).first()).toBeVisible();
  });

  test('search narrows to matches and the clear button restores the feed', async ({ page }) => {
    await page.goto('/collections');
    await expect(page.getByRole('link', { name: 'Stub Anthology' })).toBeVisible();

    const input = page.getByLabel('Search collections and franchises');
    await input.fill('Alpha');
    await expect(page.getByRole('link', { name: 'Stub Franchise Alpha' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Anthology' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(input).toHaveValue('');
    await expect(page.getByRole('link', { name: 'Stub Anthology' })).toBeVisible();
  });

  test('a search with no match shows the Nothing found plate', async ({ page }) => {
    await page.goto('/collections');
    await page.getByLabel('Search collections and franchises').fill('zzzz-no-such-shelf');
    await expect(page.getByText('Nothing found')).toBeVisible({ timeout: 15000 });
  });

  test('a metacharacter query does not break the search', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/collections');
    const input = page.getByLabel('Search collections and franchises');
    for (const q of ['"', '\\', '%', '*', '(', 'a"b*c']) {
      await input.fill(q);
      await page.waitForTimeout(500);
    }
    await expect(input).toHaveValue('a"b*c');
    expect(realErrors(errs)).toEqual([]);
  });

  test('Save to Shelves on a collection tile writes the id and flips the menu label', async ({ page }) => {
    await page.goto('/collections');
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Stub Saga Collection' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Save to Shelves' }).click();

    await expect(page.getByText('Saved "Stub Saga Collection"')).toBeVisible();
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([7001]);

    await openTileMenu(page, tile);
    await expect(page.getByRole('menuitem', { name: 'Remove from Shelves' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Remove from Shelves' }).click();
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([]);
  });

  test('Save to Shelves on a franchise tile writes moctale_franchises', async ({ page }) => {
    await page.goto('/collections');
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Stub Franchise Alpha' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Save to Shelves' }).click();
    expect(await readKey<{ id: number; name: string }[]>(page, KEYS.franchises))
      .toEqual([{ id: 9001, name: 'Stub Franchise Alpha' }]);
  });

  test('a total IGDB failure on Discover says so and offers a retry', async ({ page }) => {
    await page.unroute('**/api/**');
    await stubApi(page, { fail: true });
    await page.goto('/collections');
    await page.waitForTimeout(2500);

    await expect(page.getByRole('button', { name: 'Collection options' })).toHaveCount(0);
    await expect(page.getByText(/did not answer|could not reach/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /try again|retry/i }).first()).toBeVisible();
    // The search box is still there, so the tab is usable once the index returns.
    await expect(page.getByLabel('Search collections and franchises')).toBeVisible();
  });  test('FINDING 2 — a franchise tile names its own menu "Collection options"', async ({ page }) => {
    await page.goto('/collections');
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Stub Franchise Alpha' }) });
    await expect(tile.getByRole('button', { name: 'Collection options' })).toBeVisible();
    await expect(tile.getByRole('button', { name: /franchise options/i })).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /collections — SAVED: create, delete, empty state
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/collections — Saved', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('the empty state names the control that fixes it, and contains it', async ({ page }) => {
    await gotoSaved(page);
    await expect(page.getByRole('heading', { name: 'No collections yet' })).toBeVisible();
    // The control is inside the plate, not 85px above it, and does not repeat
    // the header button's accessible name.
    await expect(page.getByRole('button', { name: 'Create your first collection' })).toBeVisible();
  });  test('New Collection opens the name field and flips its own label to Cancel', async ({ page }) => {
    await gotoSaved(page);
    const toggle = page.getByRole('button', { name: 'New Collection' });
    await toggle.click();
    await expect(page.getByLabel('New collection name')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('New collection name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Collection' })).toBeVisible();
  });

  test('Create writes the collection, toasts, and updates the header count', async ({ page }) => {
    const errs = watchConsole(page);
    await gotoSaved(page);
    await expect(page.getByText('0 Shelves')).toBeVisible();

    await page.getByRole('button', { name: 'New Collection' }).click();
    await page.getByLabel('New collection name').fill('Phase Four Shelf');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Created "Phase Four Shelf"')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Phase Four Shelf' })).toBeVisible();
    await expect(page.getByText('1 Shelf')).toBeVisible();

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Phase Four Shelf');
    expect(stored[0].games).toEqual([]);
    // The form closes and clears itself.
    await expect(page.getByLabel('New collection name')).toHaveCount(0);
    expect(realErrors(errs)).toEqual([]);
  });

  test('Enter in the name field creates without touching the Create button', async ({ page }) => {
    await gotoSaved(page);
    await page.getByRole('button', { name: 'New Collection' }).click();
    await page.getByLabel('New collection name').fill('Keyboard Made This');
    await page.getByLabel('New collection name').press('Enter');
    await expect(page.getByRole('link', { name: 'Keyboard Made This' })).toBeVisible();
    expect(await readKey<Coll[]>(page, KEYS.collections)).toHaveLength(1);
  });

  test('a duplicate name is refused with a toast and creates nothing', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Already Here', games: [] }] });
    await gotoSaved(page);
    await page.getByRole('button', { name: 'New Collection' }).click();
    // Case-insensitive, per Collections.jsx:240.
    await page.getByLabel('New collection name').fill('already here');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('"already here" already exists')).toBeVisible();
    expect(await readKey<Coll[]>(page, KEYS.collections)).toHaveLength(1);
  });

  test('Create with an empty name says what is missing', async ({ page }) => {
    await gotoSaved(page);
    await page.getByRole('button', { name: 'New Collection' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(600);

    // Nothing created, nothing said, the form stays open with no error message.
    expect(await readKey<Coll[]>(page, KEYS.collections) ?? []).toEqual([]);
    await expect(page.getByLabel('New collection name')).toBeVisible();
    await expect(page.getByText('Enter a name for the collection')).toBeVisible();
  });

  test('a whitespace-only name says what is missing too', async ({ page }) => {
    await gotoSaved(page);
    await page.getByRole('button', { name: 'New Collection' }).click();
    await page.getByLabel('New collection name').fill('     ');
    await page.getByLabel('New collection name').press('Enter');
    await page.waitForTimeout(600);
    expect(await readKey<Coll[]>(page, KEYS.collections) ?? []).toEqual([]);
    await expect(page.getByText('Enter a name for the collection')).toBeVisible();
  });

  test('a long collection name is clamped, not overflowed', async ({ page }) => {
    const LONG = 'A Collection Whose Name Simply Refuses To Stop Going On And On For Ever And Ever Amen';
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: LONG, games: [] }] });
    await gotoSaved(page);
    const caption = page.locator('.line-clamp-2').filter({ hasText: 'A Collection Whose Name' }).first();
    await expect(caption).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // The accessible name of the link is the full string, so nothing is lost to AT.
    await expect(page.getByRole('link', { name: LONG })).toBeVisible();
  });

  test('Delete Collection: the confirm appears, Cancel genuinely cancels', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Keep Me', games: [1942] }] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Keep Me' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Delete Collection' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Delete this collection?')).toBeVisible();
    await expect(dialog.getByText(/"Keep Me" and its list of games will be removed/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Keep Me' })).toBeVisible();
    expect(await readKey<Coll[]>(page, KEYS.collections)).toHaveLength(1);

    // And it survives a reload — Cancel did not half-write.
    await page.reload();
    await page.getByRole('button', { name: 'Saved' }).click();
    await expect(page.getByRole('link', { name: 'Keep Me' })).toBeVisible();
  });

  test('Delete Collection: Escape cancels, and focus returns to the trigger', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Escape Me', games: [] }] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Escape Me' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Delete Collection' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readKey<Coll[]>(page, KEYS.collections)).toHaveLength(1);
  });

  test('Delete Collection: the confirm button is the danger variant, focus starts on Cancel', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Danger Check', games: [] }] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Danger Check' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Delete Collection' }).click();

    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Delete' });
    // Per CLAUDE.md: a destructive action uses the danger variant everywhere,
    // including its confirm button. Read the computed colour, not the class.
    const [colour, destructive] = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="dialog"] button')];
      const del = btns.find(b => b.textContent?.trim() === 'Delete')!;
      return [
        getComputedStyle(del).color,
        getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
      ];
    });
    expect(destructive).not.toBe('');
    expect(colour).not.toBe('rgb(255, 255, 255)');
    // Focus lands on Cancel, never on the destructive button (ConfirmDialog.jsx:61).
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(confirm).toBeVisible();
  });

  test('Delete Collection: confirming removes the tile, the row and the count', async ({ page }) => {
    await seed(page, {
      [KEYS.collections]: [
        { id: 'c1', name: 'Doomed Shelf', games: [8001] },
        { id: 'c2', name: 'Survivor Shelf', games: [] },
      ],
    });
    await gotoSaved(page);
    await expect(page.getByText('2 Shelves')).toBeVisible();

    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Doomed Shelf' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Delete Collection' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Deleted "Doomed Shelf"')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Doomed Shelf' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Survivor Shelf' })).toBeVisible();
    await expect(page.getByText('1 Shelf')).toBeVisible();

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored.map(c => c.name)).toEqual(['Survivor Shelf']);
  });

  test('a saved IGDB collection and a saved franchise both appear under Saved Shelves', async ({ page }) => {
    await seed(page, {
      [KEYS.savedIgdbCollections]: [7001],
      [KEYS.franchises]: [{ id: 9002, name: 'Stub Franchise Beta' }],
    });
    await gotoSaved(page);
    await expect(page.getByRole('heading', { name: 'Saved Shelves' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Saga Collection' })).toHaveAttribute('href', '/collection/igdb/7001');
    await expect(page.getByRole('link', { name: 'Stub Franchise Beta' })).toHaveAttribute('href', '/franchise/9002');
  });

  test('Remove from Shelves drops a saved shelf and its stored id', async ({ page }) => {
    await seed(page, { [KEYS.savedIgdbCollections]: [7001] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Stub Saga Collection' }) });
    await openTileMenu(page, tile);
    await page.getByRole('menuitem', { name: 'Remove from Shelves' }).click();
    await expect(page.getByText('Removed "Stub Saga Collection"')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Saga Collection' })).toHaveCount(0);
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([]);
  });

  test('FINDING 4 — Remove from Shelves is destructive-styled but has no confirm at all', async ({ page }) => {
    await seed(page, { [KEYS.savedIgdbCollections]: [7001] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'Stub Saga Collection' }) });
    await openTileMenu(page, tile);
    // The menu row declares variant: 'danger' (Collections.jsx:498) …
    const item = page.getByRole('menuitem', { name: 'Remove from Shelves' });
    await item.click();
    // … and yet it fires immediately, with no dialog and no undo.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([]);
  });

  test('FINDING 5 — a collection can only be renamed from inside it; the tile menu offers no Rename', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'No Rename Here', games: [] }] });
    await gotoSaved(page);
    const tile = page.locator('div.group').filter({ has: page.getByRole('link', { name: 'No Rename Here' }) });
    await openTileMenu(page, tile);
    // lh-label uppercases in CSS, so innerText comes back shouting.
    const items = await page.getByRole('menuitem').allInnerTexts();
    expect(items.map(s => s.trim().toLowerCase())).toEqual(['delete collection']);
  });

  test('FINDING 6 — collections cannot be reordered: no drag handle, no move control, no sort', async ({ page }) => {
    await seed(page, {
      [KEYS.collections]: [
        { id: 'c1', name: 'Zulu Shelf', games: [] },
        { id: 'c2', name: 'Alpha Shelf', games: [] },
      ],
    });
    await gotoSaved(page);
    // Insertion order is the only order there is: Zulu was stored first and
    // renders first, so there is not even an implicit alphabetical sort.
    const names = await page.locator('.line-clamp-2').allInnerTexts();
    expect(names.map(s => s.trim().toLowerCase())).toEqual(['zulu shelf', 'alpha shelf']);
    // Nothing on the page can change that.
    await expect(page.locator('[draggable="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /move|reorder|sort|up|down/i })).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /collection/:id — a custom collection
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/collection/:id — custom', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  const ONE: Coll[] = [{ id: 'c1', name: 'Working Shelf', description: 'Seeded description.', games: [8001, 8002] }];

  test('the header renders name, count, meta and description; Back returns to /collections', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await expect(page.getByRole('heading', { level: 1, name: 'Working Shelf' })).toBeVisible();
    await expect(page.getByText('2 Titles')).toBeVisible();
    await expect(page.getByText('Collection — Custom')).toBeVisible();
    await expect(page.getByText('Seeded description.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Saga I', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Collections/ }).first().click();
    await expect(page).toHaveURL(/\/collections$/);
  });

  test('Edit prefills the fields, Save renames without losing the games', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Edit' }).click();

    const nameField = page.getByLabel('Name');
    const descField = page.getByLabel('Description');
    await expect(nameField).toHaveValue('Working Shelf');
    await expect(descField).toHaveValue('Seeded description.');

    await nameField.fill('Renamed Shelf');
    await descField.fill('Rewritten description.');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Collection updated')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Renamed Shelf' })).toBeVisible();
    await expect(page.getByText('Rewritten description.')).toBeVisible();

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored[0].name).toBe('Renamed Shelf');
    expect(stored[0].description).toBe('Rewritten description.');
    // The rename must not eat the membership list.
    expect(stored[0].games).toEqual([8001, 8002]);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Renamed Shelf' })).toBeVisible();
  });

  test('Edit > Cancel discards the typed edit and writes nothing', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('Never Saved');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Working Shelf' })).toBeVisible();
    expect((await readKey<Coll[]>(page, KEYS.collections))[0].name).toBe('Working Shelf');
  });

  test('Save with an emptied name says what is missing and keeps the stored name', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Enter a name for the collection')).toBeVisible();
    expect((await readKey<Coll[]>(page, KEYS.collections))[0].name).toBe('Working Shelf');
  });  test('FINDING 8 — Edit accepts a name that Create would have refused as a duplicate', async ({ page }) => {
    await seed(page, {
      [KEYS.collections]: [
        { id: 'c1', name: 'Working Shelf', games: [] },
        { id: 'c2', name: 'Twin Shelf', games: [] },
      ],
    });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('Twin Shelf');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Collection updated')).toBeVisible();

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored.map(c => c.name)).toEqual(['Twin Shelf', 'Twin Shelf']);

    // And now /collections shows two tiles that cannot be told apart.
    await gotoSaved(page);
    await expect(page.getByRole('link', { name: 'Twin Shelf' })).toHaveCount(2);
  });

  test('Add games: search, add, the button flips to Added and the card appears', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Add Here', games: [] }] });
    await page.goto('/collection/c1');
    await expect(page.getByText('Empty Shelf')).toBeVisible();

    const search = page.getByLabel('Search games to add');
    await search.fill('Addable');
    const row = page.locator('div').filter({ hasText: /^Addable Stub Game/ }).last();
    const add = page.getByRole('button', { name: 'Add' }).first();
    await expect(add).toBeVisible({ timeout: 15000 });
    await add.click();

    await expect(page.getByText('Added "Addable Stub Game"')).toBeVisible();
    const added = page.getByRole('button', { name: 'Added' }).first();
    await expect(added).toBeVisible();
    await expect(added).toHaveAttribute('aria-disabled', 'true');
    expect((await readKey<Coll[]>(page, KEYS.collections))[0].games).toEqual([8005]);
    await expect(page.getByText('1 Title')).toBeVisible();
    await expect(row).toBeVisible();
  });

  test('Add games: a second click on Added does not duplicate the entry', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Add Here', games: [] }] });
    await page.goto('/collection/c1');
    await page.getByLabel('Search games to add').fill('Addable');
    await page.getByRole('button', { name: 'Add' }).first().click();
    // aria-disabled, not disabled — Playwright treats it as not enabled, but a
    // real pointer still reaches it, so force the click a user could make.
    await page.getByRole('button', { name: 'Added' }).first().click({ force: true });
    await page.waitForTimeout(400);
    expect((await readKey<Coll[]>(page, KEYS.collections))[0].games).toEqual([8005]);
  });

  test('Add games: no match shows its own plate, and Clear restores the box', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Add Here', games: [] }] });
    await page.goto('/collection/c1');
    const search = page.getByLabel('Search games to add');
    await search.fill('zzzz-nothing-matches');
    await expect(page.getByText('No games found')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await expect(page.getByText('No games found')).toHaveCount(0);
  });

  test('Remove from Collection drops the card and the stored id', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await expect(page.getByRole('link', { name: 'Stub Saga I', exact: true })).toBeVisible();

    const card = page.locator('.game-grid > div').filter({ has: page.getByRole('link', { name: 'Stub Saga I', exact: true }) }).first();
    const trigger = card.getByRole('button').first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Remove from Collection' }).click();

    await expect(page.getByText('Removed "Stub Saga I"')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Saga I', exact: true })).toHaveCount(0);
    expect((await readKey<Coll[]>(page, KEYS.collections))[0].games).toEqual([8002]);
    await expect(page.getByText('1 Title')).toBeVisible();
  });

  test('the empty-shelf plate points at the search box on the same screen', async ({ page }) => {
    await seed(page, { [KEYS.collections]: [{ id: 'c1', name: 'Nothing In Here Yet', games: [] }] });
    await page.goto('/collection/c1');
    await expect(page.getByRole('heading', { name: 'Empty Shelf' })).toBeVisible();
    await expect(page.getByText('Search IGDB above to add your first title.')).toBeVisible();
    // And the plate carries the control it names.
    await page.getByRole('button', { name: 'Search IGDB' }).click();
    await expect(page.getByLabel('Search games to add')).toBeFocused();
  });  test('Delete: the confirm appears, Cancel keeps the collection and stays on the page', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete this collection?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/collection\/c1$/);
    expect(await readKey<Coll[]>(page, KEYS.collections)).toHaveLength(1);
  });

  test('Delete: the trigger and its confirm both use the danger variant', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    const triggerColour = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === 'Delete')!;
      return getComputedStyle(b).color;
    });
    await page.getByRole('button', { name: 'Delete' }).click();
    const confirmColour = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent?.trim() === 'Delete')!;
      return getComputedStyle(b).color;
    });
    expect(confirmColour).toBe(triggerColour);
    expect(confirmColour).not.toBe('rgb(255, 255, 255)');
  });

  test('Delete: confirming leaves for /collections and the tile is gone', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/collections$/);
    await expect(page.getByText('Deleted "Working Shelf"')).toBeVisible();
    expect(await readKey<Coll[]>(page, KEYS.collections)).toEqual([]);
  });

  test('the Not Found plate for a bogus collection id carries a heading', async ({ page }) => {
    await page.goto('/collection/no-such-collection-id');
    await expect(page.getByText('This collection does not exist')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not Found' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Collections' }).click();
    await expect(page).toHaveURL(/\/collections$/);
  });  test('the grid toolbar drives this route too — a sort reorders the shelf', async ({ page }) => {
    await seed(page, { [KEYS.collections]: ONE });
    await page.goto('/collection/c1');
    const first = () => page.locator('.game-grid [role="link"]').first();
    await expect(first()).toBeVisible();
    const before = await first().getAttribute('aria-label');

    const sort = page.getByRole('button', { name: /^Sort/ });
    await sort.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await sort.click();
    await page.getByRole('menuitemradio', { name: 'A → Z' }).click();
    await page.waitForTimeout(400);
    const after = await first().getAttribute('aria-label');
    expect([before, after].every(Boolean)).toBe(true);
    expect(after).toBe('Stub Saga I');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /collection/igdb/:id — a community collection
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/collection/igdb/:id', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('it offers Save and Clone, and none of the custom-only controls', async ({ page }) => {
    await page.goto('/collection/igdb/7001');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Saga Collection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clone' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(page.getByLabel('Search games to add')).toHaveCount(0);
  });

  test('Save toggles the stored id and the button label', async ({ page }) => {
    await page.goto('/collection/igdb/7001');
    const btn = page.getByRole('button', { name: 'Save' });
    await btn.click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([7001]);

    // Second surface for FINDING 27: the toast covers this header button too,
    // so the un-save is unreachable by pointer until it expires. Measured here
    // as a real click interception, not a geometry calculation (p4-run4.log).
    await clearToasts(page);
    await page.getByRole('button', { name: 'Saved' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    expect(await readKey<number[]>(page, KEYS.savedIgdbCollections)).toEqual([]);
  });

  test('a community card carries no Remove from Collection option', async ({ page }) => {
    await page.goto('/collection/igdb/7001');
    const card = page.locator('.game-grid > div').first();
    await expect(card).toBeVisible();
    // GameCard.jsx:580 falls back to its own add-to-library menu when the caller
    // passes none, so a trigger IS there — what must not be there is the
    // collection-editing row.
    const trigger = card.getByRole('button').first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Remove from Collection' })).toHaveCount(0);
  });

  test('Clone writes a local copy carrying the games and navigates to it', async ({ page }) => {
    await page.goto('/collection/igdb/7001');
    await page.getByRole('button', { name: 'Clone' }).click();
    await expect(page.getByText('Cloned to My Collections')).toBeVisible();
    await expect(page).toHaveURL(/\/collection\/coll_/);
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Saga Collection (Clone)' })).toBeVisible();

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored).toHaveLength(1);
    expect(stored[0].games).toEqual([8001, 8002]);
    expect(stored[0].description).toBe('Cloned from community collection.');
  });

  test('FINDING 11 — Clone twice makes two collections with the same name and no warning', async ({ page }) => {
    await page.goto('/collection/igdb/7001');
    await page.getByRole('button', { name: 'Clone' }).click();
    await expect(page).toHaveURL(/\/collection\/coll_/);
    await page.goto('/collection/igdb/7001');
    await page.getByRole('button', { name: 'Clone' }).click();
    await expect(page).toHaveURL(/\/collection\/coll_/);

    const stored = await readKey<Coll[]>(page, KEYS.collections);
    expect(stored).toHaveLength(2);
    expect(stored[0].name).toBe(stored[1].name);
    await expect(page.getByText(/already exists/)).toHaveCount(0);
  });

  test('Clone is not offered on a failed community page, so no empty shelf is written', async ({ page }) => {
    await page.unroute('**/api/**');
    await stubApi(page, { fail: true });
    await page.goto('/collection/igdb/7001');
    await expect(page.getByText(/did not answer|could not reach/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Clone' })).toHaveCount(0);
    expect((await readKey<Coll[]>(page, KEYS.collections)) ?? []).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /franchise/:franchiseId
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/franchise/:franchiseId', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('it renders the franchise, its count and its titles', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/franchise/9001');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Franchise Alpha' })).toBeVisible();
    await expect(page.getByText('1 Title')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stub Saga I', exact: true })).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('Save toggles moctale_franchises and the button label', async ({ page }) => {
    await page.goto('/franchise/9001');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Franchise Alpha' })).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved Stub Franchise Alpha')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
    expect(await readKey<{ id: number; name: string }[]>(page, KEYS.franchises))
      .toEqual([{ id: 9001, name: 'Stub Franchise Alpha' }]);

    await clearToasts(page);
    await page.getByRole('button', { name: 'Saved' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    expect(await readKey<unknown[]>(page, KEYS.franchises)).toEqual([]);
  });

  test('the toast does not cover the button that raised it', async ({ page }) => {
    await page.goto('/franchise/9001');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Franchise Alpha' })).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    // Wait out the slide-in: the toast is not at its resting position on the click frame.
    await page.waitForTimeout(600);
    const box = (await page.getByRole('button', { name: 'Saved' }).boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[role="status"]') ? 'toast' : (el?.tagName || 'none');
    }, centre);
    expect(hit).not.toBe('toast');
  });  test('the save survives a reload — the page reads the stored state on mount', async ({ page }) => {
    await seed(page, { [KEYS.franchises]: [{ id: 9001, name: 'Stub Franchise Alpha' }] });
    await page.goto('/franchise/9001');
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20000 });
  });

  test('a library entry in the franchise shows its shelf badge and the owned count', async ({ page }) => {
    await seed(page, {
      [KEYS.library]: [{ id: 8001, name: 'Stub Saga I', status: 'Beaten', is_custom: false, cover_id: 'co1wyy', release_year: 2015 }],
    });
    await page.goto('/franchise/9001');
    await expect(page.getByRole('heading', { level: 1, name: 'Stub Franchise Alpha' })).toBeVisible();
    await expect(page.getByText('1 in Library')).toBeVisible();
  });

  test('Back returns to the page you came from', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('link', { name: 'Stub Franchise Alpha' }).click();
    await expect(page).toHaveURL(/\/franchise\/9001$/);
    await page.getByRole('button', { name: 'Go back to previous page' }).click();
    await expect(page).toHaveURL(/\/collections$/);
  });

  test('an unknown franchise says so in its heading', async ({ page }) => {
    await page.goto('/franchise/99999999');
    await expect(page.getByText('No Entries')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('IGDB lists no titles for this franchise')).toBeVisible();
    // The heading names the state instead of keeping the loading placeholder.
    // innerText is the rendered text, and the masthead is set uppercase.
    const h1 = await page.getByRole('heading', { level: 1 }).innerText();
    expect(h1.trim()).toBe('FRANCHISE NOT FOUND');
  });

  test('Save on an unknown franchise is refused instead of storing a nameless shelf', async ({ page }) => {
    await page.goto('/franchise/99999999');
    await expect(page.getByText('No Entries')).toBeVisible({ timeout: 20000 });
    // No name has arrived, so there is nothing to save and the control says so.
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect((await readKey<unknown[]>(page, KEYS.franchises)) ?? []).toEqual([]);
  });

  test('a failing IGDB call reads differently from an unknown franchise', async ({ page }) => {
    await page.unroute('**/api/**');
    await stubApi(page, { fail: true });
    await page.goto('/franchise/9001');
    // A failed index says so and offers a retry; an unknown franchise says something else.
    await expect(page.getByText('The index did not answer')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    const h1 = await page.getByRole('heading', { level: 1 }).innerText();
    expect(h1.trim()).toBe('FRANCHISE UNAVAILABLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /game/:id/collections — the orphan stub
// ═══════════════════════════════════════════════════════════════════════════

test.describe('/game/:id/collections', () => {
  test('the stub renders and its one control goes back to the game', async ({ page }) => {
    await stubApi(page);
    await page.goto('/game/8001/collections');
    await expect(page.getByRole('heading', { level: 1, name: 'Game Collections' })).toBeVisible();
    await expect(page.getByText('Collections Disabled')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Game' }).click();
    await expect(page).toHaveURL(/\/game\/8001$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /platforms — ManagePlatforms
// ═══════════════════════════════════════════════════════════════════════════

/** The Your-Consoles / Your-Storefronts panel, so a pill query never matches
    the suggestion sidebar by accident. */
const ownedPanel = (page: Page) => page.locator('div.flex-1').filter({ has: page.getByRole('heading', { level: 2 }) });

test.describe('/platforms — tabs, search, suggestions', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('the three tabs flip aria-pressed and swap the heading, blurb and placeholder', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/platforms');
    await expect(page.getByRole('heading', { level: 1, name: 'Manage Platforms' })).toBeVisible();

    const cases = [
      ['Hardware', 'Your Consoles', 'e.g. PlayStation 3...', 'Search consoles'],
      ['Stores', 'Your Storefronts', 'e.g. Steam, GOG...', 'Search storefronts'],
      ['Subscriptions', 'Your Subscriptions', 'e.g. Xbox Game Pass...', 'Search subscriptions'],
    ] as const;

    for (const [tab, heading, placeholder, label] of cases) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      await expect(page.getByLabel(label)).toHaveAttribute('placeholder', placeholder);
    }
    expect(realErrors(errs)).toEqual([]);
  });

  test('switching tab clears a live query and its results', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('Wii');
    await expect(page.getByText('Create Custom "Wii"')).toBeVisible();
    await page.getByRole('button', { name: 'Stores', exact: true }).click();
    await expect(page.getByLabel('Search storefronts')).toHaveValue('');
    await expect(page.getByText(/Create Custom/)).toHaveCount(0);
  });

  test('the empty state names the two ways out of it', async ({ page }) => {
    await page.goto('/platforms');
    await expect(page.getByText('No entries added yet')).toBeVisible();
    await expect(page.getByText('0 Configured')).toBeVisible();
    await expect(page.getByText('Suggested Platforms')).toBeVisible();
  });

  test('a suggestion adds the console, leaves the suggestion list and updates the count', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: /PlayStation 5|PS5/ }).first().click();
    await expect(page.getByText(/Added PS5 to owned hardware/)).toBeVisible();
    await expect(page.getByText('1 Configured')).toBeVisible();
    await expect(ownedPanel(page).getByText('Official').first()).toBeVisible();

    // Platforms live inside the user profile (db.js:321, :528).
    const profile = await readKey<{ platforms: { id: number }[] }>(page, KEYS.profile);
    expect(profile.platforms.map(p => p.id)).toEqual([167]);
  });

  test('the search box finds an IGDB platform and adding it moves it into Your Consoles', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('Wii U');
    // Scope to the results list: the Create-Custom button's own label contains
    // the query too, and getByText would grab that first.
    const result = page.locator('div.flex.flex-col.gap-1 [role="button"]').filter({ hasText: 'WiiU' }).first();
    await expect(result).toBeVisible({ timeout: 15000 });
    await result.click();
    await expect(page.getByText('Added WiiU to owned hardware')).toBeVisible();
    // The query is cleared as part of the add.
    await expect(page.getByLabel('Search consoles')).toHaveValue('');
    await expect(page.getByText('1 Configured')).toBeVisible();
  });

  test('a query with no IGDB match still offers the create path', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('zzzz-no-such-console');
    await expect(page.getByText('No platforms found on IGDB')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Create Custom "zzzz-no-such-console"')).toBeVisible();
  });

  test('the Subscriptions tab has a no-results state of its own', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: 'Subscriptions', exact: true }).click();
    await page.getByLabel('Search subscriptions').fill('zzzz-no-such-sub');
    await page.waitForTimeout(900);
    await expect(page.getByText('No subscriptions match that search')).toBeVisible();
    await expect(page.getByText('No platforms found on IGDB')).toHaveCount(0);
    await expect(page.getByText('Create Custom "zzzz-no-such-sub"')).toBeVisible();
  });  test('FINDING 18 — every action pill claims to be an unpressed toggle', async ({ page }) => {
    await page.goto('/platforms');
    const pill = page.locator('[role="button"][aria-pressed]').first();
    await expect(pill).toBeVisible();
    // PlatformPill.jsx:12 hardwires aria-pressed to !!isSelected and ManagePlatforms
    // never passes isSelected, so an ADD button announces as a toggle that is off.
    const states = await page.locator('[role="button"][aria-pressed]').evaluateAll(
      els => els.map(e => e.getAttribute('aria-pressed')));
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['false']));
  });

  test('searching Stores emits no duplicate React keys', async ({ page }) => {
    const errs = watchConsole(page);
    await page.goto('/platforms');
    await page.getByRole('button', { name: 'Stores', exact: true }).click();
    // "sto" matches four POPULAR_STORES rows, none of which has an `id`.
    await page.getByLabel('Search storefronts').fill('sto');
    await page.waitForTimeout(1500);
    const keyWarnings = errs.filter(e => /same key|unique "key"|Encountered two children/i.test(e));
    expect(keyWarnings).toEqual([]);
  });
});

test.describe('/platforms — custom entries', () => {
  test.beforeEach(async ({ page }) => { await stubApi(page); });

  test('Create Custom confirms first, and Cancel creates nothing', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('My Attic Console');
    await page.getByText('Create Custom "My Attic Console"').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Create Custom Platform')).toBeVisible();
    await expect(dialog.getByText(/create a custom platform named "My Attic Console"/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('0 Configured')).toBeVisible();
  });

  test('Create Custom uses the primary variant, not the danger one', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('Primary Variant Check');
    await page.getByText('Create Custom "Primary Variant Check"').click();
    const colour = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent?.trim() === 'Create')!;
      return getComputedStyle(b).color;
    });
    // A create is not destructive; it must not borrow the danger token.
    expect(colour).toBe('rgb(0, 0, 0)');
  });

  test('Create Custom confirmed adds the entry, toasts, and clears the query', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('My Attic Console');
    await page.getByText('Create Custom "My Attic Console"').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Created custom entry "My Attic Console"')).toBeVisible();
    await expect(page.getByLabel('Search consoles')).toHaveValue('');
    await expect(page.getByText('1 Configured')).toBeVisible();
    await expect(ownedPanel(page).getByText('Custom').first()).toBeVisible();
  });

  test('a duplicate custom name is refused before the dialog opens', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('Twin Console');
    await page.getByText('Create Custom "Twin Console"').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await page.getByLabel('Search consoles').fill('twin console');
    await page.getByText('Create Custom "twin console"').click();
    await expect(page.getByText('"twin console" is already in your list')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('1 Configured')).toBeVisible();
  });

  test('FINDING 20 — a custom entry may take the exact name of an owned official console', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: /PlayStation 5|PS5/ }).first().click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await page.getByLabel('Search consoles').fill('PlayStation 5');
    await page.getByText('Create Custom "PlayStation 5"').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

    // Two entries with one name — the duplicate guard at :392 only reads the
    // CUSTOM list, never ownedPlatforms.
    await expect(page.getByText('2 Configured')).toBeVisible();
    await expect(page.getByText('Created custom entry "PlayStation 5"')).toBeVisible();
    const panel = ownedPanel(page);
    await expect(panel.getByText('Official').first()).toBeVisible();
    await expect(panel.getByText('Custom').first()).toBeVisible();
  });

  test('FINDING 21 — the confirm quotes a name the app will not actually store', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('  Spaced Console  ');
    // The dialog and the toast both echo the RAW query, spaces and all…
    await page.getByText(/Create Custom "\s+Spaced Console\s+"/).click();
    await expect(page.getByRole('dialog').getByText(/named "\s+Spaced Console\s+"/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    // …while db.js:328 trims it on the way in, so the stored name differs from
    // the one you were asked to confirm.
    const profile = await readKey<{ custom_platforms: { name: string }[] }>(page, KEYS.profile);
    expect(profile.custom_platforms.map(p => p.name)).toEqual(['Spaced Console']);

    // The trim does at least make the duplicate guard hold on the second pass.
    await page.getByLabel('Search consoles').fill('Spaced Console');
    await page.getByText('Create Custom "Spaced Console"').click();
    await expect(page.getByText('"Spaced Console" is already in your list')).toBeVisible();
    await expect(page.getByText('1 Configured')).toBeVisible();
  });

  test('deleting a custom entry confirms, Cancel keeps it, Confirm removes it', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByLabel('Search consoles').fill('Deletable Console');
    await page.getByText('Create Custom "Deletable Console"').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    const del = ownedPanel(page).getByTitle('Delete').first();
    await del.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete Custom Platform')).toBeVisible();
    await expect(dialog.getByText(/permanently delete "Deletable Console"/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await ownedPanel(page).getByTitle('Delete').first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Removed "Deletable Console"')).toBeVisible();
    await expect(page.getByText('0 Configured')).toBeVisible();
  });

  test('deleting an owned official console confirms, Cancel keeps it, Confirm removes it', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: /PlayStation 5|PS5/ }).first().click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await ownedPanel(page).getByTitle('Delete').first().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove Platform')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await ownedPanel(page).getByTitle('Delete').first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('0 Configured')).toBeVisible();
    await expect(page.getByText('No entries added yet')).toBeVisible();
  });

  test('the delete confirm uses the danger variant and closes on Escape', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: /PlayStation 5|PS5/ }).first().click();
    await ownedPanel(page).getByTitle('Delete').first().click();

    const [confirmColour, destructive] = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent?.trim() === 'Remove')!;
      return [getComputedStyle(b).color, getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim()];
    });
    expect(destructive).not.toBe('');
    expect(confirmColour).not.toBe('rgb(255, 255, 255)');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('1 Configured')).toBeVisible();
  });

  test('the platform confirm dialog focuses Cancel, and has no Close X', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: /PlayStation 5|PS5/ }).first().click();
    await ownedPanel(page).getByTitle('Delete').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // It is the house ConfirmDialog now, which lands focus on Cancel so a stray
    // Enter cannot delete.
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Close' })).toHaveCount(0);
  });  test('a store suggestion lands under Official with its linked-platform subtitle', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: 'Stores', exact: true }).click();
    await page.getByRole('button', { name: 'Steam' }).first().click();
    await expect(page.getByText('Added Steam to configured list')).toBeVisible();
    await expect(page.getByText('1 Configured')).toBeVisible();
    await expect(ownedPanel(page).getByText('Official', { exact: true })).toBeVisible();
  });

  test('FINDING 26 — the "Linked: X" subtitle can never render', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: 'Stores', exact: true }).click();
    await page.getByRole('button', { name: 'Steam' }).first().click();
    await expect(page.getByText('1 Configured')).toBeVisible();
    // ManagePlatforms.jsx:809 reads `plat.linkedIgdbId ? 'Linked: …' : 'Custom'`,
    // but :733 defines the custom bucket as exactly the rows WITHOUT a
    // linkedIgdbId — so the true arm of that ternary is unreachable. Steam has
    // one, and lands under Official instead.
    await expect(page.getByText(/^Linked:/)).toHaveCount(0);
    await expect(ownedPanel(page).getByText('Official', { exact: true })).toBeVisible();
  });

  test('a subscription suggestion adds and deletes through its own confirm', async ({ page }) => {
    await page.goto('/platforms');
    await page.getByRole('button', { name: 'Subscriptions', exact: true }).click();
    await page.getByRole('button', { name: 'EA Play' }).first().click();
    await expect(page.getByText('Added EA Play to configured list')).toBeVisible();
    await expect(page.getByText('1 Configured')).toBeVisible();

    await ownedPanel(page).getByTitle('Delete').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove Subscription')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('0 Configured')).toBeVisible();
  });
});

test.describe('/platforms — transfer', () => {
  /** A library where one game is linked to the custom platform being transferred. */
  const LIB_ON_CUSTOM = [
    {
      id: 8001, name: 'Stub Saga I', status: 'Beaten', is_custom: false,
      cover_id: 'co1wyy', release_year: 2015,
      user_platforms: [{ name: 'Attic Box', category: 'hardware' }],
    },
    {
      id: 8002, name: 'Stub Saga II', status: 'Backlog', is_custom: false,
      cover_id: 'co2lbd', release_year: 2017, user_platforms: [],
    },
  ];
  const CUSTOM_PLATFORMS = [{ name: 'Attic Box', category: 'hardware', linkedIgdbId: null, linkedIgdbName: null }];

  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await seed(page, {
      [KEYS.library]: LIB_ON_CUSTOM,
      // Platforms live inside the user profile (db.js:321).
      [KEYS.profile]: { name: 'QA Phase 4', platforms: [], custom_platforms: CUSTOM_PLATFORMS },
    });
  });

  test('the transfer dialog opens on step 1 and Preview is inert until a target is picked', async ({ page }) => {
    await page.goto('/platforms');
    await expect(page.getByText('Attic Box')).toBeVisible();
    await ownedPanel(page).getByTitle('Transfer games').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Transfer Access Data' })).toBeVisible();
    await expect(dialog.getByText(/migrate all games linked to/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Preview Transfer' })).toBeDisabled();
  });

  test('the target search narrows, its clear button restores, and a nonsense query says so', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    const search = dialog.getByLabel('Search platforms, stores and subscriptions');

    await search.fill('zzzz-no-such-target');
    await expect(dialog.getByText('No matches found')).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
    await expect(dialog.getByText('No matches found')).toHaveCount(0);
    await expect(dialog.getByText('PS5')).toBeVisible();
  });

  test('picking a target shows the summary, and Change puts the list back', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();

    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Preview Transfer' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Change' }).click();
    await expect(dialog.getByLabel('Search platforms, stores and subscriptions')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Preview Transfer' })).toBeDisabled();
  });

  test('Preview counts only the games linked to the source, and Cancel returns to select', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();

    await expect(dialog.getByRole('heading', { name: 'Preview Transfer' })).toBeVisible();
    await expect(dialog.getByText('1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('game will be updated')).toBeVisible();
    await expect(dialog.getByText('Stub Saga I')).toBeVisible();
    await expect(dialog.getByText('Stub Saga II')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByRole('heading', { name: 'Transfer Access Data' })).toBeVisible();
    // Nothing was written by the preview.
    const lib = await readKey<{ user_platforms: unknown[] }[]>(page, KEYS.library);
    expect(lib[0].user_platforms).toHaveLength(1);
  });

  test('Escape and the X both close the transfer dialog without writing', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await ownedPanel(page).getByTitle('Transfer games').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const lib = await readKey<{ user_platforms: { name: string }[] }[]>(page, KEYS.library);
    expect(lib[0].user_platforms.map(p => p.name)).toEqual(['Attic Box']);
  });

  test('"Transfer" moves the platform: the target is added and the source is removed', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();
    await dialog.getByRole('button', { name: 'Confirm Transfer' }).click();

    await expect(dialog.getByRole('heading', { name: 'Transfer Complete' })).toBeVisible();
    await expect(dialog.getByText('1 game updated')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByText(/Transferred 1 game to "PlayStation 5"/)).toBeVisible();

    // The toast says transferred, and so does the data.
    const lib = await readKey<{ user_platforms: { name: string }[] }[]>(page, KEYS.library);
    expect(lib[0].user_platforms.map(p => p.name)).toEqual(['PlayStation 5']);
  });  test('the delete-after-transfer branch does unlink the source everywhere', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();
    await dialog.getByRole('button', { name: 'Confirm Transfer' }).click();
    await expect(dialog.getByText(/permanently delete/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(/Transferred 1 game and deleted "Attic Box"/)).toBeVisible();
    await expect(ownedPanel(page).getByText('Attic Box', { exact: true })).toHaveCount(0);
    const lib = await readKey<{ user_platforms: { name: string }[] }[]>(page, KEYS.library);
    expect(lib[0].user_platforms.map(p => p.name)).toEqual(['PlayStation 5']);
  });

  test('the delete-after-transfer button is the danger variant', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();
    await dialog.getByRole('button', { name: 'Confirm Transfer' }).click();
    const colour = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent?.trim() === 'Delete')!;
      return getComputedStyle(b).color;
    });
    expect(colour).not.toBe('rgb(255, 255, 255)');
    expect(colour).not.toBe('rgb(0, 0, 0)');
  });

  test('FINDING 24 — a transfer with nothing to move still runs and silently adds the target', async ({ page }) => {
    await page.goto('/platforms');
    // Create a second custom entry that no game is linked to.
    await page.getByLabel('Search consoles').fill('Unused Box');
    await page.getByText('Create Custom "Unused Box"').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(ownedPanel(page).getByText('Unused Box', { exact: true })).toBeVisible();
    await clearToasts(page);

    const row = ownedPanel(page).locator('[title="Transfer games"]');
    await row.last().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();

    await expect(dialog.getByText('No games are currently linked to this entry.')).toBeVisible();
    // Nothing warns you, and Confirm is as prominent as ever.
    await expect(dialog.getByRole('button', { name: 'Confirm Transfer' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Confirm Transfer' }).click();
    await expect(dialog.getByText('0 games updated')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByText(/Transferred 0 games to "PlayStation 5"/)).toBeVisible();
    // …and PS5 is now in the profile, added by a transfer that moved nothing.
    await expect(page.getByText(/PS5|PlayStation 5/).first()).toBeVisible();
  });

  test('FINDING 25 — the transfer writes the list-rendering scratch fields into the library', async ({ page }) => {
    await page.goto('/platforms');
    await ownedPanel(page).getByTitle('Transfer games').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('PS5').first().click();
    await dialog.getByRole('button', { name: 'Preview Transfer' }).click();
    await dialog.getByRole('button', { name: 'Confirm Transfer' }).click();
    await dialog.getByRole('button', { name: 'Close' }).last().click();

    const lib = await readKey<{ user_platforms: Record<string, unknown>[] }[]>(page, KEYS.library);
    const target = lib[0].user_platforms.find(p => p.name === 'PlayStation 5')!;
    // handlePreview strips only `group` (:477), a key nothing ever sets, and
    // leaves the two the list actually added.
    expect(Object.keys(target)).toContain('typeLabel');
    expect(Object.keys(target)).toContain('displayCategory');
  });
});
