/**
 * Auto Priority and Find Duplicates, driven end to end.
 *
 * Every IGDB request is stubbed. The shelf ids sit outside IGDB's range, so the
 * library keeps its stored fields verbatim, and the relations query (the only
 * request carrying `version_parent`) answers from the fixture below. Nothing
 * here reaches IGDB, Wikidata or Firestore.
 */
import { test, expect, type Page } from '@playwright/test';
import { seed, KEYS } from './fixtures';

type Row = Record<string, unknown>;

/* What getGameById answers for the preview panel, keyed by id. */
const DETAILS: Record<string, Row> = {
  900301: {
    id: 900301, name: 'Night Harbour', summary: 'A harbour city run on contracts and tides.',
    first_release_date: 1400000000, total_rating: 84.2, total_rating_count: 312,
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' }],
    involved_companies: [{ company: { name: 'Tidewright' }, developer: true }],
    genres: [{ name: 'Role-playing (RPG)' }],
  },
  900302: {
    id: 900302, name: 'Night Harbour: Game of the Year Edition', summary: 'The base game with both expansions.',
    first_release_date: 1472601600, total_rating: 88, total_rating_count: 120,
    platforms: [{ id: 48, name: 'PlayStation 4', abbreviation: 'PS4' }],
    involved_companies: [{ company: { name: 'Tidewright' }, developer: true }],
  },
};

async function stubNetwork(page: Page, relations: Row[] = [], { failRelations = false } = {}) {
  await page.route(/googleapis\.com|firebaseio\.com/, r => r.abort());
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
  await page.route(/images\.igdb\.com/, r => r.abort());
  await page.route('**/api/**', r => {
    const body = r.request().postData() || '';
    if (body.includes('summary')) {
      const id = (body.match(/where id = (\d+)/) || [])[1];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAILS[id] ? [DETAILS[id]] : []) });
    }
    if (body.includes('version_parent')) {
      return failRelations
        ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) })
        : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(relations) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

const readKey = (page: Page, key: string) =>
  page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), key);

const priorities = async (page: Page) =>
  Object.fromEntries((await readKey(page, KEYS.library)).map((g: Row) => [String(g.id), g.priority ?? null]));

async function librarySettled(page: Page) {
  await expect(page.locator('button[aria-label^="Sort · "]')).toBeAttached({ timeout: 20000 });
  await expect.poll(() => page.locator('.skeleton-placeholder').count(), { timeout: 20000 }).toBe(0);
}

/* ── Auto Priority ─────────────────────────────────────────────────────── */

const SHELF = [
  { id: 900201, name: 'Alpha Signal', status: 'Backlog', total_rating: 90, cover_id: null, release_year: 2020 },
  { id: 900202, name: 'Bravo Tide', status: 'Backlog', total_rating: 70, cover_id: null, release_year: 2018 },
  { id: 900203, name: 'Charlie Unrated', status: 'Backlog', cover_id: null, release_year: 2021 },
  { id: 900204, name: 'Delta Set', status: 'Backlog', total_rating: 60, priority: 'Soon', cover_id: null, release_year: 2015 },
  { id: 900205, name: 'Echo Finished', status: 'Beaten', feel: 'Perfection', cover_id: null, release_year: 2011 },
];

test.describe('Auto Priority', () => {
  test('previews by public rating, applies in one write, and Undo restores every prior value', async ({ page }) => {
    await stubNetwork(page);
    await seed(page, { [KEYS.library]: SHELF });
    await page.goto('/library/backlog');
    await librarySettled(page);

    await page.getByRole('button', { name: 'Library tools' }).click();
    await page.getByRole('menuitem', { name: 'Auto Priority' }).click();
    const dialog = page.getByRole('dialog', { name: 'Auto Priority' });
    await expect(dialog).toBeVisible();

    /* One rated Beaten game is under the threshold of five. */
    await expect(dialog.getByRole('radio', { name: /By Your Taste/ })).toBeDisabled();
    await expect(dialog.getByText('Rate 4 more beaten games to use this', { exact: false })).toBeVisible();

    const changes = dialog.getByRole('list', { name: 'Changes' }).getByRole('listitem');
    const apply = dialog.getByRole('button', { name: /^(Set \d+ Priorit|Nothing to Change)/i });
    await expect(changes).toHaveCount(2);
    await expect(apply).toHaveText(/Set 2 Priorities/i);
    await expect(dialog.getByText('1 skipped, no rating', { exact: false })).toBeVisible();

    await dialog.getByText('Replace existing priorities').click();
    await expect(changes).toHaveCount(3);
    await expect(apply).toHaveText(/Set 3 Priorities/i);

    await apply.click();
    await expect(dialog).toBeHidden();
    expect(await priorities(page)).toEqual({
      900201: 'Next Up', 900202: 'Maybe', 900203: null, 900204: 'Someday', 900205: null,
    });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => priorities(page)).toEqual({
      900201: null, 900202: null, 900203: null, 900204: 'Soon', 900205: null,
    });
  });

  test('is not offered on Beaten, where priority is hidden', async ({ page }) => {
    await stubNetwork(page);
    await seed(page, { [KEYS.library]: SHELF });
    await page.goto('/library/beaten');
    await librarySettled(page);
    await page.getByRole('button', { name: 'Library tools' }).click();
    await expect(page.getByRole('menuitem', { name: 'Find Duplicates' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Auto Priority' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Find Duplicates' }).click();
    await expect(page).toHaveURL(/\/library\/duplicates$/);
  });
});

