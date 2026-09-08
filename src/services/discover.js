// Explore-page intelligence: recommendations, library-update diffing, radar.
// Pure-ish orchestration over IGDB + localStorage — no UI here.
import { getLibrary, getSavedIgdbCollections, getSavedFranchises, getRecFeedbackList, setRecFeedback, getPrefs, setSyncedLocalItem } from './db.js';
import {
  getGamesProfile, getGamesForDiscovery, getGamesForUpdates,
  getTrendingGames, getRecentlyAnnounced, getGameHero,
  getCollectionsByIds, getFranchiseMetadataByIds,
} from './igdb.js';

/* Which artwork belongs behind a hero.
 *
 * Two things disqualify one, and transparency is only the second. IGDB's
 * artwork_type says what the image IS, and its full vocabulary, read off 1692
 * typed artworks, is:
 *
 *   1 Artwork              5 Game logo (white)     9 Alternative cover
 *   2 Key art without logo 6 Game logo (black)    10 Historical cover
 *   3 Key art with logo    7 Game logo (color)    11 Square cover
 *   4 Concept art          8 Infographic          12 Icon
 *                                                 13 Historical logo
 *
 * Only the first four are scenic and wide. The logos are a wordmark on nothing,
 * the covers are portrait or square and get cropped to a strip, the icon is
 * tiny and the infographic is a wall of text. Grand Theft Auto III is the case
 * that showed this up: its first artwork is a 1154x152 "Game logo (color)" with
 * no alpha channel at all, so filtering on transparency alone let it through
 * and the hero was the game's name on a black band, while a 1920x620 "Artwork"
 * sat fourth in the same list.
 *
 * alpha_channel is still worth avoiding for the reason it always was: the page
 * is black, so a cut-out reads as a shape floating in a void, and the .jpg the
 * image CDN serves has flattened the transparency onto a slab of colour anyway.
 *
 * So: scenic beats unknown beats logo, and within each, opaque beats
 * transparent. Nothing is excluded outright -- an image with a flaw beats no
 * image -- it is only ordered. A query that asks for neither field leaves both
 * undefined, which ranks as "unknown, opaque" for every candidate and so keeps
 * taking the first artwork exactly as before. */
const SCENIC_TYPES = new Set([1, 2, 3, 4]);

/** True when IGDB says this artwork is scenic, or has not said what it is. */
export const isScenicArtwork = (a) => {
  const type = a?.artwork_type?.id ?? a?.artwork_type;
  return type == null || SCENIC_TYPES.has(type);
};

const artworkRank = (a) => {
  const type = a.artwork_type?.id ?? a.artwork_type;
  const kind = type == null ? 1 : SCENIC_TYPES.has(type) ? 0 : 2;
  return kind * 2 + (a.alpha_channel ? 1 : 0);
};

const pickArtwork = (artworks) => {
  const usable = (artworks || []).filter(a => a.image_id);
  if (!usable.length) return null;
  return usable.reduce((best, a) => (artworkRank(a) < artworkRank(best) ? a : best)).image_id;
};

/* Map a raw IGDB game to what GameCard reads. */
export const toCard = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
  first_release_date: g.first_release_date || null,   // releaseEraOf reads this; pickHero needs it on the card
  game_type_label: g.genres?.[0]?.name || null,
  total_rating: g.total_rating || null,
  artwork_id: pickArtwork(g.artworks),
  summary: g.summary || null,
});

// ── Recommendations: taste-profile matching ──────────────────────────────────
//
// Every library game contributes to weighted taste vectors by tier:
//   1  games you rated Perfection        (weight 3)
//   2  games you Beat and didn't pan     (weight 2, excludes Skip / Timepass)
//   3  anything else you're tracking     (weight 1, excludes Dropped)
// Candidates come from attribute queries alone (top studios, franchises you
// track, theme overlap; popularity-sorted) and are scored by overlap against
// the vectors. Franchise and studio matches dominate ("more from what you
// demonstrably play"); themes carry the rest. Quality gates: rating >= 70,
// no DLC/editions, and version-family rules — owning any version of a game
// (original / remaster / remake) blocks the whole family, and among sibling
// versions only the newest is suggested.

const TIER = { PERFECTION: 1, BEATEN: 2, OTHER: 3 };
// Main game / remake / remaster only — no DLC, bundles, mods, ports. Editions
// ("Deluxe", "Ultimate") are game_type 0 on IGDB but carry version_parent.
const MAIN_TYPES = new Set([0, 8, 9]);
const isMainGame = (g) => (g.game_type == null || MAIN_TYPES.has(g.game_type)) && !g.version_parent;

