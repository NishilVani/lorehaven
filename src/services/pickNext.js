// Pick Next — "which of my own games should I start?"
//
// Deliberately NOT part of getRecommendations(). That engine scores games you do
// NOT own: it excludes ownedIds and pulls a fresh candidate pool from IGDB over
// the network. This one scores games you DO own, from data already hydrated on
// the page. Same taste model, opposite candidate set, no request.
//
// Both read the same two dials, so Explore and Pick Next cannot disagree about
// what you like.

import { getLibrary, getPrefs } from './db';
import { getGamesProfile } from './igdb';
import { buildTaste, eraBonus } from './discover';
import { normalizeStatus } from '../constants/stateColors';

/* What can be suggested. Playing is out because you already started it — the
   question is what to start NEXT. Beaten is finished and Unreleased cannot be
   played at all. Wishlist and Dropped stay: one is something you meant to buy,
   the other something worth a second look, and both are real answers to "what
   now?".

   Matched on the NORMALISED status, not the raw string. Statuses on disk are not
   the six shelf names — imports and older entries write 'Completed', 'Done',
   'Interested' — so comparing `g.status` directly quietly skipped whole shelves.
   That map used to live inside Library.jsx; it is shared now. */
const SUGGESTABLE = new Set(['Backlog', 'Wishlist', 'Dropped']);

/* A shelf of 60 games contains dozens the scorer rates within a hair of each
   other, and always returning the single argmax would make Reroll feel broken.
   Picking at random from the top slice keeps the answer defensible and the
   button honest. */
const SHORTLIST = 8;

/** Why this game, in the user's words. Ordered by how much each term actually
 *  moved the score, so the first reason given is the real one.
 *
 *  Exported so the game page can say the same things in the same words. Two
 *  surfaces that both claim to know your taste and phrase it differently are
 *  two surfaces you stop believing. */
export function reasonsFor(parts, prefs) {
  const out = [];
  if (parts.franchiseHit) out.push('From a series you follow');
  if (parts.studio > 0.5) out.push('By a studio you keep coming back to');
  if (parts.themeSim > 1) out.push('Matches the themes you play most');
  if (parts.eraHit) {
    out.push(prefs.releaseEra === 'new' ? 'A recent release'
      : prefs.releaseEra === 'old' ? 'From further back' : 'From the era you asked for');
  }
  if (prefs.tasteBias > 0.3 && parts.sim < 1) out.push('Unlike what you have been finishing');
  if (parts.rating >= 85) out.push('Very well reviewed');
  return out.slice(0, 3);
}

/** The suggestable shelf, read synchronously.
 *
 *  pickNextGame has to go to the network for profiles before it can score
 *  anything, and for that whole wait the dialog had nothing true to show — so it
 *  showed a skeleton, which is the same thing every loading state in every app
 *  shows and says nothing about what is being done. The library itself is on
 *  disk and needs no request, so the games actually under consideration are
 *  available immediately, covers included. The dialog reads them straight off
 *  the shelf and riffles them.
 *
 *  Name and cover only, and only entries that carry a name locally: this is
 *  display copy for a state that lasts a few hundred milliseconds, not the pool.
 *  pickNextGame still does its own filtering, including rescuing a name from the
 *  profile, and its poolSize stays the number the answer quotes.
 */
export function suggestablePicks() {
  return getLibrary()
    .filter(g => SUGGESTABLE.has(normalizeStatus(g.status)))
    .map(g => ({ name: (g.name || '').trim(), cover_id: g.cover_id || null }))
    .filter(p => p.name);
}

/**
 * → { game, reasons, poolSize } or { game: null, poolSize, reason: 'empty' }.
 *
 * `exclude` carries the ids already shown, so Reroll walks the shortlist instead
 * of handing back the same game with a new animation.
 */
