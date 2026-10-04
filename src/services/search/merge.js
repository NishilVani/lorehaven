/* One ranked list per tab, from three sources: your device (library and games
 * you have opened), the shipped index, and IGDB.
 *
 * The local sources answer instantly and forgive typos; IGDB covers the long
 * tail. Everything goes through the same engine ranking, so a game is placed
 * by how well it matches and how popular it is, never by which source happened
 * to answer first, and appears once however many sources hold it. An IGDB hit
 * the engine scores below its threshold -- matched on an alternative name the
 * index does not carry, say -- is still kept, after the ranked ones, because
 * IGDB found it for a reason. Pure. */
import { prepare, search } from './engine.js';

const GAME_TYPE = {
  0: 'Game', 1: 'DLC Addon', 2: 'Expansion', 3: 'Bundle', 4: 'Standalone Expansion', 5: 'Mod',
  6: 'Episode', 7: 'Season', 8: 'Remake', 9: 'Remaster', 10: 'Expanded Game', 11: 'Port',
  12: 'Fork', 13: 'Pack', 14: 'Update',
};
/* Kinds that are not the game itself: kept, but ranked under it. */
const SECONDARY = new Set([1, 3, 5, 11, 13, 14]);

const yearOf = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);

export function igdbGameDoc(g) {
  return {
    kind: 'game', id: g.id, name: g.name, year: yearOf(g), cover: g.cover?.image_id || null,
    pop: g.total_rating_count || (g.follows || 0) / 4,
    edition: !!g.version_parent || SECONDARY.has(g.game_type),
    gameType: g.game_type, source: 'igdb',
  };
}

/** The card shape the overlay renders, from any source's document. */
export function toResultCard(doc) {
  return {
    id: doc.id, name: doc.name, cover_id: doc.cover || null, release_year: doc.year || null,
    game_type_label: doc.gameType !== undefined ? GAME_TYPE[doc.gameType] : null,
  };
}

function rankWithLeftovers(pool, igdbDocs, query, kind, limit) {
  const ranked = search(pool, query, { limit, kinds: [kind], minText: 0.45 });
  const have = new Set(ranked.map(r => String(r.doc.id)));
  const leftovers = igdbDocs
    .filter(d => !have.has(String(d.id)) && have.add(String(d.id)))
    .sort((a, b) => (b.pop || 0) - (a.pop || 0));
  return [...ranked.map(r => r.doc), ...leftovers].slice(0, limit);
}

/** → result cards, best first. */
export function mergeGames({ device = [], local = [], igdb = [], query, limit = 40 }) {
  const igdbDocs = prepare(igdb.map(igdbGameDoc));
  return rankWithLeftovers([...device, ...igdbDocs, ...local], igdbDocs, query, 'game', limit).map(toResultCard);
}

/* Franchises and studios: IGDB's records carry what the cards draw (a
   franchise's games for its cover, a studio's logo), so when both sources hold
   one, IGDB's record is the one returned; the index adds the ones IGDB's
   substring match missed. */
function mergeNamed(kind, { local = [], igdb = [], query, limit = 20, popOf }) {
  const byId = new Map(igdb.map(r => [String(r.id), r]));
  const igdbDocs = prepare(igdb.map(r => ({ kind, id: r.id, name: r.name, pop: popOf(r), source: 'igdb' })));
  return rankWithLeftovers([...igdbDocs, ...local], igdbDocs, query, kind, limit)
    .map(d => byId.get(String(d.id)) || { id: d.id, name: d.name });
}

export const mergeFranchises = (args) => mergeNamed('franchise', { ...args, popOf: (f) => (f.games?.length || 0) * 20 });
export const mergeCompanies = (args) => mergeNamed('company', { ...args, popOf: (c) => ((c.developed?.length || 0) + (c.published?.length || 0)) * 5 });
