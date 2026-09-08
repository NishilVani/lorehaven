// Everything the profile page counts, derived from the library alone.
//
// Pure and synchronous — no IGDB call, no network. Every figure here comes from
// fields already on the entries, which is what lets band B render on first paint
// while the taste band is still fetching.
//
// The rule this file follows: a number never travels without its coverage. Hours
// are summed from IGDB's time-to-beat, which is missing on some entries, so
// `hours` always ships alongside `covered` and `of` — and the UI is expected to
// say "about" and to show the shortfall rather than presenting a total that
// quietly under-counts. Measured on the real library: 59 of 66 Beaten entries
// carry a time-to-beat, but only 13 of 116 Wishlist ones do, so the same
// calculation is trustworthy on one shelf and near-meaningless on another. It is
// the caller's job to decide, and it can only decide if it is told.
import { getLibrary } from './db';
import { normalizeStatus } from '../constants/stateColors';

/** IGDB stores time-to-beat in seconds. */
const HOURS = 3600;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The four-point verdict, worst to best — the order the UI reads them in. */
export const FEEL_ORDER = ['Skip', 'Timepass', 'Go for it', 'Perfection'];

/** Planning intent, most urgent first. */
export const PRIORITY_ORDER = ['Next Up', 'Soon', 'Maybe', 'Someday'];

const ttbHours = (g) => {
  const s = g?.game_time_to_beat?.normally;
  return typeof s === 'number' && s > 0 ? s / HOURS : null;
};

/** Sum of time-to-beat over a shelf, with the coverage that qualifies it. */
const sumHours = (games) => {
  const vals = games.map(ttbHours).filter(v => v !== null);
  return {
    hours: Math.round(vals.reduce((a, c) => a + c, 0)),
    covered: vals.length,
    of: games.length,
  };
};

const tally = (games, pick) => {
  const out = {};
  for (const g of games) {
    for (const v of [].concat(pick(g) || [])) {
      if (v === null || v === undefined || v === '') continue;
      out[v] = (out[v] || 0) + 1;
    }
  }
  return out;
};

const ranked = (counts, limit) => Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, limit)
  .map(([name, count]) => ({ name, count }));

/**
 * @param {Array} [library] — defaults to the live library
 * @returns everything band B renders. All counts, never percentages: the page
 *          decides how to phrase a ratio, and a rounded percent stored here
 *          would lose the numerator the copy needs.
 */
export function libraryStats(library = getLibrary()) {
  const games = Array.isArray(library) ? library : [];

  /* Statuses on disk are not the six shelf names — imports and older entries
     wrote 'Completed', 'Done', 'Interested'. Comparing g.status directly is what
     used to make pickNext skip whole shelves silently. */
  const status = (g) => normalizeStatus(g.status);
  const on = (s) => games.filter(g => status(g) === s);

  const beaten = on('Beaten');
  const backlog = on('Backlog');
  const dropped = on('Dropped');
  const playing = on('Playing');
  const wishlist = on('Wishlist');
  const unreleased = on('Unreleased');

  /* Started means you committed to playing it, so Wishlist and Unreleased are
     out — neither has been begun and counting them would make the completion
     rate a measure of how much you window-shop. */
  const started = beaten.length + backlog.length + dropped.length + playing.length;

  const completions = beaten
    .map(g => ({ at: Date.parse(g.dateCompleted), hours: ttbHours(g), game: g }))
    .filter(c => Number.isFinite(c.at));

  /* Two passes over the same completions, because the profile asks two different
     questions of them: which years you finished things in, and which part of the
     year you finish things in whatever the year. The second is the one that shows
     a habit — April is a spike across seven years, not a fact about 2025. */
  const byYear = {};
  const byMonth = MONTHS.map((label, i) => ({ label, month: i, games: 0 }));
  for (const c of completions) {
    const d = new Date(c.at);
    const y = d.getFullYear();
    byYear[y] = byYear[y] || { year: y, games: 0, hours: 0, covered: 0, loved: 0, months: MONTHS.map(() => 0) };
    byYear[y].games++;
    byYear[y].months[d.getMonth()]++;
    if (c.hours) { byYear[y].hours += c.hours; byYear[y].covered++; }
    if (c.game.feel === 'Perfection') byYear[y].loved++;
    byMonth[d.getMonth()].games++;
  }

  /* Release decade. first_release_date is a unix second, and it is absent on
     roughly half the library — entries only carry it once something has fetched
     their IGDB metadata. */
  const decades = {};
  let dated = 0;
  for (const g of games) {
    const t = g.first_release_date;
    if (!t) continue;
    dated++;
    const d = Math.floor(new Date(t * 1000).getFullYear() / 10) * 10;
    decades[d] = (decades[d] || 0) + 1;
  }

  /* Where the library actually lives. user_platforms mixes three kinds of thing
     — a console, a storefront and a subscription are all recorded in the same
     array and told apart by `category` — so they are split here rather than
     summed into one misleading list. */
  const places = { hardware: {}, store: {}, subscription: {} };
  for (const g of games) {
    for (const p of g.user_platforms || []) {
      const cat = places[p?.category] ? p.category : 'hardware';
      const name = p?.name || String(p);
      if (!name) continue;
      places[cat][name] = (places[cat][name] || 0) + 1;
    }
  }

  return {
    total: games.length,

    shelves: {
      Playing: playing.length,
      Backlog: backlog.length,
      Wishlist: wishlist.length,
      Beaten: beaten.length,
      Dropped: dropped.length,
      Unreleased: unreleased.length,
    },

    hoursBeaten: sumHours(beaten),
    hoursBacklog: sumHours(backlog),

    started,
    completed: beaten.length,
    droppedCount: dropped.length,

    /* Both are counted on Beaten only. feel is set on a finished game; priority
       is what you thought before playing, and until GameDetail stopped clearing
       it on completion it did not survive to be counted here at all. */
    feels: tally(beaten, g => g.feel),
    priorities: tally(games.filter(g => status(g) !== 'Beaten'), g => g.priority),

    completions: {
      dated: completions.length,
      of: beaten.length,
      byMonth,
      byYear: Object.values(byYear).sort((a, b) => a.year - b.year)
        .map(y => {
          /* The month is only worth naming when it actually stands out. A year
             with one game in each of three months has no busiest month, and
             printing one would invent a pattern out of a tie. */
          const peak = Math.max(...y.months);
          const leaders = y.months.filter(n => n === peak).length;
          return {
            ...y,
            hours: Math.round(y.hours),
            peakMonth: peak > 1 && leaders === 1 ? MONTHS[y.months.indexOf(peak)] : null,
            peakMonthGames: peak,
          };
        }),
    },

    decades: Object.entries(decades)
      .map(([d, count]) => ({ decade: Number(d), count }))
      .sort((a, b) => a.decade - b.decade),
    decadesCovered: { covered: dated, of: games.length },

    places: {
      hardware: ranked(places.hardware, 6),
      store: ranked(places.store, 6),
      subscription: ranked(places.subscription, 6),
      unrecorded: games.filter(g => !(g.user_platforms || []).length).length,
    },
  };
}