export async function pickNextGame({ exclude = [], prefs = getPrefs() } = {}) {
  const library = getLibrary();
  const suggestable = library.filter(g => SUGGESTABLE.has(normalizeStatus(g.status)));
  if (suggestable.length === 0) return { game: null, poolSize: 0, shortlist: [], reason: 'empty' };

  /* Custom games have no IGDB profile, so they carry no themes or studios to
     match on. They stay in the pool — a hand-added game is still something you
     could play — but they can only ever score on rating and era. */
  const profileIds = library.filter(g => !g.is_custom && !String(g.id).startsWith('custom_')).map(g => g.id);
  const profiles = profileIds.length ? await getGamesProfile(profileIds).catch(() => []) : [];
  const byId = new Map(library.map(g => [String(g.id), g]));
  const profileById = new Map(profiles.map(p => [String(p.id), p]));

  /* The name comes from the entry OR the profile. Library entries are not
     guaranteed to carry one — the Library page hydrates names from IGDB at
     render time and never writes them back, so an entry added by a path that
     stored only id and status has no name on disk. This dialog read the entry
     alone and rendered a card with a status, two reasons and a blank title.
     The profile fetched for scoring already has the name; use it. */
  const named = suggestable
    .map(entry => {
      const p = profileById.get(String(entry.id));
      return {
        entry,
        name: entry.name || p?.name || '',
        /* Same story as the name, one step worse: the profile did not even ASK
           for a cover until now, so a game whose entry stored `cover_id: null`
           had no second source and rendered the empty plate forever. */
        cover_id: entry.cover_id || p?.cover?.image_id || null,
      };
    })
    .filter(x => x.name);
  if (named.length === 0) return { game: null, poolSize: 0, shortlist: [], reason: 'empty' };

  /* Diagnostics. Silent when everything resolves; `console.debug` is hidden
     behind Chrome's Verbose level so the healthy path costs nothing to read.
     Counts are per draw, so a repeated pattern is visible immediately. */
  const missingCover = named.filter(x => !x.cover_id);
  const rescuedName = named.filter(x => !x.entry.name && x.name);
  const rescuedCover = named.filter(x => !x.entry.cover_id && x.cover_id);
  console.debug('[picknext] pool', {
    suggestable: suggestable.length,
    usable: named.length,
    droppedForNoName: suggestable.length - named.length,
    profilesFetched: profiles.length,
    profilesRequested: profileIds.length,
    nameFromProfile: rescuedName.length,
    coverFromProfile: rescuedCover.length,
    stillNoCover: missingCover.length,
  });
  if (missingCover.length) {
    console.warn('[picknext] no cover from entry OR profile — these render the empty plate:',
      missingCover.slice(0, 10).map(x => ({
        id: x.entry.id,
        name: x.name,
        custom: !!x.entry.is_custom || String(x.entry.id).startsWith('custom_'),
        hadProfile: profileById.has(String(x.entry.id)),
      })));
  }

  /* Everything has been offered, so start the round again rather than dead-end.
     Only the game on screen is held back, so Pick Another never repeats itself
     back-to-back and never stops working either. */
  const excluded = new Set(exclude.map(String));
  let fresh = named.filter(x => !excluded.has(String(x.entry.id)));
  if (fresh.length === 0) {
    const last = String(exclude[exclude.length - 1]);
    fresh = named.filter(x => String(x.entry.id) !== last);
    if (fresh.length === 0) fresh = named;
  }
  const pool = fresh.map(x => ({ ...x.entry, name: x.name, cover_id: x.cover_id }));

  const taste = buildTaste(profiles, byId);
  const norm = (counts) => {
    const max = Math.max(1, ...Object.values(counts));
    return (id) => (counts[id] || 0) / max;
  };
  const tW = norm(taste.themes), mW = norm(taste.modes), cW = norm(taste.companies);
  const topFranchises = new Set(Object.entries(taste.franchises)
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => Number(k)));

  const scored = pool.map(entry => {
    const p = profileById.get(String(entry.id)) || {};
    const themeSim = (p.themes || []).reduce((s, x) => s + tW(x.id), 0);
    const modeSim = (p.game_modes || []).reduce((s, x) => s + mW(x.id), 0);
    const studio = Math.max(0, ...(p.involved_companies || []).map(c => cW(c.company?.id)), 0);
    const franchiseHit = (p.franchises || []).some(f => topFranchises.has(f.id ?? f)) ? 1 : 0;
    const rating = p.total_rating || entry.total_rating || 60;

    /* Same shape as the Explore scorer, including the tasteBias inversion, so
       the two surfaces rank on the same basis. */
    const sim = themeSim * 2 + modeSim * 0.5 + studio * 4 + franchiseHit * 5;
    const era = eraBonus({ first_release_date: p.first_release_date ?? entry.first_release_date }, prefs.releaseEra);

    /* The one term Explore has no use for: a game you have already told the app
       you mean to play soon should beat one you shrugged at. This is the whole
       reason priority exists. */
    const priorityBoost = { 'Next Up': 4, 'Soon': 2.5, 'Maybe': 1, 'Someday': 0 }[entry.priority] ?? 0;

    const score = sim * (1 - prefs.tasteBias) + rating / 25 + era + priorityBoost;
    return { entry, score, parts: { themeSim, studio, franchiseHit, sim, rating, eraHit: era > 0 } };
  }).sort((a, b) => b.score - a.score);

  const slice = scored.slice(0, Math.min(SHORTLIST, scored.length));
  const chosen = slice[Math.floor(Math.random() * slice.length)];

  return {
    game: chosen.entry,
    reasons: reasonsFor(chosen.parts, prefs),
    poolSize: named.length,
    /* The whole shortlist, ranked, not just the one that won it.
     *
     * This function has always sorted every candidate, kept the top eight and
     * thrown seven of them away. That was the most interesting thing it knew:
     * the field it narrowed through. Returning it lets the dialog decelerate
     * past games that were REALLY in contention instead of past arbitrary
     * shelf covers — which is the difference between an honest near-miss and a
     * manufactured one, the mechanic slot research ties to erroneous cognitions
     * and chasing. If we cannot show the real runners-up we show none.
     *
     * Each carries its own reasons because reasonsFor is a pure read of parts
     * already computed, so a viewer can swap the answer to a runner-up without
     * a second request or a second score. */
    shortlist: slice.map((s, idx) => ({
      game: s.entry,
      reasons: reasonsFor(s.parts, prefs),
      rank: idx + 1,
      picked: s === chosen,
    })),
  };
}