// Quality floor: no suggestions under public rating 70. Unrated games pass
// only while unreleased (upcoming sequels have no rating yet); an unrated
// RELEASED game is obscurity, not anticipation.
const MIN_RATING = 70;
const passesRatingFloor = (g, nowMs = Date.now()) =>
  (g.total_rating || 0) >= MIN_RATING ||
  (!g.total_rating && (!g.first_release_date || g.first_release_date * 1000 > nowMs));

/* Release era — rolling windows measured from today, not fixed console
   generations. A Gen 8 game never stops being Gen 8, but it does stop being
   new, and "new" is what the dial is for. Games with no release date score
   neutral rather than being pushed to either end on missing data. */
export const ERA_YEARS = { new: 5, neutral: 15 };

export function releaseEraOf(g, nowMs = Date.now()) {
  const secs = g?.first_release_date;
  if (!secs) return 'neutral';
  const years = (nowMs / 1000 - secs) / (365.25 * 24 * 60 * 60);
  if (years <= ERA_YEARS.new) return 'new';
  if (years <= ERA_YEARS.neutral) return 'neutral';
  return 'old';
}

/** Bonus for matching the preferred era. A weight, not a filter: preferring new
 *  games must never mean an old library has nothing to suggest.
 *
 *  6, not the 3 it was. sim reaches 9 or more for a game in a franchise you
 *  track made by a studio you like, so 3 could not move one of those and the
 *  top of the list stayed period-mixed. Measured on a 12-game library with Era
 *  set to Recent, once the pool carried era-matching games at all: at 3, six of
 *  the top twelve were still from the 2000s; at 6, all twelve were from the last
 *  four years; at 9, identical to 6, so the extra weight buys nothing and only
 *  makes it harder for a strong match from another era to ever surface. */
export const eraBonus = (g, releaseEra, nowMs) =>
  (!releaseEra || releaseEra === 'any') ? 0 : (releaseEraOf(g, nowMs) === releaseEra ? 6 : 0);

/** The same boundaries as releaseEraOf, as unix seconds for an IGDB where
 *  clause. Null when the era is 'any' or unknown, meaning do not narrow.
 *  Kept next to releaseEraOf on purpose: two places deciding what "recent"
 *  means is how the pool and the score come to disagree. */
export const eraDateWindow = (releaseEra, nowMs = Date.now()) => {
  const YEAR = 365.25 * 24 * 60 * 60;
  const now = nowMs / 1000;
  if (releaseEra === 'new') return { releasedAfter: now - ERA_YEARS.new * YEAR };
  if (releaseEra === 'neutral') return { releasedAfter: now - ERA_YEARS.neutral * YEAR, releasedBefore: now - ERA_YEARS.new * YEAR };
  if (releaseEra === 'old') return { releasedBefore: now - ERA_YEARS.neutral * YEAR };
  return null;
};

/** The hero, from a list already sorted by score.
 *
 *  Two callers pick a top pick: the engine, and the page when you dismiss the
 *  one you were shown. Both used to scan `find(rating > 85)` over a
 *  score-sorted list, which silently overrides the sort whenever the top of the
 *  list rates below the bar -- with Era set to Recent that walked past a grid of
 *  2022-2025 games rating 79 to 85 and surfaced Grand Theft Auto: San Andreas,
 *  2004, rated 92. Fixing the engine alone left the page's copy to hand San
 *  Andreas straight back on the next dismissal, so the rule lives here once.
 *
 *  The rating floor stays -- a hero is a showcase -- but applies WITHIN the
 *  preferred era, falling back to the whole list when that era has nothing, so
 *  preferring an era can never leave the hero empty. */
export function pickHero(cards, releaseEra = getPrefs().releaseEra) {
  const era = releaseEra && releaseEra !== 'any'
    ? cards.filter(c => releaseEraOf(c) === releaseEra)
    : [];
  const pool = era.length ? era : cards;
  return pool.find(c => (c.total_rating || 0) > 85) || pool[0] || null;
}

export function tierOfLibraryGame(g) {
  if (g.feel === 'Perfection') return TIER.PERFECTION;
  if (g.status === 'Beaten' && g.feel !== 'Skip' && g.feel !== 'Timepass') return TIER.BEATEN;
  if (g.status !== 'Dropped') return TIER.OTHER;
  return null; // Dropped — not a positive signal
}

