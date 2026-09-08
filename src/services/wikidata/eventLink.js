// Where IGDB events and Wikidata award ceremonies actually meet.
//
// Deliberately dependency-free: the event pages import this, and pulling in
// awards.js would drag Firebase and the 335 kB corpus onto a page that needs
// neither.
//
// Measured against all 934 IGDB events and the 41 seeded ceremonies, EXACT
// normalised matching finds 14 links across 3 ceremonies — twelve editions of
// The Game Awards (2014-2025), Japan Game Awards 2023, and Gamescom 2022.
//
// Exact, and never fuzzy. Loosening to substring matching was measured too and
// it is actively harmful: "The Game Awards" then matches 41 events including
// "Cozy Game Awards 2026" and "The Horror Game Awards 2025", and "Gamescom"
// matches 26 showcases held *at* gamescom. That is the same false-positive class
// as the name-substring "Awards" tab that used to sit on /events, and the reason
// it was removed.
//
// Done at runtime rather than as a checked-in map so a new edition links itself:
// IGDB adding "The Game Awards 2026" needs no code change.

import CEREMONIES from './ceremonies.seed.json';

/**
 * Strip the parts that differ between an IGDB event title and a Wikidata
 * ceremony label: the year, an ordinal ("17th"), a leading "The", punctuation
 * and case. What survives is the ceremony's identity.
 */
export const normalizeCeremonyName = (s) => (s || '')
  .toLowerCase()
  .replace(/\b(19|20)\d{2}\b/g, ' ')
  .replace(/\b\d{1,2}(st|nd|rd|th)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/^\s*the\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const BY_NAME = new Map(
  CEREMONIES.map(c => [normalizeCeremonyName(c.label), c]).filter(([k]) => k),
);

/**
 * The Wikidata ceremony an IGDB event IS, or null.
 * → { qid, label } | null
 *
 * Note what this does not claim. For The Game Awards the event and the ceremony
 * are one broadcast. For Gamescom the event is the trade show and the ceremony
 * is an award given at it — related, worth linking, not the same thing. The
 * copy at the call site says "award ceremony" rather than asserting identity.
 */
export const ceremonyForEvent = (eventName) => {
  const hit = BY_NAME.get(normalizeCeremonyName(eventName));
  return hit ? { qid: hit.qid, label: hit.label } : null;
};

/* The award index — igdbId -> [wins, nominations] — for 2,299 games, ~8.6 kB
   gzipped. Loaded on demand so an event page that never reaches the award tally
   never pays for it, and cached module-side so a second event page is free. */
let indexPromise = null;
const loadIndex = () => (indexPromise ??= import('./awardsIndex.json')
  .then(m => m.default)
  .catch(() => null));

/**
 * How many of these IGDB ids have won or been nominated for something.
 * → { won, nominated } — `won` counts games with at least one win, not wins.
 */
export const awardTally = async (igdbIds) => {
  const index = await loadIndex();
  if (!index) return { won: 0, nominated: 0 };
  let won = 0, nominated = 0;
  for (const id of igdbIds) {
    const hit = index[String(id)];
    if (!hit) continue;
    if (hit[0] > 0) won++;
    /* Nominated-only, so the two figures partition the slate instead of
       double-counting a game that was nominated in one category and won
       another — which is most winners. */
    else if (hit[1] > 0) nominated++;
  }
  return { won, nominated };
};
