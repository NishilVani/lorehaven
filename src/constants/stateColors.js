/**
 * The one reader of the three coloured state scales: status, priority and feel.
 *
 * These values were a `STATUS_COLORS` object literal copy-pasted into nine files.
 * Changing a status colour meant nine edits, and the copies had already drifted:
 * StepMapping, StepReview and ImportWizard were missing `Unreleased`, so an
 * unreleased game fell through to the colourless fallback in the import flow but
 * rendered violet everywhere else.
 *
 * Everything here returns a `var(--status-solid-*)` string rather than a hex, so
 * the values stay in the token layer (`src/index.css`) and the theme remains
 * switchable from one place. Every consumer feeds these into a `style={{}}`
 * background or colour, where `var()` resolves normally — including under
 * `filter: brightness(...)`, which operates on rendered pixels.
 *
 * NOT for dense list views. Those use the monochrome `--status-*` ramp, which is
 * a deliberate second treatment (see DESIGN.md, "Two status treatments").
 */

export const STATUS_COLORS = {
  Playing: 'var(--status-solid-playing)',
  Backlog: 'var(--status-solid-backlog)',
  Wishlist: 'var(--status-solid-wishlist)',
  Beaten: 'var(--status-solid-beaten)',
  Dropped: 'var(--status-solid-dropped)',
  Unreleased: 'var(--status-solid-unreleased)',
};

/** Colour for a status, falling back to the colourless token for unknown values. */
export const statusColor = (status) =>
  STATUS_COLORS[status] || 'var(--status-solid-fallback)';

/**
 * The poster-sticker badge shape. Four files carried a byte-identical
 * `getStatusBadge` returning exactly this.
 */
export const statusBadge = (status) => {
  const color = statusColor(status);
  return { dot: color, text: color, label: status };
};

/* ── Priority ────────────────────────────────────────────────────────────────
 *
 * Four hexes that had no token at all and were inlined in nine places, in three
 * different shapes: {dot,text} badges, {label,color} menu rows, and {key,color}
 * detail rows. All three are built from one list here.
 */

export const PRIORITIES = ['Next Up', 'Soon', 'Maybe', 'Someday'];

const PRIORITY_VAR = {
  'Next Up': 'var(--priority-next-up)',
  'Soon': 'var(--priority-soon)',
  'Maybe': 'var(--priority-maybe)',
  'Someday': 'var(--priority-someday)',
};

/** Unprioritised falls to a colourless grey rather than borrowing a scale value. */
export const priorityColor = (priority) =>
  PRIORITY_VAR[priority] || 'var(--priority-none)';

export const priorityBadge = (priority) => {
  const color = priorityColor(priority);
  return { dot: color, text: color, label: priority };
};

/** The DropdownMenu row shape, previously repeated verbatim in five files. */
export const PRIORITY_MENU = PRIORITIES.map(label => ({ label, color: priorityColor(label) }));

/* ── Feel (rating) ───────────────────────────────────────────────────────────
 *
 * Perfection is the one feel whose text reads lighter than its dot; the other
 * three use a single value for both. Flattening that would have quietly changed
 * how CollectionCard renders.
 */

export const FEELS = ['Perfection', 'Go for it', 'Timepass', 'Skip'];

const FEEL_VAR = {
  'Perfection': 'var(--feel-perfection)',
  'Go for it': 'var(--feel-go-for-it)',
  'Timepass': 'var(--feel-timepass)',
  'Skip': 'var(--feel-skip)',
};

const FEEL_TEXT_VAR = {
  ...FEEL_VAR,
  'Perfection': 'var(--feel-perfection-text)',
};

export const feelColor = (feel) => FEEL_VAR[feel] || 'var(--feel-none)';
export const feelTextColor = (feel) => FEEL_TEXT_VAR[feel] || 'var(--feel-none)';

export const feelBadge = (feel) => ({
  dot: feelColor(feel),
  text: feelTextColor(feel),
  label: feel,
});

export const FEEL_MENU = FEELS.map(label => ({ label, color: feelColor(label) }));

/**
 * The stored status → canonical shelf name.
 *
 * Statuses on disk are not the six shelf names. Older entries carry 'Completed',
 * 'Done', 'Interested', 'Currently playing'; the Library has always mapped them
 * on read. That map lived inside Library.jsx, so anything else reading the
 * library compared raw strings and silently disagreed — pickNext matched on
 * `g.status` directly and would have skipped every game an import had written as
 * 'Completed'. One definition, here, next to the colours that key off the same
 * six names.
 */
export const STATUS_ALIASES = {
  'playing': 'Playing', 'currently playing': 'Playing', 'current': 'Playing',
  'backlog': 'Backlog', 'wishlist': 'Wishlist', 'beaten': 'Beaten',
  'completed': 'Beaten', 'done': 'Beaten', 'dropped': 'Dropped',
  'interested': 'Unreleased', 'unreleased': 'Unreleased',
};

export const normalizeStatus = (status) =>
  STATUS_ALIASES[String(status || '').trim().toLowerCase()] || null;
