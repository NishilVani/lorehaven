/**
 * The arithmetic behind the profile redesign, and the CSV the export writes.
 *
 * Three things here are easy to get wrong in a way no gate can see, because the
 * page renders perfectly while the number on it is false:
 *
 *   1. The all-years month distribution and the per-year busiest month. A tie
 *      must not be reported as a peak — "busiest March" on a year with one game
 *      in each of three months invents a pattern out of nothing.
 *   2. Completion dates crossing a timezone. `toISOString().slice(0,10)` is the
 *      obvious way to write a date column and it is one day early for every
 *      reader east of UTC, so the file disagrees with the app that made it.
 *   3. The status column. Entries written by older imports carry 'Completed' and
 *      'Done'; the app reads both as Beaten, and an export that copied the raw
 *      string would not re-import as the shelf it came from.
 *
 * Run: node tests/profile-stats.test.mjs
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* The app's source is written for Vite, which resolves extensionless relative
 * imports; plain node does not. igdb-cache.test.mjs works around that by simply
 * not importing the affected modules — which is why `asRows()` has no coverage.
 * Two hooks close the gap without editing working source.
 *
 * The second hook stubs `services/db`. Both functions under test take the
 * library as an argument and only reach for `getLibrary()` as a default, but the
 * real module initialises Firebase at import time — a network client stood up to
 * satisfy an import that is never called. The stub keeps the test hermetic and
 * makes "was a library actually passed in?" a thing the test can catch.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : HERE;
      const asFile = resolvePath(base, `${specifier}.js`);
      if (existsSync(asFile)) return { url: pathToFileURL(asFile).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    /* A stub must export every name its importers destructure or the module
       graph fails to link. That is a SyntaxError naming the missing export at
       load time, so this list cannot rot silently — but it does have to be
       extended by hand when a new import is added.
       ponytail: hand-listed; derive from source only if this starts churning. */
    if (url.endsWith('/services/db.js')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export const getLibrary = () => { throw new Error("the live library must never be read in a test"); };
          export const getSavedIgdbCollections = () => [];
          export const getSavedFranchises = () => [];
          export const getRecFeedbackList = () => [];
          export const setRecFeedback = () => {};
          export const getPrefs = () => ({});
          export const setSyncedLocalItem = () => {};
        `,
      };
    }
    /* `services/igdb` is stubbed for the same reason as `db`: importing the real
       one stands up a network client. `globalThis.__igdbCalls` records what was
       asked for, which is the whole point of the askedIgdb assertions below —
       the distinction they protect is "did we ask", and only the call log can
       answer that. */
    if (url.endsWith('/services/igdb.js')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export const getGamesByIds = async (ids) => {
            globalThis.__igdbCalls.push(ids);
            return globalThis.__igdbReturns;
          };
          export const getGamesProfile = async () => [];
          export const getGamesForDiscovery = async () => [];
          export const getGamesForUpdates = async () => [];
          export const getTrendingGames = async () => [];
          export const getRecentlyAnnounced = async () => [];
          export const getGameHero = async () => null;
          export const getCollectionsByIds = async () => [];
          export const getFranchiseMetadataByIds = async () => [];
        `,
      };
    }
    return next(url, context);
  },
});

const { libraryStats } = await import('../src/services/libraryStats.js');
const { libraryRows } = await import('../src/services/exportLibrary.js');
const { tasteStats } = await import('../src/services/tasteStats.js');

/** Local midnight, the way the app stores a date you picked off a calendar. */
const on = (y, m, d) => new Date(y, m - 1, d).toISOString();
const hours = (h) => ({ normally: h * 3600 });

const LIB = [
  // 2024: three months with one each — a tie, so no busiest month.
  { id: 1, name: 'Alpha', status: 'Beaten', feel: 'Perfection', dateCompleted: on(2024, 1, 10), game_time_to_beat: hours(10) },
  { id: 2, name: 'Beta', status: 'Beaten', feel: 'Go for it', dateCompleted: on(2024, 4, 2), game_time_to_beat: hours(20) },
  { id: 3, name: 'Gamma', status: 'Beaten', feel: 'Go for it', dateCompleted: on(2024, 7, 5) },
  // 2025: April clearly ahead, and a legacy 'Completed' status that must count.
  { id: 4, name: 'Delta', status: 'Beaten', feel: 'Perfection', dateCompleted: on(2025, 4, 1), game_time_to_beat: hours(5) },
  { id: 5, name: 'Epsilon', status: 'Completed', feel: 'Timepass', dateCompleted: on(2025, 4, 20), game_time_to_beat: hours(7) },
  { id: 6, name: 'Zeta', status: 'Beaten', dateCompleted: on(2025, 9, 9), game_time_to_beat: hours(3) },
  // Not finished, so out of every completion figure.
  { id: 7, name: 'Eta', status: 'Backlog', priority: 'Next Up', game_time_to_beat: hours(40) },
  { id: 8, name: 'Theta', status: 'Wishlist', priority: 'Soon' },
  { id: 9, name: 'Iota', status: 'Dropped' },
];

