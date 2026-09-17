/* Steam import, client side: reading a profile link, turning a Steam library
   and wishlist into review rows, and exactly what an import writes and what
   its Undo puts back. Pure modules, no storage shim. */
import assert from 'node:assert';
import { parseProfileInput } from '../src/services/steamProfile.js';
import {
  STEAM_PLATFORM, buildSteamRows, rowReady, planSteamImport, importUndo,
  linkRowToIgdb, unlinkRowFromIgdb,
} from '../src/services/steamImport.js';

/* ── Profile links ── */
const GABE = '76561197960287930';
assert.deepStrictEqual(parseProfileInput(`https://steamcommunity.com/profiles/${GABE}`), { steamid: GABE });
assert.deepStrictEqual(parseProfileInput(`steamcommunity.com/profiles/${GABE}/`), { steamid: GABE }, 'no scheme, trailing slash');
assert.deepStrictEqual(parseProfileInput(`  ${GABE}  `), { steamid: GABE }, 'a bare 64-bit id');
assert.deepStrictEqual(parseProfileInput('https://steamcommunity.com/id/gabelogannewell/'), { vanity: 'gabelogannewell' });
assert.deepStrictEqual(parseProfileInput('gabelogannewell'), { vanity: 'gabelogannewell' }, 'a bare custom name');
assert.strictEqual(parseProfileInput(''), null);
assert.strictEqual(parseProfileInput('   '), null);
assert.strictEqual(parseProfileInput('https://example.com/id/gabe'), null, 'only steamcommunity.com links');
assert.strictEqual(parseProfileInput('https://steamcommunity.com/groups/valve'), null, 'a group is not a profile');
assert.strictEqual(parseProfileInput('gabe newell'), null, 'custom names have no spaces');
assert.strictEqual(parseProfileInput('12345'), null, 'a short number is neither an id nor a name Steam allows');

/* ── Rows ── */
const owned = [
  { appid: 620, name: 'Portal 2', playtimeMinutes: 0, lastPlayed: null },
  { appid: 400, name: 'Portal', playtimeMinutes: 120, lastPlayed: 1600000000 },
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtimeMinutes: 5400, lastPlayed: 1700000000 },
  { appid: 499450, name: 'The Witcher 3: Wild Hunt - GOTY', playtimeMinutes: 60, lastPlayed: 1710000000 },
  { appid: 431960, name: 'Wallpaper Engine', playtimeMinutes: 30, lastPlayed: 1650000000 },
];
const wishlist = [
  { appid: 1091500, dateAdded: 1690000000 },
  { appid: 999999, dateAdded: 1 },
  { appid: 620, dateAdded: 5 },
];
const game = (id, name, extra = {}) => ({ id, name, cover: { image_id: `c${id}` }, first_release_date: 1300000000, game_type: 0, ...extra });
const matches = new Map([
  ['620', game(72, 'Portal 2')],
  ['400', game(71, 'Portal')],
  ['292030', game(1942, 'The Witcher 3: Wild Hunt')],
  ['499450', game(1942, 'The Witcher 3: Wild Hunt')],
  ['1091500', game(1877, 'Cyberpunk 2077')],
]);
const PC = { id: 6, name: 'PC (Windows)', category: 'hardware' };
const library = [{ id: 71, name: 'Portal', status: 'Beaten', user_platforms: [PC] }];

const { rows, droppedWishlist } = buildSteamRows({ owned, wishlist, matches, library });
const byKey = Object.fromEntries(rows.map(r => [r.key, r]));

assert.deepStrictEqual(rows.map(r => r.key), ['igdb:1877', 'igdb:72', 'igdb:1942', 'igdb:71', 'steam:431960'],
  'new games A to Z, then games already in the library, then Steam items IGDB does not have');

assert.deepStrictEqual(byKey['igdb:1942'].appids, [292030, 499450], 'two Steam apps for one IGDB game become one row');
assert.strictEqual(byKey['igdb:1942'].playtimeMinutes, 5460, 'playtime adds up across them');
assert.strictEqual(byKey['igdb:1942'].lastPlayed, 1710000000, 'the latest last-played wins');

