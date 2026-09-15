// Auto Priority -- give every game on a planning shelf a priority from a rule
// the user can read.
//
// Pure, with one pure import, so tests/auto-priority.test.mjs can run it in
// node. The dialog does the fetching and hands the results in.
//
// Two methods, one scale. Both produce a 0-100 score and read it through the
// same fixed bands, so "84" means Soon whichever method made it. Fixed bands
// were the owner's call over ranking within the shelf: the same rating always
// lands in the same priority, and the dialog's count strip is where a shelf
// that floods Next Up shows itself before anything is written.

import { PRIORITIES, FEELS, normalizeStatus } from '../constants/stateColors.js';

/* The shelves with a priority sort. Beaten hides priority entirely and Dropped
   has no priority sort, so offering the action there would write a value the
   shelf never reads. */
export const AUTO_PRIORITY_TABS = ['Playing', 'Backlog', 'Wishlist', 'Unreleased'];

/* Floors, highest first. */
const BANDS = [[85, 'Next Up'], [75, 'Soon'], [65, 'Maybe']];

export const bandFor = (score) => {
  if (score == null) return null;
  for (const [floor, label] of BANDS) if (score >= floor) return label;
  return 'Someday';
};

/* Rounded here rather than at display time, so the number beside a game and
   the band it lands in can never disagree: an 84.6 shows as 85 and is Next Up.
   IGDB writes 0 for a game nobody has rated, which is not a verdict. */
export const publicScore = (game) => {
  const r = Number(game?.total_rating);
  return Number.isFinite(r) && r > 0 ? Math.round(r) : null;
};

/* ── Taste ────────────────────────────────────────────────────────────────── */

/* The taste method is offered once there is something to learn from. Five is
   the owner's threshold; below it one Perfection would decide the whole shelf. */
export const MIN_RATED_BEATEN = 5;

export const countRatedBeaten = (library) =>
  (library || []).filter(g => normalizeStatus(g.status) === 'Beaten' && FEELS.includes(g.feel)).length;

/* What each rating says about a game like it, on the public-rating scale so the
   two blend without a conversion. Timepass is absent on purpose: it is neutral,
   so a game resembling one is neither pulled up nor pushed down. */
const FEEL_SCORE = { 'Perfection': 95, 'Go for it': 85, 'Skip': 45 };

/* 60% taste, 40% public rating: the owner's split. */
export const TASTE_WEIGHT = 0.6;

/* How much the public rating holds its ground against resemblance, in units of
   similarity. One strongly similar game (7) moves a score most of the way; a
   single shared theme (under 1) barely moves it. Without this a game sharing
   one genre with one Perfection would score 95. */
const PRIOR = 2;

const idsOf = (list) => new Set((list || []).map(x => (x && typeof x === 'object') ? (x.id ?? x.company?.id) : x).filter(x => x != null).map(String));

const attrsOf = (profile) => ({
  series: new Set([...idsOf(profile.franchises)].map(x => `f${x}`).concat([...idsOf(profile.collections)].map(x => `c${x}`))),
  developers: idsOf((profile.involved_companies || []).filter(c => c.developer).map(c => c.company)),
  themes: idsOf(profile.themes),
  genres: idsOf(profile.genres),
});

const overlaps = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
};

/* Series and studio are the strongest signals because they are what people
   actually follow; themes and genres are broad enough that only a close match
   should count for much. The same order of weight as pickNext's scorer. */
const similarity = (a, b) =>
  (overlaps(a.series, b.series) ? 3 : 0)
  + (overlaps(a.developers, b.developers) ? 2 : 0)
  + jaccard(a.themes, b.themes) * 2
  + jaccard(a.genres, b.genres);

/** Beaten games carrying a rating that pulls, with their profile attributes.
 *  Only Beaten: a Dropped game rated Perfection is not what this learns from. */
export const buildBeatenTaste = (library, profilesById) =>
  (library || [])
    .filter(g => normalizeStatus(g.status) === 'Beaten' && FEEL_SCORE[g.feel] != null)
    .map(g => ({ g, p: profilesById.get(String(g.id)) }))
    .filter(x => x.p)
    .map(({ g, p }) => ({ id: String(g.id), feelScore: FEEL_SCORE[g.feel], attrs: attrsOf(p) }));

/**
 * A game's score by resemblance to rated Beaten games, blended with its public
 * rating. Null when there is nothing to go on.
 *
 * The resemblance estimate is a weighted mean of those ratings, shrunk toward
 * the public rating, so a game resembling nothing keeps exactly its rating and
 * the blend changes nothing about it.
 */
export const tasteScore = (game, profile, taste) => {
  const pub = publicScore(game);
  if (!profile) return pub;
  const mine = attrsOf(profile);
  let weight = 0, sum = 0;
  for (const t of taste) {
    if (t.id === String(game.id)) continue;
    const s = similarity(mine, t.attrs);
    if (s > 0) { weight += s; sum += s * t.feelScore; }
  }
  if (pub == null) return weight > 0 ? Math.round(sum / weight) : null;
  const estimate = (sum + PRIOR * pub) / (weight + PRIOR);
  return Math.round(TASTE_WEIGHT * estimate + (1 - TASTE_WEIGHT) * pub);
};

/* ── The plan ─────────────────────────────────────────────────────────────── */

const hasPriority = (g) => g.priority != null && g.priority !== '';

/**
 * What the dialog previews and applies.
 *
 * With `replace` off a game that already has a priority is left alone, and an
 * unrecognised value an import wrote ("Eventually") counts as having one: the
 * user put it there. With `replace` on every game is rescored, and a game whose
 * band matches what it already has is counted but is not a change.
 */
export const planAutoPriority = ({ games, scoreOf, replace }) => {
  const counts = Object.fromEntries(PRIORITIES.map(p => [p, 0]));
  let skipped = 0, alreadySet = 0;
  const rows = [];
  for (const g of games || []) {
    if (!replace && hasPriority(g)) { alreadySet++; continue; }
    const score = scoreOf(g);
    if (score == null) { skipped++; continue; }
    const to = bandFor(score);
    const from = hasPriority(g) ? g.priority : null;
    counts[to]++;
    rows.push({ id: g.id, name: g.name, cover_id: g.cover_id || null, score, from, to, changed: from !== to });
  }
  rows.sort((a, b) => b.score - a.score);
  return { rows, changes: rows.filter(r => r.changed), counts, skipped, alreadySet };
};

/* null, not a deleted key: saveManyToLibrary merges, so only an explicit null
   clears a priority the game did not have before. */
export const undoPatch = (changes) => changes.map(c => ({ id: c.id, priority: c.from ?? null }));
