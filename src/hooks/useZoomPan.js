import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useZoomPan — continuous zoom and pan for a single piece of media.
 *
 * Replaces a boolean `zoomed` that snapped between scale(1) and scale(2). A
 * toggle is not zoom: it picks one magnification you did not choose, anchors it
 * at the centre of the image whatever you were looking at, and gives you no way
 * to reach the corners. Every real photo viewer is continuous and anchored, and
 * both of the gestures people already know — pinch, and ctrl+wheel — are
 * continuous by nature. A discrete toggle cannot be driven by either.
 *
 * The two gestures are the same event on the desktop. A trackpad pinch is
 * delivered as a `wheel` event with `ctrlKey` set, which is exactly what a
 * ctrl+scroll produces, so one handler serves both and neither needs sniffing
 * for a trackpad.
 *
 * Anchoring is the part that is easy to get wrong. Scaling about the element's
 * centre makes the thing under your fingers slide away as you pinch. Keeping the
 * content point under the pinch midpoint (or the cursor) fixed is what makes the
 * gesture feel attached to the picture:
 *
 *     p = t + s·c        (container-centre coords → content coords)
 *     c  fixed  ⇒  t' = p − (s'/s)·(p − t)
 *
 * Panning is clamped so the media can never be flung out of view: at scale s the
 * translation is bounded by half the overhang, (size·(s−1))/2.
 *
 * Pointer Events throughout, matching `useSwipe`, so a finger, a pen and a mouse
 * take one path. Wheel is bound natively rather than through React's onWheel:
 * React attaches `wheel` at the root as a passive listener, and a passive
 * listener cannot call preventDefault — without which ctrl+scroll zooms the
 * whole browser page instead of the picture.
 *
 * @param {object}  o
 * @param {boolean} o.enabled
 * @param {number}  o.min          floor scale; reaching it snaps back to rest
 * @param {number}  o.max          ceiling scale
 * @param {number}  o.tapScale     what a double tap / double click zooms to
 * @param {fn}      o.onDoubleTap  (isZoomedIn) => void, after a double tap
 * @param {object}  o.contentRef   ref to the media element; one is made if absent
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A second tap later or further away than this is a new first tap.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
// Movement above this makes a pointer sequence a drag, so it must not also read
// as a tap. Matches useSwipe's AXIS_LOCK_SLOP.
const TAP_SLOP = 8;
// Below this the zoom is close enough to rest that holding it would leave the
// media a hair off-centre with no way to feel the difference.
const REST_EPSILON = 1.02;

