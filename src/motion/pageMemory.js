/* Which page a pathname belongs to for the page stack (PageStack.jsx), and
 * where each kept page was scrolled to when it was left.
 *
 * Scroll is saved by the transition director just before a page change
 * starts, while the old page is still on screen; once it is hidden the
 * document shrinks and the browser clamps the scroll, so it cannot be read
 * afterwards. */

/** One page per pathname, except that library shelves share one page. */
export const pageIdOf = (pathname) => {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return p.startsWith('/library/') && p !== '/library/duplicates' ? '/library/*' : p;
};

/** Bare /library and /browse only redirect to a shelf or tab. */
export const isRedirectPath = (pathname) => /^\/(library|browse)\/?$/.test(String(pathname || ''));

const scrolls = new Map();
export const rememberScroll = (pathname, y) => { scrolls.set(pageIdOf(pathname), Math.max(0, Math.round(y))); };
export const recallScroll = (id) => scrolls.get(id);
export const forgetScroll = (id) => { scrolls.delete(id); };