/* ── Find Duplicates ───────────────────────────────────────────────────── */

const DUPES = [
  { id: 900301, name: 'Night Harbour', status: 'Beaten', feel: 'Perfection', notes: 'First run', user_platforms: [{ id: 6, name: 'PC', category: 'hardware' }], addedAt: 2000 },
  { id: 900302, name: 'Night Harbour: Game of the Year Edition', status: 'Backlog', priority: 'Soon', notes: 'Sale copy', addedAt: 1000 },
  { id: 'custom_e2e_rook', name: 'Glass Rook', is_custom: true, status: 'Backlog' },
  { id: 900303, name: 'Glass Rook', status: 'Wishlist' },
  { id: 900304, name: 'Old Lantern', status: 'Beaten' },
  { id: 900305, name: 'Old Lantern', status: 'Backlog' },
];
const RELATIONS = [
  { id: 900301, name: 'Night Harbour', game_type: 0, first_release_date: 1400000000 },
  { id: 900302, name: 'Night Harbour: Game of the Year Edition', game_type: 0, version_parent: 900301 },
  { id: 900303, name: 'Glass Rook', game_type: 0 },
  { id: 900304, name: 'Old Lantern', game_type: 0, remakes: [900305], first_release_date: 900000000 },
  { id: 900305, name: 'Old Lantern', game_type: 8, first_release_date: 1500000000 },
];
const COLLECTIONS = [{ id: 'coll_e2e', name: 'Harbour Shelf', games: [900302] }];

