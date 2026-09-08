// What the library says about your taste, and how it compares to everyone else's.
//
// Unlike libraryStats this one is async, because it has to fill a gap. IGDB
// metadata only lands on a library entry once something has fetched that game —
// measured, 59 of 66 Beaten entries carry a `total_rating` but only 13 of 116
// Wishlist ones do. Every figure below is an average over games that have a
// crowd score, so on the raw library the priority comparison ran on 25 of 134
// games and meant nothing. One chunked, cached getGamesByIds closes that — over
// the entries that can actually reach a figure here rather than the whole shelf,
// see `contributes` — and it warms a cache the rest of the app reads.
//
// The fetched metadata is deliberately NOT written back into the library. The
// entries are mirrored into one Firestore document with a 1MB ceiling (see the
// header of db.js), and persisting the full IGDB object for 240 games to compute
// an average is how that ceiling gets hit. It is merged in memory and thrown away.
import { getLibrary } from './db';
import { getGamesByIds } from './igdb';
import { tierOfLibraryGame, TIER_WEIGHT } from './discover';
import { normalizeStatus } from '../constants/stateColors';
import { FEEL_ORDER, PRIORITY_ORDER } from './libraryStats';

/** IGDB's total_rating is 0-100. Below this a handful of votes is not a verdict. */
const MIN_RATING = 1;

/* {id, name}, not a bare name. The profile links a studio to /games/company/:id
 * and a series to /franchise/:id, and the id is the only thing that can address
 * either page — a name cannot. An entry's own cached copy of this metadata has
 * no id on it (`entry.dev` is a plain string), so the id is null whenever IGDB
 * was not reachable, and the row renders as text instead of pointing at a route
 * that cannot resolve. */
const developersOf = (g) => (g?.involved_companies || [])
  .filter(c => c.developer && c.company?.name)
  .map(c => ({ id: c.company.id ?? null, name: c.company.name }));

/** Franchises arrive as objects from IGDB and occasionally as bare strings on an
 *  older entry. Both shapes reduce to the same {id, name}. */
const franchisesOf = (src) => (src || [])
  .map(f => (typeof f === 'string'
    ? { id: null, name: f }
    : (f?.name ? { id: f.id ?? null, name: f.name } : null)))
  .filter(Boolean);

/** One entry per name within a single game, keeping the first that carries an id. */
const byName = (rows) => [...(rows || []).reduce((m, r) => {
  if (!r?.name) return m;
  const prev = m.get(r.name);
  if (!prev) m.set(r.name, r);
  else if (prev.id == null && r.id != null) m.set(r.name, r);
  return m;
}, new Map()).values()];

/** Weighted by how much you liked it, ranked by that, but reported as counts.
 *  A row that says "21" when you own seven of their games is a number nobody
 *  can check; the weight decides the order and the counts explain it. */
const rank = (rows, limit) => Object.values(rows)
  .sort((a, b) => b.weight - a.weight || b.games - a.games)
  .slice(0, limit)
  .map(({ id, name, games, loved }) => ({ id, name, games, loved }));

/* Bucketed by name, because that is what the reader is being shown and two
   IGDB ids for one studio name would otherwise split its games across two rows.
   The first id seen wins and a later one only fills a gap, so a bucket that met
   the game through a cached entry first can still become linkable. */
const add = (bucket, { id, name } = {}, weight, loved) => {
  if (!name) return;
  bucket[name] = bucket[name] || { id: null, name, games: 0, loved: 0, weight: 0 };
  if (id != null && bucket[name].id == null) bucket[name].id = id;
  bucket[name].games++;
  bucket[name].weight += weight;
  if (loved) bucket[name].loved++;
};

/** Mean crowd score per bucket, with the n that produced it. A mean without its
 *  n is unreadable here — `Someday` has one game. */
const meanBy = (entries, keyOf, order) => {
  const acc = {};
  for (const { key, rating } of entries.map(e => ({ key: keyOf(e.entry), rating: e.rating }))) {
    if (!key || !(rating >= MIN_RATING)) continue;
    acc[key] = acc[key] || { n: 0, sum: 0 };
    acc[key].n++;
    acc[key].sum += rating;
  }
  return order
    .filter(k => acc[k])
    .map(k => ({ key: k, n: acc[k].n, avg: Math.round((acc[k].sum / acc[k].n) * 10) / 10 }));
};

/**
 * Can this entry reach any figure this file returns?
 *
 * Studios and franchises are ranked over Beaten and Playing only. `byFeel` reads
 * Beaten only. `byPriority` reads unfinished entries that carry a priority, and
 * skips a null key. So a wishlisted game with no priority set contributes to
 * nothing — and the fetch below was pulling IGDB metadata for every one of them.
 */
const contributes = (g) => {
  const status = normalizeStatus(g.status);
  return status === 'Beaten' || status === 'Playing' || Boolean(g.priority);
};

const played = (g) => {
  const status = normalizeStatus(g.status);
  return status === 'Beaten' || status === 'Playing';
};

/**
 * Is anything this entry will be READ for still missing from it?
 *
 * Narrowing to contributors was not enough on its own: someone who sets a
 * priority on their whole wishlist makes almost every entry a contributor, and
 * the fetch is unbounded again. But an entry that already carries the field it
 * will be read for does not need fetching at all — the merge below prefers the
 * IGDB copy and falls back to the entry's own, and for these the two agree.
 *
 * A played game is read for its score, its studio and its franchise; an unplayed
 * one with a priority is read for its score alone, since the studio ranking
 * skips it by status. So the question is per-entry and not per-library, and on a
 * warm library most entries answer no.
 */
