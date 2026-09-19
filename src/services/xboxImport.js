// Xbox import -- turn what an Xbox account has played into review rows, and the
// rows the owner ticked into library writes.
//
// Pure, with one pure import, so tests/xbox-import.test.mjs runs it in node. The
// page does the fetching -- the Worker for the played list, IGDB for the matches
// -- and hands the results in.
//
// Games are matched by Microsoft Store product id through IGDB's external_games
// (source 11, the Store, and source 54, the Xbox cloud listing), never silently
// by name. A title with no id, or an id IGDB does not know, can be matched by
// name, but such a row arrives unticked and says so: taking the first search
// result is how a library ends up holding the wrong edition.

import { normalizePlat, platKey } from './platformMatch.js';

/* The Xbox store exactly as DEFAULT_CUSTOM_PLATFORMS defines it, so an imported
   game marks the same row the game page toggles. The design called this store
   "Xbox"; the list has always called it Microsoft Store, and ownership is keyed
   on the name, so a row named "Xbox" would never show the store somebody had
   already marked by hand. */
export const XBOX_STORE = { name: 'Microsoft Store', category: 'store', linkedIgdbId: 169, linkedIgdbName: 'Xbox Series X|S' };
export const XBOX_PLATFORM = normalizePlat(XBOX_STORE);

/* The consoles titlehub's `devices` can name, as IGDB knows them. A device it
   does not list is not guessed at: the row gets the store and no console, which
   is true rather than tidy. */
export const CONSOLES = {
  'Xbox Series X|S': { id: 169, name: 'Xbox Series X|S', abbreviation: 'Series X|S' },
  'Xbox One': { id: 49, name: 'Xbox One', abbreviation: 'XONE' },
  'Xbox 360': { id: 12, name: 'Xbox 360', abbreviation: 'X360' },
  PC: { id: 6, name: 'PC (Windows)', abbreviation: 'PC' },
};

export const consolePlatform = (platform) => (CONSOLES[platform] ? normalizePlat(CONSOLES[platform]) : null);

const nameOf = (row) => row.igdb?.name || row.xboxName || '';

/**
 * → { rows }
 *
 * One row per IGDB game: two Store ids IGDB files under one game -- a base game
 * and its deluxe edition, say -- become a single row. A title IGDB has no match
 * for keeps its own row, unticked.
 *
 * `matches` is keyed by Store product id, `suggestions` by titleId: the first
 * is IGDB's own record of which game a Store id is and arrives ticked, the
 * second is a search by name and never does. Status is never guessed: the owner
 * picks per game in the review, exactly as the Steam import asks them to.
 */
export function buildXboxRows({ titles = [], matches = new Map(), suggestions = new Map(), library = [] }) {
  const byId = new Map(library.map(g => [String(g.id), g]));
  const rows = new Map();

  for (const title of titles) {
    const productIds = title.productIds || [];
    const matched = productIds.map(id => matches.get(String(id))).find(Boolean) || null;
    const suggested = matched ? null : (suggestions.get(String(title.titleId)) || null);
    const igdb = matched || suggested;

    const key = igdb ? `igdb:${igdb.id}` : `xbox:${title.titleId}`;
    const had = rows.get(key);
    if (had) {
      /* Two titles under one game: keep every product id, the newest console,
         and the later of the two times it was played. */
      had.productIds = [...new Set([...had.productIds, ...productIds])];
      if (!had.lastPlayed || (title.lastPlayed && title.lastPlayed > had.lastPlayed)) had.lastPlayed = title.lastPlayed;
      continue;
    }

    const existing = byId.get(igdb ? String(igdb.id) : `custom_xbox_${title.titleId}`) || null;
    rows.set(key, {
      key,
      titleId: title.titleId,
      productIds,
      xboxName: title.name || null,
      platform: title.platform || null,
      lastPlayed: title.lastPlayed || null,
      igdb,
      byName: !!suggested,
      existing,
      status: null,
      /* A Store id match is IGDB's own record and starts ticked. A name match
         is a guess and starts unticked, however confident it looks. */
      selected: !!matched || (!igdb && !!existing),
    });
  }

  const rank = (r) => (r.existing ? 1 : r.igdb && !r.byName ? 0 : r.byName ? 2 : 3);
  const sorted = [...rows.values()].sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
  return { rows: sorted };
}

/** Ticked, and either already in the library or given a status. */
export const rowReady = (row) => !!row.selected && (!!row.existing || !!row.status);

const has = (list, plat) => (list || []).some(p => platKey(p) === platKey(plat));

/** The store, plus the console the row is filed under when it names one. */
const platformsFor = (row) => {
  const console_ = consolePlatform(row.platform);
  return console_ ? [XBOX_PLATFORM, console_] : [XBOX_PLATFORM];
};

/**
 * → { entries, skipped }. `entries` go to saveManyToLibrary in one write.
 *
 * A game already in the library only gains the Xbox store and console, plus a
 * status if one was picked for it; its notes, rating, dates and other platforms
 * are left alone. A title IGDB does not have becomes a custom entry with an id
 * built from its title id, so importing again updates it instead of adding a
 * second copy.
 */
export function planXboxImport(rows) {
  const entries = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.selected) continue;
    if (!rowReady(row)) { skipped++; continue; }
    const plats = platformsFor(row);
    if (row.existing) {
      const list = row.existing.user_platforms || [];
      const entry = { id: row.existing.id, user_platforms: [...list, ...plats.filter(p => !has(list, p))] };
      if (row.status && row.status !== row.existing.status) entry.status = row.status;
      entries.push(entry);
    } else if (row.igdb) {
      entries.push({
        id: row.igdb.id,
        name: row.igdb.name,
        cover_id: row.igdb.cover?.image_id || null,
        status: row.status,
        user_platforms: plats,
        is_custom: false,
      });
    } else {
      entries.push({
        id: `custom_xbox_${row.titleId}`,
        name: row.xboxName,
        status: row.status,
        user_platforms: plats,
        is_custom: true,
      });
    }
  }
  return { entries, skipped };
}

/**
 * A title IGDB's Store-id record does not cover, filed by hand under the game
 * the owner found by searching. The row keeps its ids, console and status and
 * moves to that game's key, so the import writes the real game instead of a
 * custom entry -- and picks up the library entry when the game is already there.
 */
export function linkRowToIgdb(row, game, library = []) {
  const byId = new Map(library.map(g => [String(g.id), g]));
  const igdb = {
    id: game.id,
    name: game.name,
    cover: game.cover?.image_id ? { image_id: game.cover.image_id } : null,
    first_release_date: game.first_release_date ?? null,
    game_type: game.game_type ?? 0,
  };
  return {
    ...row,
    key: `igdb:${game.id}`,
    igdb,
    byName: false,
    linkedByHand: true,
    existing: byId.get(String(game.id)) || null,
    selected: true,
  };
}

/** The same row back as a custom entry, with everything else left alone. */
export function unlinkRowFromIgdb(row, library = []) {
  const byId = new Map(library.map(g => [String(g.id), g]));
  return {
    ...row,
    key: `xbox:${row.titleId}`,
    igdb: null,
    byName: false,
    linkedByHand: false,
    existing: byId.get(`custom_xbox_${row.titleId}`) || null,
  };
}