// ── Rec feedback: Interested / Not Interested on non-library games ───────────
// Storage lives in db.js (synced list domain). Re-exported so pages/components
// can import feedback from one place alongside the engine.
export { setRecFeedback };

export const getRecFeedback = () => {
  const list = getRecFeedbackList();
  return {
    interested: list.filter(x => x.verdict === 'interested').map(x => Number(x.id)),
    notInterested: list.filter(x => x.verdict === 'not_interested').map(x => Number(x.id)),
  };
};

/** Hero cards need artwork/summary the grids don't fetch. */
export async function enrichHero(card) {
  if (!card || card.artwork_id) return card;
  const full = await getGameHero(card.id).catch(() => null);
  return full ? { ...card, ...toCard(full) } : card;
}

const POOL_PAGE = 200;        // rows per IGDB discovery request
const POOL_MAX_PAGES = 3;     // 600 deep before we admit the pool is genuinely dry
const POOL_ENOUGH = 24;       // survivors needed to fill one reveal page

/* Exported so the profile's taste band ranks studios and franchises by the same
   weights the recommender scores them with. Two surfaces that both claim to know
   your taste and disagree about it are two surfaces you stop believing. */
export const TIER_WEIGHT = { 1: 3, 2: 2, 3: 1 };
const topKeys = (counts, n) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => Number(k));

/** Tier-weighted attribute counts across the library. */
export function buildTaste(profiles, byId) {
  const taste = { themes: {}, modes: {}, companies: {}, franchises: {} };
  const add = (counts, id, w) => { if (id != null) counts[id] = (counts[id] || 0) + w; };
  for (const p of profiles) {
    const lib = byId.get(String(p.id));
    const tier = lib ? tierOfLibraryGame(lib) : null;
    if (tier == null) continue;
    const w = TIER_WEIGHT[tier];
    p.themes?.forEach(x => add(taste.themes, x.id, w));
    p.game_modes?.forEach(x => add(taste.modes, x.id, w));
    p.franchises?.forEach(x => add(taste.franchises, x.id ?? x, w));
    // Developer identity is a stronger taste signal than publisher
    p.involved_companies?.forEach(c => {
      const cw = w * (c.developer ? 1 : c.publisher ? 0.6 : 0);
      if (cw > 0) add(taste.companies, c.company?.id, cw);
    });
  }
  return taste;
}