assert.strictEqual(byKey['igdb:72'].source, 'owned', 'owned beats wishlisted for the same app');
assert.strictEqual(byKey['igdb:72'].status, null, 'no status is guessed for an owned game: the owner picks per game');
assert.strictEqual(byKey['igdb:72'].selected, true);

assert.strictEqual(byKey['igdb:1877'].source, 'wishlist');
assert.strictEqual(byKey['igdb:1877'].status, 'Wishlist', 'a wishlisted game is on the wishlist; that is a fact, not a guess');

assert.strictEqual(byKey['igdb:71'].existing.status, 'Beaten');
assert.strictEqual(byKey['igdb:71'].status, null, 'null on a game already in the library means keep its status');

assert.strictEqual(byKey['steam:431960'].igdb, null);
assert.strictEqual(byKey['steam:431960'].selected, false, 'Steam items IGDB has no match for start unticked');
assert.strictEqual(droppedWishlist, 1, 'a wishlisted app IGDB does not know has no name to show, so it is counted, not listed');

assert.strictEqual(rowReady(byKey['igdb:72']), false, 'ticked with no status is not importable');
assert.strictEqual(rowReady(byKey['igdb:71']), true, 'a game already in the library is importable as it stands');
assert.strictEqual(rowReady(byKey['igdb:1877']), true);
assert.strictEqual(rowReady({ ...byKey['igdb:1877'], selected: false }), false);

/* ── The import ── */
assert.strictEqual(STEAM_PLATFORM.id, 'custom_store_steam', 'the same id the game page uses for Steam');
assert.strictEqual(STEAM_PLATFORM.category, 'store');

const picked = rows.map(r => {
  if (r.key === 'igdb:72') return { ...r, status: 'Backlog' };
  if (r.key === 'igdb:1942') return { ...r, status: 'Beaten' };
  if (r.key === 'igdb:1877') return { ...r, selected: false };
  if (r.key === 'steam:431960') return { ...r, selected: true, status: 'Playing' };
  return r;
});

{
  const { entries, skipped } = planSteamImport(picked);
  assert.strictEqual(skipped, 0);
  assert.deepStrictEqual(entries, [
    { id: 72, name: 'Portal 2', cover_id: 'c72', status: 'Backlog', user_platforms: [STEAM_PLATFORM], is_custom: false },
    { id: 1942, name: 'The Witcher 3: Wild Hunt', cover_id: 'c1942', status: 'Beaten', user_platforms: [STEAM_PLATFORM], is_custom: false },
    { id: 71, user_platforms: [PC, STEAM_PLATFORM] },
    { id: 'custom_steam_431960', name: 'Wallpaper Engine', status: 'Playing', user_platforms: [STEAM_PLATFORM], is_custom: true },
  ], 'a game already in the library only gains Steam; its status and everything else stay');
}

{
  const { entries, skipped } = planSteamImport(picked.map(r => (r.key === 'igdb:72' ? { ...r, status: null } : r)));
  assert.strictEqual(skipped, 1, 'a ticked row with no status is skipped and counted');
  assert.ok(!entries.some(e => e.id === 72));
}

{
  const withSteam = [{ id: 71, name: 'Portal', status: 'Beaten', user_platforms: [PC, STEAM_PLATFORM] }];
  const again = buildSteamRows({ owned, wishlist, matches, library: withSteam }).rows;
  const { entries } = planSteamImport(again.map(r => (r.key === 'igdb:71' ? { ...r, status: 'Playing' } : { ...r, selected: false })));
  assert.deepStrictEqual(entries, [{ id: 71, user_platforms: [PC, STEAM_PLATFORM], status: 'Playing' }],
    're-importing never lists Steam twice, and a status picked for a library game replaces it');
}

{
  const { entries } = planSteamImport(picked);
  const undo = importUndo(entries, library);
  assert.deepStrictEqual(undo.restore, [{ id: 71, user_platforms: [PC] }], 'a library game gets back exactly what the import touched');
  assert.deepStrictEqual(undo.removeIds, [72, 1942, 'custom_steam_431960'], 'games the import added are removed');
}

