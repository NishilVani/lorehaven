/**
 * Steam import, driven end to end with Steam and IGDB stubbed.
 *
 * The Worker's /steam routes and IGDB's external_games answer from the fixture
 * below, so nothing here reaches Steam, IGDB, Wikidata or Firestore, and no
 * Steam API key is needed.
 */
import { test, expect, type Page } from '@playwright/test';
import { seed, KEYS } from './fixtures';

type Row = Record<string, unknown>;
const GABE = '76561197960287930';

const OWNED = [
  { appid: 620, name: 'Portal 2', playtimeMinutes: 0, lastPlayed: null },
  { appid: 400, name: 'Portal', playtimeMinutes: 120, lastPlayed: 1600000000 },
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtimeMinutes: 5400, lastPlayed: 1700000000 },
  { appid: 431960, name: 'Wallpaper Engine', playtimeMinutes: 30, lastPlayed: 1650000000 },
];
const WISHLIST = [{ appid: 1091500, dateAdded: 1690000000 }, { appid: 999999, dateAdded: 1 }];
const game = (id: number, name: string) => ({ id, name, cover: { image_id: `c${id}` }, first_release_date: 1300000000, game_type: 0 });
const MATCHES = [
  { uid: '620', game: game(72, 'Portal 2') },
  { uid: '400', game: game(71, 'Portal') },
  { uid: '292030', game: game(1942, 'The Witcher 3: Wild Hunt') },
  { uid: '1091500', game: game(1877, 'Cyberpunk 2077') },
];
const LIBRARY = [{ id: 71, name: 'Portal', status: 'Beaten', user_platforms: [{ id: 6, name: 'PC (Windows)', category: 'hardware' }] }];
/* What IGDB's name search answers for a Steam item its app-id records miss. */
const SEARCH = [{ id: 4242, name: 'Wallpaper Engine', cover: { image_id: 'wp1' }, first_release_date: 1478000000, game_type: 0 }];

async function stub(page: Page, { privateLibrary = false } = {}) {
  const steamCalls: string[] = [];
  await page.route(/googleapis\.com|firebaseio\.com/, r => r.abort());
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
  await page.route(/images\.igdb\.com/, r => r.abort());
  await page.route('**/steam/**', r => {
    const action = new URL(r.request().url()).pathname.split('/').pop() as string;
    steamCalls.push(action);
    const json = (status: number, body: unknown) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'resolve' || action === 'verify') return json(200, { steamid: GABE });
    if (action === 'owned') return json(200, privateLibrary ? { visible: false, games: [] } : { visible: true, games: OWNED });
    if (action === 'wishlist') return json(200, { available: true, items: WISHLIST });
    return json(404, { error: 'unknown steam route' });
  });
  await page.route('**/api/**', r => {
    const body = r.request().postData() || '';
    const rows = body.includes('external_game_source = 1') ? MATCHES
      : body.includes('search "') ? SEARCH
        : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  return steamCalls;
}

const library = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), KEYS.library);

/* The status control is the app's own menu, not a native select, so a status is
   picked the way a person picks one: open the row's control, choose the status. */
async function setStatus(page: Page, game: string, status: string) {
  await page.getByRole('button', { name: `Status for ${game}` }).click();
  await page.getByRole('menuitemradio', { name: status, exact: true }).click();
}

async function readByProfile(page: Page) {
  await page.goto('/import/steam');
  await page.getByLabel('Your Steam profile address, or just its custom name').fill('gabelogannewell');
  await page.getByRole('button', { name: 'Read Library' }).click();
  await expect(page.getByRole('list', { name: 'Steam games' })).toBeVisible({ timeout: 20000 });
}

