// The library, out.
//
// The counterpart to the import wizard, and deliberately its mirror: the columns
// below are the ones StepMapping knows how to read back, so a file this writes
// re-imports without a mapping step. That is the whole point of an export — a
// copy you can leave somewhere, and a copy you can put back.
//
// Only fields YOU set are written. IGDB metadata (cover ids, ratings, involved
// companies) is cached from a service that will hand it over again for free, and
// putting a few hundred kilobytes of it in a file that is meant to be openable in
// a spreadsheet trades the one property that makes the file useful.
import { getLibrary } from './db';
import { normalizeStatus } from '../constants/stateColors';

/**
 * YYYY-MM-DD in the reader's own timezone, assembled from local parts.
 *
 * `toISOString().slice(0,10)` is the obvious way to write this and it is wrong
 * everywhere east or west of UTC: a game finished on 1 January is stored as
 * local midnight, which is 31 December in UTC, and the export would disagree
 * with the date the app has been showing you all along. Measured in IST: every
 * date came out one day early.
 */
const dateOf = (v) => {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const platformsOf = (g, category) => (g.user_platforms || [])
  .filter(p => (p?.category || 'hardware') === category)
  .map(p => p?.name || String(p))
  .filter(Boolean)
  .join('; ');

export function libraryRows(library = getLibrary()) {
  return (Array.isArray(library) ? library : []).map(g => ({
    Name: g.name || '',
    'IGDB ID': g.id ?? '',
    /* The normalised shelf, not the raw string. An entry an old import wrote as
       'Completed' reads as Beaten everywhere in the app, and an export that
       disagreed with the screen it was taken from would be worse than useless.
       The raw value rides along so nothing is actually lost. */
    Status: normalizeStatus(g.status) || '',
    'Status (as stored)': g.status || '',
    Verdict: g.feel || '',
    Priority: g.priority || '',
    Completed: dateOf(g.dateCompleted),
    Hardware: platformsOf(g, 'hardware'),
    Store: platformsOf(g, 'store'),
    Subscription: platformsOf(g, 'subscription'),
    Notes: g.notes || '',
  }));
}

/**
 * Writes the library to a CSV the browser saves. Returns what happened rather
 * than toasting itself, so the caller owns the wording.
 *
 * Papa is imported on the click rather than at the top of the file. It is
 * already in the bundle for the import wizard, but a static import here put its
 * chunk on the critical path of the profile route — paid on every visit, for a
 * button pressed once in a while.
 *
 * @returns {Promise<{rows: number, saved: boolean}>}
 */
export async function exportLibraryCsv(library = getLibrary()) {
  const rows = libraryRows(library);
  if (rows.length === 0) return { rows: 0, saved: false };

  const { default: Papa } = await import('papaparse');

  /* A leading BOM. Excel reads a CSV without one as the system codepage and
     renders every non-ASCII title as mojibake — and this library has Pokémon in
     it. Papa will not add one for us. */
  const blob = new Blob(['﻿', Papa.unparse(rows)], { type: 'text/csv;charset=utf-8' });
  const name = `moctale-library-${new Date().toISOString().slice(0, 10)}.csv`;

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { rows: rows.length, saved: true };
  } catch (err) {
    // ponytail: browser download only. The Android webview may refuse a blob
    // download; wire the Tauri fs plugin the way Wallpapers.jsx does if it does.
    console.error('[export] could not save the CSV:', err);
    return { rows: rows.length, saved: false };
  }
}
