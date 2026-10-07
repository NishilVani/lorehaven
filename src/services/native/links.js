/* Two more ways into the app, each as narrow as it can be. The sign-in links
 * in appSignIn.js stay exactly as they were.
 *
 * Launcher shortcuts: long-press the app icon. Each is lorehaven://shortcut/
 * <name>, and the name maps to a FIXED route here: nothing from the link (no
 * path, no query) reaches the router, so another app firing the same intent
 * can only open one of these screens. The widgets' headers use two more
 * (backlog, schedule) that are not launcher shortcuts.
 *
 * Widget rows and the like: lorehaven://game/<id> opens that game page.
 * Numeric id only, read-only page.
 *
 * App Links: https://lorehaven.app/game/<id> and /franchise/<id> open in the
 * app once Android has verified the site (public/well-known-assetlinks.json,
 * served at /.well-known/assetlinks.json). Read-only pages, numeric ids only. */

import { parseAppUrl } from '../appSignIn.js';
import { DIGEST_ID } from './libraryDigest.js';

const SHORTCUTS = {
  search: '/?search=true',
  library: '/library',
  playing: '/library/playing',
  /* Straight to the backlog: '/library' redirects there and the redirect
     drops the query, so ?pick=1 never reached the page. */
  pick: '/library/backlog?pick=1',
  backlog: '/library/backlog',
  schedule: '/schedule',
};

/** lorehaven://game/1942 -> '/game/1942', or null. */
export function routeFromAppGame(link) {
  const url = parseAppUrl(link);
  if (!url || url.host !== 'game' || url.search) return null;
  const m = url.path.match(/^\/(\d{1,10})\/?$/);
  return m && Number(m[1]) > 0 ? `/game/${m[1]}` : null;
}

/** lorehaven://shortcut/search -> '/?search=true', or null. */
export function routeFromShortcut(link) {
  const url = parseAppUrl(link);
  if (!url || url.host !== 'shortcut') return null;
  const name = url.path.replace(/^\/+|\/+$/g, '');
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

/** The page a tapped notification opens, from its id alone (all the tap
 *  carries; LoreHavenPlugin.takeNotificationTap). A release reminder's id is
 *  its game's id (reminders.js); the evening digest has its own. */
export function routeFromNotificationTap(id) {
  const n = Number(id);
  if (n === DIGEST_ID) return '/explore/updates';
  return Number.isInteger(n) && n > 0 && n < DIGEST_ID ? `/game/${n}` : null;
}