test.describe('/import/steam', () => {
  test('reads a library by profile link, needs a status per game, imports in one write, and Undo reverses it', async ({ page }) => {
    await stub(page);
    await seed(page, { [KEYS.library]: LIBRARY });
    await readByProfile(page);

    const rows = page.getByRole('list', { name: 'Steam games' }).getByRole('listitem');
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('1 wishlisted item is not on IGDB and left out.', { exact: false })).toBeVisible();

    /* Wishlisted starts as Wishlist, the library game as itself; the two owned
       games need a status before they count. */
    const importButton = page.getByRole('button', { name: /^(Import \d+ Games?|Nothing to Import)$/ });
    await expect(importButton).toHaveText('Import 2 Games');
    await expect(page.getByText('2 ticked games need a status', { exact: false })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Import Wallpaper Engine' })).not.toBeChecked();

    await setStatus(page, 'Portal 2', 'Backlog');
    await setStatus(page, 'The Witcher 3: Wild Hunt', 'Beaten');
    await expect(importButton).toHaveText('Import 4 Games');

    await importButton.click();
    await expect(page.getByRole('heading', { name: '4 Games Imported' })).toBeFocused();

    const after = await library(page);
    const byId = Object.fromEntries(after.map((g: Row) => [String(g.id), g]));
    expect(byId['72']).toMatchObject({ status: 'Backlog', is_custom: false });
    expect(byId['1942']).toMatchObject({ status: 'Beaten' });
    expect(byId['1877']).toMatchObject({ status: 'Wishlist' });
    expect(byId['71']).toMatchObject({ status: 'Beaten' });
    expect((byId['71'].user_platforms as Row[]).map(p => p.id)).toEqual([6, 'custom_store_steam']);
    expect((byId['72'].user_platforms as Row[]).map(p => p.id)).toEqual(['custom_store_steam']);
    expect(byId.custom_steam_431960).toBeUndefined();

    /* exact: the done card carries its own "Undo Import" beside the toast's Undo. */
    await expect(page.getByRole('button', { name: 'Undo Import' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import Undone' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Undo Import' })).toHaveCount(0);
    const undone = await library(page);
    expect(undone.map((g: Row) => String(g.id))).toEqual(['71']);
    expect((undone[0].user_platforms as Row[]).map(p => p.id)).toEqual([6]);
  });

  test('Set Status applies to every selected game, including a ticked item IGDB does not have', async ({ page }) => {
    await stub(page);
    await seed(page, { [KEYS.library]: [] });
    await readByProfile(page);

    /* Clicked through its label, the way a pointer reaches it: Checkbox hides
       the native input with pointer-events: none, so the input itself cannot be
       clicked, and a row checkbox without a label could not be ticked at all.
       That shipped in the first build of this page and this is the check. */
    const row = page.getByRole('checkbox', { name: 'Import Wallpaper Engine' });
    await row.locator('xpath=ancestor::label[1]').click();
    await expect(row).toBeChecked();
    await row.locator('xpath=ancestor::label[1]').click();
    await expect(row).not.toBeChecked();

    await page.getByRole('checkbox', { name: 'Select every game shown' }).locator('xpath=ancestor::label[1]').click();
    await expect(page.getByRole('checkbox', { name: 'Deselect every game shown' })).toBeChecked();
    await page.getByRole('button', { name: /^Set a status for 5 selected games$/ }).click();
    await page.getByRole('menuitem', { name: 'Playing' }).click();
    await expect(page.getByRole('button', { name: 'Import 5 Games' })).toBeVisible();

    await page.getByRole('button', { name: 'Import 5 Games' }).click();
    const saved = await library(page);
    expect(saved.find((g: Row) => g.id === 'custom_steam_431960')).toMatchObject({ name: 'Wallpaper Engine', status: 'Playing', is_custom: true });
  });

  test('a game IGDB has no Steam record for can be found by name and imported as that game', async ({ page }) => {
    await stub(page);
    await seed(page, { [KEYS.library]: [] });
    await readByProfile(page);

    const row = page.getByRole('listitem').filter({ hasText: 'Wallpaper Engine' });
    await expect(row.getByText('Not on IGDB. Tick to add it as a custom entry')).toBeVisible();
    await row.getByRole('button', { name: 'Find It on IGDB' }).click();

    /* The panel searches for the Steam name on open, so the match is one click. */
    await row.getByRole('button', { name: 'Match Wallpaper Engine to Wallpaper Engine' }).click();
    await expect(row.getByText('Matched by hand')).toBeVisible();
    await setStatus(page, 'Wallpaper Engine', 'Playing');

    await page.getByRole('button', { name: /^Import \d+ Games?$/ }).click();
    await expect(page.getByRole('heading', { name: /Imported$/ })).toBeVisible();
    const saved = await library(page);
    expect(saved.find((g: Row) => g.id === 4242)).toMatchObject({ name: 'Wallpaper Engine', status: 'Playing', is_custom: false });
    expect(saved.find((g: Row) => String(g.id) === 'custom_steam_431960')).toBeUndefined();
  });

  test('a private library says how to fix it, with a link to Steam privacy settings', async ({ page }) => {
    await stub(page, { privateLibrary: true });
    await page.goto('/import/steam');
    await page.getByLabel('Your Steam profile address, or just its custom name').fill(`https://steamcommunity.com/profiles/${GABE}`);
    await page.getByRole('button', { name: 'Read Library' }).click();
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Steam Kept This Library Private' })).toBeVisible({ timeout: 20000 });
    await expect(alert.getByRole('link', { name: 'Open Steam Privacy Settings' })).toHaveAttribute('href', 'https://steamcommunity.com/my/edit/settings');
  });

  test('something that is not a Steam profile is refused in place, without asking Steam', async ({ page }) => {
    const calls = await stub(page);
    await page.goto('/import/steam');
    const field = page.getByLabel('Your Steam profile address, or just its custom name');
    await field.fill('https://example.com/id/gabe');
    await page.getByRole('button', { name: 'Read Library' }).click();
    await expect(page.getByText('That is not a Steam profile.', { exact: false })).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toEqual([]);
  });

  test('coming back from Steam sign-in verifies it, clears it from the address, and reads the library', async ({ page }) => {
    const calls = await stub(page);
    await seed(page, { [KEYS.library]: [] });
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'id_res',
      'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${GABE}`,
      'openid.identity': `https://steamcommunity.com/openid/id/${GABE}`,
      'openid.return_to': 'http://localhost:5173/import/steam',
      'openid.response_nonce': '2026-09-15T10:00:00Zabc',
      'openid.assoc_handle': '1234567890',
      'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
      'openid.sig': 'c2ln',
    });
    await page.goto(`/import/steam?${params}`);
    await expect(page.getByRole('list', { name: 'Steam games' })).toBeVisible({ timeout: 20000 });
    expect(page.url()).not.toContain('openid');
    expect(calls[0]).toBe('verify');
  });

  test('the Import page and Your Data both lead here', async ({ page }) => {
    await stub(page);
    await page.goto('/import');
    await page.getByRole('link', { name: /Import From Steam/ }).click();
    await expect(page).toHaveURL(/\/import\/steam$/);
    await expect(page.getByRole('heading', { name: 'Sign In With Steam' })).toBeVisible();
  });
});