const needsFetch = (g) => {
  const hasRating = typeof g.total_rating === 'number' && g.total_rating >= MIN_RATING;
  if (!played(g)) return !hasRating;
  return !hasRating || !g.involved_companies?.length || !(g.franchises?.length || g.dev);
};

/**
 * @returns {Promise<{studios, franchises, byFeel, byPriority, coverage, reachedIgdb}>}
 *          `reachedIgdb` false means the call returned nothing — no credentials,
 *          or offline. The figures are then whatever the entries already carried,
 *          which is honest but thin, and the caller must say so.
 */
export async function tasteStats(library = getLibrary()) {
  const games = Array.isArray(library) ? library : [];

  /* Fetch what the statistics actually read, not the whole shelf.
   *
   * This pulled IGDB metadata for every entry — measured on a 2,116-entry
   * library, 49 chunked requests and over 40 seconds of "Reading your library…"
   * for a band whose every number is computed from a fraction of them. Bounded
   * to contributors it is the same arithmetic over the same inputs, done once
   * for each game that can affect an answer.
   *
   * `coverage` counts the same set for the same reason. It was measured over the
   * whole library, which flattered nothing and misled slightly: it invited you to
   * read "scored for 236 of 2,116" as thin coverage, when the 1,880 it counted
   * against were wishlist entries that appear in neither row and never could. */
  const contributors = games.filter(contributes);
  const ids = contributors.filter(needsFetch).map(g => Number(g.id)).filter(Number.isFinite);

  let fetched;
  try {
    fetched = ids.length ? await getGamesByIds(ids) : [];
  } catch {
    fetched = [];
  }
  const byId = new Map(fetched.map(g => [String(g.id), g]));

  /* IGDB first, then the entry's own copy, then the single denormalised `dev`
     string an older entry carries. The middle link is what makes skipping the
     fetch safe: an entry that already holds `involved_companies` reads exactly
     the same either way, and without this step it would have fallen past a rich
     array straight to a bare string. */
  const merged = contributors.map(entry => {
    const igdb = byId.get(String(entry.id));
    /* Computed once each. Both were called twice per entry — once to test the
       length, once for the value — so every game walked its company list twice
       and allocated the result twice, for nothing. */
    const devs = developersOf(igdb);
    const ownDevs = devs.length ? null : developersOf(entry);
    return {
      entry,
      rating: igdb?.total_rating ?? entry.total_rating ?? null,
      devs: devs.length ? devs
        : (ownDevs.length ? ownDevs : (entry.dev ? [{ id: null, name: entry.dev }] : [])),
      franchises: franchisesOf(igdb?.franchises || entry.franchises),
    };
  });

  const studios = {};
  const franchises = {};
  for (const m of merged) {
    /* Games you have actually played, not everything in the library. The
       recommender counts a wishlisted game too, because it is modelling what to
       suggest next — but "studios you keep going back to" is a claim about your
       history, and on the real library the two answers were not close: counting
       everything put Ubisoft Montreal top with 17 games of which 2 were loved
       and most were wishlist. That is a studio you keep ADDING. Ranked over
       played games it drops behind Naughty Dog, which is the true answer to the
       question the heading asks.

       The weights are still the recommender's, so the shape of "what you like"
       agrees between the two surfaces: Perfection counts triple, another
       finished game double, one in progress single, a dropped one not at all. */
    const status = normalizeStatus(m.entry.status);
    if (status !== 'Beaten' && status !== 'Playing') continue;
    const tier = tierOfLibraryGame(m.entry);
    if (tier == null) continue;
    const weight = TIER_WEIGHT[tier];
    const loved = m.entry.feel === 'Perfection';
    /* byName, not `new Set`. These were bare strings and a Set deduped them by
       value; they are objects now, so every entry is distinct by identity and a
       game that credits the same studio twice — IGDB does list a company twice
       when it both developed and ported — would have counted twice. */
    for (const d of byName(m.devs)) add(studios, d, weight, loved);
    for (const f of byName(m.franchises)) add(franchises, f, weight, loved);
  }

  const rated = merged.filter(m => m.rating >= MIN_RATING);

  return {
    studios: rank(studios, 6),
    franchises: rank(franchises, 6),

    byFeel: meanBy(
      merged.filter(m => normalizeStatus(m.entry.status) === 'Beaten'),
      e => e.feel,
      FEEL_ORDER,
    ),
    /* Priority is what you thought BEFORE playing, so this only means anything
       on games you have not finished. On finished ones it is the leftover of an
       intention the outcome has already answered. */
    byPriority: meanBy(
      merged.filter(m => normalizeStatus(m.entry.status) !== 'Beaten'),
      e => e.priority,
      PRIORITY_ORDER,
    ),

    coverage: { rated: rated.length, of: contributors.length },
    reachedIgdb: fetched.length > 0,
    /* Whether a request was made at all, which `reachedIgdb` cannot express:
       it is `fetched.length > 0`, so a library with nothing to fetch and a
       library whose fetch failed report the same false. The band read that one
       flag as "IGDB is down" and told a user with a single unfinished game so —
       an infrastructure failure that had not happened, on a page whose only
       real news was that they had not finished anything yet. Every entry
       already being cached lands in the same false, for the same reason. */
    askedIgdb: ids.length > 0,
  };
}
