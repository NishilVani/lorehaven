/* Auto Priority: the bands, both scoring methods, and the plan the dialog
   previews and applies. Pure module, so no storage shim is needed. */
import assert from 'node:assert';
import {
  bandFor, publicScore, countRatedBeaten, MIN_RATED_BEATEN, AUTO_PRIORITY_TABS,
  buildBeatenTaste, tasteScore, planAutoPriority, undoPatch,
} from '../src/services/autoPriority.js';

/* ── Bands ── */
assert.strictEqual(bandFor(100), 'Next Up');
assert.strictEqual(bandFor(85), 'Next Up', '85 is the floor of Next Up');
assert.strictEqual(bandFor(84), 'Soon');
assert.strictEqual(bandFor(75), 'Soon', '75 is the floor of Soon');
assert.strictEqual(bandFor(74), 'Maybe');
assert.strictEqual(bandFor(65), 'Maybe', '65 is the floor of Maybe');
assert.strictEqual(bandFor(64), 'Someday');
assert.strictEqual(bandFor(0), 'Someday');
assert.strictEqual(bandFor(null), null, 'no score, no band');

/* ── Public score ── */
assert.strictEqual(publicScore({ total_rating: 84.6 }), 85, 'rounded, so the shown score and its band agree');
assert.strictEqual(bandFor(publicScore({ total_rating: 84.6 })), 'Next Up');
assert.strictEqual(publicScore({ total_rating: null }), null);
assert.strictEqual(publicScore({ total_rating: 0 }), null, 'IGDB writes 0 for unrated, not a real zero');
assert.strictEqual(publicScore({}), null);

/* ── Availability of the taste method ── */
assert.strictEqual(MIN_RATED_BEATEN, 5);
assert.deepStrictEqual(AUTO_PRIORITY_TABS, ['Playing', 'Backlog', 'Wishlist', 'Unreleased']);
assert.strictEqual(countRatedBeaten([
  { id: 1, status: 'Beaten', feel: 'Perfection' },
  { id: 2, status: 'Completed', feel: 'Skip' },      // legacy status name still counts
  { id: 3, status: 'Beaten', feel: 'Timepass' },     // Timepass is a rating
  { id: 4, status: 'Beaten' },                       // unrated
  { id: 5, status: 'Dropped', feel: 'Perfection' },  // Dropped never counts
  { id: 6, status: 'Backlog', feel: 'Go for it' },
]), 3);

/* ── The plan ── */
const shelf = [
  { id: 'a', name: 'A', total_rating: 90 },
  { id: 'b', name: 'B', total_rating: 60, priority: 'Soon' },
  { id: 'c', name: 'C' },                                   // no rating
  { id: 'd', name: 'D', total_rating: 70, priority: 'Eventually' }, // unrecognised import value
  { id: 'e', name: 'E', total_rating: 88, priority: 'Next Up' },
];

{
  const plan = planAutoPriority({ games: shelf, scoreOf: publicScore, replace: false });
  assert.deepStrictEqual(plan.rows.map(r => r.id), ['a'], 'replace off: only unprioritised games are scored');
  assert.strictEqual(plan.skipped, 1, 'C has no rating');
  assert.strictEqual(plan.alreadySet, 3, 'B, D and E keep what they have, Eventually included');
  assert.deepStrictEqual(plan.counts, { 'Next Up': 1, 'Soon': 0, 'Maybe': 0, 'Someday': 0 });
  assert.deepStrictEqual(plan.changes.map(c => [c.id, c.from, c.to, c.score]), [['a', null, 'Next Up', 90]]);
}

{
  const plan = planAutoPriority({ games: shelf, scoreOf: publicScore, replace: true });
  assert.deepStrictEqual(plan.rows.map(r => r.id), ['a', 'e', 'd', 'b'], 'rows run highest score first');
  assert.strictEqual(plan.skipped, 1);
  assert.strictEqual(plan.alreadySet, 0);
  assert.deepStrictEqual(plan.counts, { 'Next Up': 2, 'Soon': 0, 'Maybe': 1, 'Someday': 1 });
  assert.deepStrictEqual(
    plan.changes.map(c => [c.id, c.from, c.to]),
    [['a', null, 'Next Up'], ['d', 'Eventually', 'Maybe'], ['b', 'Soon', 'Someday']],
    'E already sits in its band, so it is counted but is not a change',
  );
}

