/** "Just now", "5m", "3h", "2d", then a date. Short, because it sits in a row
 *  beside the game's name. PURE apart from the clock default. */
export function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
