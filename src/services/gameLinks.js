/* Where a game can be bought, and what the game page's platforms area shows.
 *
 * IGDB carries store links in two places. `websites` has storefront URLs for
 * most stores, including the Nintendo eShop, which has no external game source
 * at all; `external_games` fills gaps. Both also carry noise nobody buys from:
 * dozens of Amazon listings per game, GiantBomb, Twitch, YouTube, social pages.
 * Only the stores below count.
 *
 * Store names match DEFAULT_CUSTOM_PLATFORMS in db.js exactly, because ownership
 * is keyed on the name: a row named "Epic Games" would never show the
 * "Epic Games Store" a user already marked.
 *
 * Pure on purpose, with .js extensions on its imports: tests/game-links.test.mjs
 * runs it under plain node.
 */
import { FAMILY_BY_PLATFORM_ID, matchPlatformsForGame, normalizePlat, platKey } from './platformMatch.js';
import { getPlatformLogoUrl, getShortPlatformName } from '../components/platforms/platformLogoUtils.js';

/* websites.type and external_game_source ids, read off live IGDB responses on
   2026-09-12. `brand` is the swatch key in BRAND_SWATCHES. */
export const STORE_DEFS = [
  { key: 'steam', name: 'Steam', family: 'pc', brand: 'steam', icon: 'steam.svg', webTypes: [13], sources: [1] },
  { key: 'gog', name: 'GOG', family: 'pc', brand: 'gogdotcom', icon: 'gogdotcom.svg', webTypes: [17], sources: [5] },
  { key: 'epic', name: 'Epic Games Store', family: 'pc', brand: 'epicgames', icon: 'epicgames.svg', webTypes: [16], sources: [26] },
  { key: 'itch', name: 'itch.io', family: 'pc', brand: 'itch', icon: null, webTypes: [15], sources: [30] },
  { key: 'playstation', name: 'PlayStation Store', family: 'playstation', brand: 'playstation', icon: 'playstation.svg', webTypes: [23], sources: [36] },
  { key: 'xbox', name: 'Microsoft Store', family: 'xbox', brand: 'xbox', icon: 'xbox.svg', webTypes: [22], sources: [11, 31] },
  { key: 'nintendo', name: 'Nintendo eShop', family: 'nintendo', brand: 'nintendo-switch', icon: 'nintendo-switch.svg', webTypes: [24], sources: [] },
  { key: 'appstore', name: 'App Store', family: 'ios', brand: 'appstore', icon: 'appstore.svg', webTypes: [10, 11], sources: [13] },
  { key: 'googleplay', name: 'Google Play Store', family: 'android', brand: 'google-play', icon: 'google-play.svg', webTypes: [12], sources: [15] },
];

/* The platform DEFAULT_CUSTOM_PLATFORMS links each family's store to. */
const LINKED_ID_BY_FAMILY = { pc: 6, playstation: 167, xbox: 169, nintendo: 130, ios: 39, android: 34 };

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/** A game -> the stores it can be bought from, each with one URL. */
export function buildStoreLinks(game) {
  const websites = game?.websites || [];
  const external = game?.external_games || [];
  const platforms = game?.platforms || [];
  const links = [];
  for (const def of STORE_DEFS) {
    const site = websites.find((w) => def.webTypes.includes(w.type) && isWebUrl(w.url));
    const ext = external.find((e) => def.sources.includes(e.external_game_source) && isWebUrl(e.url));
    const url = site?.url || ext?.url;
    if (!url) continue;
    links.push({
      key: def.key,
      name: def.name,
      brand: def.brand,
      iconUrl: def.icon ? `/platform-icons/${def.icon}` : null,
      url,
      covers: platforms.filter((p) => FAMILY_BY_PLATFORM_ID[p.id] === def.family).map((p) => getShortPlatformName(p)),
    });
  }
  return links;
}

const unlinkedRow = (platform) => {
  const iconUrl = getPlatformLogoUrl(platform);
  return { key: platKey(platform), name: platform.name, brand: iconUrl, iconUrl, url: null, covers: [], platform };
};

/**
 * Everything the platforms area shows, in order.
 *
 * pills   the platforms IGDB lists, then hardware you marked that IGDB does not.
 * rows    stores with a link for this game; then your stores and subscriptions
 *         that fit it; then any store or subscription you marked that neither
 *         covers. Only the first group has a url.
 * others  your remaining platforms, behind a disclosure, so a purchase IGDB
 *         knows nothing about can still be recorded.
 *
 * Every entry carries the platform object toggled into user_platforms. A linked
 * store reuses your own entry when you have one, so its key matches what is
 * already saved.
 */
export function buildPlatformArea(game, userPlatforms = [], selectedKeys = new Set()) {
  const users = (userPlatforms || []).map(normalizePlat);
  const shown = new Set();
  const take = (p) => { shown.add(platKey(p)); return p; };

  const pills = [];
  for (const raw of game?.platforms || []) {
    const p = normalizePlat(raw);
    if (!shown.has(platKey(p))) pills.push(take(p));
  }

  const rows = [];
  for (const link of buildStoreLinks(game)) {
    const def = STORE_DEFS.find((d) => d.key === link.key);
    const own = users.find((p) => p.category === 'store' && p.name.toLowerCase() === def.name.toLowerCase());
    const platform = own || normalizePlat({ name: def.name, category: 'store', linkedIgdbId: LINKED_ID_BY_FAMILY[def.family] ?? null });
    if (!shown.has(platKey(platform))) rows.push({ ...link, platform: take(platform) });
  }

  const { fitting, other } = matchPlatformsForGame(game, users);
  for (const p of fitting) {
    if (p.category !== 'hardware' && !shown.has(platKey(p))) rows.push(unlinkedRow(take(p)));
  }

  for (const p of users) {
    const k = platKey(p);
    if (!selectedKeys.has(k) || shown.has(k)) continue;
    if (p.category === 'hardware') pills.push(take(p));
    else rows.push(unlinkedRow(take(p)));
  }

  const others = [...fitting, ...other].filter((p) => !shown.has(platKey(p)));
  return { pills, rows, others };
}
