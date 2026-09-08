/* The pieces the profile bands and the yearly review both draw with.
 *
 * Card was three byte-similar `Group` components, one per band, and the copies
 * had already drifted on padding. Swatch and Legend are new: the redesign leans
 * on the three coloured state scales to carry shelf, verdict and priority, and a
 * colour that appears in a chart has to appear again next to its name — colour is
 * never the only carrier of meaning (WCAG 1.4.1).
 */

import { useRef, useState, useEffect } from 'react';

/** A bordered box with a label-sized title and an optional closing note. */
export function Card({ title, note, children, className = '', headingId }) {
  return (
    <section className={`border border-white/15 p-4 lg:p-6 min-w-0 ${className}`} aria-labelledby={headingId}>
      {title && <h3 id={headingId} className="lh-label text-white/60 m-0 mb-3">{title}</h3>}
      {children}
      {/* Deliberately not `.lh-label`. These notes are sentences and the label
          style is an 11px uppercase 0.18em track — three lines of it is a
          barcode. The rule is already written down beside the danger row in
          YourData; it applies to every note on the page. */}
      {note && <p className="text-[13px] text-white/60 mt-4 leading-[1.6]">{note}</p>}
    </section>
  );
}

/** The 9px square the state scales are drawn as everywhere else in the app. */
export function Swatch({ color, size = 9 }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 block"
      style={{ width: size, height: size, background: color }}
    />
  );
}

/**
 * The key under a chart. Every row names its colour, so the chart above it is
 * readable without seeing colour at all.
 *
 * @param {Array<{key,label,color,count}>} items
 */
export function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 mt-4 list-none p-0 m-0">
      {items.map(i => (
        <li key={i.key ?? i.label} className="flex items-center gap-2">
          <Swatch color={i.color} />
          <span className="text-[13px] text-white/60">{i.label}</span>
          {i.count !== undefined && (
            <span className="text-[13px] text-white tabular-nums">{i.count}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A chart too wide to shrink, scrolled inside its own box rather than pushing
 * the page sideways. The dot plots need a usable pixel width per unit of scale
 * and a 320px phone cannot give it; squeezing them instead produced overlapping
 * labels, which is a worse answer than a scroll.
 */
export function ScrollX({ min = 460, children, label }) {
  /* The box hid 35 to 60 percent of the plot with a 0px scrollbar and no edge
     treatment, and the hidden side is the high end of the scale, which is where
     a well-liked library's dots land. A thin scrollbar gives it an affordance; the
     right-edge fade says there is more, and lifts once there is not. */
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [children]);
  return (
    /* `overflow-y-hidden` is not decoration. CSS says an axis set to anything but
       `visible` forces the OTHER axis from `visible` to `auto`, so `overflow-x-auto`
       alone gave every chart in here a vertical scrollbar as well — and the plots
       overflow their box by a single pixel where a dot's radius pokes past the
       edge, which was enough to render a 6px bar down the right of each one.
       Charts must not scroll vertically in any case; they are one screen tall. */
    <div
      ref={ref}
      className="overflow-x-auto overflow-y-hidden -mx-1 px-1 [scrollbar-width:thin]"
      style={more ? { maskImage: 'linear-gradient(to right, #000 calc(100% - 40px), transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 40px), transparent)' } : undefined}
      tabIndex={0} role="group" aria-label={label}
    >
      <div style={{ minWidth: min }}>{children}</div>
    </div>
  );
}
