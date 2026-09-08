import { useEffect, useRef, useCallback } from 'react';
import useSwipe from '../../hooks/useSwipe';
import { createPortal } from 'react-dom';

/**
 * Modal accessibility for LoreHaven, in two shapes:
 *
 *  - <Dialog>        for modals that fit a `fixed inset-0` positioning layer.
 *  - useFocusTrap()  for overlays with bespoke positioning that Dialog cannot
 *                    express — SearchOverlay and the Wallpapers drawer/lightbox
 *                    each pin themselves with custom top/height offsets
 *                    (titlebar + safe-area CSS vars) and a lg:left-[220px] inset.
 *
 * Both share ONE trap implementation, so behaviour cannot drift between them.
 *
 * Covers WCAG 4.1.2 (name/role/value), 2.1.2 (no keyboard trap — you can always
 * Escape out), and 2.4.3 (focus order).
 */

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

/**
 * Dialog — centered (or aligned) modal.
 *
 * Props:
 *  open              {boolean} — render gate
 *  onClose           {fn}      — Escape, backdrop click, close buttons
 *  label             {string}  — accessible name via aria-label
 *  labelledBy        {string}  — id of a heading; wins over `label`
 *  describedBy       {string}  — id of the body text, announced after the name
 *  z                 {number}  — z-index (match the value being replaced)
 *  alignClassName    {string}  — flex alignment, e.g. "items-end" for a sheet
 *  panelClassName    {string}  — panel box classes ("max-w-md", "max-h-[90vh]")
 *  className         {string}  — extra classes on the positioning layer
 *  backdropClassName {string}  — default "bg-black/75"
 *  backdropStyle     {object}  — inline backdrop style (blur, custom alpha)
 *  panelStyle        {object}  — inline panel style
 *  closeOnBackdrop   {boolean} — default true
 *  closeOnEscape     {boolean} — default true
 *  initialFocus      {ref}     — element to focus on open
 */
export default function Dialog({
  open,
  onClose,
  label,
  labelledBy,
  describedBy,
  z = 3000,
  alignClassName = 'items-center justify-center',
  panelClassName = 'w-full max-w-md',
  className = 'p-4',
  backdropClassName = 'bg-black/75',
  backdropStyle,
  panelStyle,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocus,
  children,
}) {
  const panelRef = useRef(null);

  /* Drag the panel down to dismiss — the same outcome as Escape, so it goes
     through onClose and the focus trap restores focus exactly as it always did.
     Two things gate it, and both matter more than the gesture itself:

     1. Coarse pointers only. On a mouse, press-and-drag inside a dialog is how
        you select text, and stealing that to fling the dialog away would break
        an ordinary desktop action to add a mobile one.
     2. Only when the content under the finger is scrolled to the top. A dialog
        with a scrollable body must scroll first; a drag-to-close that outranks
        scrolling makes long dialogs unreadable on exactly the devices this is
        for. */
  const canDragToDismiss = useCallback((e) => {
    if (!closeOnBackdrop) return false;          // a dialog you must answer stays put
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
    for (let el = e.target; el && el !== panelRef.current?.parentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return false;
    }
    return true;
  }, [closeOnBackdrop]);

  const rawDragDown = useSwipe({
    axis: 'y',
    threshold: 96,
    onMove: (dy, dragging) => {
      const el = panelRef.current;
      if (!el) return;
      if (!dragging) {
        el.style.transition = 'transform 220ms cubic-bezier(0.23, 1, 0.32, 1)';
        el.style.transform = '';
        return;
      }
      // Upward has nowhere to go, so it resists rather than following.
      el.style.transition = 'none';
      el.style.transform = `translate3d(0, ${dy > 0 ? dy : dy * 0.2}px, 0)`;
    },
    onSwipe: (dir) => {
      const el = panelRef.current;
      if (dir !== 'down') { if (el) { el.style.transition = 'transform 220ms cubic-bezier(0.23, 1, 0.32, 1)'; el.style.transform = ''; } return; }
      if (el) {
        el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
        el.style.transform = 'translate3d(0, 60vh, 0)';
        el.style.opacity = '0';
      }
      setTimeout(() => onClose?.(), 180);
    },
  });

  const dragDown = {
    ...rawDragDown,
    onPointerDown: (e) => { if (canDragToDismiss(e)) rawDragDown.onPointerDown?.(e); },
  };
  const rootRef = useRef(null);

  useFocusTrap({
    active: !!open,
    containerRef: panelRef,
    boundaryRef: rootRef,
    onClose,
    closeOnEscape,
    initialFocus,
  });

  if (!open) return null;

  /* Portalled to <body>: a `fixed` overlay is positioned against the nearest
     ancestor with a transform/filter, not the viewport, and the game grid carries
     an entrance transform. A dialog opened from a card inside it would have been
     laid out against the grid. Portalling also makes the inert walk below a
     single level instead of climbing the whole page tree. */
  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 flex ${alignClassName} ${className}`}
      style={{ zIndex: z }}
    >
      {/* Backdrop. A plain div, not a button: the dialog already exposes a close
          control, and a full-screen button adds a confusing extra tab stop. */}
      <div
        className={`absolute inset-0 ${backdropClassName}`}
        style={backdropStyle}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        /* Every dialog in the app named itself and then said nothing about what
           it was for: the body sat in the panel with no association, so a screen
           reader announced "Clear your entire library?, dialog" and left the
           sentence explaining what that destroys to be discovered by arrowing.
           Callers pass the id of their body element. */
        aria-describedby={describedBy}
        tabIndex={-1}
        {...dragDown}
        /* `dialog-in` scales the panel in from 0.96 rather than cross-fading it;
           see the keyframe in index.css for why it uses a `backwards` fill and
           must never use `both`.

           Skipped when the caller brings its own entrance — the wallpaper sheets
           pass `animate-in slide-in-from-bottom-4` (Wallpapers.jsx:1569, 1850)
           and two animation-name declarations on one element would fight, with
           stylesheet order deciding rather than intent.

           Note the `duration-200` this replaces was inert: Tailwind's duration-*
           sets transition-duration, which does nothing for an animation, so the
           old entrance actually ran at `.animate-in`'s 300ms. */
        /* A black panel on a black page had no surface of its own: the 75% black
           scrim cannot darken #000, so the 1px border was the whole depth cue.
           A near-black ground plus a deep shadow separates the panel; the scrim
           needs no change. */
        className={`relative bg-neutral-950 border border-white/25 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_64px_rgba(0,0,0,0.9)] outline-none ${
          panelClassName.includes('animate-in') ? '' : 'dialog-in'
        } ${panelClassName}`}
        style={{ ...panelStyle, ...dragDown.style }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
