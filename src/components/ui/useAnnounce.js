import { useEffect } from 'react';

/**
 * Announce transient status to assistive tech.
 *
 * Writes into ONE always-present live region rather than each page mounting its own.
 * A live region that is inserted into the DOM together with its content is not
 * reliably announced — the region has to already be in the accessibility tree and
 * only its text change. That is exactly the shape most "loading…" / "N results"
 * nodes had, which is why searching, filtering and infinite scroll were silent.
 *
 *   useAnnounce(loading ? 'Searching' : `${results.length} results`);
 *
 * Pass null/'' to say nothing. Repeats of the same string are skipped so a re-render
 * does not re-announce. WCAG 4.1.3.
 */

const REGION_ID = 'app-live-region';

function getRegion() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(REGION_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = REGION_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    document.body.appendChild(el);
  }
  return el;
}

export function announce(message) {
  const el = getRegion();
  if (!el || !message) return;
  // Clearing first makes an identical consecutive message announce again when a
  // caller genuinely wants to repeat it (e.g. "no results" twice in a row).
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 50);
}

export default function useAnnounce(message) {
  useEffect(() => {
    if (!message) return;
    const el = getRegion();
    // Compare against what the region actually says, not a ref of what we last
    // *scheduled*: StrictMode's double-invoke cancels the first timeout, and a ref
    // set before the timeout fires would then suppress the retry — the region ends
    // up created but permanently empty.
    if (!el || el.textContent === message) return;
    const t = setTimeout(() => { el.textContent = message; }, 150);   // debounce typing
    return () => clearTimeout(t);
  }, [message]);
}
