/**
 * Store links and the game page platforms area.
 *
 * Game shapes are trimmed from live IGDB responses read on 2026-09-12 through
 * the Lorehaven proxy.
 *
 * Run: node tests/game-links.test.mjs
 */
import assert from 'node:assert/strict';
import { buildStoreLinks, buildPlatformArea } from '../src/services/gameLinks.js';
import { normalizePlat, platKey } from '../src/services/platformMatch.js';

const witcher = {
  platforms: [
    { id: 169, name: 'Xbox Series X|S', abbreviation: 'Series X|S' },
    { id: 48, name: 'PlayStation 4', abbreviation: 'PS4' },
    { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
    { id: 167, name: 'PlayStation 5', abbreviation: 'PS5' },
    { id: 49, name: 'Xbox One', abbreviation: 'XONE' },
    { id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' },
  ],
  websites: [
    { type: 4, url: 'https://www.facebook.com/CDPROJEKTRED' },
    { type: 16, url: 'https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home' },
    { type: 22, url: 'https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD' },
    { type: 23, url: 'https://store.playstation.com/en-us/concept/204794' },
    { type: 24, url: 'https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/' },
    { type: 13, url: 'https://store.steampowered.com/app/292030' },
    { type: 17, url: 'https://www.gog.com/game/the_witcher_3_wild_hunt' },
    { type: 1, url: 'http://www.thewitcher.com' },
  ],
  external_games: [
    { external_game_source: 1, url: 'https://store.steampowered.com/app/292030' },
    { external_game_source: 20, url: 'https://amazon.com/dp/B07SH3D6HT' },
    { external_game_source: 3, url: 'https://www.giantbomb.com/games/3030-41484/' },
    { external_game_source: 5, url: 'https://www.gog.com/en/game/the_witcher_3_wild_hunt' },
  ],
};

/* ── buildStoreLinks ── */
const links = buildStoreLinks(witcher);
assert.deepEqual(links.map((l) => l.key), ['steam', 'gog', 'epic', 'playstation', 'xbox', 'nintendo'], 'every store, in store order, and nothing else');
assert.equal(links.find((l) => l.key === 'gog').url, 'https://www.gog.com/game/the_witcher_3_wild_hunt', 'websites wins over external_games');
assert.equal(links.find((l) => l.key === 'nintendo').url, 'https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/', 'eShop comes from websites; IGDB has no eShop source');
assert.ok(!links.some((l) => /amazon|giantbomb|facebook|thewitcher/.test(l.url)), 'no Amazon, GiantBomb, social or official-site links');
assert.deepEqual(links.find((l) => l.key === 'playstation').covers, ['PS4', 'PS5'], 'covers lists the family platforms the game is on');
assert.deepEqual(links.find((l) => l.key === 'xbox').covers, ['Series X|S', 'XONE']);
assert.deepEqual(links.find((l) => l.key === 'steam').covers, ['PC']);
assert.equal(links.find((l) => l.key === 'xbox').name, 'Microsoft Store', 'names match DEFAULT_CUSTOM_PLATFORMS');
assert.equal(links.find((l) => l.key === 'epic').name, 'Epic Games Store');
assert.equal(links.find((l) => l.key === 'steam').iconUrl, '/platform-icons/steam.svg');

/* The Last of Us Part II: PlayStation only; websites and external_games disagree on the URL. */
const tlou2 = {
  platforms: [{ id: 48, name: 'PlayStation 4', abbreviation: 'PS4' }],
  websites: [{ type: 23, url: 'https://store.playstation.com/en-us/product/UP9000-CUSA07820_00-THELASTOFUSPART2' }],
  external_games: [{ external_game_source: 36, url: 'https://store.playstation.com/en-us/concept/230079' }],
};
assert.deepEqual(buildStoreLinks(tlou2).map((l) => [l.key, l.url]), [['playstation', 'https://store.playstation.com/en-us/product/UP9000-CUSA07820_00-THELASTOFUSPART2']]);

/* Only http(s) links are links. */
assert.deepEqual(buildStoreLinks({ websites: [{ type: 13, url: 'javascript:alert(1)' }] }), [], 'a non-web URL is dropped');
assert.deepEqual(buildStoreLinks({}), [], 'a game with no link data has no stores');
assert.deepEqual(buildStoreLinks(null), []);

/* ── buildPlatformArea ── */
const steam = normalizePlat({ name: 'Steam', category: 'store', linkedIgdbId: 6 });
const psPlus = normalizePlat({ name: 'PlayStation Plus', category: 'subscription', linkedIgdbId: 167 });
const ubisoft = normalizePlat({ name: 'Ubisoft Connect', category: 'store', linkedIgdbId: 6 });
const ps5 = normalizePlat({ id: 167, name: 'PlayStation 5', abbreviation: 'PS5' });
const shelf = normalizePlat({ name: 'My Shelf', category: 'hardware' });
const users = [steam, psPlus, ubisoft, ps5, shelf];

const area = buildPlatformArea(witcher, users, new Set());
assert.deepEqual(area.pills.map((p) => p.name), witcher.platforms.map((p) => p.name), 'pills are the IGDB platforms, once each');
assert.deepEqual(area.rows.map((r) => r.name), [
  'Steam', 'GOG', 'Epic Games Store', 'PlayStation Store', 'Microsoft Store', 'Nintendo eShop',
  'Ubisoft Connect', 'PlayStation Plus',
], 'linked stores first, then your stores, then your subscriptions that fit');
assert.equal(platKey(area.rows[0].platform), platKey(steam), "a linked store reuses the user's own entry, so its key matches what is saved");
assert.equal(area.rows.find((r) => r.name === 'PlayStation Plus').url, null, 'a subscription has no link');
assert.equal(area.rows.find((r) => r.name === 'Ubisoft Connect').url, null, 'a fitting store IGDB does not link has no link');
assert.deepEqual(area.others.map((p) => p.name), ['My Shelf'], 'what fits nowhere is offered under other platforms');

/* Something you marked always shows, even where it does not fit the game. */
const zelda = { platforms: [{ id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' }] };
const marked = buildPlatformArea(zelda, users, new Set([platKey(ps5), platKey(ubisoft)]));
assert.ok(marked.pills.some((p) => p.name === 'PlayStation 5'), 'marked hardware IGDB does not list joins the pills');
assert.ok(marked.rows.some((r) => r.name === 'Ubisoft Connect'), 'a marked store that does not fit joins the rows');
assert.ok(!marked.others.some((p) => p.name === 'Ubisoft Connect' || p.name === 'PlayStation 5'), 'nothing appears twice');

/* A game with nothing at all. */
assert.deepEqual(buildPlatformArea({}, [], new Set()), { pills: [], rows: [], others: [] });

console.log('game-links: all checks passed');
