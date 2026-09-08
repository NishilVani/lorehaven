// One year of finished games, for the yearly review.
//
// The spine is `dateCompleted`, which is the only date the app has ever asked
// you for — measured, 62 of 66 finished games carry one, which is what makes a
// yearly view possible at all. The four that do not are counted and reported
// rather than quietly dropped: a year total that silently omits games is the
// exact failure this file is built to avoid.
//
// `addedAt` deliberately plays no part yet. It only started recording in
// 2445166, so "games added in 2026" would mean "since the day that shipped" and
// read as a collapse. It becomes usable a year from now.
import { getLibrary } from './db';
import { getGamesByIds } from './igdb';
import { normalizeStatus } from '../constants/stateColors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const hoursOf = (g) => {
  const s = g?.game_time_to_beat?.normally;
  return typeof s === 'number' && s > 0 ? s / 3600 : null;
};

/* {id, name}, because "Studio of the year" links to /games/company/:id and
 * "Series of the year" to /franchise/:id. An entry's own cached copy carries no
 * id, so the id is null when IGDB was unreachable and the card renders as plain
 * text rather than a link to a route that cannot resolve. */
const developersOf = (g) => (g?.involved_companies || [])
  .filter(c => c.developer && c.company?.name)
  .map(c => ({ id: c.company.id ?? null, name: c.company.name }));

/** IGDB sends objects; an older entry sometimes holds a bare string. */
const franchisesOf = (src) => (src || [])
  .map(f => (typeof f === 'string'
    ? { id: null, name: f }
    : (f?.name ? { id: f.id ?? null, name: f.name } : null)))
  .filter(Boolean);

/** One entry per name within a single game — IGDB lists a company twice when it
 *  both developed and ported, and that must not count as two games. */
const byName = (rows) => [...(rows || []).reduce((m, r) => {
  if (!r?.name) return m;
  const prev = m.get(r.name);
  if (!prev || (prev.id == null && r.id != null)) m.set(r.name, r);
  return m;
}, new Map()).values()];

/** Which years have anything finished in them, newest first. Sync — the year
 *  picker must not wait on a fetch to know which years exist. */
export function completedYears(library = getLibrary()) {
  const years = new Map();
  for (const g of library || []) {
    if (normalizeStatus(g.status) !== 'Beaten') continue;
    const t = Date.parse(g.dateCompleted);
    if (!Number.isFinite(t)) continue;
    const y = new Date(t).getFullYear();
    years.set(y, (years.get(y) || 0) + 1);
  }
  return [...years.entries()]
    .map(([year, games]) => ({ year, games }))
    .sort((a, b) => b.year - a.year);
}

const topOf = (counts) => {
  const rows = Object.values(counts).sort((a, b) => b.games - a.games);
  return rows.length ? rows[0] : null;
};

/**
 * @param {number} year
 * @returns {Promise<object|null>} null when nothing was finished that year.
 */
export async function yearStats(year, library = getLibrary()) {
  const all = Array.isArray(library) ? library : [];

  const inYear = all.filter(g => {
    if (normalizeStatus(g.status) !== 'Beaten') return false;
    const t = Date.parse(g.dateCompleted);
    return Number.isFinite(t) && new Date(t).getFullYear() === year;
  });
  if (inYear.length === 0) return null;

  /* Same fetch as the taste band and the same cache, so opening a year after
     the profile costs nothing. Only this year's games — a year view has no
     reason to pull the whole library. */
  let fetched;
  try {
    fetched = await getGamesByIds(inYear.map(g => Number(g.id)).filter(Number.isFinite));
  } catch {
    fetched = [];
  }
  const byId = new Map(fetched.map(g => [String(g.id), g]));

  const games = inYear.map(entry => {
    const igdb = byId.get(String(entry.id));
    const at = Date.parse(entry.dateCompleted);
    /* Computed once. It used to be called twice per game — once to test the
       length, once for the value — so every entry walked its involved_companies
       list and allocated the result twice over, for nothing. */
    const devs = developersOf(igdb);
    return {
      id: entry.id,
      name: entry.name || igdb?.name || 'Untitled',
      cover: entry.cover_id || igdb?.cover?.image_id || null,
      feel: entry.feel || null,
      at,
      month: new Date(at).getMonth(),
      hours: hoursOf(entry) ?? hoursOf(igdb),
      rating: igdb?.total_rating ?? entry.total_rating ?? null,
      devs: devs.length ? devs : (entry.dev ? [{ id: null, name: entry.dev }] : []),
      franchises: franchisesOf(igdb?.franchises || entry.franchises),
      released: igdb?.first_release_date ?? entry.first_release_date ?? null,
    };
  }).sort((a, b) => a.at - b.at);

  const timed = games.filter(g => g.hours !== null).sort((a, b) => b.hours - a.hours);
  const rated = games.filter(g => g.rating >= 1);

  const months = MONTHS.map((label, i) => ({
    label,
    games: games.filter(g => g.month === i).length,
  }));
  const busiest = months.reduce((a, m) => (m.games > a.games ? m : a), months[0]);

  const studios = {};
  const franchises = {};
  /* Keyed by name so two ids for one studio cannot split its games in two, with
     the first id seen kept so the card stays linkable. */
  const bump = (bucket, { id, name }) => {
    bucket[name] = bucket[name] || { id: null, name, games: 0 };
    if (id != null && bucket[name].id == null) bucket[name].id = id;
    bucket[name].games++;
  };
  for (const g of games) {
    for (const d of byName(g.devs)) bump(studios, d);
    for (const f of byName(g.franchises)) bump(franchises, f);
  }

  /* The decade those games came FROM, which is a different question from when
     you played them and usually the more surprising one. */
  const decades = {};
  let datedReleases = 0;
  for (const g of games) {
    if (!g.released) continue;
    datedReleases++;
    const d = Math.floor(new Date(g.released * 1000).getFullYear() / 10) * 10;
    decades[d] = (decades[d] || 0) + 1;
  }

  return {
    year,
    games,
    count: games.length,
    hours: Math.round(timed.reduce((a, g) => a + g.hours, 0)),
    timed: { covered: timed.length, of: games.length },
    longest: timed[0] || null,
    shortest: timed.length > 1 ? timed[timed.length - 1] : null,
    months,
    busiest: busiest.games > 0 ? busiest : null,
    loved: games.filter(g => g.feel === 'Perfection'),
    topStudio: topOf(studios),
    topFranchise: topOf(franchises),
    decades: Object.entries(decades)
      .map(([d, count]) => ({ decade: Number(d), count }))
      .sort((a, b) => b.count - a.count),
    datedReleases,
    crowd: rated.length
      ? { avg: Math.round((rated.reduce((a, g) => a + g.rating, 0) / rated.length) * 10) / 10, n: rated.length }
      : null,
  };
}
