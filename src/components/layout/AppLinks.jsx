import { useEffect, useRef } from 'react';
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
  /* React Router makes a new navigate on every page change. With it as a
     dependency the effect below re-ran after each navigation, asked Android
     for the launch link again (which reports the latest one), and followed it
     again: the Library shortcut, whose /library only redirects, so it never
     reads as "already there", navigated in a loop five times a second. Read
     navigate through a ref and run the effect once. */
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let live = true;
    let unlisten = null;

    const routeFor = (url) => routeFromAppLink(url) || routeFromShortcut(url) || routeFromAppGame(url) || routeFromWebLink(url);
    const follow = (urls) => {
      for (const url of urls || []) {
        const signIn = routeFromAppLink(url);
        const route = signIn || routeFor(url);
        if (!route) continue;
        /* The sign-in page reads its address once, when it mounts. Already on
           that page, a navigation would change the address under it and
           nothing else, so reload the page at the new address instead. Only
           sign-in pages: the search shortcut's '/?search=true' shares '/' with
           the home page, and reloading there looped (see below). */
        if (signIn && route.split('?')[0] === window.location.pathname) window.location.assign(route);
        else navigateRef.current(route);
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
      /* Skip it only when this page is already where it leads: that is the
         page re-reading a link it followed (the sign-in reload). Android's
         WebView keeps sessionStorage across app restarts, so on a fresh launch
         the same link (a widget row tapped twice) must be followed again. */
      const here = window.location.pathname + window.location.search;
      const already = (first || []).some((u) => routeFor(u) === here);
      if (live && first && !(firstKey === seen && already)) {
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
  }, []);

  return null;
}