{
  const lib = [{ id: 71, name: 'Portal', status: 'Beaten' }];
  const undo = importUndo([{ id: 71, user_platforms: [STEAM_PLATFORM], status: 'Playing' }], lib);
  assert.deepStrictEqual(undo.restore, [{ id: 71, user_platforms: null, status: 'Beaten' }],
    'null for a key the game never had, since saving merges');
}

/* ── Matched by hand ── */
{
  const rows = buildSteamRows({ owned, wishlist, matches, library: [] }).rows;
  const wallpaper = rows.find(r => r.key === 'steam:431960');
  assert.ok(wallpaper && !wallpaper.igdb, 'the unmatched Steam item is where the owner starts');

  const found = { id: 4242, name: 'Wallpaper Engine', cover: { image_id: 'wp1' }, first_release_date: 1478000000, game_type: 0 };
  const linked = linkRowToIgdb(wallpaper, found, []);
  assert.strictEqual(linked.key, 'igdb:4242', 'the row moves to the game it was matched to');
  assert.strictEqual(linked.igdb.name, 'Wallpaper Engine');
  assert.strictEqual(linked.igdb.cover.image_id, 'wp1', 'the cover comes along, so the review shows it');
  assert.strictEqual(linked.linkedByHand, true, 'the row says it was matched by hand, so Undo Match can be offered');
  assert.strictEqual(linked.selected, true, 'matching a game by hand ticks it');
  assert.deepStrictEqual(linked.appids, [431960], 'it keeps its Steam app id');
  assert.strictEqual(linked.playtimeMinutes, 30, 'and its playtime');
  assert.strictEqual(linked.existing, null, 'nothing in an empty library to find');

  const { entries } = planSteamImport([{ ...linked, status: 'Backlog' }]);
  assert.deepStrictEqual(entries, [{
    id: 4242, name: 'Wallpaper Engine', cover_id: 'wp1', status: 'Backlog',
    user_platforms: [STEAM_PLATFORM], is_custom: false,
  }], 'a matched row imports the real IGDB game, never a custom entry');

  const back = unlinkRowFromIgdb(linked, []);
  assert.strictEqual(back.key, 'steam:431960', 'undoing the match returns the row to its Steam key');
  assert.strictEqual(back.igdb, null);
  assert.strictEqual(back.linkedByHand, false);
  assert.strictEqual(back.playtimeMinutes, 30, 'and still keeps its playtime');
  const { entries: asCustom } = planSteamImport([{ ...back, status: 'Backlog' }]);
  assert.strictEqual(asCustom[0].id, 'custom_steam_431960', 'so it imports as a custom entry again');
}

{
  /* The game matched by hand is already in the library: the row must pick that
     up, or the import would write a second copy of it instead of adding Steam. */
  const rows = buildSteamRows({ owned, wishlist, matches, library: [] }).rows;
  const wallpaper = rows.find(r => r.key === 'steam:431960');
  const lib = [{ id: 4242, name: 'Wallpaper Engine', status: 'Playing', user_platforms: [] }];
  const linked = linkRowToIgdb(wallpaper, { id: 4242, name: 'Wallpaper Engine' }, lib);
  assert.strictEqual(linked.existing?.status, 'Playing', 'the library entry is found by the game id');
  const { entries } = planSteamImport([linked]);
  assert.deepStrictEqual(entries, [{ id: 4242, user_platforms: [STEAM_PLATFORM] }],
    'so the import only marks Steam on the game already there');
}

{
  /* Undoing a match on a Steam item already imported as a custom entry finds
     that entry again, so the row reads "In your library" rather than new. */
  const rows = buildSteamRows({ owned, wishlist, matches, library: [] }).rows;
  const wallpaper = rows.find(r => r.key === 'steam:431960');
  const linked = linkRowToIgdb(wallpaper, { id: 4242, name: 'Wallpaper Engine' }, []);
  const lib = [{ id: 'custom_steam_431960', name: 'Wallpaper Engine', status: 'Backlog' }];
  const back = unlinkRowFromIgdb(linked, lib);
  assert.strictEqual(back.existing?.id, 'custom_steam_431960');
}

console.log('steam import: all assertions passed');
