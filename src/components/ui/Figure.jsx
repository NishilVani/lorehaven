/* A figure: label, a value at display size, a caption that says what it means.
   Moved out of the profile's LibraryNumbers so the game page can state its
   numbers the same way.

   `pending` is the case where the figure has no basis at all — not a small
   number, an absent one. It renders a statement instead of the value, which is
   the No-Zero Rule in DESIGN.md: a library of one game printed "0 h" and "0%"
   at 72px about someone who had not yet committed to anything. The caption
   below it does the explaining, and it leads with what would fill the card.

   `size`: 'lg' is the profile's hero figure, 'md' the profile default, 'sm' the
   game page, where three or four sit in one row beside a poster. `children`
   replaces the value slot for a figure whose value is a control (the
   completion date) or a coloured state (your rating). */
const VALUE = {
  lg: 'text-5xl lg:text-7xl',
  md: 'text-4xl lg:text-5xl',
  sm: 'text-3xl lg:text-4xl',
};
const UNIT = {
  lg: 'text-3xl lg:text-5xl',
  md: 'text-2xl lg:text-3xl',
  sm: 'text-xl lg:text-2xl',
};

export default function Figure({ label, value, unit, detail, className = '', big, size, pending, pendingText = 'Not enough data', children }) {
  const s = size || (big ? 'lg' : 'md');
  return (
    <div className={`border border-white/15 min-w-0 ${s === 'sm' ? 'p-4' : 'p-4 lg:p-6'} ${className}`}>
      <div className="lh-label text-white/60">{label}</div>
      {children ? (
        <div className="mt-3">{children}</div>
      ) : (
        <div className={`lh-display text-white leading-none tabular-nums mt-3 ${VALUE[s]}`}>
          {pending ? <span className="lh-label text-white/60">{pendingText}</span> : value}
          {!pending && unit && <span className={`text-white/60 ${UNIT[s]}`}> {unit}</span>}
        </div>
      )}
      {detail && <p className={`text-[13px] text-white/60 m-0 leading-[1.6] ${s === 'sm' ? 'mt-3' : 'mt-4'}`}>{detail}</p>}
    </div>
  );
}
