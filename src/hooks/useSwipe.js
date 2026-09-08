import { useRef, useCallback } from 'react';

/**
 * useSwipe — one gesture implementation for the whole app.
 *
 * Before this there was no gesture layer at all: a single `onTouchStart` in
 * GameCard whose only job was to BLOCK dragging, and a bare `touchStartX` in the
 * wallpaper lightbox. Anything touch-shaped had to be reinvented, so it wasn't.
 *
 * Pointer Events rather than touch events, so a mouse, a pen and a finger all
 * take the same path and the desktop can be tested without emulation.
 *
 * What it handles that a naive `touchend - touchstart` does not:
 *
 *  - **Velocity.** A short fast flick commits. Requiring distance alone forces
 *    people to drag the full width of a phone before anything happens.
 *  - **Axis lock.** The dominant axis is decided on the first real movement and
 *    held for the rest of the gesture, so a horizontal handler can never eat a
 *    vertical scroll — the single most common way swipe UIs break a page.
 *  - **Pointer capture.** Once a drag starts, events keep coming even if the
 *    finger leaves the element. Without it a fast swipe simply stops halfway.
 *  - **Multi-touch.** Additional pointers are ignored while one is active.
 *    Otherwise putting a second finger down makes the element jump.
 *
 * Movement is reported through `onMove` so the caller can follow the finger with
 * a transform. It deliberately does NOT write styles itself — a toast, a sheet
 * and a card all want to move differently.
 *
 * @param {object}   o
 * @param {'x'|'y'}  o.axis        which direction this gesture cares about
 * @param {fn}       o.onSwipe     ('left'|'right'|'up'|'down') => void, on commit
 * @param {fn}       o.onMove      (delta, isDragging) => void, live offset in px
 * @param {fn}       o.onCancel    called when a started gesture ends uncommitted
 * @param {number}   o.threshold   px that always commits, regardless of speed
 * @param {boolean}  o.enabled
 */

// px/ms. A flick this fast commits at any distance — Sonner's number, and it
// matches what a hand actually does when it means "get rid of this".
const VELOCITY_COMMIT = 0.11;
// Movement below this is a tap, not a drag, and must not steal the click.
const AXIS_LOCK_SLOP = 8;

export default function useSwipe({
  axis = 'x',
  onSwipe,
  onMove,
  onCancel,
  threshold = 60,
  enabled = true,
} = {}) {
  const st = useRef({ id: null, x0: 0, y0: 0, t0: 0, locked: null, dragging: false });

  const finish = useCallback((commitDir) => {
    const s = st.current;
    s.id = null; s.locked = null; s.dragging = false;
    onMove?.(0, false);
    if (commitDir) onSwipe?.(commitDir);
    else onCancel?.();
  }, [onMove, onSwipe, onCancel]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    // One pointer at a time. A second finger mid-drag would otherwise retarget.
    if (st.current.id !== null) return;
    // Ignore secondary mouse buttons; a right-click is not a swipe.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, locked: null, dragging: false };
  }, [enabled]);

  const onPointerMove = useCallback((e) => {
    const s = st.current;
    if (s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;

    if (!s.locked) {
      if (Math.abs(dx) < AXIS_LOCK_SLOP && Math.abs(dy) < AXIS_LOCK_SLOP) return;
      s.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      /* Locked to the other axis: this gesture is a scroll, so let go of it
         entirely rather than half-tracking it. */
      if (s.locked !== axis) { st.current.id = null; return; }
      s.dragging = true;
      /* Captured only once the axis is ours, so a vertical scroll that starts on
         this element is never stolen. */
      /* Guarded: the optional call only checks the method exists, and the
         throw here is InvalidPointerId — the pointer was released between the
         event being queued and this handler running. A fast tap on a slow frame
         does it, and an uncaught throw takes the rest of the gesture chain with
         it. Losing capture degrades the swipe; losing the handler breaks it. */
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    }

    onMove?.(axis === 'x' ? dx : dy, true);
  }, [axis, onMove]);

  const onPointerUp = useCallback((e) => {
    const s = st.current;
    if (s.id !== e.pointerId) return;
    if (!s.dragging) { st.current.id = null; return; }

    const delta = axis === 'x' ? e.clientX - s.x0 : e.clientY - s.y0;
    const elapsed = Math.max(1, e.timeStamp - s.t0);
    const velocity = Math.abs(delta) / elapsed;

    const commits = Math.abs(delta) >= threshold || velocity > VELOCITY_COMMIT;
    if (!commits) return finish(null);
    finish(axis === 'x' ? (delta < 0 ? 'left' : 'right') : (delta < 0 ? 'up' : 'down'));
  }, [axis, threshold, finish]);

  const onPointerCancel = useCallback((e) => {
    if (st.current.id !== e.pointerId) return;
    finish(null);
  }, [finish]);

  /* Disabling mid-gesture unmounts the handlers, so the pointerup that would
     have cleared the tracked pointer never arrives — and a stale id makes every
     later gesture bail at the one-pointer-at-a-time check. The library grid does
     exactly this: a long press arms the shelf swipe and then lifts a card, which
     disables the swipe. Without this reset, one lift kills swiping for good —
     measured: control swipe reaches /wishlist, post-lift swipe stays put. */
  if (!enabled) { st.current.id = null; return {}; }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    /* Tell the browser which direction it may still scroll. Without this it
       claims the gesture before a single event reaches us. */
    style: { touchAction: axis === 'x' ? 'pan-y' : 'pan-x' },
  };
}
