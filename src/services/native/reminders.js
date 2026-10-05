/* Release-day reminders: a local notification on the phone when a game you are
 * waiting for comes out. No server -- the release dates are already on your
 * library entries, and Android's alarm service fires them, through Doze and
 * across reboots (the notification plugin re-arms them on boot).
 *
 * planReminders is pure and decides WHAT to schedule; syncReminders makes the
 * phone's pending reminders match the plan. Re-run on launch and whenever the
 * library changes, so a game moved off the wishlist or given a new date
 * reschedules itself. */

/** The settings a device can choose; see deviceSettings.js for where they live. */
export const REMINDER_SHELVES = ['Wishlist', 'Unreleased', 'Backlog'];
export const DEFAULT_REMINDERS = { enabled: false, when: 'day-of', shelves: ['Wishlist', 'Unreleased'] };

/* Android caps an app's pending alarms (500 on most builds); the nearest 60
   releases is far more than anyone waits on, and leaves room. */
const MAX = 60;
const CHANNEL = 'release-days';

/* IGDB stores a release date as midnight UTC on the day. The reminder fires in
   the phone's own time on that calendar day: 10:00 on the day, or 18:00 the
   evening before. */
function fireAt(releaseSec, when) {
  const d = new Date(releaseSec * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  return when === 'day-before' ? new Date(y, m, day - 1, 18, 0, 0) : new Date(y, m, day, 10, 0, 0);
}

/* Library ids are IGDB game ids, which fit an Android notification id (a
   32-bit int). A custom entry has a string id and no release date to remind
   about, so it is never scheduled. */
const notificationId = (id) => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};

/**
 * → [{ id, gameId, at: Date, title, body }] nearest first.
 * Only games on a chosen shelf, with a dated release whose reminder time is
 * still ahead. "TBA" and year-only dates have no day to remind on.
 */
export function planReminders(library, settings, now = Date.now()) {
  if (!settings?.enabled) return [];
  const shelves = new Set(settings.shelves || DEFAULT_REMINDERS.shelves);
  const out = [];
  for (const g of library || []) {
    if (!shelves.has(g.status)) continue;
    const id = notificationId(g.id);
    const rel = Number(g.first_release_date);
    if (!id || !g.name || !Number.isFinite(rel) || rel <= 0) continue;
    const at = fireAt(rel, settings.when);
    if (at.getTime() <= now) continue;
    out.push({
      id, gameId: g.id, at,
      title: settings.when === 'day-before' ? `${g.name} is out tomorrow` : `${g.name} is out today`,
      body: `On your ${g.status} shelf. Tap to open it.`,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX);
}

/* What this device last scheduled: id -> fire time (ms). Kept here rather than
   read back from the plugin, because pending() does not return the `extra`
   that marks a notification as ours. Device-local on purpose: alarms belong to
   one phone. */
const SCHEDULED_KEY = 'lorehaven_reminders_scheduled';
const readScheduled = () => {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_KEY) || '{}') || {}; } catch { return {}; }
};
const writeScheduled = (map) => {
  try { localStorage.setItem(SCHEDULED_KEY, JSON.stringify(map)); } catch { /* storage full: next sync retries */ }
};

/** The changes that bring `scheduled` (id -> ms) in line with `plan`. Pure. */
export function diffReminders(scheduled, plan) {
  const want = new Map(plan.map(r => [String(r.id), r]));
  const cancel = Object.keys(scheduled).filter(id => !want.has(id) || want.get(id).at.getTime() !== scheduled[id]).map(Number);
  const add = plan.filter(r => scheduled[String(r.id)] !== r.at.getTime());
  return { cancel, add };
}

let channelReady = false;

/**
 * Make the phone's pending reminders match the plan. Safe to call often: an
 * unchanged plan schedules and cancels nothing. Throws only when the plugin is
 * missing, which the caller treats as "this build has no reminders".
 */
export async function syncReminders(library, settings, now = Date.now()) {
  const n = await import('@tauri-apps/plugin-notification');
  const plan = planReminders(library, settings, now);
  const scheduled = readScheduled();
  const { cancel, add } = diffReminders(scheduled, plan);
  if (cancel.length) {
    await n.cancel(cancel).catch(() => {});
    for (const id of cancel) delete scheduled[String(id)];
  }
  if (add.length) {
    if (!(await n.isPermissionGranted())) { writeScheduled(scheduled); return { scheduled: 0, cancelled: cancel.length, permission: false }; }
    if (!channelReady) {
      await n.createChannel({
        id: CHANNEL,
        name: 'Release days',
        description: 'A game you are waiting for comes out.',
        importance: n.Importance.Default,
      }).catch(() => {});
      channelReady = true;
    }
    for (const r of add) {
      n.sendNotification({
        id: r.id,
        channelId: CHANNEL,
        title: r.title,
        body: r.body,
        autoCancel: true,
        extra: { kind: 'release', gameId: r.gameId },
        schedule: n.Schedule.at(r.at, false, true),
      });
      scheduled[String(r.id)] = r.at.getTime();
    }
  }
  writeScheduled(scheduled);
  return { scheduled: add.length, cancelled: cancel.length, permission: true };
}

/** Ask for the Android 13+ notification permission. → true when granted. */
export async function requestReminderPermission() {
  const n = await import('@tauri-apps/plugin-notification');
  if (await n.isPermissionGranted()) return true;
  return (await n.requestPermission()) === 'granted';
}
