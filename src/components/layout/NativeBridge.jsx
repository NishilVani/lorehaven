import { useEffect, useRef } from 'react';
import { matchSteamApps } from '../../services/igdb';
import { useLocation, useNavigate } from 'react-router-dom';
import { getLibrary } from '../../services/db';
import { isAndroidApp, getDeviceSettings } from '../../services/native/device';
import { syncReminders } from '../../services/native/reminders';
import { syncWidgets } from '../../services/native/widgets';
import { syncLibraryDigest } from '../../services/native/libraryDigest';
import { nativeCall } from '../../services/native/bridge';
import { parseSharedText, searchRoute } from '../../services/native/shareIn';
import { startBackController } from '../../services/native/back';

/**
 * The Android app's background duties. Renders nothing; does nothing on the
 * web, the desktop app, or an APK built before the plugins.
 *
 * - Keeps release-day reminders and the home-screen widgets in step with the
 *   library: on launch, and a moment after any library or settings change.
 * - Gathers library updates for the evening digest, on launch and whenever the
 *   app comes back to the foreground.
 * - Opens what another app shared into LoreHaven.
 * - Runs predictive back (services/native/back.js).
 * - A tap on a notification opens its game, or the updates list.
 */
export default function NativeBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const back = useRef(null);
  /* navigate changes identity on every navigation; effects that only need to
     call it read it from here, so their listeners register once instead of
     being torn down and re-registered on every page change (unregistering a
     notification listener is not permitted, and failed on each one). */
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

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
        const library = getLibrary();
        syncReminders(library, getDeviceSettings().reminders).catch(() => {});
        syncWidgets(library).catch(() => {});
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

  /* Foreground work: the digest, and anything shared while the app was in
     the background (a share to a running app arrives as a new intent and
     brings it forward, which is a visibility change). */
  useEffect(() => {
    if (!isAndroidApp()) return undefined;
    let live = true;
    const takeShare = async () => {
      const res = await nativeCall('takeShared').catch(() => null);
      const shared = live && res?.text ? parseSharedText(res.text) : null;
      if (!shared) return;
      if (shared.kind === 'route') { navigateRef.current(shared.route); return; }
      if (shared.kind === 'steam') {
        try {
          const game = (await matchSteamApps([shared.appid])).get(String(shared.appid));
          if (live && game?.id) { navigateRef.current(`/game/${game.id}`); return; }
        } catch { /* no match or offline: search instead */ }
      }
      if (live && shared.query) navigateRef.current(searchRoute(shared.query));
    };
    const onForeground = () => {
      if (document.visibilityState !== 'visible') return;
      takeShare();
      syncLibraryDigest(getDeviceSettings().updates);
    };
    /* After first paint: the digest refresh reads IGDB, and a share should
       land on a page that has mounted. */
    const first = setTimeout(onForeground, 2500);
    document.addEventListener('visibilitychange', onForeground);
    const onSettings = () => syncLibraryDigest(getDeviceSettings().updates);
    window.addEventListener('lorehaven_device_settings', onSettings);
    return () => {
      live = false;
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('lorehaven_device_settings', onSettings);
    };
  }, []);

  useEffect(() => {
    if (!isAndroidApp()) return undefined;
    back.current = startBackController();
    return () => { back.current?.stop(); back.current = null; };
  }, []);

  /* A route change can make history back possible, or not. */
  useEffect(() => { back.current?.refresh(); }, [location.key]);

  useEffect(() => {
    if (!isAndroidApp()) return undefined;
    let live = true;
    let listener = null;
    (async () => {
      const { onAction } = await import('@tauri-apps/plugin-notification');
      const l = await onAction((n) => {
        const extra = n?.extra || {};
        const id = Number(extra.gameId);
        if (extra.kind === 'release' && Number.isInteger(id) && id > 0) navigateRef.current(`/game/${id}`);
        else if (extra.kind === 'updates') navigateRef.current('/explore/updates');
      });
      if (live) listener = l; else l.unregister?.().catch?.(() => {});
    })().catch(() => {});
    return () => { live = false; Promise.resolve(listener?.unregister?.()).catch(() => {}); };
  }, []);

  return null;
}