const s = libraryStats(LIB);

// ── Shelves and the figures derived from them ───────────────────────────────
assert.equal(s.completed, 6, "'Completed' must normalise to Beaten, not fall through");
assert.equal(s.shelves.Beaten, 6);
assert.equal(s.started, 8, 'started is Beaten + Backlog + Dropped + Playing; wishlist never counts');
assert.equal(s.hoursBeaten.hours, 45, '10+20+5+7+3, with the untimed one excluded');
assert.equal(s.hoursBeaten.covered, 5);
assert.equal(s.hoursBeaten.of, 6, 'coverage must travel with the total or the total cannot be judged');
assert.equal(s.hoursBacklog.hours, 40);

// ── All-years month distribution ────────────────────────────────────────────
const byMonth = Object.fromEntries(s.completions.byMonth.map(m => [m.label, m.games]));
assert.equal(s.completions.byMonth.length, 12, 'every month is present, including the empty ones');
assert.deepEqual(
  [byMonth.Jan, byMonth.Apr, byMonth.Jul, byMonth.Sep, byMonth.Feb],
  [1, 3, 1, 1, 0],
  'April holds 2024 and both of 2025 — the point of combining years',
);
assert.equal(s.completions.byMonth.reduce((a, m) => a + m.games, 0), 6);

// ── Per-year rollup ─────────────────────────────────────────────────────────
const y = Object.fromEntries(s.completions.byYear.map(r => [r.year, r]));
assert.equal(y[2024].games, 3);
assert.equal(y[2024].loved, 1);
assert.equal(y[2024].peakMonth, null, 'a three-way tie is not a busiest month');
assert.equal(y[2025].games, 3);
assert.equal(y[2025].peakMonth, 'Apr');
assert.equal(y[2025].peakMonthGames, 2);
assert.equal(y[2024].hours, 30, 'the untimed 2024 game must not be counted as zero and hidden');
assert.equal(y[2024].covered, 2);

// ── The CSV ─────────────────────────────────────────────────────────────────
const rows = libraryRows(LIB);
assert.equal(rows.length, LIB.length, 'every entry is exported, whatever shelf it is on');

const epsilon = rows.find(r => r.Name === 'Epsilon');
assert.equal(epsilon.Status, 'Beaten', 'the normalised shelf, so the file agrees with the app');
assert.equal(epsilon['Status (as stored)'], 'Completed', 'and the raw value rides along, so nothing is lost');
assert.equal(epsilon.Completed, '2025-04-20', 'the local date, not the UTC one a slice of toISOString gives');
assert.equal(epsilon.Verdict, 'Timepass');

const jan = rows.find(r => r.Name === 'Alpha');
assert.equal(jan.Completed, '2024-01-10',
  'a January date must not slip to 31 December for readers east of UTC');

const eta = rows.find(r => r.Name === 'Eta');
assert.equal(eta.Completed, '', 'no date is an empty cell, never today');
assert.equal(eta.Priority, 'Next Up');
assert.equal(eta.Status, 'Backlog');

// Platform columns are split by kind, because a console and a store are not the
// same claim and one merged column cannot be re-imported.
const withPlaces = libraryRows([{
  id: 10, name: 'Kappa', status: 'Beaten', dateCompleted: on(2025, 2, 2),
  user_platforms: [
    { category: 'hardware', name: 'PS5' },
    { category: 'hardware', name: 'PC' },
    { category: 'store', name: 'Steam' },
    { category: 'subscription', name: 'Game Pass' },
  ],
}])[0];
assert.equal(withPlaces.Hardware, 'PS5; PC');
assert.equal(withPlaces.Store, 'Steam');
assert.equal(withPlaces.Subscription, 'Game Pass');

// An empty library must produce zeros, not NaN or a crash.
const empty = libraryStats([]);
assert.equal(empty.total, 0);
assert.equal(empty.hoursBeaten.hours, 0);
assert.equal(empty.completions.byYear.length, 0);
assert.equal(empty.completions.byMonth.length, 12);
assert.equal(libraryRows([]).length, 0);

console.log('profile-stats: all assertions passed');

// ─────────────────────────────────────────────────────────────────────────────
// askedIgdb — "we never asked" is not "IGDB is down".
//
// The taste band branched on `reachedIgdb` alone, which is `fetched.length > 0`
// and therefore false in three unrelated situations: the fetch failed, there was
// nothing to fetch, and everything was already cached. Only the first is an
// outage, and the band told the other two "Could not reach IGDB" — sending a
// user with one unfinished game off to check their connection over a page that
// was working perfectly.
// ─────────────────────────────────────────────────────────────────────────────
const taste = async (library, returns = []) => {
  globalThis.__igdbCalls = [];
  globalThis.__igdbReturns = returns;
  const stats = await tasteStats(library);
  return { stats, calls: globalThis.__igdbCalls };
};

