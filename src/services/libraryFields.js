// Boundary helpers for the fields on a library entry: the shape a completion
// date is allowed to take, and the unsaved note draft that outlives a page.
//
// Its own module, with no imports, for two reasons. Neither has anything to do
// with Firebase or sync, and db.js — their natural home — stands up a Firestore
// client at import time, so anything living there cannot be unit-tested without
// stubbing the whole module and testing the stub instead of the code.

/* ── Unsaved note drafts ──────────────────────────────────────────────────────
 *
 * The review field holds up to 1000 characters of a user's own writing and it
 * had no protection at all: `grep beforeunload src/` and `grep useBlocker src/`
 * both returned nothing. Clicking Back threw it away without a word.
 *
 * A draft rather than a navigation guard, for a reason that is not preference:
 * `useBlocker` requires a data router, and the app mounts `<BrowserRouter>`, so
 * calling it throws. Beyond that, a blocker only guards the exits it is wired
 * to — and this text is also lost to a closed tab, a crashed process, and the
 * remount `App.jsx` performs on every route except `/import` when a sync lands.
 * A draft survives all four, and interrupts nobody.
 *
 * One key per game so two half-written reviews cannot overwrite each other, and
 * capped at the field's own 1000-character limit so this can never become the
 * write that fills the origin's storage budget.
 */
const DRAFT_PREFIX = 'lh_note_draft_';
const DRAFT_MAX = 1000;

/** The unsaved draft for a game, or null. Never throws. */
export const readNoteDraft = (gameId) => {
  try { return localStorage.getItem(DRAFT_PREFIX + gameId); }
  catch { return null; }
};

/** Persist a draft. Never throws — losing a draft must not break the editor. */
export const writeNoteDraft = (gameId, text) => {
  try { localStorage.setItem(DRAFT_PREFIX + gameId, String(text ?? '').slice(0, DRAFT_MAX)); }
  catch { /* quota; the draft is a safety net, not the record */ }
};

/** Drop a draft once it is saved or reverted. Never throws. */
export const clearNoteDraft = (gameId) => {
  try { localStorage.removeItem(DRAFT_PREFIX + gameId); }
  catch { /* nothing to do */ }
};

/** Already `yyyy-MM-dd`. Matched, not parsed — see below. */
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A completion date as `yyyy-MM-dd`, the only shape `<input type="date">` reads.
 * Returns null for anything unparseable, and never invents a date.
 *
 * Every reader of `dateCompleted` parsed it leniently with `new Date()` — the
 * library sort, the cards, the profile charts — so a full ISO timestamp
 * displayed correctly everywhere EXCEPT the one field you edit it in. The date
 * input silently blanks a value it cannot read, the blank field then reports ''
 * on change, and that was persisted as null. Editing the field to "fix" the
 * blank is what destroyed the date.
 *
 * An already-correct value is returned untouched rather than re-parsed, which
 * matters more than it looks: `new Date('2024-01-10')` is UTC midnight by spec,
 * so re-parsing a plain date and reading local parts moves it to the 9th for
 * anyone west of UTC. That is the same timezone trap that once made the CSV
 * export write 2019-12-31 for a 1 January completion.
 *
 * Everything else is read in LOCAL parts, because that is how it was written:
 * `new Date(2024, 0, 10).toISOString()` is "2024-01-09T18:30:00.000Z" in IST,
 * and only the local reading recovers the 10th the user actually picked.
 */
export const toDateInputValue = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  if (PLAIN_DATE.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
