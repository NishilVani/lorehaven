// Self-check for library sort comparators. Run: node src/pages/library/librarySort.test.mjs
import assert from 'node:assert';
import { sortGames, cmpNum } from './librarySort.js';

const names = (arr) => arr.map(g => g.name);

// 1. release_year mixes numbers and the string 'Unknown Year' — must NOT NaN-corrupt.
//    Real years descend; 'Unknown Year' lands LAST (not scattered / not at top).
const yr = [
  { name: 'B2018', release_year: 2018 },
  { name: 'CustomA', release_year: 'Unknown Year' },
  { name: 'A2020', release_year: 2020 },
  { name: 'CustomB', release_year: 'Unknown Year' },
];
assert.deepStrictEqual(names(sortGames(yr, 'year-desc')), ['A2020', 'B2018', 'CustomA', 'CustomB'],
  'year-desc: numeric years descend, unknowns last, name tiebreak');
assert.deepStrictEqual(names(sortGames(yr, 'year-asc')), ['B2018', 'A2020', 'CustomA', 'CustomB'],
  'year-asc: unknowns STILL last (do not flip to top), name tiebreak');

// 2. Stable natural-order name tiebreaker when the primary key ties.
const tie = [
  { name: 'Assassin\'s Creed 10', release_year: 2020 },
  { name: 'Assassin\'s Creed 2', release_year: 2020 },
];
assert.deepStrictEqual(names(sortGames(tie, 'year-desc')), ['Assassin\'s Creed 2', 'Assassin\'s Creed 10'],
  'equal years → natural name order (2 before 10, not string 10 before 2)');

// 3. Priority: Someday(0) is distinct from unprioritized(missing→last).
const pr = [
  { name: 'none1' },
  { name: 'someday1', priority: 'Someday' },
  { name: 'nextup1', priority: 'Next Up' },
];
assert.deepStrictEqual(names(sortGames(pr, 'priority')), ['nextup1', 'someday1', 'none1'],
  'priority desc: Next Up > Someday > unprioritized-last');

// 4. Public rating: missing (custom games, total_rating null) sort last both ways.
const rt = [
  { name: 'unrated', total_rating: null },
  { name: 'good', total_rating: 82 },
  { name: 'great', total_rating: 95 },
];
assert.deepStrictEqual(names(sortGames(rt, 'public-desc')), ['great', 'good', 'unrated'],
  'public-desc: rated descend, unrated last');

// 5. cmpNum contract: nulls last in both directions.
assert.strictEqual(cmpNum(null, 5, -1), 1, 'a null → after b');
assert.strictEqual(cmpNum(5, null, -1), -1, 'b null → after a');
assert.strictEqual(cmpNum(null, 5, 1), 1, 'a null → after b (asc too)');

console.log('librarySort: all assertions passed');
