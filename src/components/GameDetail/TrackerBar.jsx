import { Gamepad2, FolderPlus, Ellipsis, ChevronDown } from 'lucide-react';
import DropdownMenu from '../ui/DropdownMenu';

/* The tracker bar: every library control on the game page, in one row.
 *
 * It replaced a 340px rail of stacked state lists (five status rows, five
 * priority rows, platform pills, a collections list and a remove button) that
 * pushed the status control below the fold on a laptop, and a second copy of
 * the same controls for phones that sat under the Overview. One instance now,
 * rendered once: inline under the title at lg and up, docked to the bottom of
 * the screen below that, where a thumb reaches it and it never scrolls away.
 *
 * Each segment is a menu button and the menus use the same vocabulary as the
 * card menus — choosing a value sets it, Clear clears it, Remove lives at the
 * end of More behind a confirm. The old page removed a game when you clicked
 * the status it already had, which no other surface did. */

function Swatch({ color }) {
  return <span aria-hidden="true" className="w-2 h-2 shrink-0" style={{ backgroundColor: color }} />;
}

/* One segment. `primary` is the unshelved Add state: the only filled control on
   the page, because it is the one thing a visitor who has not shelved the game
   can usefully do. `icon` segments collapse to the icon below sm, where five
   labelled segments do not fit a 320px phone. */
function Segment({ caption, value, swatch, icon: Icon, primary, menu = true, className = '', ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className={`group relative w-full h-14 flex items-center gap-2 px-3 lg:px-4 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${primary
        ? 'bg-white text-black hover:bg-white/80 focus-visible:bg-white/80 focus-visible:ring-black'
        : 'text-white hover:bg-white/10 focus-visible:bg-white/10'} ${className}`}
    >
      {Icon && <Icon aria-hidden="true" className={`w-4 h-4 shrink-0 ${caption ? 'sm:hidden' : ''}`} />}
      {caption !== undefined && (
        <span className={`min-w-0 flex-1 flex flex-col gap-1 ${Icon ? 'hidden sm:flex' : ''}`}>
          {caption && <span className={`lh-label truncate ${primary ? 'text-current/70' : 'text-white/60'}`}>{caption}</span>}
          <span className="lh-label flex items-center gap-2 min-w-0">
            {swatch && <Swatch color={swatch} />}
            <span className="truncate">{value}</span>
          </span>
        </span>
      )}
      {menu && <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 shrink-0 hidden min-[380px]:block ${primary ? 'text-current/70' : 'text-white/60'}`} />}
    </button>
  );
}

/* A segment that opens a menu. The wrapper takes the flex share; DropdownMenu's
   own span is told to fill it. */
function MenuSegment({ options, closeOnSelect, grow = true, align = 'left', children }) {
  return (
    <div className={`${grow ? 'flex-1 min-w-0' : 'shrink-0'} border-r border-white/15 last:border-r-0`}>
      <DropdownMenu options={options} align={align} fullWidth closeOnSelect={closeOnSelect}>
        {children}
      </DropdownMenu>
    </div>
  );
}

export default function TrackerBar({
  status, statusColor, statusOptions, onAddUnreleased,
  second, // { caption, value, swatch, options, ariaLabel } | null
  platformsLabel, onOpenPlatforms,
  collections, // { label, options } | null
  moreOptions,
}) {
  return (
    <div
      role="group"
      aria-label="Your library"
      className="fixed inset-x-0 bottom-0 z-[90] bg-black border-t border-white/15 pb-[env(safe-area-inset-bottom)] lg:static lg:z-auto lg:border lg:pb-0 lg:mb-12"
    >
      <div className="flex">
        {onAddUnreleased ? (
          /* An unreleased game has one shelf to go on, so there is no menu to open:
             the segment is the action. Once shelved it reads as the status. */
          <div className="flex-1 min-w-0 border-r border-white/15">
            <Segment
              primary={!status}
              menu={false}
              caption={status ? 'Status' : ''}
              value={status || 'Add to library'}
              swatch={status ? statusColor : null}
              aria-label={status ? `Status: ${status}` : 'Add to library as Unreleased'}
              onClick={status ? undefined : onAddUnreleased}
              aria-disabled={status ? true : undefined}
            />
          </div>
        ) : (
          <MenuSegment options={statusOptions}>
            <Segment
              primary={!status}
              caption={status ? 'Status' : ''}
              value={status || 'Add to library'}
              swatch={status ? statusColor : null}
              aria-label={status ? `Status: ${status}` : 'Add to library'}
            />
          </MenuSegment>
        )}

        {second && (
          <MenuSegment options={second.options}>
            <Segment
              caption={second.caption}
              value={second.value}
              swatch={second.swatch}
              aria-label={second.ariaLabel}
            />
          </MenuSegment>
        )}

        {platformsLabel !== null && (
          <div className="shrink-0 sm:flex-1 min-w-0 border-r border-white/15">
            <Segment
              icon={Gamepad2}
              caption="Platforms"
              value={platformsLabel}
              menu={false}
              aria-label={`Platforms: ${platformsLabel}`}
              aria-haspopup="dialog"
              onClick={onOpenPlatforms}
              className="w-14 sm:w-full justify-center sm:justify-start"
            />
          </div>
        )}

        {collections && (
          <MenuSegment options={collections.options} closeOnSelect={false} grow={false} align="right">
            <Segment
              icon={FolderPlus}
              caption="Collections"
              value={collections.label}
              aria-label={`Collections: ${collections.label}`}
              className="w-14 sm:w-auto sm:min-w-36 justify-center sm:justify-start"
            />
          </MenuSegment>
        )}

        <MenuSegment options={moreOptions} grow={false} align="right">
          <Segment
            icon={Ellipsis}
            menu={false}
            aria-label="More actions"
            className="w-14 justify-center"
          />
        </MenuSegment>
      </div>
    </div>
  );
}
