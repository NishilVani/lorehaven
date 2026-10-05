/* Library-update notifications: one evening digest of what changed for games
 * in the library -- a release date set or moved, a game out, a new trailer, a
 * rating settled. The changes are the ones Explore's "In Your Library" already
 * finds (discover.js refreshLibraryUpdates, diffSnapshots); this only says so
 * outside the app.
 *
 * How: a web bundle cannot run while the app is closed, so the news is
 * gathered while it is open (on launch, and each time it comes back to the
 * foreground) and the digest is scheduled for the next 18:00 local with the
 * notification plugin's own alarm, which fires with the app closed and
 * survives a reboot. Each sync replaces the scheduled digest with an up to
 * date one, or cancels it when there is nothing new. A phone that never opens
 * the app gets no news, which is the honest limit of doing it without a
 * server.
 *
 * planDigest and nextDigestAt are pure: tests/native.test.mjs runs them. */
export const DIGEST_ID = 2147480001;   // above any IGDB game id the reminders use
export const DIGEST_HOUR = 18;
const STATE_KEY = 'lorehaven_digest';
const CHANNEL = 'library-updates';

/** The next 18:00 local, at least a minute away. */
export function nextDigestAt(now = Date.now()) {
  const at = new Date(now);
  at.setHours(DIGEST_HOUR, 0, 0, 0);
  if (at.getTime() <= now + 60_000) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** What the digest says about events newer than seenAt, or null. */
export function planDigest(events, seenAt = 0) {
  const fresh = (Array.isArray(events) ? events : [])
    .filter(e => e && Number(e.at) > seenAt && e.gameName && e.detail)
    .sort((a, b) => Number(b.at) - Number(a.at));
  if (fresh.length === 0) return null;

  /* One line per game, its newest change; a game with three changes is one
     piece of news. */
  const byGame = new Map();
  for (const e of fresh) if (!byGame.has(e.gameId)) byGame.set(e.gameId, e);
  const lines = [...byGame.values()].map(e => `${e.gameName}: ${e.detail}`);
  const games = lines.length;
  if (games === 1) return { title: lines[0], body: 'Tap to see it in LoreHaven.', newestAt: Number(fresh[0].at), games };
  const shown = lines.slice(0, 3);
  const more = games - shown.length;
  return {
    title: `${games} games in your library changed`,
    body: `${shown.join('. ')}.${more > 0 ? ` And ${more} more.` : ''}`,
    newestAt: Number(fresh[0].at),
    games,
  };
}

const readState = () => {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; } catch { return {}; }
};
const writeState = (s) => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* not kept */ } };

/** Gathers news and (re)schedules the evening digest. Never throws. */
export async function syncLibraryDigest(enabled, now = Date.now()) {
  try {
    const n = await import('@tauri-apps/plugin-notification');
    const state = readState();
    /* A digest scheduled for a time now past was delivered: its news is old. */
    let seenAt = Number(state.seenAt) || 0;
    if (state.at && Number(state.at) <= now && Number(state.newestAt) > seenAt) seenAt = Number(state.newestAt);

    await n.cancel([DIGEST_ID]).catch(() => {});
    if (!enabled) { writeState({ seenAt }); return null; }

    const { refreshLibraryUpdates } = await import('../discover.js');
    const { events } = await refreshLibraryUpdates();
    /* First run on this phone: what is already in the feed is old news. */
    if (!seenAt) {
      seenAt = Math.max(now, ...(events || []).map(e => Number(e.at) || 0));
      writeState({ seenAt });
      return null;
    }
    const plan = planDigest(events, seenAt);
    if (!plan || !(await n.isPermissionGranted())) { writeState({ seenAt }); return null; }

    await n.createChannel({
      id: CHANNEL,
      name: 'Library updates',
      description: 'Release dates, trailers and ratings for games in your library, once a day.',
      importance: n.Importance.Low,
    }).catch(() => {});
    const at = nextDigestAt(now);
    n.sendNotification({
      id: DIGEST_ID,
      channelId: CHANNEL,
      title: plan.title,
      body: plan.body,
      autoCancel: true,
      extra: { kind: 'updates' },
      schedule: n.Schedule.at(new Date(at), false, true),
    });
    writeState({ seenAt, at, newestAt: plan.newestAt });
    return { ...plan, at };
  } catch {
    return null;
  }
}
