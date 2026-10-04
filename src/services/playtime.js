/* Imported play time, kept on the library entry.
 *
 * The Steam and Xbox imports always read how long and how recently a game was
 * played -- Steam's playtime_forever and rtime_last_played, Xbox's
 * titleHistory.lastTimePlayed -- showed them in the review, and threw them away
 * when the entries were written. They are kept now, as `entry.play`:
 *
 *   play: {
 *     steam: { minutes, lastPlayed, at },   // minutes: Steam's own total
 *     xbox:  { lastPlayed, at },            // Xbox reports no minutes
 *   }
 *
 * Every time is unix ms. `at` is when the import read it, because these are
 * snapshots, not live numbers: the page says "as of your import" rather than
 * implying it watched you play. Each source is replaced whole by its own
 * import and never touches the other, so importing Steam keeps the Xbox half.
 *
 * Pure, with no imports, so the importers and the tests share it. */

/** Steam's rtime_last_played is unix SECONDS; anything at or below zero is "never". */
const fromSteamTime = (s) => (Number(s) > 0 ? Number(s) * 1000 : null);

/** Xbox's lastTimePlayed is an ISO string. A value that will not parse is dropped. */
const fromIso = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** prev.play with its Steam half replaced. `row` is a Steam import row:
    playtimeMinutes (number) and lastPlayed (unix seconds or null). */
export function withSteamPlay(prevPlay, row, now = Date.now()) {
  return {
    ...(prevPlay && typeof prevPlay === 'object' ? prevPlay : {}),
    steam: {
      minutes: Math.max(0, Math.round(Number(row.playtimeMinutes) || 0)),
      lastPlayed: fromSteamTime(row.lastPlayed),
      at: now,
    },
  };
}

/** prev.play with its Xbox half replaced, or prev unchanged when Xbox has
    nothing to say: a title it never saw played carries no date at all. */
export function withXboxPlay(prevPlay, row, now = Date.now()) {
  const lastPlayed = fromIso(row.lastPlayed);
  const base = prevPlay && typeof prevPlay === 'object' ? prevPlay : null;
  if (lastPlayed == null) return base;
  return { ...(base || {}), xbox: { lastPlayed, at: now } };
}

const SOURCE_NAME = { steam: 'Steam', xbox: 'Xbox' };

/**
 * What the game page says about it, or null when nothing was imported.
 *   minutes    Steam's total, or null when Steam never reported one
 *   lastPlayed the most recent play across sources, ms, or null
 *   lastSource 'Steam' | 'Xbox' for that play
 *   minutesAt  when Steam's import read those minutes, ms -- what a figure
 *              quoting the minutes has to date itself by
 */
export function playSummary(entry) {
  const play = entry?.play;
  if (!play || typeof play !== 'object') return null;
  const sources = Object.entries(play).filter(([k, v]) => SOURCE_NAME[k] && v && typeof v === 'object');
  if (sources.length === 0) return null;
  const minutes = play.steam && Number.isFinite(play.steam.minutes) ? play.steam.minutes : null;
  let lastPlayed = null, lastSource = null;
  for (const [k, v] of sources) {
    if (v.lastPlayed && (!lastPlayed || v.lastPlayed > lastPlayed)) { lastPlayed = v.lastPlayed; lastSource = SOURCE_NAME[k]; }
  }
  return { minutes, lastPlayed, lastSource, minutesAt: minutes != null ? Number(play.steam.at) || null : null };
}

/** "3 days ago", "last month", "in 2019". Coarse on purpose: these are imported
    snapshots, and minute precision would claim a freshness they do not have. */
export function agoPhrase(ms, now = Date.now()) {
  if (!ms) return null;
  const days = Math.floor((now - ms) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 2) return 'last month';
  if (months < 12) return `${months} months ago`;
  return `in ${new Date(ms).getFullYear()}`;
}

/** Hours to show for a minute total: whole hours from 10h, one decimal below,
    and "under an hour" rather than "0h" for a game opened once. */
export function hoursText(minutes) {
  if (minutes == null) return null;
  if (minutes < 60) return { value: minutes === 0 ? '0' : '<1', unit: 'h' };
  const h = minutes / 60;
  return { value: h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace(/\.0$/, ''), unit: 'h' };
}
