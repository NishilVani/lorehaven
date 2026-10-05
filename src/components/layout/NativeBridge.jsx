import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLibrary } from '../../services/db';
import { isAndroidApp, getDeviceSettings } from '../../services/native/device';
import { syncReminders } from '../../services/native/reminders';

/**
 * The Android app's background duties. Renders nothing; does nothing on the
 * web, the desktop app, or an APK built before the plugins.
 *
 * - Keeps release-day reminders in step with the library: on launch, and a
 *   moment after any library change or settings change, so a game moved off
 *   the wishlist, given a new date, or removed reschedules itself.
 * - A tap on a reminder opens that game.
 */
export default function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAndroidApp()) return undefined;
    let timer = null;
    let live = true;
    const sync = () => {
      clearTimeout(timer);
      /* Debounced: an import writes the library in one go but fires several
         events, and every sync reads the whole library. */
      timer = setTimeout(() => {
        if (!live) return;
        syncReminders(getLibrary(), getDeviceSettings().reminders).catch(() => {});
      }, 1500);
    };
    sync();
    window.addEventListener('moctale_lib_update', sync);
    window.addEventListener('lorehaven_device_settings', sync);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener('moctale_lib_update', sync);
      window.removeEventListener('lorehaven_device_settings', sync);
    };
  }, []);

  useEffect(() => {
    if (!isAndroidApp()) return undefined;
    let live = true;
    let listener = null;
    (async () => {
      const { onAction } = await import('@tauri-apps/plugin-notification');
      const l = await onAction((n) => {
        const id = Number(n?.extra?.gameId);
        if (n?.extra?.kind === 'release' && Number.isInteger(id) && id > 0) navigate(`/game/${id}`);
      });
      if (live) listener = l; else l.unregister?.();
    })().catch(() => {});
    return () => { live = false; listener?.unregister?.(); };
  }, [navigate]);

  return null;
}