export async function getRecommendations() {
  const prefs = getPrefs();
  const library = getLibrary().filter(g => !g.is_custom && !String(g.id).startsWith('custom_'));

  if (library.length < 2) {
    const trending = (await getTrendingGames()).map(toCard);
    const hero = trending.find(c => c.artwork_id) || trending[0] || null;
    return { hero, candidates: trending.filter(c => c.id !== hero?.id), basedOn: 'trending' };
  }

  const ownedIds = new Set(library.map(g => String(g.id)));
  const fb = getRecFeedback();
  const notInterested = new Set(fb.notInterested.map(String));
  // Interested games count as weight-1 taste sources alongside the library
  const interestedIds = fb.interested.filter(id => !ownedIds.has(String(id)));

  const profiles = await getGamesProfile([...library.map(g => g.id), ...interestedIds]);
  const byId = new Map(library.map(g => [String(g.id), g]));
  interestedIds.forEach(id => byId.set(String(id), { status: 'Backlog' }));  // → OTHER tier
  const taste = buildTaste(profiles, byId);

  // Version family: a remaster/remake and its original share one key
  // (parent_game points at the original; the original is its own key).
  const familyOf = (g) => String(g.parent_game || g.id);
  const ownedFamilies = new Set(profiles
    .filter(p => ownedIds.has(String(p.id)))
    .flatMap(p => [String(p.id), familyOf(p)]));

  const topThemes = topKeys(taste.themes, 6);
  const topCompanies = topKeys(taste.companies, 10);
  const topFranchises = topKeys(taste.franchises, 12);

  // Owning any version blocks the family; among sibling versions in the pool,
  // suggest only the newest release.
  // ponytail: siblings outside the pool can't displace an older version in it —
  // full fix needs remakes/remasters expansion per candidate; add if it shows up.
  const byFamily = new Map();

  /* Page the pool instead of taking one fixed shot at 200. Everything owned or
     marked Not Interested is filtered out below, so a heavy user drained the
     single page and the whole section went empty — permanently, since the page
     is cached for six hours. Later pages only run when the earlier ones came up
     short, so the common case is still one request. */
  const take = (rows) => {
    for (const g of rows) {
      if (ownedIds.has(String(g.id)) || notInterested.has(String(g.id))) continue;
      if (!g.cover || !isMainGame(g) || !passesRatingFloor(g)) continue;
      if (ownedFamilies.has(familyOf(g))) continue;
      const cur = byFamily.get(familyOf(g));
      if (!cur || (g.first_release_date || 0) > (cur.first_release_date || 0)) byFamily.set(familyOf(g), g);
    }
  };

  /* One pass constrained to the preferred era, before the general pool.
   *
   * eraBonus re-ranks what the pool already holds, and that is all a score can
   * do: the pool is built from taste and sorted by popularity, which favours
   * games that have had years to accumulate ratings. Measured on a 12-game
   * library with Era set to Recent, the pool held 7 games from the last five
   * years against 92 old and 89 in between -- so no weight, however large, could
   * have produced a recent list, because there was nothing recent to rank. That
   * is the reported bug: the dial moved two games up a couple of places and the
   * suggestions stayed in the 2000s.
   *
   * This does not turn the weight into a filter. It is one extra request that
   * puts era-matching candidates INTO the pool; the general pages still run
   * after it, so preferring recent games can still never leave the section
   * empty, which is what the note above eraBonus protects. */
  const eraWindow = eraDateWindow(prefs.releaseEra);
  if (eraWindow) {
    take(await getGamesForDiscovery({
      themeIds: topThemes, companyIds: topCompanies, franchiseIds: topFranchises,
      limit: POOL_PAGE, offset: 0, sortBy: 'popularity', ...eraWindow,
    }));
  }

  for (let page = 0; page < POOL_MAX_PAGES; page++) {
    const rows = await getGamesForDiscovery({
      themeIds: topThemes, companyIds: topCompanies, franchiseIds: topFranchises,
      limit: POOL_PAGE, offset: page * POOL_PAGE, sortBy: 'popularity',
    });
    take(rows);
    if (rows.length < POOL_PAGE) break;          // IGDB has nothing deeper
    if (byFamily.size >= POOL_ENOUGH) break;     // enough to fill a reveal page
  }

  // Normalized attribute weight: 1.0 for your strongest signal, fading to 0
  const norm = (counts) => {
    const max = Math.max(1, ...Object.values(counts));
    return (id) => (counts[id] || 0) / max;
  };
  const tW = norm(taste.themes), mW = norm(taste.modes), cW = norm(taste.companies);
  const franchiseSet = new Set(topFranchises);

  const ranked = [...byFamily.values()]
    .map(g => {
      const themeSim = (g.themes || []).reduce((s, x) => s + tW(x.id), 0);
      const modeSim = (g.game_modes || []).reduce((s, x) => s + mW(x.id), 0);
      const studio = Math.max(0, ...(g.involved_companies || []).map(c => cW(c.company?.id)));
      const franchiseHit = (g.franchises || []).some(f => franchiseSet.has(f.id ?? f)) ? 1 : 0;
      /* tasteBias tilts the similarity terms without touching the quality term.
         At 0 the multiplier is 1 and the score is byte-identical to what this
         returned before preferences existed. At +1 similarity counts against a
         candidate, which is what "show me something unlike what I have beaten"
         has to mean. Rating still carries, so novelty never becomes a licence
         to suggest bad games. */
      const sim = themeSim * 2 + modeSim * 0.5 + studio * 4 + franchiseHit * 5;
      const score = sim * (1 - prefs.tasteBias)
        + (g.total_rating || 60) / 25
        + eraBonus(g, prefs.releaseEra);
      return { card: toCard(g), score };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = ranked.map(x => x.card);

  /* Genuinely out of matches. Fall back to trending, but through the SAME
     exclusions — an unfiltered fallback handed back the games you had just
     wishlisted. `exhausted` is distinct from `trending` so the UI does not tell
     someone with a full library to "shelve games to unlock personalized picks". */
  if (candidates.length === 0) {
    const trending = (await getTrendingGames({ limit: 48 })).map(toCard)
      .filter(c => !ownedIds.has(String(c.id)) && !notInterested.has(String(c.id)));
    const hero = await enrichHero(trending[0] || null);
    return { hero, candidates: trending.filter(c => c.id !== hero?.id), basedOn: 'exhausted' };
  }

  const hero = await enrichHero(pickHero(candidates, prefs.releaseEra));

  return { hero, candidates: candidates.filter(c => c.id !== hero.id), basedOn: 'library' };
}

// ── Shelf recommendations ────────────────────────────────────────────────────
//
// Collections / franchises where a good share of the games are already in the
// library — natural shelves to save. Membership comes from the same profile
// fetch (game.collections / game.franchises); already-saved shelves excluded.

export async function getShelfRecommendations({ limit = 6 } = {}) {
  const library = getLibrary().filter(g => !g.is_custom && !String(g.id).startsWith('custom_'));
  if (library.length < 2) return [];

  const profiles = await getGamesProfile(library.map(g => g.id));
  const colCounts = {}, frCounts = {};
  profiles.forEach(p => {
    p.collections?.forEach(id => { colCounts[id] = (colCounts[id] || 0) + 1; });
    p.franchises?.forEach(x => { const id = x.id ?? x; frCounts[id] = (frCounts[id] || 0) + 1; });
  });

  const savedCols = new Set(getSavedIgdbCollections().map(Number));
  const savedFrs = new Set(getSavedFranchises().map(f => Number(f.id)));
  const pick = (counts, saved) => Object.entries(counts)
    .filter(([id, c]) => c >= 2 && !saved.has(Number(id)))
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => Number(id));

  const [cols, frs] = await Promise.all([
    getCollectionsByIds(pick(colCounts, savedCols)),
    getFranchiseMetadataByIds(pick(frCounts, savedFrs)),
  ]);

  const shelf = (item, kind, owned) => {
    const games = (item.games || []).filter(g => g.game_type == null || MAIN_TYPES.has(g.game_type));
    return {
      kind, id: item.id, name: item.name, type: item.type,
      games, total: games.length, owned,
      ratio: games.length ? owned / games.length : 0,
    };
  };

  return [
    ...(cols || []).map(c => shelf(c, 'collection', colCounts[c.id] || 0)),
    ...(frs || []).map(f => shelf(f, 'franchise', frCounts[f.id] || 0)),
  ]
    // "Mostly owned" = 40%+ of the set, or 4+ games for huge franchises whose
    // entry lists (ports, spin-offs) make ratios meaningless.
    .filter(s => s.total >= 2 && (s.ratio >= 0.4 || s.owned >= 4))
    .sort((a, b) => b.ratio - a.ratio || b.owned - a.owned)
    .slice(0, limit);
}

// ── Library update feed ──────────────────────────────────────────────────────

const SNAP_KEY = 'lh_lib_snapshot';
const FEED_KEY = 'lh_lib_updates';
const CHECKED_KEY = 'lh_lib_updates_at';
const CLEAR_KEY = 'lh_lib_updates_clear';
const RECHECK_MS = 6 * 60 * 60 * 1000; // 6h

const readJson = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};