assert.deepStrictEqual(
  undoPatch([{ id: 'a', from: null, to: 'Next Up' }, { id: 'b', from: 'Soon', to: 'Someday' }]),
  [{ id: 'a', priority: null }, { id: 'b', priority: 'Soon' }],
  'undo restores each prior value, and null means it had none',
);

/* ── Taste ── */
const profile = (id, { franchise, dev, themes = [], genres = [] }) => ({
  id,
  franchises: franchise ? [{ id: franchise }] : [],
  collections: [],
  involved_companies: dev ? [{ company: { id: dev }, developer: true }] : [],
  themes: themes.map(t => ({ id: t })),
  genres: genres.map(g => ({ id: g })),
});

const beaten = [
  { id: 1, status: 'Beaten', feel: 'Perfection' },
  { id: 2, status: 'Beaten', feel: 'Skip' },
  { id: 3, status: 'Beaten', feel: 'Timepass' },
  { id: 4, status: 'Dropped', feel: 'Perfection' },   // ignored: only Beaten teaches taste
];
const profiles = new Map([
  ['1', profile(1, { franchise: 10, dev: 100, themes: [1, 2] })],
  ['2', profile(2, { franchise: 20, dev: 200, themes: [3] })],
  ['3', profile(3, { franchise: 30, dev: 300, themes: [4] })],
  ['4', profile(4, { franchise: 40, dev: 400, themes: [5] })],
]);
const taste = buildBeatenTaste(beaten, profiles);
assert.deepStrictEqual(taste.map(t => t.id).sort(), ['1', '2'], 'Timepass and Dropped teach nothing');

const like = (id, shape) => profile(id, shape);
/* Resembles the Perfection game on series (3), developer (2) and themes (2):
   taste = (7*95 + 2*75) / 9 = 90.56, blended 0.6*90.56 + 0.4*75 = 84.3. */
assert.strictEqual(tasteScore({ id: 50, total_rating: 75 }, like(50, { franchise: 10, dev: 100, themes: [1, 2] }), taste), 84,
  'resembling a Perfection pulls a 75 up');
/* Resembles the Skip: (7*45 + 150) / 9 = 51.67, blended 31 + 30 = 61. */
assert.strictEqual(tasteScore({ id: 51, total_rating: 75 }, like(51, { franchise: 20, dev: 200, themes: [3] }), taste), 61,
  'resembling a Skip pushes a 75 down');
assert.strictEqual(tasteScore({ id: 52, total_rating: 75 }, like(52, { franchise: 99, dev: 999, themes: [9] }), taste), 75,
  'resembling nothing leaves the public rating');
assert.strictEqual(tasteScore({ id: 53, total_rating: 75 }, like(53, { franchise: 30, dev: 300, themes: [4] }), taste), 75,
  'resembling a Timepass is neutral');
assert.strictEqual(tasteScore({ id: 54, total_rating: 75 }, like(54, { franchise: 40, dev: 400, themes: [5] }), taste), 75,
  'resembling a Dropped game is neutral');
assert.strictEqual(tasteScore({ id: 55 }, like(55, { franchise: 10, dev: 100, themes: [1, 2] }), taste), 95,
  'no public rating: taste alone');
assert.strictEqual(tasteScore({ id: 56 }, like(56, { franchise: 99 }), taste), null,
  'no public rating and no resemblance: nothing to go on');
assert.strictEqual(tasteScore({ id: 57, total_rating: 80 }, null, taste), 80,
  'no profile (a custom entry with a rating) falls back to the public rating');
assert.strictEqual(tasteScore({ id: 58 }, null, taste), null);

/* Mutation check, recorded: dropping the `total_rating > 0` guard in
   publicScore failed the "0 is unrated" case; inverting the `Timepass` exclusion
   in buildBeatenTaste failed the neutral case; changing TASTE_WEIGHT to 0.5
   failed both blended cases. */
console.log('auto priority: all assertions passed');
