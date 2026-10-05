/* Haptic feedback on the Android app, through the system's own patterns (the
 * haptics plugin; raw vibrate is not granted). Fire-and-forget: it never
 * throws, never waits, and does nothing on the web, the desktop app, an older
 * APK without the plugin, or when the person turned haptics off.
 *
 *   select   a value picked from a menu, a shelf swiped to
 *   light    a small state change (priority, rating)
 *   lift     a card picked up to drag
 *   success  a game added to the library
 *   warning  a game removed */
import { isAndroidApp, getDeviceSettings } from './device.js';

let plugin = null;
let missing = false;

export function haptic(kind) {
  if (missing || !isAndroidApp() || !getDeviceSettings().haptics) return;
  (plugin ? Promise.resolve(plugin) : import('@tauri-apps/plugin-haptics').then(m => (plugin = m)))
    .then((h) => {
      switch (kind) {
        case 'select': return h.selectionFeedback();
        case 'lift': return h.impactFeedback('medium');
        case 'success': return h.notificationFeedback('success');
        case 'warning': return h.notificationFeedback('warning');
        default: return h.impactFeedback('light');
      }
    })
    /* An APK built before the plugin rejects every call; stop trying. */
    .catch(() => { missing = true; });
}