const snapshot = (g) => ({
  // Required to distinguish a release date that was future at snapshot time
  // from one that was already in the past when the diff runs later.
  _snap_at: Math.floor(Date.now() / 1000),
  name: g.name,
  cover: g.cover?.image_id || null,
  updated_at: g.updated_at || 0,
  release: g.first_release_date || null,
  rating: g.total_rating || null,
  videos: g.videos?.length || 0,
  screens: g.screenshots?.length || 0,
  art: g.artworks?.length || 0,
});

const YEAR_S = 365 * 24 * 3600;

/** PURE: old snapshot vs new → change events (no side effects). Self-checked.
 *  Long-released games only "change" through IGDB curation churn (re-uploaded
 *  media, metadata edits, updated_at bumps on any backend recalc) — that is
 *  noise, not news. Only unreleased or first-year games produce events, and
 *  there is deliberately NO updated_at catch-all. */
export function diffSnapshots(prev, next, nowSec = Math.floor(Date.now() / 1000)) {
  if (!prev) return []; // first sight = baseline, not news
  if (next.release && next.release < nowSec - YEAR_S) return []; // old game = curation noise
  const events = [];
  const prevSnapTime = prev._snap_at || 0;
  const wasUnreleased = !prev.release || (prevSnapTime > 0
    ? prev.release > prevSnapTime
    : prev.release > nowSec);
  const isReleased = next.release && next.release <= nowSec;

  if (wasUnreleased && isReleased) {
    events.push({ type: 'released', detail: 'Now released' });
  } else if (prev.release !== next.release) {
    if (next.release && next.release > nowSec) {
      const d = new Date(next.release * 1000).toLocaleDateString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      });
      events.push({ type: 'date', detail: `Release date moved to ${d}` });
    } else if (!next.release && prev.release && prev.release > nowSec) {
      events.push({ type: 'date', detail: 'Release date moved to TBA' });
    }
  }
  if (next.videos > prev.videos) {
    const n = next.videos - prev.videos;
    events.push({ type: 'video', detail: n === 1 ? 'New trailer' : `${n} new videos` });
  }
  if (next.screens > prev.screens) events.push({ type: 'screens', detail: 'New screenshots' });
  if (next.art > prev.art) events.push({ type: 'art', detail: 'New artwork' });
  if (next.rating != null && (prev.rating == null || Math.round(prev.rating) !== Math.round(next.rating))) {
    const detail = prev.rating == null ? 'Critic rating in' : 'Critic rating now';
    events.push({ type: 'rating', detail: `${detail} — ${Math.round(next.rating)}/100` });
  }
  return events;
}

