/* What the home-screen widgets and the Quick Settings tile show.
 *
 * The widgets render natively (Widgets.kt) from a small snapshot this module
 * builds from the library and hands over after every change. Three lists,
 * three rows each:
 *
 *   playing  Playing shelf, most recently played first; the line is the start
 *            of the game's note ("where you left off"), else when it was last
 *            played, else nothing.
 *   upNext   Backlog games with the Next Up priority, in library order.
 *   soon     Wishlist and Unreleased games with a release date from today on,
 *            soonest first. The countdown is worked out natively, at render
 *            time, from `release`.
 *
 * buildWidgetData is pure, so tests/native.test.mjs runs it directly. */
import { playSummary, agoPhrase } from '../playtime.js';
import { nativeCall } from './bridge.js';

const ROWS = 3;
const DAY = 86400;

const coverOf = (g) => {
  const c = g?.cover_id || g?.cover?.image_id || null;
  return typeof c === 'string' && /^[a-z0-9]{1,40}$/.test(c) ? c : null;
};

const firstLine = (text, max = 80) => {
  const line = String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
};

const row = (g, line, extra = {}) => ({
  id: Number(g.id),
  name: String(g.name || '').slice(0, 120),
  line,
  cover: coverOf(g),
  ...extra,
});

const valid = (g) => g && Number.isInteger(Number(g.id)) && Number(g.id) > 0 && g.name && !g.is_custom;

export function buildWidgetData(library, now = Date.now()) {
  const games = (Array.isArray(library) ? library : []).filter(valid);

  const playing = games
    .filter(g => g.status === 'Playing')
    .map(g => ({ g, last: playSummary(g)?.lastPlayed || 0 }))
    .sort((a, b) => b.last - a.last)
    .slice(0, ROWS)
    .map(({ g, last }) => {
      const note = firstLine(g.notes);
      const ago = last ? agoPhrase(last, now) : null;
      return row(g, note || (ago ? `Last played ${ago}` : ''));
    });

  const upNext = games
    .filter(g => g.status === 'Backlog' && g.priority === 'Next Up')
    .slice(0, ROWS)
    .map(g => row(g, firstLine(g.notes) || 'Next Up on your backlog'));

  /* Release dates are UTC calendar days: anything dated today or later. */
  const today = Math.floor(now / 1000 / DAY) * DAY;
  const soon = games
    .filter(g => (g.status === 'Wishlist' || g.status === 'Unreleased') && Number(g.first_release_date) >= today)
    .sort((a, b) => Number(a.first_release_date) - Number(b.first_release_date))
    .slice(0, ROWS)
    .map(g => row(g, '', { release: Number(g.first_release_date) }));

  return { playing, upNext, soon };
}

let lastSent = null;

/** Sends the snapshot when it changed since the last send. */
export async function syncWidgets(library, now = Date.now()) {
  const json = JSON.stringify(buildWidgetData(library, now));
  if (json === lastSent) return false;
  await nativeCall('setWidgetData', { json });
  lastSent = json;
  return true;
}
