/**
 * useFocusTrap — the single focus-trap implementation behind every LoreHaven
 * overlay.
 *
 * It lives in its own module rather than beside <Dialog> because a file that
 * exports both a component and a hook loses fast refresh: editing the hook
 * remounts the component tree instead of hot-swapping it.
 *
 * Covers WCAG 4.1.2 (name/role/value), 2.1.2 (no keyboard trap — you can always
 * Escape out), and 2.4.3 (focus order).
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', 'button:not([disabled])', 'iframe', 'object', 'embed',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable]',
  'audio[controls]', 'video[controls]',
].join(',');

// Nesting-safe scroll lock: only the outermost overlay restores overflow.
let lockCount = 0;

/* Standalone so the compiler lint does not read `el.inert = ...` as mutating the
   ref the element was reached through — these are DOM nodes, not React state. */
const setInert = (el, on) => { el.inert = on; };

/**
 * useFocusTrap — moves focus into `containerRef` on activate, restores it on
 * deactivate, and closes on Escape. When `modal` (the default) it also traps Tab
 * and makes everything outside inert.
 *
 * @param {object}  o
 * @param {boolean} o.active          — engage the trap
 * @param {object}  o.containerRef    — ref to the element that holds focus
 * @param {fn}      o.onClose         — called on Escape
 * @param {boolean} o.closeOnEscape   — default true
 * @param {object}  o.initialFocus    — optional ref to focus first
 * @param {boolean} o.lockScroll      — default true
 * @param {object}  o.boundaryRef     — subtree kept live while everything outside it
 *                                      is made inert; defaults to containerRef
 * @param {boolean} o.modal           — default true. false = a panel that coexists with
 *                                      the page: no inert, no Tab trap, so the rest of
 *                                      the UI stays operable. Escape and focus in/out
 *                                      still apply. Pair it with NO `aria-modal`, or the
 *                                      markup promises AT something the behaviour does
 *                                      not honour. Tab must not be trapped when the page
 *                                      is reachable by mouse — otherwise keyboard users
 *                                      get strictly less access than pointer users.
 */
export function useFocusTrap({
  active,
  containerRef,
  onClose,
  closeOnEscape = true,
  initialFocus,
  lockScroll = true,
  boundaryRef,
  modal = true,
}) {
  const restoreRef = useRef(null);

  // Make everything outside the dialog inert.
  //
  // aria-modal alone is not enough: several screen readers still let browse mode
  // walk the page behind the dialog, and the Tab trap below only covers Tab — a
  // find-in-page jump or a rotor move lands outside it. Walking up from the panel
  // and inerting siblings at each level leaves exactly the dialog reachable.
  //
  // DECLARED FIRST ON PURPOSE. React runs cleanups in declaration order, and the
  // focus-restore below cannot focus an element that still has an inert ancestor —
  // focus() silently no-ops and the user lands back on <body>. Measured: closing
  // the remove-confirm left activeElement as BODY with the trigger still mounted
  // and #root still inert. Un-inert has to happen before the restore. WCAG 2.4.3.
  useEffect(() => {
    if (!active || !modal) return;
    // The boundary is usually the focus container, but a Dialog's backdrop is a
    // sibling of its panel — inerting it would kill click-to-close.
    const node = (boundaryRef || containerRef).current;
    if (!node) return;

    /* Exempt only an element that IS a live region — never one that merely
       CONTAINS one. `querySelector('[aria-live]')` used to be in this test and it
       exempted whole page containers: while a lazy route showed RouteFallback
       (App.jsx, aria-live="polite"), <main> matched and the ENTIRE page stayed
       interactive behind a modal. Measured with the search overlay open: every
       sibling inert except <main>. Toast.jsx already hit this exact failure and
       fixed its half by portalling out of #root; the clause it left behind kept
       reintroducing it for anything else that renders a live region inline.

       The contract this depends on: app-level live regions are direct children of
       <body> (Toast portals there, useAnnounce and ScrollToTop append there), so
       they are siblings at the top of this walk and `hasAttribute` reaches them.
       A live region rendered INSIDE the page is page content and is correctly
       inerted along with it. */
    const isLiveRegion = (el) => el.hasAttribute('aria-live')
      || el.getAttribute('role') === 'status' || el.getAttribute('role') === 'alert';

    const touched = [];
    for (let el = node; el && el !== document.body && el.parentElement; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.inert || sib.tagName === 'SCRIPT' || isLiveRegion(sib)) continue;
        setInert(sib, true);
        touched.push(sib);
      }
    }
    return () => touched.forEach((el) => setInert(el, false));
    // containerRef/boundaryRef are refs; intentionally not dependencies.
  }, [active, modal]);

  // Focus in / out + scroll lock.
  useEffect(() => {
    if (!active) return;

    restoreRef.current = document.activeElement;

    /* Lock the SCROLLING ELEMENT, not <body>.
       `document.body.style.overflow = 'hidden'` locked nothing: this document's
       scrollingElement is <html>, so the page went on scrolling behind every open
       modal. Measured with the media dialog open: scrollBy(0, 800) moved the page
       from 0 to 800, and content kept lazy-loading behind it while the panel sat
       still. Both elements are set because which one scrolls depends on the
       document's quirks/standards mode and on any app CSS that moves overflow to
       body — setting both is correct in either case and restores exactly what was
       there before. */
    const scroller = document.scrollingElement || document.documentElement;
    let prev;
    if (lockScroll) {
      lockCount += 1;
      prev = { scroller: scroller.style.overflow, body: document.body.style.overflow };
      scroller.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }

    const container = containerRef.current;
    const target = initialFocus?.current || container?.querySelector(FOCUSABLE) || container;
    /* focusVisible is the standards-track half; engines ignore it today, so
       ConfirmDialog carries plain focus: twins beside its focus-visible: states.
       A programmatic .focus() matches :focus but not :focus-visible, so the
       control a dialog opened onto painted no ring at all. */
    target?.focus?.({ focusVisible: true });

    return () => {
      if (lockScroll) {
        lockCount -= 1;
        // Nesting-safe: only the outermost overlay restores.
        if (lockCount === 0) {
          scroller.style.overflow = prev.scroller;
          document.body.style.overflow = prev.body;
        }
      }
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus?.();
    };
    // containerRef/initialFocus are refs; intentionally not dependencies.
  }, [active, lockScroll]);

  // Escape + Tab cycling.
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      // A non-modal panel leaves the page operable, so Tab must be able to walk
      // out of it the same way a pointer can.
      if (e.key !== 'Tab' || !modal) return;

      const container = containerRef.current;
      if (!container) return;

      const items = [...container.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (!container.contains(activeEl)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, onClose, closeOnEscape, modal]);
}
