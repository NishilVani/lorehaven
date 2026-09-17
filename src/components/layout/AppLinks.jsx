import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTauri } from '../../services/openExternal';
import { routeFromAppLink } from '../../services/appSignIn';

/**
 * Follows lorehaven:// links inside the desktop and Android apps.
 *
 * A Steam sign-in finished in the system browser comes back as one. Only the
 * sign-in and import pages can be opened this way (see routeFromAppLink), so a
 * link from anywhere else is ignored. Renders nothing, and does nothing on the
 * web.
 */
export default function AppLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return undefined;
    let live = true;
    let unlisten = null;

    const follow = (urls) => {
      for (const url of urls || []) {
        const route = routeFromAppLink(url);
        if (!route) continue;
        /* The sign-in page reads its address once, when it mounts. Already on
           that page, a navigation would change the address under it and
           nothing else, so reload the page at the new address instead. */
        if (route.split('?')[0] === window.location.pathname) window.location.assign(route);
        else navigate(route);
        return;
      }
    };

    (async () => {
      const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
      /* The link that started the app, when it was not already running. */
      const first = await getCurrent().catch(() => null);
      if (live && first) follow(first);
      const stop = await onOpenUrl(follow);
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
