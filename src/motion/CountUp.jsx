import { useLayoutEffect, useRef } from 'react';
import { reducedMotion } from './motion';

/* A figure that counts up from zero the first time its page is shown in a
 * session (spec 3.2: numbers only, 600ms, no replay). Written straight to the
 * DOM each frame, not through React state, so a page full of figures costs
 * one text write per figure per frame and no re-renders. Reduced motion, a
 * revisit, or a value that is not a positive number show the final value. */
const DURATION = 600;

export default function CountUp({ value, format = String }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !Number.isFinite(value) || value <= 0) return undefined;
    const key = `lh_counted:${window.location.pathname}`;
    try { if (sessionStorage.getItem(key)) return undefined; } catch { /* count anyway */ }
    let start = null;
    let frame = 0;
    const step = (t) => {
      if (start === null) start = t;
      const k = Math.min(1, (t - start) / DURATION);
      const eased = 1 - (1 - k) ** 3;
      el.textContent = format(Math.round(value * eased));
      if (k < 1) frame = requestAnimationFrame(step);
      else { try { sessionStorage.setItem(key, '1'); } catch { /* fine */ } }
    };
    el.textContent = format(0);
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); el.textContent = format(value); };
  }, [value, format]);
  return <span ref={ref}>{format(value)}</span>;
}
