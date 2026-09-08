/* Which of the user's platforms fit a given game.
 *
 * The game page used to render the game's IGDB platforms and every platform the
 * user had configured as one row, so a PS4-only game showed Steam, GOG, Epic and
 * both Game Passes beside the one platform it runs on. Separating those needs a
 * rule for "fits", and no single source has it:
 *
 *   - IGDB knows which storefronts a game is actually on, in external_games. It
 *     is right where the hardcoded links are wrong: PlayStation Store is pinned
 *     to PS5 in DEFAULT_CUSTOM_PLATFORMS, so it would miss Bloodborne.
 *   - IGDB does not know about subscriptions, and has no Nintendo eShop source
 *     at all. Breath of the Wild's only external sources are GiantBomb, Youtube,
 *     Twitch and Amazon.
 *
 * So storefronts come from IGDB where IGDB knows, and a platform-family map
 * covers the rest. The map is a guess and is meant to be one; nothing here is a
 * hard filter, because everything that does not fit is still offered under
 * "other".
 *
 * Pure on purpose: no localStorage, no import.meta, so tests/platform-match.test.mjs
 * can run it under plain node.
 */

/* IGDB external_game_source id -> the store name in DEFAULT_CUSTOM_PLATFORMS.
 * An allowlist, not a mapping of everything: the 22 sources also include
 * GiantBomb, Youtube, Twitch, Amazon, Oculus, Itch.io, Kartridge, GameJolt and
 * IGDB itself, none of which is a place anyone owns a console game. Nintendo
 * eShop is absent from IGDB entirely and is served by the family map below. */
export const STORE_SOURCE_IDS = {
  Steam: [1],
  GOG: [5],
  'Microsoft Store': [11, 31],
  'App Store': [13],
  'Google Play Store': [15],
  'Epic Games Store': [26],
  'PlayStation Store': [36],
};

/* Every id that is actually a storefront, flattened out of STORE_SOURCE_IDS.
 * Most of IGDB's 22 external_game_source values are metadata -- GiantBomb,
 * Youtube, Twitch, Amazon, IGDB itself -- not a place anyone owns a game. A
 * game carrying only those still has sources.size > 0, so checking size alone
 * would treat IGDB as authoritative and suppress every store, never reaching
 * the family fallback below. */
const ALL_STORE_SOURCE_IDS = new Set(Object.values(STORE_SOURCE_IDS).flat());

/* IGDB platform id -> family. Only the families that have a store or a
 * subscription in DEFAULT_CUSTOM_PLATFORMS are here; anything else contributes
 * no family and therefore places no store.
 *
 * Careful: the two id spaces collide. Platform 11 is the original Xbox, while
 * external game source 11 is Microsoft. Never compare one to the other. */
export const FAMILY_BY_PLATFORM_ID = {
  3: 'pc', 6: 'pc', 14: 'pc',
  7: 'playstation', 8: 'playstation', 9: 'playstation', 38: 'playstation',
  46: 'playstation', 48: 'playstation', 167: 'playstation', 390: 'playstation',
  11: 'xbox', 12: 'xbox', 49: 'xbox', 169: 'xbox',
  4: 'nintendo', 5: 'nintendo', 18: 'nintendo', 19: 'nintendo', 20: 'nintendo',
  21: 'nintendo', 24: 'nintendo', 33: 'nintendo', 37: 'nintendo', 41: 'nintendo',
  130: 'nintendo', 159: 'nintendo', 508: 'nintendo',
  39: 'ios',
  34: 'android',
};

/** Stable identity for a platform across IGDB, owned and custom sources. */
export const platKey = (p) => {
  if (!p) return '';
  if (p.id !== undefined && p.id !== null && p.id !== '') return `id:${p.id}`;
  return `name:${String(p.name || '').trim().toLowerCase()}`;
};

/** The minimal shape stored on a library entry's user_platforms. */
export const normalizePlat = (p) => ({
  id: p.id ?? `custom_${p.category || 'hardware'}_${String(p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
  name: String(p.name || '').trim(),
  abbreviation: p.abbreviation || null,
  category: p.category ?? 'hardware',
  linkedIgdbId: p.linkedIgdbId ?? null,
  linkedIgdbName: p.linkedIgdbName ?? null,
  platform_logo_image_id: p.platform_logo_image_id ?? p.platform_logo?.image_id ?? undefined,
});

const ORDER = { hardware: 0, store: 1, subscription: 2 };

/**
 * Split the user's platforms into those that fit this game and the rest.
 *
 * Both arrays hold only the USER's platforms. The game's own IGDB platforms are
 * rendered separately as the availability chips and never pass through here.
 *
 * @param {{platforms?: {id:number}[], external_games?: {external_game_source:number}[]}} game
 * @param {object[]} userPlatforms  already normalised, may contain duplicates
 * @returns {{fitting: object[], other: object[]}}
 */
export function matchPlatformsForGame(game, userPlatforms) {
  const platformIds = new Set((game?.platforms || []).map(p => p.id));
  const families = new Set([...platformIds].map(id => FAMILY_BY_PLATFORM_ID[id]).filter(Boolean));
  const sources = new Set((game?.external_games || []).map(e => e.external_game_source).filter(v => v != null));

  const familyFits = (p) => {
    const family = FAMILY_BY_PLATFORM_ID[p.linkedIgdbId];
    return !!family && families.has(family);
  };

  const fitsGame = (p) => {
    if (p.category === 'store') {
      const ids = STORE_SOURCE_IDS[p.name];
      /* IGDB is authoritative only when it knows this store AND says something
         about this game -- "something" meaning at least one of the game's
         sources is actually a storefront, not just metadata. Otherwise fall
         back to the family. */
      const knowsAStorefront = [...sources].some(id => ALL_STORE_SOURCE_IDS.has(id));
      if (ids && knowsAStorefront) return ids.some(id => sources.has(id));
      return familyFits(p);
    }
    if (p.category === 'subscription') return familyFits(p);
    return platformIds.has(p.id);          // hardware
  };

  const seen = new Set();
  const fitting = [], other = [];
  for (const p of userPlatforms || []) {
    const key = platKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    (fitsGame(p) ? fitting : other).push(p);
  }
  fitting.sort((a, b) => (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9));
  return { fitting, other };
}
