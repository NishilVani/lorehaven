/* The notification center's model: library update events (discover.js) shaped
 * into one notification per game, with read state.
 *
 * Read state is a single watermark, lh_notif_seen: opening the center marks
 * everything up to that moment read. It syncs, so reading on one device clears
 * the badge on the others. Per-notification read flags would need tombstones to
 * survive the union merge the feed takes across devices; the watermark does not.
 */
import { getStoredUpdates, mergeGameEvents, UPDATE_TAG } from './discover.js';
import { getLibrary, setSyncedLocalItem } from './db.js';

export const SEEN_KEY = 'lh_notif_seen';
export const NOTIF_EVENT = 'moctale_notif_update';

export const getSeenAt = () => {
  try { return Number(JSON.parse(localStorage.getItem(SEEN_KEY))?.at) || 0; } catch { return 0; }
};

export function markNotificationsSeen(at = Date.now()) {
  if (at <= getSeenAt()) return;
  setSyncedLocalItem(SEEN_KEY, JSON.stringify({ at }));
  window.dispatchEvent(new Event(NOTIF_EVENT));
}

/** A notification opens a page of its own unless all it says is "released":
 *  that one has nothing to itemise, so it opens the game. PURE. */
export const hasDetail = (n) => n.events.some(e => e.type !== 'released');

/** PURE. Events -> one notification per library game, newest first. */
export function toNotifications(events, library, seenAt = 0) {
  const inLibrary = new Set((library || []).map(g => String(g.id)));
  const byGame = new Map();
  for (const e of events || []) {
    if (!inLibrary.has(String(e.gameId))) continue;
    const g = byGame.get(String(e.gameId)) || { gameId: e.gameId, name: e.gameName, cover: e.cover, game_type: e.game_type, raw: [] };
    g.raw.push(e);
    if (!g.name && e.gameName) g.name = e.gameName;
    if (!g.cover && e.cover) g.cover = e.cover;
    byGame.set(String(e.gameId), g);
  }
  return [...byGame.values()].map(g => {
    const merged = mergeGameEvents(g.raw);
    const at = Math.max(...g.raw.map(e => e.at || 0));
    return {
      gameId: g.gameId,
      name: g.name,
      cover: g.cover,
      game_type: g.game_type,
      events: merged,
      primary: merged[0],
      label: UPDATE_TAG[merged[0]?.type] || 'Update',
      at,
      unread: at > seenAt,
    };
  }).sort((a, b) => b.at - a.at);
}

/** PURE. Notifications -> [{ label, items }] by how long ago, for headings. */
export function groupByDay(list, now = Date.now()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const DAY = 24 * 3600 * 1000;
  const buckets = [
    { label: 'Today', test: at => at >= today },
    { label: 'Yesterday', test: at => at >= today - DAY },
    { label: 'This Week', test: at => at >= today - 6 * DAY },
    { label: 'Earlier', test: () => true },
  ];
  const out = buckets.map(b => ({ label: b.label, items: [] }));
  for (const n of list) out[buckets.findIndex(b => b.test(n.at))].items.push(n);
  return out.filter(b => b.items.length);
}

export const getNotifications = () => toNotifications(getStoredUpdates(), getLibrary(), getSeenAt());

export const unreadCount = (list) => list.filter(n => n.unread).length;