// Nothing qualifies: wishlist entries are neither played nor prioritised.
{
  const { stats, calls } = await taste([
    { id: 1, name: 'Alpha', status: 'Wishlist' },
    { id: 2, name: 'Beta', status: 'Wishlist' },
  ]);
  assert.equal(calls.length, 0, 'a library with no contributors must not make a request');
  assert.equal(stats.askedIgdb, false, 'askedIgdb must be false when nothing was asked for');
  assert.equal(stats.reachedIgdb, false);
}

// Contributors that need data, and the request comes back empty. This one IS an
// outage and must stay distinguishable from the case above.
{
  const { stats, calls } = await taste([{ id: 7, name: 'Gamma', status: 'Beaten' }], []);
  assert.deepEqual(calls, [[7]], 'a contributor missing its metadata must be fetched');
  assert.equal(stats.askedIgdb, true, 'asking and getting nothing is not the same as never asking');
  assert.equal(stats.reachedIgdb, false);
}

// Contributors, and the request succeeds.
{
  const { stats } = await taste(
    [{ id: 7, name: 'Gamma', status: 'Beaten' }],
    [{ id: 7, total_rating: 88, involved_companies: [{ developer: true, company: { id: 3, name: 'Studio' } }], franchises: [{ id: 9, name: 'Series' }] }],
  );
  assert.equal(stats.askedIgdb, true);
  assert.equal(stats.reachedIgdb, true);
  assert.equal(stats.studios[0].name, 'Studio', 'a successful fetch must still rank what it fetched');
}

// Every contributor already carries what the stats read, so nothing is fetched.
// reachedIgdb is false here and always was — the bug is reading that as an outage.
{
  const cached = {
    id: 11, name: 'Delta', status: 'Beaten', total_rating: 91,
    involved_companies: [{ developer: true, company: { id: 4, name: 'Cached Studio' } }],
    franchises: [{ id: 12, name: 'Cached Series' }],
  };
  const { stats, calls } = await taste([cached]);
  assert.equal(calls.length, 0, 'a fully cached contributor must not be re-fetched');
  assert.equal(stats.askedIgdb, false, 'a cache hit is not an outage');
  assert.equal(stats.reachedIgdb, false);
  assert.equal(stats.studios[0].name, 'Cached Studio', 'and it must still be ranked from what the entry carries');
}

console.log('profile-stats: taste-band assertions passed');

// ─────────────────────────────────────────────────────────────────────────────
// Completion dates must survive a round trip through the date input.
//
// `<input type="date">` reads only `yyyy-MM-dd` and silently blanks anything
// else. Every other reader parsed the field leniently, so a full ISO timestamp
// displayed correctly on the cards, the sort and the profile charts while the
// one field you edit it in showed empty -- and the empty field reported '' on
// change, which persisted null over the real date.
// ─────────────────────────────────────────────────────────────────────────────
const { toDateInputValue } = await import('../src/services/libraryFields.js');

// The shape the app actually writes: local midnight, stored as UTC.
{
  const stored = new Date(2024, 0, 10).toISOString();
  assert.equal(toDateInputValue(stored), '2024-01-10',
    `a local date stored as ISO must come back as the day the user picked, not the UTC day (${stored})`);
}

// A plain date passes through untouched. Re-parsing it would be the bug in
// reverse: `new Date('2024-01-10')` is UTC midnight, so reading local parts
// moves it to the 9th anywhere west of UTC.
assert.equal(toDateInputValue('2024-01-10'), '2024-01-10', 'an already-correct value must not be re-parsed');

// Import writes whatever the spreadsheet held.
assert.equal(toDateInputValue('2024-01-10T00:00:00'), '2024-01-10', 'a local ISO string with no zone');
assert.equal(toDateInputValue('January 10, 2024'), '2024-01-10', 'a human-written cell');

// Absence stays absence; garbage does not become a date.
for (const empty of [null, undefined, '', 0]) {
  assert.equal(toDateInputValue(empty), null, `${JSON.stringify(empty)} must stay null, never today`);
}
assert.equal(toDateInputValue('not a date'), null, 'an unparseable value must be null, not Invalid Date');

// The whole point: whatever goes in, what comes out is assignable to the input.
for (const input of [new Date(2024, 0, 10).toISOString(), '2024-01-10', 'January 10, 2024', '2024-01-10T00:00:00']) {
  assert.match(toDateInputValue(input), /^\d{4}-\d{2}-\d{2}$/,
    `every accepted shape must normalise to the one shape the date input reads (${input})`);
}

console.log('profile-stats: completion-date assertions passed');
