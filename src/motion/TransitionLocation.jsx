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
 * The update never waits on anything. A new route's code chunk, when not
 * already in (routes.js prefetches them), is awaited before the transition
 * starts, with the old page still live, for at most CHUNK_WAIT_MS. Query-only
 * changes apply at once, without a transition. */

const supported = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
/* How long the old page may stay up while the new page's code downloads. */
const CHUNK_WAIT_MS = 1500;
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
/* Routes that only redirect (App.jsx <Navigate>). */
const REDIRECTS = /^\/(library|browse)\/?$/;
let latest = 0;
/* True while a transition's update is rendering the new page. A redirect
   route (/library, /browse) renders a <Navigate> that replaces the address
   as it commits, inside that same render: the change is applied to the held
   location at once instead of starting a second transition from an empty
   page (which flashed blank between two moves). */
let updating = false;
/* Resolves the update's wait once the redirect has been applied. */
let redirectApplied = null;

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
    if (updating) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a redirect inside a transition's update; see `updating`
      setShown(location);
      redirectApplied?.();
      return undefined;
    }
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

    /* The new page's code must be in before the browser captures anything:
       starting with it missing used to capture the Suspense skeleton as the
       new page, so the transition played and then the skeleton gave way to
       the page, two changes for one tap. Until the chunk arrives the old page
       simply stays, live and usable (no transition has frozen it yet); the
       wait is capped so a failed chunk cannot strand the navigation. */
    let cancelled = false;
    let transition = null;
    let updated = false;
    const begin = () => {
      if (cancelled) return;
      const type = classifyTransition({ from: from.pathname, to: to.pathname, navigationType, pair });
      root.dataset.vt = type;
      const dir = siblingDirection(from.pathname, to.pathname);
      if (dir) root.dataset.vtDir = dir; else delete root.dataset.vtDir;
      clearShared();
      nameShared(source);

      let landed = false;
      const id = ++latest;
      /* Where the old page sat when it was captured. Its snapshot is the
         whole of <main>; pinned to the new page's top it showed the old
         page's own top, so a page left while scrolled (a long shelf) lost
         what was on screen the instant the transition began. The snapshot is
         offset by the difference once the new page is laid out (ready). */
      const mainEl = document.getElementById('main');
      const oldTop = mainEl ? mainEl.getBoundingClientRect().top : 0;
      transition = document.startViewTransition(async () => {
        updated = true;
        clearShared();
        updating = true;
        try {
          flushSync(() => setShown(to));
          /* A redirect route's <Navigate> replaces the address from an effect
             after this render, and the router applies it a task or more later
             depending on the engine. Wait (redirect routes only, capped) until
             the effect above has taken it into the held location. */
          if (REDIRECTS.test(to.pathname)) {
            await Promise.race([new Promise((resolve) => { redirectApplied = resolve; }), wait(150)]);
            redirectApplied = null;
          }
        } finally { updating = false; }
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
        root.style.removeProperty('--vt-old-top');
      });
      transition.ready.then(() => {
        const newTop = mainEl ? mainEl.getBoundingClientRect().top : 0;
        root.style.setProperty('--vt-old-top', `${Math.round(oldTop - newTop)}px`);
      }, () => {});
      transition.updateCallbackDone.catch(() => {});
    };

    if (routeLoaded(to.pathname)) begin();
    else Promise.race([preloadRoute(to.pathname), wait(CHUNK_WAIT_MS)]).then(begin);

    return () => {
      /* A newer navigation arrived first: drop this one if it has not
         started, finish it now if it has. */
      cancelled = true;
      if (transition && !updated) transition.skipTransition();
    };
  }, [animate, location, navigationType]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LocationContext.Provider value={{ location: display, navigationType }}>
      {children}
    </LocationContext.Provider>
  );
}