// Reading heals legacy events: drops noisy catch-alls and migrates prior
// release IDs so timestamp corrections cannot leave duplicate cards.
const readFeed = () => {
  /* Everything at or before the last Clear All is gone, wherever it came from.
     The feed is unioned across devices on purpose — two machines each notice
     different updates and the findings pool — but that also means a phone
     opened once a week re-uploads the events you cleared on your desktop, and
     they land back on the desktop as "new". The watermark is what a union
     cannot express on its own: not "these ids are gone", but "I have seen
     everything up to this moment". */
  const clearedAt = readJson(CLEAR_KEY, null)?.at || 0;
  return readJson(FEED_KEY, [])
    .filter(e => e.type !== 'updated')
    .filter(e => (e.at || 0) > clearedAt)
    .map(e => e.type === 'released' ? { ...e, id: `${e.gameId}-released` } : e);
};

const VERSION_KEY = 'lh_lib_updates_v';
const FEED_VERSION = '4';           // force snapshot timestamp migration
const RETRO_S = 90 * 24 * 3600;     // releases this recent are news even without a prior snapshot

const updateEventId = (gameId, event, snap) => {
  if (event.type === 'released') return `${gameId}-released`;
  if (event.type === 'date') return `${gameId}-date-${snap.release || 'tba'}`;
  if (event.type === 'video') return `${gameId}-video-${snap.videos}`;
  if (event.type === 'screens') return `${gameId}-screens-${snap.screens}`;
  if (event.type === 'art') return `${gameId}-art-${snap.art}`;
  if (event.type === 'rating') return `${gameId}-rating-${Math.round(snap.rating)}`;
  return `${gameId}-${event.type}-${snap.updated_at || Date.now()}`;
};

export async function refreshLibraryUpdates({ force = false } = {}) {
  const library = getLibrary().filter(g => !g.is_custom && !String(g.id).startsWith('custom_'));
  const feed = readFeed();
  const lastChecked = Number(localStorage.getItem(CHECKED_KEY) || 0);
  const versionStale = localStorage.getItem(VERSION_KEY) !== FEED_VERSION;
  const prevSnaps = readJson(SNAP_KEY, {});
  const hasUnsnapshotted = library.some(g => !prevSnaps[String(g.id)]);

  if (library.length === 0) return { events: feed, baseline: false };
  if (!force && !versionStale && !hasUnsnapshotted && Date.now() - lastChecked < RECHECK_MS) return { events: feed, baseline: false };

  const fetched = await getGamesForUpdates(library.map(g => g.id));
  if (fetched.length === 0) return { events: feed, baseline: false };

  const isFirstRun = Object.keys(prevSnaps).length === 0;
  // Keep prior snapshots when a chunk/API response is partial. Missing data is
  // not evidence that a library game was removed.
  const nextSnaps = { ...prevSnaps };
  const newEvents = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const g of fetched) {
    const snap = snapshot(g);
    nextSnaps[g.id] = snap;
    const storedSnap = prevSnaps[String(g.id)];
    // Pre-v4 snapshots lack `_snap_at`; CHECKED_KEY is when their batch was
    // saved, so it is a reliable migration timestamp for release detection.
    const previousSnap = storedSnap && !storedSnap._snap_at && lastChecked > 0
      ? { ...storedSnap, _snap_at: Math.floor(lastChecked / 1000) }
      : storedSnap;
    const events = diffSnapshots(previousSnap, snap, nowSec);
    // A recent release is news no matter when the game entered the library —
    // snapshot diffing can't see changes that predate the first snapshot.
    if (snap.release && snap.release <= nowSec && snap.release > nowSec - RETRO_S
        && !events.some(e => e.type === 'released')) {
      events.push({ type: 'released', detail: 'Now released' });
    }
      for (const ev of events) {
        newEvents.push({
          id: updateEventId(g.id, ev, snap),
          gameId: g.id, gameName: snap.name, cover: snap.cover,
          type: ev.type, detail: ev.detail, at: Date.now(),
          game_type: g.game_type,
        });
      }
  }

  const seen = new Set();
  const merged = [...newEvents, ...feed].filter(e => !seen.has(e.id) && seen.add(e.id)).slice(0, 200);

  // localStorage has no transactions. Persist feed first, then advance cache
  // markers only after all state writes succeed; a quota error then retries
  // safely instead of locking the UI into an empty/stale feed.
  try {
    /* The feed and the snapshot go through the syncing setter so they reach the
       cloud and the next device; a plain localStorage.setItem is what kept this
       whole feature on one machine. The other two stay local on purpose:
       CHECKED_KEY is this device's own refresh timer and VERSION_KEY is a client
       schema marker — see the DOMAINS comment in db.js. */
    setSyncedLocalItem(FEED_KEY, JSON.stringify(merged));
    setSyncedLocalItem(SNAP_KEY, JSON.stringify(nextSnaps));
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
    localStorage.setItem(VERSION_KEY, FEED_VERSION);
  } catch (e) {
    console.error('[discover] localStorage write failed — updates feed not persisted', e);
  }

  return { events: merged, baseline: isFirstRun };
}

