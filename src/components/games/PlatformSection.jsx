import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlatformLogo } from '../platforms/PlatformLogo';
import { getShortPlatformName } from '../platforms/platformLogoUtils';
import { platKey, normalizePlat, matchPlatformsForGame } from '../../services/platformMatch';

/* One row: the platforms the game runs on, with the ones you own marked.
 *
 * This replaced two copies of the same JSX -- the desktop plate and the mobile
 * sheet each spread [...gamePlats, ...userPlats] into chips -- which is how the
 * row came to mix "the game exists here" with "you have it here" in both places
 * at once. */
function Chip({ plat, active, onToggle }) {
  return (
    <button
      onClick={() => onToggle(plat)}
      title={plat.name}
      aria-pressed={active}
      aria-label={`${active ? 'Unmark' : 'Mark'} ${getShortPlatformName(plat)} as yours`}
      className={`flex items-center gap-1.5 border px-2 py-1.5 lh-label transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${active
        ? 'bg-white border-white text-black'
        : 'border-white/15 text-white/60 hover:border-white hover:text-white'
        }`}
    >
      <PlatformLogo platform={plat} className="w-4 h-4 p-[2px]" disableTooltip />
      <span className="pointer-events-none">{getShortPlatformName(plat)}</span>
    </button>
  );
}

/* A row in the "Where do you own it?" picker. A toggle button, not a menu
 * item -- there is no arrow-key navigation here, so it does not claim the
 * ARIA menu pattern. aria-pressed announces the checked state the same way
 * Chip does. Hoisted to module scope (like Chip) so its identity is stable
 * across renders -- defined inside PlatformSection, it was a new component
 * type every render, so React unmounted and remounted every row on each
 * toggle, dropping focus to document.body mid-click. */
function Row({ plat, active, onToggle }) {
  return (
    <button
      onClick={() => onToggle(plat)}
      aria-pressed={active}
      className="flex items-center gap-2 w-full text-left px-2 py-2 lh-label text-white/60 hover:text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
    >
      <span aria-hidden="true" className={`w-3 h-3 border ${active ? 'bg-white border-white' : 'border-white/40'}`} />
      <PlatformLogo platform={plat} className="w-4 h-4 p-[2px]" disableTooltip />
      <span>{plat.name}</span>
    </button>
  );
}

export default function PlatformSection({ game, userPlatforms, selectedKeys, onToggle }) {
  const gamePlats = [];
  const seen = new Set();
  for (const p of (game?.platforms || []).map(normalizePlat)) {
    const key = platKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    gamePlats.push(p);
  }

  /* Marked platforms with no chip of their own -- a store, a subscription, or
     hardware IGDB does not list -- are appended rather than dropped. */
  const appended = (userPlatforms || [])
    .filter(p => selectedKeys.has(platKey(p)) && !seen.has(platKey(p)));

  const [open, setOpen] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const triggerRef = useRef(null);
  /* This page mounts PlatformSection twice (desktop aside + mobile strip,
     one CSS-hidden). useId keeps the two instances' group ids from colliding
     in the DOM. */
  const baseId = useId();
  const fittingHeadingId = `${baseId}-fitting-heading`;
  const otherHeadingId = `${baseId}-other-heading`;

  /* matchPlatformsForGame does a scan over the user's platform list; memoize
     it so it isn't paid on every render, twice over since both mounted
     instances re-render on every toggle. */
  const { fitting, other } = useMemo(
    () => matchPlatformsForGame(game, userPlatforms),
    [game, userPlatforms]
  );

  const noIgdbPlatforms = gamePlats.length === 0;

  /* Not an edge case: about one IGDB game in six lists no platforms, and every
     custom entry the user adds has none. Hiding the section there would hide it
     from the people with the most reason to record where they own something,
     since IGDB is telling them nothing. It is hidden only when there is also
     nothing of the user's to offer. */
  if (noIgdbPlatforms && (userPlatforms || []).length === 0) return null;

  return (
    <div>
      <div className="lh-label text-white/60 mb-2">Available On</div>
      <div className="flex flex-wrap gap-1.5">
        {gamePlats.map(p => (
          <Chip key={platKey(p)} plat={p} active={selectedKeys.has(platKey(p))} onToggle={onToggle} />
        ))}
      </div>
      {appended.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5 pl-3 border-l border-white/15">
          {appended.map(p => (
            <Chip key={platKey(p)} plat={p} active onToggle={onToggle} />
          ))}
        </div>
      )}
      {noIgdbPlatforms && (
        <p className="lh-label text-white/40">IGDB lists no platforms for this game.</p>
      )}
      {/* Escape needs to close the picker with focus still on the trigger
          (right after opening) as well as with focus inside the panel, so
          the handler sits on the wrapper that covers both -- not just the
          panel, which is a sibling of the trigger button. */}
      <div
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          ref={triggerRef}
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="lh-label mt-2 px-2 py-1.5 border border-white/15 text-white/60 hover:border-white hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Where do you own it?
        </button>
        {open && (
          <div className="mt-1.5 border border-white/15">
            {noIgdbPlatforms
              ? userPlatforms.map(p => (
                <Row key={platKey(p)} plat={p} active={selectedKeys.has(platKey(p))} onToggle={onToggle} />
              ))
              /* fitting and other are both built from userPlatforms, so both empty
                 here (with the game's own IGDB platforms present, the noIgdbPlatforms
                 branch above) means one thing: nothing is configured yet. Rendering
                 the two group blocks below would just skip both `.length > 0` guards
                 and leave an empty bordered box with no way out. */
              : (fitting.length === 0 && other.length === 0)
                ? (
                  <div role="group" aria-labelledby={fittingHeadingId}>
                    <div id={fittingHeadingId} className="lh-label text-white/40 px-2 pt-2">Available for this game</div>
                    <p className="lh-label text-white/40 px-2 pb-2">
                      No platforms added yet. <Link to="/platforms" className="underline hover:text-white">Add your platforms</Link> to mark where you own this.
                    </p>
                  </div>
                )
                : (<>
                {fitting.length > 0 && (
                  <div role="group" aria-labelledby={fittingHeadingId}>
                    <div id={fittingHeadingId} className="lh-label text-white/40 px-2 pt-2">Available for this game</div>
                    {fitting.map(p => (
                      <Row key={platKey(p)} plat={p} active={selectedKeys.has(platKey(p))} onToggle={onToggle} />
                    ))}
                  </div>
                )}
                {other.length > 0 && (
                  <div role="group" aria-labelledby={otherHeadingId}>
                    <button
                      id={otherHeadingId}
                      onClick={() => setShowOther(v => !v)}
                      aria-expanded={showOther}
                      className="lh-label w-full text-left text-white/40 px-2 py-2 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                    >
                      {showOther ? 'Hide' : 'Other platforms'} ({other.length})
                    </button>
                    {showOther && other.map(p => (
                      <Row key={platKey(p)} plat={p} active={selectedKeys.has(platKey(p))} onToggle={onToggle} />
                    ))}
                  </div>
                )}
              </>)}
          </div>
        )}
      </div>
    </div>
  );
}
