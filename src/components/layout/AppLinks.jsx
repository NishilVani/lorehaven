import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTauri } from '../../services/openExternal';
import { routeFromAppLink } from '../../services/appSignIn';
import { routeFromShortcut, routeFromWebLink, routeFromAppGame } from '../../services/native/links';

/**
 * Follows lorehaven:// links inside the desktop and Android apps.
 *
 * A Steam sign-in finished in the system browser comes back as one. Only the
 * sign-in and import pages can be opened this way (see routeFromAppLink).
 * On Android three more kinds arrive here, each with its own narrow allowlist
 * (services/native/links.js): a launcher shortcut, widget header or Quick
 * Settings tile, which maps to a fixed screen; a widget row's
 * lorehaven://game/<id>; and a verified https://lorehaven.app/game/<id> link.
 * Anything else is ignored. Renders nothing, and does nothing on the web.
 */
export default function AppLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return undefined;
    let live = true;
    let unlisten = null;

    const follow = (urls) => {
      for (const url of urls || []) {
        const signIn = routeFromAppLink(url);
        const route = signIn || routeFromShortcut(url) || routeFromAppGame(url) || routeFromWebLink(url);
        if (!route) continue;
        /* The sign-in page reads its address once, when it mounts. Already on
           that page, a navigation would change the address under it and
           nothing else, so reload the page at the new address instead. Only
           sign-in pages: the search shortcut's '/?search=true' shares '/' with
           the home page, and reloading there looped (see below). */
        if (signIn && route.split('?')[0] === window.location.pathname) window.location.assign(route);
        else navigate(route);
        return;
      }
    };

    (async () => {
      const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
      /* The link that started the app, when it was not already running.
         getCurrent keeps returning it for the life of the process, including
         after a reload, so follow it once per WebView session: following it
         again after a sign-in reload reloaded the page forever. */
      const first = await getCurrent().catch(() => null);
      const key = 'lorehaven_followed_launch_link';
      const seen = (() => { try { return sessionStorage.getItem(key); } catch { return null; } })();
      const firstKey = first ? JSON.stringify(first) : null;
      if (live && first && firstKey !== seen) {
        try { sessionStorage.setItem(key, firstKey); } catch { /* private mode: follow anyway */ }
        follow(first);
      }
      /* On Android getCurrent reports the latest link, warm ones included, so
         mark these as followed too. */
      const stop = await onOpenUrl((urls) => {
        try { sessionStorage.setItem(key, JSON.stringify(urls)); } catch { /* follow anyway */ }
        follow(urls);
      });
      if (live) unlisten = stop;
      else stop();
    })().catch(() => {});

    return () => {
      live = false;
      unlisten?.();
    };
  }, [navigate]);

  return null;
}
