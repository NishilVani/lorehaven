import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PlatformPill from '../platforms/PlatformPill';
import { getShortPlatformName } from '../platforms/platformLogoUtils';
import { platKey } from '../../services/platformMatch';
import { buildPlatformArea } from '../../services/gameLinks';

/* The platforms area of the game page: where the game runs, where it can be
 * bought, and where you own it.
 *
 * Every entry is the one PlatformPill, so a platform looks the same here as on
 * Manage Platforms. What goes where is decided in services/gameLinks.js; this
 * file only draws it. */

const markLabel = (selected, label) => `${selected ? 'Unmark' : 'Mark'} ${label} as yours`;

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

  /* About one IGDB game in six lists no platforms, and custom entries list none.
     The area still shows while there is anything of yours or IGDB's to offer. */
  if (pills.length === 0 && rows.length === 0 && others.length === 0 && noIgdbPlatforms) return null;

  const isOn = (p) => selectedKeys.has(platKey(p));

  const platformPill = (p) => {
    const selected = isOn(p);
    return (
      <PlatformPill
        key={platKey(p)}
        platform={p}
        isSelected={selected}
        onClick={onToggle}
        toggleLabel={markLabel(selected, getShortPlatformName(p))}
      />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="lh-label text-white/60">Available On</div>
          <Link
            to="/platforms"
            className="tap lh-label text-white/60 underline decoration-white/30 underline-offset-4 py-2 -my-2 hover:text-white hover:decoration-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
          >
            Manage Platforms
          </Link>
        </div>
        {pills.length > 0 && <div className="flex flex-wrap gap-1.5">{pills.map(platformPill)}</div>}
        {noIgdbPlatforms && <p className="lh-label lh-multiline text-white/60">IGDB lists no platforms for this game.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="lh-label text-white/60">Stores and subscriptions</div>
        {rows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => {
              const selected = isOn(row.platform);
              return (
                <PlatformPill
                  key={row.key}
                  platform={row.platform}
                  name={row.name}
                  brand={row.brand}
                  iconUrl={row.iconUrl}
                  detail={row.covers.join(', ')}
                  href={row.url || undefined}
                  linkLabel={`Open ${row.name} in a new tab`}
                  isSelected={selected}
                  onClick={onToggle}
                  toggleLabel={markLabel(selected, row.name)}
                  isFullWidth
                />
              );
            })}
          </div>
        ) : (
          <p className="lh-label lh-multiline text-white/60">IGDB lists no stores for this game.</p>
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
              {others.map(platformPill)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
