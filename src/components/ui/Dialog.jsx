import { useRef, useCallback } from 'react';
import { reducedMotion } from '../../motion/motion';
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

import { useFocusTrap } from './useFocusTrap';

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
  const backdropRef = useRef(null);
  /* Closing the dialog's own ways (Escape, the backdrop) plays the exit first:
     the panel sinks as both fade, 180ms. A caller that unmounts the dialog
     itself closes it at once. */
  const closing = useRef(false);
  const requestClose = useCallback(() => {
    if (closing.current) return;
    const panel = panelRef.current;
    if (!panel || reducedMotion()) { onClose?.(); return; }
    closing.current = true;
    const ease = 'cubic-bezier(0.4, 0, 1, 1)';
    panel.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 8px' }], { duration: 180, easing: ease, fill: 'forwards' });
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: ease, fill: 'forwards' });
    setTimeout(() => { closing.current = false; onClose?.(); }, 170);
  }, [onClose]);

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
    onClose: requestClose,
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
        ref={backdropRef}
        className={`absolute inset-0 m-dialog-backdrop ${backdropClassName}`}
        style={backdropStyle}
        onClick={closeOnBackdrop ? requestClose : undefined}
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
        /* `m-dialog-panel` (motion/elements.css): the panel rises in after the
           scrim. Its fill is `backwards`, never `both`: drag-to-dismiss writes
           `transform` inline and a held animation would override it.

           Skipped when the caller brings its own sheet entrance (`m-sheet`):
           two animation-name declarations on one element would fight, with
           stylesheet order deciding rather than intent. */
        /* A black panel on a black page had no surface of its own: the 75% black
           scrim cannot darken #000, so the 1px border was the whole depth cue.
           A near-black ground plus a deep shadow separates the panel; the scrim
           needs no change. */
        className={`relative bg-neutral-950 border border-white/25 shadow-(--lh-panel-shadow) outline-none ${
          /\bm-sheet\b/.test(panelClassName) ? '' : 'm-dialog-panel'
        } ${panelClassName}`}
        style={{ ...panelStyle, ...dragDown.style }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
