/**
 * Library sorting, and the interaction between sorting and grouping.
 *
 * The bug this was written for: on the Unreleased shelf -- whose defaults are
 * sort "Release . New" and group "Release Year" -- switching to "Release . Old"
 * changed nothing at all. Neither the order of the year groups nor the order of
 * the cards inside them moved. Reproduced against the real comparators: grouped
 * output was byte-identical for both directions, while the same games ungrouped
 * sorted correctly.
 *
 * Two independent causes, and both had to be fixed or the page contradicts
 * itself:
 *
 *   1. The release sorters keyed on `release_year` alone. Inside a group of one
 *      year that key is constant, so every comparison tied and the only thing
 *      ordering the cards was the name tiebreaker -- which reads the same in
 *      both directions. IGDB carries `first_release_date`, so there was a finer
 *      key available the whole time.
 *   2. The year group ordering was hardcoded descending and never consulted the
 *      sort. Picking "Release . Old" still listed 2028 before 2026.
 *
 * Run: node tests/library-sort.test.mjs
 */
import assert from 'node:assert/strict';
import { sortGames, releaseVal, groupDirection } from '../src/pages/library/librarySort.js';

/** unix seconds, the shape IGDB returns on first_release_date */
const secs = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

// ── The finer key ────────────────────────────────────────────────────────────
{
  const may = { name: 'May Game', release_year: 1998, first_release_date: secs(1998, 5, 1) };
  const jul = { name: 'Jul Game', release_year: 1998, first_release_date: secs(1998, 7, 1) };

  assert.ok(releaseVal(may) < releaseVal(jul),
    'two games from the same year must be separable when IGDB gives exact dates');

  const newFirst = sortGames([may, jul], 'year-desc').map(g => g.name);
  const oldFirst = sortGames([may, jul], 'year-asc').map(g => g.name);
  assert.deepEqual(newFirst, ['Jul Game', 'May Game'], 'Release . New puts the later date first');
  assert.deepEqual(oldFirst, ['May Game', 'Jul Game'], 'Release . Old puts the earlier date first');
  assert.notDeepEqual(newFirst, oldFirst,
    'THE BUG: same-year games must reorder when the direction flips, which is what the year groups render');
}

// A game with only a year still sorts by that year, and never outranks a dated
// game from a later year.
{
  const yearOnly = { name: 'Year Only', release_year: 2020 };
  const dated = { name: 'Dated', release_year: 2021, first_release_date: secs(2021, 1, 1) };
  assert.ok(releaseVal(yearOnly) < releaseVal(dated), 'a bare year must still compare against a full date');
  assert.deepEqual(sortGames([yearOnly, dated], 'year-desc').map(g => g.name), ['Dated', 'Year Only']);
}

// Missing release info parks last in BOTH directions -- an undated game never
// jumps to the top just because the direction flipped.
{
  const none = { name: 'No Info' };
  const some = { name: 'Has Year', release_year: 2000 };
  assert.equal(releaseVal(none), null, 'no year and no date is a null key, not a zero');
  assert.deepEqual(sortGames([none, some], 'year-desc').map(g => g.name), ['Has Year', 'No Info']);
  assert.deepEqual(sortGames([none, some], 'year-asc').map(g => g.name), ['Has Year', 'No Info'],
    'missing values stay last when the direction flips');
}

// ── Group ordering follows the sort ──────────────────────────────────────────
assert.equal(groupDirection('year-asc'), 1, 'Release . Old orders the year groups oldest first');
assert.equal(groupDirection('year-desc'), -1, 'Release . New orders them newest first');
assert.equal(groupDirection('date-asc'), 1, 'the completion-year groups follow the completion sort too');
assert.equal(groupDirection('date-desc'), -1);
assert.equal(groupDirection('alpha'), -1,
  'a sort with no chronological direction leaves the groups newest-first, the established default');
assert.equal(groupDirection(undefined), -1, 'an unknown sort key must not produce NaN ordering');

// ── The whole path: sort, then group, the way Library.jsx renders it ─────────
{
  const g = (name, year, m) => ({ name, release_year: year, first_release_date: m ? secs(year, m, 1) : undefined });
  const games = [
    g('Crimson', 2028, 3),
    g('Zebra Quest', 2027, 9), g('Alpha Strike', 2027, 2),
    g('Yonder', 2026, 11), g('Beta Run', 2026, 4), g('Mid Game', 2026, 7),
  ];

  /* The grouping Library.jsx performs, driven by the same direction. */
  const groupByYear = (sortKey) => {
    const dir = groupDirection(sortKey);
    const m = new Map();
    for (const x of sortGames(games, sortKey)) {
      const y = x.release_year || 'Unknown Year';
      if (!m.has(y)) m.set(y, []);
      m.get(y).push(x);
    }
    return [...m.entries()]
      .map(([label, gs]) => ({ label: String(label), games: gs.map(x => x.name) }))
      .sort((a, b) => {
        if (a.label === 'Unknown Year') return 1;
        if (b.label === 'Unknown Year') return -1;
        return dir * (parseInt(a.label) - parseInt(b.label));
      });
  };

  const newFirst = groupByYear('year-desc');
  const oldFirst = groupByYear('year-asc');

  assert.deepEqual(newFirst.map(x => x.label), ['2028', '2027', '2026'], 'Release . New: newest group first');
  assert.deepEqual(oldFirst.map(x => x.label), ['2026', '2027', '2028'], 'Release . Old: oldest group first');

  const y2026New = newFirst.find(x => x.label === '2026').games;
  const y2026Old = oldFirst.find(x => x.label === '2026').games;
  assert.deepEqual(y2026New, ['Yonder', 'Mid Game', 'Beta Run'], 'newest release first inside the group');
  assert.deepEqual(y2026Old, ['Beta Run', 'Mid Game', 'Yonder'], 'oldest release first inside the group');
  assert.notDeepEqual(y2026New, y2026Old,
    'THE BUG, end to end: the cards inside a year group must reorder when the sort flips');
}

console.log('library-sort: all assertions passed');
