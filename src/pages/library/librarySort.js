// Library sort comparators — pure, so they can be unit-tested (librarySort.test.mjs).
//
// The bugs this fixes vs the old version:
//  • release_year is a NUMBER for dated games but the string 'Unknown Year' for
//    custom/undated ones, so `(b.release_year||0) - (a.release_year||0)` produced
//    NaN and silently corrupted the whole order. Keys are now coerced to numbers.
//  • No tiebreaker → equal/blank keys scattered randomly. Every sort now ends in
//    a stable, natural-order name compare.
//  • Missing values flipped ends when you toggled asc/desc. They now sort LAST in
//    both directions (an undated/unrated game never jumps to the top).

export const PRIORITY_MAP = { 'Next Up': 3, 'Soon': 2, 'Maybe': 1, 'Someday': 0 };
export const FEEL_MAP = { 'Perfection': 3, 'Go for it': 2, 'Timepass': 1, 'Skip': 0 };

// natural, case-insensitive: "Assassin's Creed 2" sorts before "…Creed 10"
export const byName = (a, b) =>
  (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });

// Key extractors — return null for missing/blank so cmpNum can park them last.
export const yearVal = (g) => { const y = Number(g.release_year); return Number.isFinite(y) && y > 0 ? y : null; };

/**
 * The release sort key, at the finest granularity available.
 *
 * `yearVal` alone is why "Release · New" and "Release · Old" did nothing on a
 * shelf grouped by Release Year: inside one year group that key is constant, so
 * every pair tied and the name tiebreaker — identical in both directions —
 * decided the whole order. The Unreleased shelf defaults to exactly that pair,
 * so the sort control was inert the moment the tab opened.
 *
 * IGDB carries `first_release_date` (unix seconds) on real entries, so a finer
 * key was available all along. Expressed in years so the two sources stay
 * comparable: a game with only `release_year` still ranks against a dated one
 * from another year, which a raw-seconds key would break by making every bare
 * year astronomically small.
 */
export const releaseVal = (g) => {
  const t = Number(g.first_release_date);
  if (Number.isFinite(t) && t > 0) return 1970 + t / 31556952; // seconds → fractional years
  return yearVal(g);
};

/**
 * Which way the chronological groups run, for a given sort key.
 *
 * The year and completion-year group ordering was hardcoded descending and
 * never read the sort, so picking "Release · Old" still listed 2028 above 2026.
 * Fixing only the within-group order would have left the page contradicting
 * itself — cards ascending inside groups that descend.
 *
 * Sorts with no chronological direction (alpha, priority, rating) keep the
 * established newest-first default rather than inventing an order from a key
 * the groups do not share. Listed explicitly rather than matched on an `-asc`
 * suffix, which would sweep in `ttb-asc` — shortest-to-beat first says nothing
 * about which year should lead.
 */
const GROUP_DIRECTION = { 'year-asc': 1, 'year-desc': -1, 'date-asc': 1, 'date-desc': -1 };
export const groupDirection = (sortKey) => GROUP_DIRECTION[sortKey] ?? -1;
export const dateVal = (g) => { const t = Date.parse(g.dateCompleted); return Number.isFinite(t) ? t : null; };
export const ttbVal = (g) => { const t = g.game_time_to_beat; const s = t?.normally || t?.hastily || t?.completely; return s > 0 ? s : null; };
export const publicVal = (g) => (typeof g.total_rating === 'number' && g.total_rating > 0 ? g.total_rating : null);
export const priorityVal = (g) => (g.priority in PRIORITY_MAP ? PRIORITY_MAP[g.priority] : null);
export const feelVal = (g) => (g.feel in FEEL_MAP ? FEEL_MAP[g.feel] : null);

/** Compare two keys; missing (null) always sorts last regardless of direction. */
export const cmpNum = (av, bv, dir) => {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return dir * (av - bv);
};

export const SORTERS = {
  'alpha':       (a, b) => byName(a, b),
  'alpha-desc':  (a, b) => byName(b, a),
  'year-desc':   (a, b) => cmpNum(releaseVal(a), releaseVal(b), -1) || byName(a, b),
  'year-asc':    (a, b) => cmpNum(releaseVal(a), releaseVal(b), 1) || byName(a, b),
  'date-desc':   (a, b) => cmpNum(dateVal(a), dateVal(b), -1) || byName(a, b),
  'date-asc':    (a, b) => cmpNum(dateVal(a), dateVal(b), 1) || byName(a, b),
  'priority':    (a, b) => cmpNum(priorityVal(a), priorityVal(b), -1) || byName(a, b),
  'rating-desc': (a, b) => cmpNum(feelVal(a), feelVal(b), -1) || byName(a, b),
  'public-desc': (a, b) => cmpNum(publicVal(a), publicVal(b), -1) || byName(a, b),
  'ttb-asc':     (a, b) => cmpNum(ttbVal(a), ttbVal(b), 1) || byName(a, b),
};

/** Sort a copy of `games` by the given sort key (falls back to A→Z). */
export const sortGames = (games, sortKey) => [...games].sort(SORTERS[sortKey] || SORTERS.alpha);