test.describe('Find Duplicates', () => {
  test('merges an edition into its original, moves its collection, and Undo puts both back', async ({ page }) => {
    await stubNetwork(page, RELATIONS);
    await seed(page, { [KEYS.library]: DUPES, [KEYS.collections]: COLLECTIONS });
    await page.goto('/library/duplicates');

    /* exact: a group's own heading, "A custom entry and the same game from IGDB",
       also contains the words. */
    await expect(page.getByRole('heading', { name: 'Same Game', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Related Versions', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'One is a remake of the other' }).getByRole('button', { name: 'Keep Both' })).toBeVisible();

    const edition = page.getByRole('article', { name: 'One is an edition of the other' });
    await expect(edition.getByRole('radio', { name: /^Keep this, Night Harbour, 2014$/i })).toBeChecked();
    await expect(edition.getByRole('radio', { name: /^Keep this, Night Harbour: Game of the Year Edition, Edition$/i })).not.toBeChecked();
    await expect(edition.getByRole('radiogroup', { name: 'Status' })).toBeVisible();

    await edition.getByRole('button', { name: 'Merge' }).click();
    await expect(edition).toBeHidden();

    let lib = await readKey(page, KEYS.library);
    expect(lib.map((g: Row) => String(g.id))).not.toContain('900302');
    expect(lib.find((g: Row) => g.id === 900301)).toMatchObject({
      status: 'Beaten', feel: 'Perfection', priority: 'Soon', notes: 'First run\n\nSale copy', addedAt: 1000,
    });
    expect((await readKey(page, KEYS.collections))[0].games).toEqual([900301]);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('article', { name: 'One is an edition of the other' })).toBeVisible();
    lib = await readKey(page, KEYS.library);
    expect(lib.map((g: Row) => String(g.id))).toContain('900302');
    expect(lib.find((g: Row) => g.id === 900301)).toMatchObject({ priority: null, notes: 'First run', addedAt: 2000 });
    expect((await readKey(page, KEYS.collections))[0].games).toEqual([900302]);
  });

  test('Not Duplicates is written on both entries, and a dismissed group can be restored', async ({ page }) => {
    await stubNetwork(page, RELATIONS);
    await seed(page, { [KEYS.library]: DUPES });
    await page.goto('/library/duplicates');

    const rook = page.getByRole('article', { name: 'A custom entry and the same game from IGDB' });
    await expect(rook).toBeVisible({ timeout: 20000 });
    await rook.getByRole('button', { name: 'Not Duplicates' }).click();
    await expect(rook).toBeHidden();

    const lib = await readKey(page, KEYS.library);
    expect(lib.find((g: Row) => g.id === 'custom_e2e_rook').notDuplicateOf).toEqual(['900303']);
    expect(lib.find((g: Row) => g.id === 900303).notDuplicateOf).toEqual(['custom_e2e_rook']);

    const toggle = page.getByRole('button', { name: '1 Dismissed Group' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('article', { name: 'A custom entry and the same game from IGDB' })).toBeVisible();
  });

  test('Preview docks beside the groups, switches between entries, and Escape returns focus to its button', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await stubNetwork(page, RELATIONS);
    await seed(page, { [KEYS.library]: DUPES });
    await page.goto('/library/duplicates');

    const edition = page.getByRole('article', { name: 'One is an edition of the other' });
    await expect(edition).toBeVisible({ timeout: 20000 });
    const trigger = edition.getByRole('button', { name: /^Preview, Night Harbour: Game of the Year Edition/ });
    await trigger.click();

    /* 1600px wide: docked as a landmark on the window's right edge, not a
       modal, and the groups keep their width rather than shrinking to fit. */
    const panel = page.locator('aside[aria-labelledby="dup-preview-title"]');
    await expect(panel).toBeVisible();
    /* Polled: the rail slides its last 12px in over 200ms. It ends at the
       window's edge less the page's 6px scrollbar, so the check allows a
       scrollbar's width and no more; docked inside the centred content column,
       as first built, it ended hundreds of pixels short. */
    await expect.poll(async () => {
      const b = await panel.boundingBox();
      const gap = 1600 - Math.round((b?.x ?? 0) + (b?.width ?? 0));
      return gap >= 0 && gap <= 16;
    }).toBe(true);
    const railBox = await panel.boundingBox();
    const groupBox = await edition.boundingBox();
    expect(Math.round((groupBox?.x ?? 0) + (groupBox?.width ?? 0))).toBeLessThanOrEqual(Math.round(railBox?.x ?? 0));
    await expect(panel.getByRole('heading', { name: 'Night Harbour: Game of the Year Edition', level: 2 })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText('Edition of Night Harbour')).toBeVisible();
    await expect(panel.getByText('The base game with both expansions.')).toBeVisible();

    await panel.getByRole('button', { name: /^Night Harbour, 2014$/ }).click();
    await expect(panel.getByText('A harbour city run on contracts and tides.')).toBeVisible();
    await expect(edition.getByRole('button', { name: /^Preview, Night Harbour, 2014$/ })).toHaveAttribute('aria-pressed', 'true');

    /* Escape from outside the panel too: it is not modal, so focus is often
       back on the groups. */
    await edition.getByRole('radio', { name: /^Keep this, Night Harbour, 2014$/i }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('on a phone the preview opens as a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubNetwork(page, RELATIONS);
    await seed(page, { [KEYS.library]: DUPES });
    await page.goto('/library/duplicates');

    const edition = page.getByRole('article', { name: 'One is an edition of the other' });
    await expect(edition).toBeVisible({ timeout: 20000 });
    await edition.getByRole('button', { name: /^Preview, Night Harbour, 2014$/ }).click();

    const sheet = page.getByRole('dialog', { name: 'Night Harbour', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('A harbour city run on contracts and tides.')).toBeVisible();
    const box = await sheet.boundingBox();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(810);

    await sheet.getByRole('button', { name: 'Close preview' }).click();
    await expect(sheet).toBeHidden();
  });

  test('when IGDB fails, name and custom matches still show and the page names what was not checked', async ({ page }) => {
    await stubNetwork(page, RELATIONS, { failRelations: true });
    await seed(page, { [KEYS.library]: DUPES });
    await page.goto('/library/duplicates');

    await expect(page.getByText('IGDB did not respond', { exact: false })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('article', { name: 'Matched by name only' })).toHaveCount(2);
    await expect(page.getByRole('article', { name: 'A custom entry and the same game from IGDB' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Related Versions', exact: true })).toHaveCount(0);
  });
});
