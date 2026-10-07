/* FLIP: items glide to their new places when a list re-orders in place
 * (sort, group, filter in a library shelf; search results re-ranking).
 *
 * After every commit the hook records where each [data-flip-id] child sits,
 * relative to the container (so scrolling between commits does not count as
 * movement). When `trigger` changes, it compares the new positions with the
 * last recorded ones and plays each moved item from its old place to its new
 * one on `translate`, 280ms on the carry curve. New items fade in. Items that
 * left are already gone; the rest closing the gap is the visible part.
 *
 * Only on-screen items animate, at most 60, so a long shelf costs the same as
 * a short one. Reduced motion skips it. */
import { useLayoutEffect, useRef } from 'react';
import { reducedMotion } from './motion';

const MAX_ANIMATED = 60;

function measure(container) {
  const base = container.getBoundingClientRect();
  const out = new Map();
  for (const el of container.querySelectorAll('[data-flip-id]')) {
    const r = el.getBoundingClientRect();
    out.set(el.getAttribute('data-flip-id'), { x: r.left - base.left, y: r.top - base.top, el, onScreen: r.bottom > 0 && r.top < window.innerHeight });
  }
  return out;
}

export function useFlip(containerRef, trigger) {
  const last = useRef(null);
  const lastTrigger = useRef(trigger);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const now = measure(container);
    const before = last.current;
    const changed = lastTrigger.current !== trigger;
    last.current = now;
    lastTrigger.current = trigger;
    if (!changed || !before || reducedMotion()) return;
    let n = 0;
    for (const [id, p] of now) {
      if (!p.onScreen || n >= MAX_ANIMATED) continue;
      const prev = before.get(id);
      if (!prev) {
        p.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
        n += 1;
        continue;
      }
      const dx = prev.x - p.x;
      const dy = prev.y - p.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      p.el.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
        { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      n += 1;
    }
  });
}
