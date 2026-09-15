// Steam import -- turn a Steam library and wishlist into review rows, and the
// rows the owner ticked into library writes.
//
// Pure, with one pure import, so tests/steam-import.test.mjs runs it in node.
// The page does the fetching (profile, owned games, wishlist, IGDB matches) and
// hands the results in.
//
// Games are matched to IGDB by Steam app id through IGDB's external_games, never
// by name. Name matching is what the CSV import does, and taking the first
// search result is how a library ends up holding the wrong edition of a game.

import { normalizePlat, platKey } from './platformMatch.js';

/* The Steam store exactly as DEFAULT_CUSTOM_PLATFORMS defines it, so an
   imported game marks the same Steam the game page toggles. */
export const STEAM_STORE = { name: 'Steam', category: 'store', linkedIgdbId: 6, linkedIgdbName: 'PC (Windows)' };
export const STEAM_PLATFORM = normalizePlat(STEAM_STORE);

const nameOf = (row) => row.igdb?.name || row.steamName || '';

/**
 * → { rows, droppedWishlist }
 *
 * One row per IGDB game: two Steam apps IGDB files under one game (a base game
 * and its Game of the Year package, say) become a single row, with their
 * playtime added up. A Steam item IGDB has no match for keeps its own row,
 * unticked. A wishlisted item IGDB has no match for has no name the app could
 * show -- Steam's wishlist carries only app ids -- so it is counted instead.
 *
 * Status is never guessed for an owned game: the owner picks per game in the
 * review. A wishlisted game starts as Wishlist, which is where Steam says it is.
 * A game already in the library starts with no status, meaning keep the one it
 * has.
 */
export function buildSteamRows({ owned = [], wishlist = [], matches = new Map(), library = [] }) {
  const byId = new Map(library.map(g => [String(g.id), g]));
  const rows = new Map();

  const add = (appid, source, steam = {}) => {
    const igdb = matches.get(String(appid)) || null;
    if (!igdb && source === 'wishlist') return false;
    const key = igdb ? `igdb:${igdb.id}` : `steam:${appid}`;
    const had = rows.get(key);
    if (had) {
      if (!had.appids.includes(appid)) had.appids.push(appid);
      if (source === 'owned') {
        had.playtimeMinutes += steam.playtimeMinutes || 0;
        if (steam.lastPlayed && (!had.lastPlayed || steam.lastPlayed > had.lastPlayed)) had.lastPlayed = steam.lastPlayed;
      }
      return true;
    }
    const existing = byId.get(igdb ? String(igdb.id) : `custom_steam_${appid}`) || null;
    rows.set(key, {
      key,
      appids: [appid],
      source,
      steamName: steam.name || null,
      playtimeMinutes: steam.playtimeMinutes || 0,
      lastPlayed: steam.lastPlayed || null,
      igdb,
      existing,
      status: !existing && source === 'wishlist' ? 'Wishlist' : null,
      selected: !!igdb || !!existing,
    });
    return true;
  };

  /* Owned first, so a game that is both owned and still wishlisted reads as
     owned. */
  owned.forEach(g => add(g.appid, 'owned', g));
  let droppedWishlist = 0;
  wishlist.forEach(w => { if (!add(w.appid, 'wishlist')) droppedWishlist++; });

  const rank = (r) => (r.existing ? 1 : r.igdb ? 0 : 2);
  const sorted = [...rows.values()].sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
  return { rows: sorted, droppedWishlist };
}

/** Ticked, and either already in the library or given a status. */
export const rowReady = (row) => !!row.selected && (!!row.existing || !!row.status);

const hasSteam = (list) => (list || []).some(p => platKey(p) === platKey(STEAM_PLATFORM));

/**
 * → { entries, skipped }. `entries` go to saveManyToLibrary in one write.
 *
 * A game already in the library only gains Steam, plus a status if one was
 * picked for it; its notes, rating, dates and other platforms are left alone.
 * A Steam item IGDB does not have becomes a custom entry with an id built from
 * its app id, so importing again updates it instead of adding a second copy.
 */
export function planSteamImport(rows) {
  const entries = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.selected) continue;
    if (!rowReady(row)) { skipped++; continue; }
    if (row.existing) {
      const list = row.existing.user_platforms || [];
      const entry = { id: row.existing.id, user_platforms: hasSteam(list) ? list : [...list, STEAM_PLATFORM] };
      if (row.status && row.status !== row.existing.status) entry.status = row.status;
      entries.push(entry);
    } else if (row.igdb) {
      entries.push({
        id: row.igdb.id,
        name: row.igdb.name,
        cover_id: row.igdb.cover?.image_id || null,
        status: row.status,
        user_platforms: [STEAM_PLATFORM],
        is_custom: false,
      });
    } else {
      entries.push({
        id: `custom_steam_${row.appids[0]}`,
        name: row.steamName,
        status: row.status,
        user_platforms: [STEAM_PLATFORM],
        is_custom: true,
      });
    }
  }
  return { entries, skipped };
}

/**
 * What Undo writes: every key the import touched on a game that was already
 * in the library, back to its prior value (null where it had none, since
 * saving merges), and the ids of games the import added, to remove.
 */
export function importUndo(entries, library) {
  const byId = new Map(library.map(g => [String(g.id), g]));
  const restore = [];
  const removeIds = [];
  for (const entry of entries) {
    const prev = byId.get(String(entry.id));
    if (!prev) { removeIds.push(entry.id); continue; }
    const back = { id: prev.id };
    for (const k of Object.keys(entry)) {
      if (k !== 'id') back[k] = Object.prototype.hasOwnProperty.call(prev, k) ? prev[k] : null;
    }
    restore.push(back);
  }
  return { restore, removeIds };
}
