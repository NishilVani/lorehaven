/* Opening and closing the search overlay without growing history.
 *
 * Search lives in the URL (?search=true), so opening it is a navigation. Closing
 * it used to be another one, so Back after closing reopened search, and on
 * Android the back gesture (services/native/back.js) bounced between the two.
 * Now opening records which history entry it created, and closing goes back to
 * the page underneath when that entry is still the current one; otherwise (a
 * search opened from a link or a reload) closing replaces the address instead.
 * Typing keeps the same entry: the overlay updates the query with replace. */

const KEY = 'lh_search_opened_idx';
const currentIndex = () => Number(window.history.state?.idx) || 0;

/** Call when a link opens search: the new entry will be one above this one. */
export function markSearchOpened() {
  try { sessionStorage.setItem(KEY, String(currentIndex() + 1)); } catch { /* closes by replace */ }
}

export function closeSearch(navigate, closeLink) {
  let opened = null;
  try {
    opened = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch { /* closes by replace */ }
  const idx = currentIndex();
  if (opened !== null && Number(opened) === idx && idx > 0) navigate(-1);
  else navigate(closeLink, { replace: true });
}
