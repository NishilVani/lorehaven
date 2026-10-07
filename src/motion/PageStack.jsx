import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Routes, useLocation, useNavigationType,
  UNSAFE_LocationContext as LocationContext, UNSAFE_NavigationContext as NavigationContext,
} from 'react-router-dom';
import { pageIdOf, recallScroll, forgetScroll, isRedirectPath } from './pageMemory';

/* Pages you have just left stay mounted, hidden, so going back shows the very
 * same page: its data, its state, its scroll position, with no refetch and no
 * skeleton. Before, every route change unmounted the page, and Back rebuilt
 * it from nothing.
 *
 * - Up to MAX pages are kept; the least recently shown goes first.
 * - Each kept page renders against its own location (its own Routes location
 *   and its own LocationContext), so a hidden page never reacts to the
 *   address of the page in front of it.
 * - Library shelves are one page, as they always were: changing shelf
 *   re-renders the same Library rather than stacking six of them.
 * - Back restores where the page was scrolled to (saved by the director as
 *   the page was left, pageMemory.js). It runs in a layout effect, inside the
 *   page transition's update, so the transition captures the restored
 *   position and art flies home to the card where it really is. ScrollToTop
 *   leaves Back to this.
 * - Hidden pages are `hidden` and `inert`: not painted, not focusable, not in
 *   the accessibility tree.
 * - Hidden pages cannot navigate. A kept page that finishes loading after it
 *   was left (Library writing its sort into the address) would otherwise
 *   replace the address of the page in front with its own. Their navigator
 *   ignores push, replace and go.
 * - Redirect routes (bare /library and /browse) are never kept. A kept one
 *   had already redirected, so coming back to it showed a blank page. */
const MAX = 4;

export default function PageStack({ children }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const id = pageIdOf(location.pathname);
  const [entries, setEntries] = useState(() => [{ id, location, used: 0 }]);

  /* Adjust the stack during render: the page in front must be in it on this
     very render, not one effect later. */
  const current = entries.find((e) => e.id === id);
  if (!current || current.location !== location) {
    const used = Math.max(...entries.map((e) => e.used)) + 1;
    let next = current
      ? entries.map((e) => (e.id === id ? { ...e, location, used } : e))
      : [...entries, { id, location, used }];
    next = next.filter((e) => e.id === id || !isRedirectPath(e.location.pathname));
    if (next.length > MAX) {
      const oldest = next.filter((e) => e.id !== id).sort((a, b) => a.used - b.used)[0];
      next = next.filter((e) => e !== oldest);
      forgetScroll(oldest.id);
    }
    setEntries(next);
  }

  /* Back to a page: put it where it was, or at the top if it was not kept.
     Only when the page itself changed: going back between library shelves
     is the same page, and Library places the shelf itself. */
  const lastId = useRef(id);
  useLayoutEffect(() => {
    const changed = lastId.current !== id;
    lastId.current = id;
    if (!changed || navigationType !== 'POP') return;
    window.scrollTo(0, recallScroll(id) ?? 0);
  }, [id, navigationType]);

  const navigation = useContext(NavigationContext);
  const still = useMemo(() => ({
    ...navigation,
    navigator: { ...navigation.navigator, push() {}, replace() {}, go() {} },
  }), [navigation]);

  return entries.map((e) => {
    const front = e.id === id;
    return (
      <div key={e.id} hidden={!front} inert={!front}>
        <NavigationContext.Provider value={front ? navigation : still}>
          <LocationContext.Provider value={{ location: front ? location : e.location, navigationType }}>
            <Routes location={front ? location : e.location}>{children}</Routes>
          </LocationContext.Provider>
        </NavigationContext.Provider>
      </div>
    );
  });
}
