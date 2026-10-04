/* Reads of the game page's phase-two fields: the family a game belongs to, the
   line that says what it is a version of, its per-platform release dates and
   its non-store links. Pure functions of the getGameById record, so the page
   derives them in one memo and the tests can call them directly. */

/* IGDB's expanded related game -> the flat shape every GameCard takes. The same
   inline mapping the search overlay and the category pages do. */
export const toCard = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  first_release_date: g.first_release_date || null,
  release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
});

/* game_type -> how THIS game relates to its parent_game. Ids read off live IGDB
   responses (Blood and Wine is 2 and points at The Witcher 3; the Remastered
   entry is 9). Anything unlisted falls back to "Part of", which is never false. */
const RELATION = {
  1: 'DLC for', 2: 'Expansion for', 4: 'Standalone expansion for', 5: 'Mod of',
  6: 'Episode of', 7: 'Season of', 8: 'Remake of', 9: 'Remaster of',
  10: 'Expanded edition of', 11: 'Port of', 12: 'Fork of', 13: 'Pack for', 14: 'Update for',
};

/** { prefix, game } naming what this game is a version of, or null. */
export function versionOf(game) {
  if (game.version_parent?.id) {
    return { prefix: `${game.version_title || 'An edition'} of`, game: game.version_parent };
  }
  if (game.parent_game?.id) {
    return { prefix: RELATION[game.game_type] || 'Part of', game: game.parent_game };
  }
  return null;
}

const byDate = (a, b) => (a.first_release_date || Infinity) - (b.first_release_date || Infinity);
const uniq = (list, seen) => list.filter(g => g?.id && !seen.has(g.id) && seen.add(g.id));

/* DLC lists run long -- sports games carry a hundred kit packs -- so a row keeps
   its first dozen in release order and says how many it left out. */
const ROW_CAP = 12;
const capped = (label, list) => ({
  label,
  games: list.slice(0, ROW_CAP).map(toCard),
  more: Math.max(0, list.length - ROW_CAP),
});

/** The game's relatives, grouped for the bento grid, empty groups dropped.
    Order is the owner's: remakes first, then the original, expansions, DLC,
    and Others -- ports, expanded editions and bundles (GOTY, Complete), which
    are versions of this game rather than new ones. */
export function familyOf(game) {
  const seen = new Set([game.id]);
  const versions = uniq([...(game.remakes || []), ...(game.remasters || [])], seen).sort(byDate);
  const original = uniq([game.version_parent, game.parent_game], seen);
  const expansions = uniq([...(game.expansions || []), ...(game.standalone_expansions || [])], seen).sort(byDate);
  const dlc = uniq(game.dlcs || [], seen).sort(byDate);
  const others = uniq([...(game.ports || []), ...(game.expanded_games || []), ...(game.bundles || [])], seen).sort(byDate);
  return [
    capped('Remakes and Remasters', versions),
    capped('Original', original),
    capped('Expansions', expansions),
    capped('DLC', dlc),
    capped('Others', others),
  ].filter(r => r.games.length > 0);
}

export function similarOf(game) {
  const seen = new Set([game.id]);
  return uniq(game.similar_games || [], seen).map(toCard);
}

/* One entry per platform: its earliest dated release, or IGDB's own words
   ("2026", "Q4 2026", "TBD") when nothing is dated. Regions repeat a platform;
   the first date is the one that means "out on this platform". */
export function releasesByPlatform(game) {
  const best = new Map();
  for (const r of game.release_dates || []) {
    const name = r.platform?.abbreviation || r.platform?.name;
    if (!name) continue;
    const cur = best.get(name);
    if (!cur || (r.date && (!cur.date || r.date < cur.date))) best.set(name, { platform: name, date: r.date || null, human: r.human || 'TBD' });
  }
  return [...best.values()].sort((a, b) => (a.date || Infinity) - (b.date || Infinity) || a.platform.localeCompare(b.platform));
}

/** True when the platforms did not all release on the same day, which is the
    only case where listing them says more than the single Released date. */
export const datesDiffer = (rows) => new Set(rows.map(r => r.date ?? r.human)).size > 1;

/* Website types from live IGDB data (The Witcher 3 carries all of these).
   Store types are not here: gameLinks.js turns those into the store rows. */
const LINKS = [
  { type: 1, label: 'Official Site' },
  { type: 3, label: 'Wikipedia' },
  { type: 2, label: 'Wiki' },
  { type: 14, label: 'Reddit' },
  { type: 18, label: 'Discord' },
];
const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

export function linksOf(game) {
  const sites = game.websites || [];
  return LINKS
    .map(({ type, label }) => {
      const site = sites.find(w => w.type === type && isWebUrl(w.url));
      return site ? { label, url: site.url } : null;
    })
    .filter(Boolean);
}

/* The series timeline: every main game in the franchise, in release order.
 *
 * Franchise lists carry every DLC, pack and bundle IGDB files under the name, so
 * only main games and the kinds that stand on their own are kept -- a Mario
 * timeline would otherwise be costume packs. The highlight is this game when it
 * is on the line, and otherwise the game it belongs to: an expansion is not on
 * the series timeline, but its original is, and that is where it sits.
 *
 * A long franchise is windowed around the highlight rather than truncated at
 * the start, so the timeline always shows this game's neighbours. Undated
 * entries go last, in name order. */
const STANDALONE = new Set([0, 4, 8, 9, 10]);   // main, standalone exp., remake, remaster, expanded
const WINDOW = 30;
export function timelineOf(game, franchiseGames) {
  const seen = new Set();
  const own = STANDALONE.has(game.game_type ?? 0) ? [game] : [];
  const all = uniq([...own, ...(franchiseGames || []).filter(g => STANDALONE.has(g.game_type ?? 0))], seen)
    .sort((a, b) => byDate(a, b) || String(a.name).localeCompare(String(b.name)));
  if (all.length < 2) return null;
  const anchor = game.version_parent?.id || game.parent_game?.id;
  const highlightId = all.some(g => g.id === game.id) ? game.id : (all.some(g => g.id === anchor) ? anchor : null);
  let start = 0;
  if (all.length > WINDOW) {
    const at = Math.max(0, all.findIndex(g => g.id === highlightId));
    start = Math.min(Math.max(0, at - Math.floor(WINDOW / 2)), all.length - WINDOW);
  }
  return {
    entries: all.slice(start, start + WINDOW).map(toCard),
    total: all.length,
    before: start,
    after: Math.max(0, all.length - start - WINDOW),
    highlightId,
    highlightIsSelf: highlightId === game.id,
  };
}
