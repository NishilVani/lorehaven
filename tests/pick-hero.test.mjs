/**
 * Which game becomes the "Top Pick" on Explore.
 *
 * The bug this was written for, reported twice:
 *
 *   "my top pick is GTA San Andreas but my era is set to recent"
 *   "after marking Persona 3 Reload as not interested its showing GTA San
 *    Andreas again"
 *
 * getRecommendations sorts candidates by score, and the era preference feeds
 * that score. The hero was then chosen with `find(rating > 85)` -- a scan by
 * RATING over a list ordered by SCORE, which silently overrides the sort
 * whenever the top of the list rates below the bar. With Era set to Recent the
 * real pool ran 2025/2023/2024/2024/2022 rated 79 to 81, so the scan walked past
 * every one of them and surfaced Grand Theft Auto: San Andreas, 2004, rated 92.
 *
 * The second report was the same defect in a second place: Discover's
 * advanceHero had its own copy of the expression, so fixing the engine alone
 * moved the bug one click away -- the first pick was recent, and dismissing it
 * handed San Andreas straight back.
 *
 * So the rule lives in exactly one function now, pickHero, and both callers use
 * it. These assertions pin the three things that were wrong: the era wins over
 * the rating scan, the rating floor still applies inside that era, and
 * preferring an era can never leave the hero empty.
 */
import './dom-shim.mjs';
import assert from 'node:assert/strict';
import { pickHero, toCard, releaseEraOf, ERA_YEARS } from '../src/services/discover.js';

const YEAR = 365.25 * 24 * 60 * 60;
/* Ages, not fixed years: the eras are measured from now, so a fixture pinned to
   calendar years would silently drift out of the era it was written for. */
const agoYears = (n) => Math.floor(Date.now() / 1000 - n * YEAR);
const card = (name, age, total_rating) => ({
  id: name, name, total_rating,
  first_release_date: agoYears(age),
  release_year: new Date(agoYears(age) * 1000).getFullYear(),
});

/** The expression both callers used to hold, kept to prove the fixture bites. */
const oldRule = (list) => list.find(c => (c.total_rating || 0) > 85) || list[0] || null;

/* The reported pool, in the score order getRecommendations produces, with the
   real ratings it carried. Everything recent rates under the old 85 floor
   except Wonder, and Wonder scores BELOW San Andreas -- which is the whole
   shape of the bug: the rating scan reaches San Andreas first. */
const scored = [
  card("Assassin's Creed Shadows", 1, 79),
  card("Assassin's Creed Mirage", 3, 74),
  card('Star Wars Outlaws', 2, 77),
  card('MultiVersus', 2, 72),
  card('LEGO Star Wars: The Skywalker Saga', 4, 81),
  card('Grand Theft Auto: San Andreas', 22, 92),
  card('Super Mario Bros. Wonder', 3, 91),
];

// ── The reported regression ──────────────────────────────────────────────────
{
  assert.equal(oldRule(scored).name, 'Grand Theft Auto: San Andreas',
    'the fixture must reproduce the reported bug under the old rule, or it proves nothing');

  const hero = pickHero(scored, 'new');
  assert.equal(hero.name, 'Super Mario Bros. Wonder',
    'THE BUG: with Era set to Recent the hero must come from the recent games, not from the highest rating in the whole list');
  assert.equal(releaseEraOf(hero), 'new');
  assert.notEqual(hero.name, scored[0].name,
    'the rating floor still applies inside the era: 91 beats the 79 at the top of the score order');
}

// ── The floor is a preference, never a filter ────────────────────────────────
{
  const noneClearFloor = [
    card('recent, unremarkable', 1, 70),
    card('recent, worse', 2, 60),
    card('ancient, brilliant', 20, 95),
  ];
  assert.equal(pickHero(noneClearFloor, 'new').name, 'recent, unremarkable',
    'when nothing in the era clears the floor the top of the score order wins -- the floor must not reach outside the era to find a better rating');
}

// ── Preferring an era can never empty the hero ───────────────────────────────
{
  const nothingRecent = [card('old, good', 20, 70), card('old, better', 18, 92)];
  assert.equal(pickHero(nothingRecent, 'new').name, 'old, better',
    'an era with no candidates falls back to the whole ranking rather than returning nothing');

  assert.equal(pickHero([], 'new'), null, 'an empty candidate list is null, not undefined or a throw');
  assert.equal(pickHero([], 'any'), null);
}

// ── 'any' is exactly the behaviour that existed before eras ──────────────────
{
  assert.deepEqual(pickHero(scored, 'any'), oldRule(scored),
    "Era 'any' must be byte-identical to the original rule, so turning the preference off changes nothing");
}

// ── The other two eras select too ────────────────────────────────────────────
{
  const mixed = [...scored, card('Mid Era Pick', 8, 88)];
  assert.equal(pickHero(mixed, 'neutral').name, 'Mid Era Pick');
  assert.equal(pickHero(mixed, 'old').name, 'Grand Theft Auto: San Andreas');

  assert.equal(releaseEraOf(card('inside', ERA_YEARS.new - 0.1, 90)), 'new');
  assert.equal(releaseEraOf(card('outside', ERA_YEARS.new + 0.1, 90)), 'neutral',
    'the era boundary is ERA_YEARS.new, shared with the IGDB date window so the pool and the pick agree');
}

// ── The era test reads the CARD, so the card must carry the date ─────────────
//
// This is the silent-failure guard. releaseEraOf falls back to 'neutral' when a
// game has no first_release_date, so a card without one matches no era, the
// filter comes up empty, the fallback engages, and the old bug is back with
// nothing to show for it in a stack trace.
{
  const row = {
    id: 1, name: 'Some Game', total_rating: 90,
    first_release_date: agoYears(1), cover: { image_id: 'abc' },
  };
  assert.ok(toCard(row).first_release_date,
    'toCard must carry first_release_date, or the era filter silently matches nothing');
  assert.equal(releaseEraOf(toCard(row)), releaseEraOf(row),
    'a card and the IGDB row it came from must land in the same era');

  const undated = scored.map(({ first_release_date, ...rest }) => rest);
  assert.equal(pickHero(undated, 'new').name, 'Grand Theft Auto: San Andreas',
    'demonstrating the failure the assertion above prevents: strip the dates and the reported bug returns');
}

// ── The page calls it with no era, and must still honour the preference ──────
//
// Discover's advanceHero -- the caller of the second report -- passes only the
// candidate list. The default argument reads saved prefs, so this is the exact
// call that regressed.
{
  localStorage.setItem('moctale_prefs', JSON.stringify({ tasteBias: 0, releaseEra: 'new' }));
  assert.equal(pickHero(scored).name, 'Super Mario Bros. Wonder',
    'dismissing the hero must advance within the saved era preference');

  localStorage.setItem('moctale_prefs', JSON.stringify({ tasteBias: 0, releaseEra: 'any' }));
  assert.equal(pickHero(scored).name, 'Grand Theft Auto: San Andreas');

  localStorage.removeItem('moctale_prefs');
  assert.equal(pickHero(scored).name, 'Grand Theft Auto: San Andreas',
    'no saved prefs means era any, which is DEFAULT_PREFS');
}

console.log('pick-hero: all assertions passed');