export default function useZoomPan({
  enabled = true,
  min = 1,
  max = 4,
  tapScale = 2.5,
  onDoubleTap,
  contentRef: externalContentRef,
} = {}) {
  /* A callback ref backed by state, not a plain useRef. The wheel listener has
     to be bound natively (React's onWheel is passive and cannot preventDefault),
     and an effect keyed on a plain ref never re-runs when the node appears — the
     hook is called by the page, whose container only exists once the viewer
     opens, so the effect fired once against null and never again. Measured: a
     ctrl+wheel dispatched at the stage came back defaultPrevented=false, i.e.
     no listener at all. The element in state gives the effect something that
     actually changes. */
  const containerElRef = useRef(null);
  const [containerEl, setContainerEl] = useState(null);
  const containerRef = useCallback((node) => {
    containerElRef.current = node;
    setContainerEl(node);
  }, []);
  const ownContentRef = useRef(null);
  const contentRef = externalContentRef || ownContentRef;

  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  /* The pointer math reads the transform mid-gesture, several times per frame,
     and must see the value it just wrote rather than the one React will render
     next. Written only alongside setT, never during render — a render-phase
     ref write is exactly the kind of tearing this ref exists to avoid. */
  const tRef = useRef({ s: 1, x: 0, y: 0 });

  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const pan = useRef(null);
  const tap = useRef({ t: 0, x: 0, y: 0 });
  const down = useRef(null);
  const swallow = useRef(false);
  const [gesturing, setGesturing] = useState(false);

  const apply = useCallback((s, x, y) => {
    const ns = clamp(s, min, max);
    const el = contentRef.current;
    // Half the overhang in each axis; zero at rest, so the media stays centred.
    const mx = el ? (el.offsetWidth * (ns - 1)) / 2 : 0;
    const my = el ? (el.offsetHeight * (ns - 1)) / 2 : 0;
    const next = { s: ns, x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
    tRef.current = next;
    setT(next);
  }, [min, max, contentRef]);

  const reset = useCallback(() => {
    tRef.current = { s: 1, x: 0, y: 0 };
    setT(tRef.current);
  }, []);

  /** Container-centre coordinates for a client point. */
  const local = useCallback((cx, cy) => {
    const r = containerElRef.current?.getBoundingClientRect();
    if (!r) return { px: 0, py: 0 };
    return { px: cx - (r.left + r.width / 2), py: cy - (r.top + r.height / 2) };
  }, []);

  /** Scale to `ns` while pinning the content point under (px, py). */
  const zoomAbout = useCallback((ns, px, py) => {
    const cur = tRef.current;
    const k = clamp(ns, min, max) / cur.s;
    apply(cur.s * k, px - k * (px - cur.x), py - k * (py - cur.y));
  }, [apply, min, max]);

  // ── ctrl+wheel, which is also how a trackpad reports a pinch ──
  useEffect(() => {
    const el = containerEl;
    if (!el || !enabled) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;              // a plain scroll is not ours to take
      e.preventDefault();                  // or the browser zooms its own page
      const { px, py } = local(e.clientX, e.clientY);
      /* Exponential, so a given wheel distance is the same proportional zoom
         wherever you already are — linear steps crawl when zoomed in and jump
         when zoomed out. */
      zoomAbout(tRef.current.s * Math.exp(-e.deltaY / 300), px, py);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerEl, enabled, local, zoomAbout]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    /* Controls layered over the media keep their own pointers. Capturing here
       retargets the pointerup, which moves the click to this element and the
       nested control never fires: while zoomed, the lightbox's prev/next arrows
       simply stopped working, because they sit inside the stage. */
    if (e.target?.closest?.('button, a, input, select, textarea, [role="button"]')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current = {
        d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        s0: tRef.current.s,
        m0: m,
        t0: { x: tRef.current.x, y: tRef.current.y },
      };
      pan.current = null;
      down.current = null;
      swallow.current = true;
      setGesturing(true);
    } else if (pointers.current.size === 1) {
      down.current = { x: e.clientX, y: e.clientY, moved: false };
      if (tRef.current.s > 1) {
        pan.current = { x0: e.clientX, y0: e.clientY, tx0: tRef.current.x, ty0: tRef.current.y };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        setGesturing(true);
      }
    }
  }, [enabled, local]);

  const onPointerMove = useCallback((e) => {
    if (!enabled) return;
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;

    if (down.current && !down.current.moved
      && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > TAP_SLOP) {
      down.current.moved = true;
    }

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const { d0, s0, m0, t0 } = pinch.current;
      const ns = clamp(s0 * (d / d0), min, max);
      const k = ns / s0;
      /* Anchored at the midpoint the pinch started from, then carried by however
         far that midpoint has since travelled — so two fingers zoom and pan in
         one motion, the way they do everywhere else. */
      apply(ns,
        m0.px - k * (m0.px - t0.x) + (m.px - m0.px),
        m0.py - k * (m0.py - t0.y) + (m.py - m0.py));
      return;
    }

    if (pan.current) {
      swallow.current = true;
      apply(tRef.current.s,
        pan.current.tx0 + (e.clientX - pan.current.x0),
        pan.current.ty0 + (e.clientY - pan.current.y0));
    }
  }, [enabled, local, apply, min, max]);

  const endPointer = useCallback((e, cancelled) => {
    const had = pointers.current.delete(e.pointerId);
    if (!had) return;

    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 1 && tRef.current.s > 1) {
      // Lifting one finger of a pinch hands the gesture to the other as a pan.
      const [only] = [...pointers.current.values()];
      pan.current = { x0: only.x, y0: only.y, tx0: tRef.current.x, ty0: tRef.current.y };
    } else if (pointers.current.size === 0) {
      /* `!pan.current` used to be part of this test, which meant a tap while
         zoomed never counted — the pointerdown arms a pan before anyone knows
         whether the finger will move, so double-tap-to-zoom-out could not fire.
         Movement is what separates a tap from a drag, and `moved` already
         carries it. */
      const wasTap = !cancelled && down.current && !down.current.moved;
      pan.current = null;
      setGesturing(false);

      if (wasTap) {
        const now = e.timeStamp || Date.now();
        const near = Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) < DOUBLE_TAP_SLOP;
        if (now - tap.current.t < DOUBLE_TAP_MS && near) {
          tap.current = { t: 0, x: 0, y: 0 };
          swallow.current = true;
          const zoomIn = tRef.current.s <= REST_EPSILON;
          if (zoomIn) {
            const { px, py } = local(e.clientX, e.clientY);
            zoomAbout(tapScale, px, py);
          } else {
            reset();
          }
          onDoubleTap?.(zoomIn);
        } else {
          tap.current = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      down.current = null;

      // Pinched back to nothing: settle exactly at rest rather than near it.
      if (tRef.current.s <= REST_EPSILON && (tRef.current.s !== 1 || tRef.current.x || tRef.current.y)) reset();
    }
  }, [local, zoomAbout, reset, tapScale, onDoubleTap]);

  const onPointerUp = useCallback((e) => endPointer(e, false), [endPointer]);
  const onPointerCancel = useCallback((e) => endPointer(e, true), [endPointer]);

  /* True once, for the click that closes out a gesture. Without it the tap that
     ends a pinch or a pan also fires whatever the stage does on click. */
  const consumeClick = useCallback(() => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  }, []);

  const zoomed = t.s > REST_EPSILON;

  return {
    containerRef,
    contentRef,
    scale: t.s,
    x: t.x,
    y: t.y,
    zoomed,
    gesturing,
    reset,
    consumeClick,
    /** Spread onto the element that owns the gesture area. */
    /* No onDoubleClick: pointer events already deliver a mouse, so the tap
       detector below covers double-click and double-tap in one path. */
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    /** `transform` plus the transition that must not fight a live finger. */
    style: {
      transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`,
      transition: gesturing ? 'none' : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: zoomed || gesturing ? 'transform' : 'auto',
    },
  };
}
