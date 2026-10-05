import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigationType, UNSAFE_LocationContext as LocationContext } from 'react-router-dom';
import { motionLevel } from './motion';

/* Page transitions with the View Transitions API.
 *
 * The router here is declarative (BrowserRouter), so it cannot start a view
 * transition itself. This holds the page on the location it was showing while
 * the browser captures it, then swaps to the new one inside
 * document.startViewTransition, and motion.css animates the two snapshots of
 * <main>. Everything below it -- <Routes>, ScrollToTop, every useLocation and
 * useParams in a page -- reads the held location through the router's own
 * context, so a page never renders the new address with the old route.
 *
 * Only a change of pathname transitions. Query changes (search, filters,
 * sorting) apply at once. Without the API, or in a test that turned motion
 * off, it renders the live location directly.
 *
 * ScrollToTop belongs inside this, not outside: its scroll then runs in the
 * update callback, after the old page was captured, rather than visibly
 * jumping the old page to the top first.
 *
 * The update never waits on anything: rendering is frozen until it returns.
 * The expressive cover flight is therefore not a view transition at all but a
 * FLIP animation that runs whenever the game page's cover arrives (motion.js). */

const supported = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';

export default function TransitionLocation({ children }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [shown, setShown] = useState(location);

  const animate = supported && motionLevel() !== 'off' && shown.pathname !== location.pathname;
  /* Same page, or nothing to animate with: follow the address at once.
     Adjusting state during render, so there is no frame on the old location. */
  if (!animate && shown !== location) setShown(location);
  const display = animate ? shown : location;

  useLayoutEffect(() => {
    if (!animate) return undefined;
    const root = document.documentElement;
    root.dataset.vtDir = navigationType === 'POP' ? 'back' : 'forward';
    let updated = false;
    const transition = document.startViewTransition(() => {
      updated = true;
      flushSync(() => setShown(location));
    });
    transition.finished.finally(() => { delete root.dataset.vtDir; });
    /* Avoid a dangling promise rejection when a newer navigation interrupts. */
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    return () => {
      /* A newer navigation arrived first: finish this one now. */
      if (!updated) transition.skipTransition();
    };
  }, [animate, location, navigationType]);

  return (
    <LocationContext.Provider value={{ location: display, navigationType }}>
      {children}
    </LocationContext.Provider>
  );
}
