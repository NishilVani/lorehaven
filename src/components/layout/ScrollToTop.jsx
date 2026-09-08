import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Per-route side effects: scroll reset, document title, and a route announcement.
 *
 * Both additions matter for assistive tech in an SPA. Without them all 23 routes
 * shared the single static <title> from index.html (2.4.2 Page Titled), and a
 * navigation was completely silent — the URL changed, the content swapped, and
 * nothing was announced (4.1.3).
 */

/* Longest-prefix match, so /library/backlog and /game/:id both resolve. Order
   matters: '/awards/' must be tested before '/awards'. */
const TITLES = [
  ['/explore/', 'Explore'],
  ['/game/', 'Game'],
  ['/library', 'My Library'],
  ['/collection/', 'Collection'],
  ['/collections', 'Collections'],
  ['/franchise/', 'Franchise'],
  ['/platforms', 'Manage Platforms'],
  ['/events', 'Events'],
  ['/event/', 'Event'],
  ['/awards/', 'Award Ceremony'],
  ['/awards', 'Awards'],
  ['/wallpapers', 'Wallpapers'],
  ['/games/', 'Browse'],
  ['/schedule', 'Schedule'],
  ['/feedback', 'Recommendation Feedback'],
  ['/import', 'Import Library'],
];

const titleFor = (pathname) => {
  if (pathname === '/') return 'Explore';
  const hit = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : null;
};

export default function ScrollToTop() {
  const { pathname } = useLocation();
  const prevPath = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);

    const name = titleFor(pathname);
    document.title = name ? `${name} — LoreHaven` : 'LoreHaven';

    // Announce the new page. The region is created once and only its TEXT changes —
    // a live region inserted together with its content is not reliably announced.
    let region = document.getElementById('route-announcer');
    if (!region) {
      region = document.createElement('div');
      region.id = 'route-announcer';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.className = 'sr-only';
      document.body.appendChild(region);
    }
    // Defer so the swap is a genuine mutation of an already-present region.
    const t = setTimeout(() => { region.textContent = document.title; }, 100);

    /* Recover focus ONLY when a navigation destroyed it. Activating a game card
       unmounts the card, so focus falls to <body> and the keyboard user restarts
       from the top of the document. Two things this deliberately does NOT do:
         - it skips the first render, where activeElement is <body> simply because
           the page just loaded. Focusing <main> there would put the skip link and
           the whole nav rail BEHIND the user in the tab order.
         - it leaves focus alone when it survived, so navigating from the rail keeps
           focus on the link, which is already correct. */
    /* Compare the PREVIOUS pathname rather than flipping a "first render" flag:
       StrictMode double-invokes this effect, so a flag is already false on the
       second pass and the restore fires on the initial load anyway. Re-running
       with the same pathname is not a navigation. */
    const isNavigation = prevPath.current !== null && prevPath.current !== pathname;
    prevPath.current = pathname;

    const restore = !isNavigation ? null : setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.getElementById('main')?.focus({ preventScroll: true });
    }, 120);

    return () => { clearTimeout(t); if (restore) clearTimeout(restore); };
  }, [pathname]);

  return null;
}
