import { ArrowUpRight } from 'lucide-react';
import MarqueeText from '../ui/MarqueeText';
import ExternalLink from '../ui/ExternalLink';
import { getBrandSwatch, getPlatformLogoUrl, getShortPlatformName, inkFilter } from './platformLogoUtils';

/* One pill for every platform the app shows: hardware, stores and subscriptions,
 * on the game page, on Manage Platforms and in the import wizard.
 *
 * Left to right: the brand tile, the name, a detail (the platforms a store
 * covers, or a subtitle), trailing actions, and an arrow when there is a store to
 * open. The name, the actions and the arrow are siblings, never nested, so each
 * keeps its own role (DESIGN.md: Two Actions, Two Buttons).
 *
 * Selected fills with the brand swatch. A white border appears on hover only, on
 * selected and unselected pills alike; a selected pill keeps a transparent border
 * at rest so hovering does not shift it. The owned state therefore rests on the
 * fill, with aria-pressed for assistive tech. That is a deliberate choice with a
 * known cost: Steam, GOG, Epic and Oculus fills sit within 1.5:1 of the black
 * page, so on those four the owned state is subtle. A separate owned mark was
 * tried and dropped: a check read as a checkbox. The pill stays one line: a name
 * or detail that does not fit ellipsises and scrolls on hover.
 *
 * No tooltip. The name is already on the pill, so a box repeating it on every
 * hover was noise, and a row of pills popped one per pill as the pointer crossed
 * them. The toggle's accessible name carries the full label. */

export function PlatformPill({
  platform,
  name,
  brand,
  iconUrl,
  isSelected = false,
  onClick,
  toggleLabel,
  detail,
  subtitle = null,
  showType = false,
  href,
  linkLabel,
  isFullWidth = false,
  className = '',
  children,
}) {
  const logoUrl = iconUrl !== undefined ? iconUrl : getPlatformLogoUrl(platform);
  const swatch = getBrandSwatch(brand || logoUrl);
  const label = name || getShortPlatformName(platform);
  const secondary = detail || subtitle || (showType ? (platform?.typeLabel || platform?.category || 'Hardware') : null);
  const selected = !!isSelected;

  const body = (
    <>
      <span className="min-w-0 shrink">
        <MarqueeText text={label} className="lh-label" showTitle={false} />
      </span>
      {secondary && (
        <span className={`ml-auto min-w-0 shrink text-xs ${selected ? '' : 'text-white/60'}`}>
          <MarqueeText text={secondary} showTitle={false} />
        </span>
      )}
    </>
  );
  const bodyClass = `flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left ${selected ? '' : 'text-white'}`;

  return (
    <div
      className={`platform-pill flex items-stretch min-h-9 border transition-colors hover:border-white ${isFullWidth ? 'w-full' : 'max-w-full'} ${selected ? 'border-transparent' : 'border-white/15'} ${className}`}
      style={selected ? { backgroundColor: swatch.fill, color: swatch.ink } : undefined}
    >
      <span aria-hidden="true" className="w-9 shrink-0 flex items-center justify-center" style={{ backgroundColor: swatch.fill }}>
        {logoUrl && (
          <img src={logoUrl} alt="" className="w-5 h-5 object-contain" style={{ filter: inkFilter(swatch.ink) }} />
        )}
      </span>

      {onClick ? (
        /* role="button" is redundant on a <button>, and deliberate:
           tests/phase4-deep.spec.ts finds Manage Platforms' pills by
           [role="button"][aria-pressed]. */
        <button
          type="button"
          role="button"
          onClick={() => onClick(platform)}
          aria-pressed={selected}
          aria-label={toggleLabel}
          className={`tap-block ${bodyClass} cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current`}
        >
          {body}
        </button>
      ) : (
        <div className={bodyClass}>{body}</div>
      )}

      {children && <div className="flex items-center shrink-0 pr-1.5">{children}</div>}

      {href && (
        <ExternalLink
          href={href}
          aria-label={linkLabel}
          className={`tap-block shrink-0 flex items-center justify-center min-w-11 px-3 border-l transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current ${selected ? 'border-current' : 'border-white/15 text-white/60'}`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </ExternalLink>
      )}
    </div>
  );
}

export default PlatformPill;