export function clearLibraryUpdates() {
  /* Through the syncing setter, not localStorage.removeItem. A raw removal left
     the cloud copy intact AND skipped the `_mt` stamp, so applyDomainDoc read
     the cloud doc as newer than local and put every cleared event straight back
     on the next snapshot — the button undid itself without a second device
     being involved.

     The watermark is written first: if the feed write fails, an over-eager
     watermark hides events, which the next refresh replaces. The other order
     empties the list while leaving the watermark behind to un-hide them. */
  setSyncedLocalItem(CLEAR_KEY, JSON.stringify({ at: Date.now() }));
  setSyncedLocalItem(FEED_KEY, '[]');
  // Device-local refresh timer — dropping it makes the next visit re-check now.
  localStorage.removeItem(CHECKED_KEY);
}

/** Read the persisted update feed without re-fetching (for the See-All page). */
export function getStoredUpdates() {
  return readFeed();
}

/** Merge events of the same type for one game into aggregated summaries. */
export function mergeGameEvents(events) {
  if (!events || events.length === 0) return [];

  const byType = new Map();
  for (const ev of events) {
    const list = byType.get(ev.type) || [];
    list.push(ev);
    byType.set(ev.type, list);
  }

  const result = [];
  for (const [type, group] of byType.entries()) {
    const baseEv = group[0];
    if (type === 'video') {
      let totalVideos = 0;
      for (const ev of group) {
        const match = ev.detail?.match(/^(\d+)\s+new/i);
        totalVideos += match ? parseInt(match[1], 10) : 1;
      }
      result.push({
        ...baseEv,
        detail: totalVideos > 1 ? `${totalVideos} new trailers` : (baseEv.detail || 'New trailer'),
      });
    } else if (type === 'screens') {
      result.push({
        ...baseEv,
        detail: 'New screenshots',
      });
    } else if (type === 'art') {
      result.push({
        ...baseEv,
        detail: 'New artwork',
      });
    } else if (type === 'released') {
      result.push({
        ...baseEv,
        detail: 'Now released',
      });
    } else {
      // date, rating, or other: pick newest event in group
      const newest = group.reduce((latest, ev) => ((ev.at || 0) > (latest.at || 0) ? ev : latest), baseEv);
      result.push(newest);
    }
  }

  return result.sort((a, b) => (UPDATE_RANK[b.type] ?? 0) - (UPDATE_RANK[a.type] ?? 0));
}

const UPDATE_RANK = { released: 6, date: 5, video: 4, screens: 3, art: 2, rating: 1 };

/** Sticker labels for update cards — single source for Discover + See-All. */
export const UPDATE_TAG = {
  released: 'Out Now', date: 'Date Moved', video: 'New Trailer',
  screens: 'New Screens', art: 'New Art', rating: 'Critic Rating',
};

/** Group events into one card per game, carrying its most significant label. */
export function updatesToCards(events, library = getLibrary()) {
  const libMap = {};
  library.forEach(g => { libMap[String(g.id)] = g; });

  const byGame = new Map();
  for (const e of events) {
    if (!libMap[String(e.gameId)]) continue;
    const g = byGame.get(e.gameId) || { gameId: e.gameId, name: e.gameName, cover: e.cover, game_type: e.game_type, events: [] };
    g.events.push(e);
    byGame.set(e.gameId, g);
  }
  return [...byGame.values()].map(g => {
    const mergedEvents = mergeGameEvents(g.events);
    const primary = mergedEvents[0];
    const libGame = libMap[String(g.gameId)];
    const gameTypeVal = g.game_type ?? libGame?.game_type ?? 0;
    return {
      card: { id: g.gameId, name: g.name, cover_id: g.cover, release_year: null, game_type_label: null, game_type: gameTypeVal },
      primary,                 // { type, detail }
      extra: mergedEvents.length - 1,
      events: mergedEvents,
    };
  });
}

