import { Link } from 'react-router-dom';

/* Small editorial primitives the game page's sections share. */

export function SectionHeader({ children, id, aside }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 id={id} className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">{children}</h2>
      <div className="flex-1 h-px bg-white/15" />
      {aside}
    </div>
  );
}

export function IndexRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-6 px-3 py-2.5 border-t first:border-t-0 border-white/10">
      <span className="lh-label text-white/60 shrink-0">{label}</span>
      <span className="text-sm text-white text-right min-w-0">{value}</span>
    </div>
  );
}

/* Index row whose values link out — genres, companies, franchises, events… */
export function IndexLinks({ label, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-6 px-3 py-2.5 border-t first:border-t-0 border-white/10">
      <span className="lh-label text-white/60 shrink-0">{label}</span>
      <span className="text-sm text-right min-w-0">
        {items.map((it, i) => (
          <span key={`${it.id ?? it.label}-${i}`}>
            {i > 0 && <span className="text-white/50"> · </span>}
            {/* p-1 -m-1 lifts the hit box from 18px to 26px in BOTH axes (WCAG 2.5.8)
                without moving the row: padding on an inline box grows the target and
                the hover fill, and the negative margin cancels the layout effect.
                Both axes are needed — short platform abbreviations like "PC" were
                18px WIDE, so vertical padding alone still failed. */}
            <TagLink to={it.to}>{it.label}</TagLink>
          </span>
        ))}
      </span>
    </div>
  );
}

export function TagLink({ to, children }) {
  return (
    <Link
      to={to}
      className="text-white underline decoration-white/30 underline-offset-4 p-1 -m-1 hover:bg-white hover:text-black hover:decoration-transparent focus-visible:bg-white focus-visible:text-black focus-visible:decoration-transparent focus-visible:outline-none transition-colors"
    >
      {children}
    </Link>
  );
}

/* A one-line fact under the figures: a label and a sentence. Used for the shelf
   and queue lines, which are statements rather than numbers. */
export function Line({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex items-baseline gap-4 px-3 py-2.5 border-t first:border-t-0 border-white/10">
      <span className="lh-label text-white/60 shrink-0 w-24">{label}</span>
      <span className="text-sm text-white min-w-0">{children}</span>
    </div>
  );
}
