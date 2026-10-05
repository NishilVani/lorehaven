/* The Android app's native features: where they run, and the settings that
 * belong to one phone.
 *
 * These settings are kept apart from prefs on purpose. Prefs sync across
 * devices; "remind me on release day" turned on on a phone that granted the
 * notification permission means nothing on a laptop, or on a second phone that
 * never did. Plain localStorage, never synced. */
import { isTauri } from '../openExternal.js';
import { DEFAULT_REMINDERS, REMINDER_SHELVES } from './reminders.js';

/** The Tauri Android shell. Every native feature checks this first, so the
    web and desktop builds never even load the plugins. */
export const isAndroidApp = () => isTauri() && /android/i.test(navigator.userAgent);

const KEY = 'lorehaven_device_settings';
const DEFAULTS = { reminders: DEFAULT_REMINDERS, haptics: true, updates: false };

export function getDeviceSettings() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* corrupt: defaults */ }
  const r = raw.reminders && typeof raw.reminders === 'object' ? raw.reminders : {};
  const shelves = Array.isArray(r.shelves) ? r.shelves.filter(s => REMINDER_SHELVES.includes(s)) : DEFAULTS.reminders.shelves;
  return {
    reminders: {
      enabled: r.enabled === true,
      when: r.when === 'day-before' ? 'day-before' : 'day-of',
      shelves: shelves.length ? shelves : DEFAULTS.reminders.shelves,
    },
    haptics: raw.haptics !== false,
    /* The evening digest of library changes (libraryDigest.js). Off until
       asked for, like reminders: it needs the notification permission. */
    updates: raw.updates === true,
  };
}

export function setDeviceSettings(patch) {
  const cur = getDeviceSettings();
  const next = { ...cur, ...patch, reminders: { ...cur.reminders, ...(patch.reminders || {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full: setting not kept */ }
  window.dispatchEvent(new Event('lorehaven_device_settings'));
  return next;
}
