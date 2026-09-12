import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { PlatformLogo } from '../platforms/PlatformLogo';
import { getBrandSwatch, getPlatformLogoUrl, getShortPlatformName, inkFilter, inverseInk } from '../platforms/platformLogoUtils';
import { platKey } from '../../services/platformMatch';
import { buildPlatformArea } from '../../services/gameLinks';
import ExternalLink from '../ui/ExternalLink';

/* The platforms area of the game page: where the game runs, where it can be
 * bought, and where you own it.
 *
 * A control you own fills with its brand colour. The fill never carries that on
 * its own: Steam, GOG, Epic and Oculus sit within 1.5:1 of the black page, so an
 * owned control also takes a solid white border and the Yours tag. What goes
 * where is decided in services/gameLinks.js; this file only draws it. */

/* A solid block in the swatch's ink, not an outline: it reads on every fill. */
function YoursTag({ ink }) {
  return (
    <span
      className="lh-label shrink-0 px-1 py-0.5 pointer-events-none"
      style={{ backgroundColor: ink, color: inverseInk(ink) }}
    >
      Yours
    </span>
  );
}

function OwnershipPill({ plat, active, onToggle }) {
  const swatch = getBrandSwatch(getPlatformLogoUrl(plat));
  const name = getShortPlatformName(plat);
  return (
    <button
      type="button"
      onClick={() => onToggle(plat)}
      title={plat.name}
      aria-pressed={active}
      aria-label={`${active ? 'Unmark' : 'Mark'} ${name} as yours`}
      className={`tap-block flex items-center gap-1.5 border px-2 py-1.5 lh-label transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${active
        ? 'border-white'
        : 'border-white/15 text-white/60 hover:border-white hover:text-white'
        }`}
      style={active ? { backgroundColor: swatch.fill, color: swatch.ink } : undefined}
    >
      <PlatformLogo platform={plat} className="w-4 h-4 p-[2px]" disableTooltip />
      <span className="pointer-events-none">{name}</span>
      {active && <YoursTag ink={swatch.ink} />}
    </button>
  );
}

/* Two sibling controls in one outline: the name records ownership, the arrow
   opens the store. Never one inside the other (DESIGN.md: Two Actions, Two
   Buttons). */
function StoreRow({ row, active, onToggle }) {
  const swatch = getBrandSwatch(row.brand);
  return (
    <div
      className={`flex items-stretch border transition-colors ${active ? 'border-white' : 'border-white/15'}`}
      style={active ? { backgroundColor: swatch.fill, color: swatch.ink } : undefined}
    >
      <span aria-hidden="true" className="w-9 shrink-0 flex items-center justify-center" style={{ backgroundColor: swatch.fill }}>
        {row.iconUrl && (
          <img src={row.iconUrl} alt="" className="w-5 h-5 object-contain" style={{ filter: inkFilter(swatch.ink) }} />
        )}
      </span>
      <button
        type="button"
        onClick={() => onToggle(row.platform)}
        aria-pressed={active}
        aria-label={`${active ? 'Unmark' : 'Mark'} ${row.name} as yours`}
        /* Wraps rather than truncates. On a phone "Microsoft Store" and
           "Series X|S, XONE" do not fit one line together, and a clipped store
           name is worse than a second line: the covers list drops below. */
        className={`tap-block flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current ${active ? '' : 'text-white hover:bg-white/5'}`}
      >
        <span className="lh-label min-w-0 break-words">{row.name}</span>
        {active && <YoursTag ink={swatch.ink} />}
        {row.covers.length > 0 && (
          <span className={`ml-auto text-xs text-right ${active ? '' : 'text-white/60'}`}>{row.covers.join(', ')}</span>
        )}
      </button>
      {row.url && (
        <ExternalLink
          href={row.url}
          aria-label={`Open ${row.name} in a new tab`}
          className={`tap-block shrink-0 flex items-center justify-center min-w-11 px-3 border-l transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current ${active
            ? 'border-current hover:opacity-70'
            : 'border-white/15 text-white/60 hover:bg-white hover:text-black'
            }`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </ExternalLink>
      )}
    </div>
  );
}

export default function PlatformSection({ game, userPlatforms, selectedKeys, onToggle }) {
  const [showOther, setShowOther] = useState(false);
  /* The page mounts this twice (desktop aside and mobile strip, one hidden), so
     ids come from useId rather than a literal. */
  const otherId = useId();

  const { pills, rows, others } = useMemo(
    () => buildPlatformArea(game, userPlatforms, selectedKeys),
    [game, userPlatforms, selectedKeys]
  );

  const noIgdbPlatforms = !(game?.platforms?.length);
  const hasUserPlatforms = (userPlatforms || []).length > 0;

  /* About one IGDB game in six lists no platforms, and custom entries list none.
     The area still shows while there is anything of yours or IGDB's to offer. */
  if (pills.length === 0 && rows.length === 0 && others.length === 0 && noIgdbPlatforms) return null;

  const isOn = (p) => selectedKeys.has(platKey(p));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="lh-label text-white/60">Available On</div>
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <OwnershipPill key={platKey(p)} plat={p} active={isOn(p)} onToggle={onToggle} />
            ))}
          </div>
        )}
        {noIgdbPlatforms && <p className="lh-label lh-multiline text-white/60">IGDB lists no platforms for this game.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="lh-label text-white/60">Stores and subscriptions</div>
        {rows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <StoreRow key={row.key} row={row} active={isOn(row.platform)} onToggle={onToggle} />
            ))}
          </div>
        ) : (
          <p className="lh-label lh-multiline text-white/60">IGDB lists no stores for this game.</p>
        )}
        {!hasUserPlatforms && (
          <p className="lh-label lh-multiline text-white/60">
            <Link to="/platforms" className="underline py-2 -my-2 hover:text-white">Add your platforms</Link> to see your subscriptions here.
          </p>
        )}
      </div>

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            aria-expanded={showOther}
            aria-controls={showOther ? otherId : undefined}
            className="tap-block self-start lh-label px-2 py-1.5 border border-white/15 text-white/60 hover:border-white hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            {showOther ? 'Hide other platforms' : `Other platforms (${others.length})`}
          </button>
          {showOther && (
            <div id={otherId} className="flex flex-wrap gap-1.5">
              {others.map((p) => (
                <OwnershipPill key={platKey(p)} plat={p} active={isOn(p)} onToggle={onToggle} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
