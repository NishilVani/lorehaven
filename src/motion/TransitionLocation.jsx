import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigationType, UNSAFE_LocationContext as LocationContext } from 'react-router-dom';
import { classifyTransition, siblingDirection } from './classify';
import { reducedMotion } from './motion';
import { findShared, takePending, rememberHomeward, homewardFor, nameShared, clearShared, setRunningTransition } from './shared';
import { routeLoaded, preloadRoute } from './routes';
import { haptic } from '../services/native/haptics';

/* The transition director (docs/superpowers/specs/2026-10-06-motion-design.md,
 * section 1.1).
 *
 * Every change of pathname runs through document.startViewTransition. The
 * router here is declarative, so the director holds the page on the location
 * it was showing while the browser captures it, then swaps inside the
 * transition. Everything below it (Routes, ScrollToTop, every useLocation and
 * useParams in a page) reads the held location through the router's own
 * context, so a page never renders the new address with the old route.
 *
 * Before starting it classifies the change (classify.js) and writes
 * <html data-vt="carry|carry-back|sideways|deeper|back"> and, for sideways,
 * data-vt-dir="left|right". choreography.css turns those into the three beats:
 * clear, carry, reveal. When a shared pair exists it names the source now and
 * the destination after the swap; if the destination has no match on screen
 * the type falls back to deeper or back.
 *
 * The update never waits on data. It waits at most 300ms for the new route's
 * code chunk, and only when that chunk is not already in (routes.js
 * prefetches them). Query-only changes apply at once, without a transition. */

const supported = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
const CHUNK_WAIT_MS = 300;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME_WAIT_MS = 250;
/* setTimeout polling, not requestAnimationFrame: rendering is paused while a
   view transition waits on its update, so frame callbacks never run. */
const waitForShared = (key, ms) => new Promise((resolve) => {
  const start = performance.now();
  const check = () => {
    const el = findShared(key);
    if (el || performance.now() - start >= ms) resolve(el);
    else setTimeout(check, 16);
  };
  check();
});
let latest = 0;

export default function TransitionLocation({ children }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [shown, setShown] = useState(location);

  const animate = supported && shown.pathname !== location.pathname;
  /* Same page, or nothing to animate with: follow the address at once,
     adjusting state during render so there is no frame on the old location. */
  if (!animate && shown !== location) setShown(location);
  const display = animate ? shown : location;

  useLayoutEffect(() => {
    if (!animate) return undefined;
    const root = document.documentElement;
    const from = shown;
    const to = location;
    const back = navigationType === 'POP';

    /* The pair: a fresh click on shared art going forward, or the art this
       page was left through, coming back. Reduced motion never travels. */
    const pressed = back ? null : takePending();
    let pair = back ? homewardFor(to.key) : pressed?.key || null;
    let source = null;
    if (pair && !reducedMotion()) source = pressed?.el?.isConnected ? pressed.el : findShared(pair);
    if (!source) pair = null;
    if (pair && !back) rememberHomeward(from.key, pair);

    const type = classifyTransition({ from: from.pathname, to: to.pathname, navigationType, pair });
    root.dataset.vt = type;
    const dir = siblingDirection(from.pathname, to.pathname);
    if (dir) root.dataset.vtDir = dir; else delete root.dataset.vtDir;
    clearShared();
    nameShared(source);

    let updated = false;
    let landed = false;
    const id = ++latest;
    const transition = document.startViewTransition(async () => {
      updated = true;
      clearShared();
      if (!routeLoaded(to.pathname)) await Promise.race([preloadRoute(to.pathname), wait(CHUNK_WAIT_MS)]);
      flushSync(() => setShown(to));
      if (pair) {
        /* Going back, the page under the art often renders its rows a few
           ticks after mounting (from cache). Look for the art's home for a
           moment before giving up on flying it there; the old page stays
           frozen meanwhile, so the wait is short. Forward navigations land
           on a prelude, which is there at once. */
        let target = findShared(pair);
        if (!target && back) target = await waitForShared(pair, HOME_WAIT_MS);
        if (target) { nameShared(target); landed = true; }
        else root.dataset.vt = back ? 'back' : 'deeper';
      }
    });
    setRunningTransition(transition.finished);
    transition.finished.then(() => { if (landed) haptic('light'); }, () => {}).finally(() => {
      /* Only the newest transition tidies up: an older one finishing late
         must not strip the attributes a newer one is animating with. */
      if (id !== latest) return;
      clearShared();
      delete root.dataset.vt;
      delete root.dataset.vtDir;
    });
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    return () => {
      /* A newer navigation arrived first: finish this one now. */
      if (!updated) transition.skipTransition();
    };
  }, [animate, location, navigationType]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LocationContext.Provider value={{ location: display, navigationType }}>
      {children}
    </LocationContext.Provider>
  );
}
