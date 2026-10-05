/* Two more ways into the app, each as narrow as it can be. The sign-in links
 * in appSignIn.js stay exactly as they were.
 *
 * Launcher shortcuts: long-press the app icon. Each is lorehaven://shortcut/
 * <name>, and the name maps to a FIXED route here: nothing from the link (no
 * path, no query) reaches the router, so another app firing the same intent
 * can only open one of these four screens.
 *
 * App Links: https://lorehaven.app/game/<id> and /franchise/<id> open in the
 * app once Android has verified the site (public/well-known-assetlinks.json,
 * served at /.well-known/assetlinks.json). Read-only pages, numeric ids only. */

const SHORTCUTS = {
  search: '/?search=true',
  library: '/library',
  playing: '/library/playing',
  pick: '/library?pick=1',
};

/** lorehaven://shortcut/search -> '/?search=true', or null. */
export function routeFromShortcut(link) {
  let url;
  try { url = new URL(String(link)); } catch { return null; }
  if (url.protocol !== 'lorehaven:' || url.host !== 'shortcut') return null;
  const name = url.pathname.replace(/^\/+|\/+$/g, '');
  return Object.prototype.hasOwnProperty.call(SHORTCUTS, name) ? SHORTCUTS[name] : null;
}

const WEB_HOSTS = new Set(['lorehaven.app', 'www.lorehaven.app']);
const WEB_ROUTES = [/^\/game\/(\d{1,10})\/?$/, /^\/franchise\/(\d{1,10})\/?$/];

/** https://lorehaven.app/game/1942 -> '/game/1942', or null. */
export function routeFromWebLink(link) {
  let url;
  try { url = new URL(String(link)); } catch { return null; }
  if (url.protocol !== 'https:' || !WEB_HOSTS.has(url.hostname)) return null;
  for (const re of WEB_ROUTES) {
    const m = url.pathname.match(re);
    if (m) return url.pathname.replace(/\/$/, '');
  }
  return null;
}
