/**
 * Which of the user's platforms fit a given game.
 *
 * The section on the game page used to list every platform the user had
 * configured next to every platform the game runs on, so a PS4-only game showed
 * Steam, GOG, Epic and both Game Passes. Deciding what "fits" is the whole
 * problem, and it needs two sources: IGDB knows which storefronts a game is
 * actually on, and it does not know about subscriptions or the Nintendo eShop.
 *
 * Rows below are real IGDB shapes, ids read off the live API on 2026-09-07.
 *
 * Run: node tests/platform-match.test.mjs
 */
import assert from 'node:assert/strict';
import { matchPlatformsForGame, normalizePlat } from '../src/services/platformMatch.js';

/* The user's configured platforms, in the shape db.js stores them. */
const USER = [
  { id: 48, name: 'PlayStation 4', abbreviation: 'PS4' },
  { id: 167, name: 'PlayStation 5', abbreviation: 'PS5' },
  { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
  { id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' },
  { name: 'Steam', category: 'store', linkedIgdbId: 6 },
  { name: 'GOG', category: 'store', linkedIgdbId: 6 },
  { name: 'Epic Games Store', category: 'store', linkedIgdbId: 6 },
  { name: 'PlayStation Store', category: 'store', linkedIgdbId: 167 },
  { name: 'PlayStation Plus', category: 'subscription', linkedIgdbId: 167 },
  { name: 'Nintendo eShop', category: 'store', linkedIgdbId: 130 },
  { name: 'My Shelf', category: 'hardware' },
].map(normalizePlat);

const names = (list) => list.map(p => p.name);
const fits = (game) => names(matchPlatformsForGame(game, USER).fitting);
const rest = (game) => names(matchPlatformsForGame(game, USER).other);

/* Bloodborne: PS4 only. IGDB lists PlayStation Store and nothing else.
   The hardcoded link pins PlayStation Store to PS5, so only the external
   source can place it here. */
const bloodborne = {
  platforms: [{ id: 48 }],
  external_games: [{ external_game_source: 36 }, { external_game_source: 3 }],
};
assert.ok(fits(bloodborne).includes('PlayStation 4'), 'owned PS4 fits a PS4 game');
assert.ok(fits(bloodborne).includes('PlayStation Store'), 'IGDB places the store');
assert.ok(fits(bloodborne).includes('PlayStation Plus'), 'family map places the subscription');
assert.ok(!fits(bloodborne).includes('Steam'), 'Steam is not offered on a PS4 game');
assert.ok(rest(bloodborne).includes('Steam'), 'Steam is still reachable under other');

/* The Witcher 3 is on Steam and GOG but not Epic, and IGDB says so. */
const witcher = {
  platforms: [{ id: 6 }, { id: 48 }, { id: 167 }, { id: 130 }],
  external_games: [{ external_game_source: 1 }, { external_game_source: 5 }, { external_game_source: 36 }],
};
assert.ok(fits(witcher).includes('Steam'), 'Steam is offered where IGDB lists it');
assert.ok(fits(witcher).includes('GOG'), 'GOG is offered where IGDB lists it');
assert.ok(!fits(witcher).includes('Epic Games Store'), 'Epic is not offered when IGDB omits it');

/* Breath of the Wild: WiiU and Switch, and its only external sources are
   GiantBomb, Youtube, Twitch and Amazon. Not one storefront, so the eShop can
   only come from the family map -- and none of those four may become a
   platform. */
const botw = {
  platforms: [{ id: 41 }, { id: 130 }],
  external_games: [{ external_game_source: 3 }, { external_game_source: 10 },
                   { external_game_source: 14 }, { external_game_source: 20 }],
};
assert.ok(fits(botw).includes('Nintendo eShop'), 'family map places the eShop');
assert.ok(fits(botw).includes('Nintendo Switch'), 'owned Switch fits a Switch game');
assert.ok(!fits(botw).includes('Steam'), 'a Nintendo game does not offer Steam');
assert.equal(fits(botw).filter(n => /GiantBomb|Youtube|Twitch|Amazon/i.test(n)).length, 0,
  'metadata sources never become platforms');

/* A PC game whose only external sources are the same four metadata ids as
   Breath of the Wild above (GiantBomb, Youtube, Twitch, Amazon) -- none of
   them a storefront. IGDB knowing *something* about the game must not be
   mistaken for IGDB knowing about its stores: Steam and GOG still have to
   reach the family fallback, the same as if external_games were empty. */
const metadataOnlyPC = {
  platforms: [{ id: 6 }],
  external_games: [{ external_game_source: 3 }, { external_game_source: 10 },
                   { external_game_source: 14 }, { external_game_source: 20 }],
};
assert.ok(fits(metadataOnlyPC).includes('Steam'), 'metadata-only sources still fall back to the family for Steam');
assert.ok(fits(metadataOnlyPC).includes('GOG'), 'metadata-only sources still fall back to the family for GOG');

/* No external_games at all: every store falls back to the family map. */
const noExternals = { platforms: [{ id: 6 }], external_games: [] };
assert.ok(fits(noExternals).includes('Steam'), 'no external data falls back to the family');
assert.ok(fits(noExternals).includes('GOG'), 'the fallback offers the whole family');
assert.ok(!fits(noExternals).includes('PlayStation Store'), 'the fallback is still family-bounded');

/* A platform the user named themselves has no id and no family. */
assert.ok(rest(witcher).includes('My Shelf'), 'a self-named platform lands in other');
assert.ok(!fits(witcher).includes('My Shelf'), 'a self-named platform never fits');

/* A game with no platforms cannot match anything. */
const bare = { platforms: [], external_games: [] };
assert.equal(fits(bare).length, 0, 'nothing fits a game with no platforms');
assert.equal(rest(bare).length, USER.length, 'and everything is in other');

/* Ordering and identity. */
const ordered = matchPlatformsForGame(witcher, USER).fitting.map(p => p.category);
assert.deepEqual(ordered.filter((c, i) => ordered.indexOf(c) === i), ['hardware', 'store', 'subscription'],
  'fitting is ordered hardware, then stores, then subscriptions');
const dupes = matchPlatformsForGame(witcher, [...USER, ...USER]).fitting;
assert.equal(dupes.length, new Set(dupes.map(p => p.id)).size, 'a repeated platform appears once');

console.log('ok   platform matching');