// ── Radar: recently announced ────────────────────────────────────────────────

export async function getAnnounced({ limit = 40, offset = 0 } = {}) {
  const rows = await getRecentlyAnnounced({ limit, offset }).catch(() => []);
  return rows.map(toCard);
}

export async function getTrending({ limit = 24, offset = 0 } = {}) {
  const rows = await getTrendingGames({ limit, offset }).catch(() => []);
  return rows.map(toCard);
}

/* Self-check for the pure diff logic — run `__discoverSelfCheck()` in the console. */
export function __discoverSelfCheck() {
  const nowSec = 1_000_000;
  const base = { videos: 1, screens: 2, art: 0, release: null, rating: null, updated_at: 100 };
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

  eq(diffSnapshots(null, base, nowSec).length, 0, 'first sight = no events');
  eq(diffSnapshots(base, base, nowSec).length, 0, 'no change = no events');
  eq(diffSnapshots({ ...base, release: nowSec + 100 }, { ...base, release: nowSec - 100 }, nowSec)[0]?.type, 'released', 'released');
  eq(diffSnapshots(
    { ...base, release: nowSec - 100, _snap_at: nowSec - 200 },
    { ...base, release: nowSec - 100 },
    nowSec,
  )[0]?.type, 'released', 'released after prior future snapshot');
  eq(diffSnapshots({ ...base, release: nowSec + 100 }, { ...base, release: nowSec + 500 }, nowSec)[0]?.type, 'date', 'date moved');
  eq(diffSnapshots({ ...base, release: nowSec + 100 }, { ...base, release: null }, nowSec)[0]?.detail, 'Release date moved to TBA', 'date moved to TBA');
  eq(diffSnapshots(base, { ...base, videos: 3 }, nowSec)[0]?.detail, '2 new videos', 'video count');
  eq(diffSnapshots(base, { ...base, videos: 2 }, nowSec)[0]?.detail, 'New trailer', 'single video');
  eq(diffSnapshots(base, { ...base, rating: 88 }, nowSec)[0]?.type, 'rating', 'rating appears');
  eq(diffSnapshots({ ...base, rating: 80 }, { ...base, rating: 83 }, nowSec)[0]?.detail, 'Critic rating now — 83/100', 'rating changes');
  // no updated_at catch-all — backend churn is not news
  eq(diffSnapshots(base, { ...base, updated_at: 200 }, nowSec).length, 0, 'updated_at alone = no event');
  // old released games are fully gated (curation churn)
  const old = { ...base, release: nowSec - 2 * 365 * 24 * 3600 };
  eq(diffSnapshots(old, { ...old, videos: 5, screens: 9, updated_at: 999 }, nowSec).length, 0, 'old game media churn = no events');
  // date "corrections" on already-released games don't fire
  const recent = { ...base, release: nowSec - 100 };
  eq(diffSnapshots(recent, { ...recent, release: nowSec - 200 }, nowSec).some(e => e.type === 'date'), false, 'past date correction = no event');

  const c = updatesToCards([
    { gameId: 5, gameName: 'X', cover: 'c', type: 'art', detail: 'New artwork' },
    { gameId: 5, gameName: 'X', cover: 'c', type: 'released', detail: 'Now released' },
  ], [{ id: 5 }]);
  eq(c.length, 1, 'one card per game');
  eq(c[0].primary.type, 'released', 'primary = most significant');
  eq(c[0].extra, 1, 'extra count');
  eq(updatesToCards(c[0].events, []).length, 0, 'deleted library game hidden');

  const mergedCards = updatesToCards([
    { gameId: 6, gameName: 'Y', cover: 'c', type: 'video', detail: 'New trailer' },
    { gameId: 6, gameName: 'Y', cover: 'c', type: 'video', detail: 'New trailer' },
  ], [{ id: 6 }]);
  eq(mergedCards[0].primary.detail, '2 new trailers', 'merge video events');
  eq(mergedCards[0].extra, 0, 'merged down to 0 extra');

  return 'discover self-check ok';
}
