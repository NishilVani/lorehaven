/* Editorial group header - label, count, hairline.
 *
 * Split out of GameGridControls so that module exports only its hook: a file
 * that exports a component and a hook together loses fast refresh.
 */
export function GroupHeader({ label, count }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">{label}</h2>
      <span className="lh-label text-white/60 tabular-nums">{count}</span>
      <div className="flex-1 self-center h-px bg-white/15" />
    </div>
  );
}
