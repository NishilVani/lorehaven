import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, GripVertical, MoreVertical } from 'lucide-react';
import MarqueeText from '../ui/MarqueeText';
import DropdownMenu from '../ui/DropdownMenu';
import { priorityBadge, feelBadge } from '../../constants/stateColors';

/**
 * CollectionCard — identical to GameCard but uses a 16:9 banner image.
 * Use this for collection cards (IGDB collections, personal collections).
 *
 * Props:
 *  game          {object}   — game data (id, name, cover_id, dev, release_year,
 *                             feel, priority, dateCompleted, status)
 *  activeTab     {string}   — current tab label ('Beaten', 'Backlog', …)
 *  statusBadge   {object}   — optional override badge: { dot, text, label }
 *  topBadge      {node}     — optional JSX rendered top-right of the cover
 *  draggable     {boolean}  — enable native drag-and-drop (default: false)
 *  isDragging    {boolean}  — true when THIS card is being dragged
 *  onDragStart   {fn}       — (e, game) => void
 *  onDragEnd     {fn}       — () => void
 *  isDraggingAny {boolean}  — any card is being dragged (for grid-blur)
 *  linkTo        {string}   — override link target (default: /game/:id)
 *  menuOptions   {Array}    — extra options [{label, icon, onClick, variant, dividerAbove}]
 *                             merged after default options
 *
 * Differences from GameCard:
 *  - Cover aspect ratio is always 16/9 (landscape banner)
 *  - Image fetched at t_screenshot_big (1280×720) instead of t_cover_big
 */
export default function CollectionCard({
  game,
  activeTab = '',
  statusBadge = null,
  topBadge = null,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  isDraggingAny = false,
  linkTo,
  menuOptions = [],
}) {
  const isDraggingRef = useRef(false);

  const handleDragStart = (e) => {
    isDraggingRef.current = true;
    onDragStart?.(e, game);
  };

  const handleDragEnd = (e) => {
    isDraggingRef.current = false;
    onDragEnd?.(e);
  };

  const href = linkTo ?? `/game/${game.id}`;

  // ── Badge logic ──────────────────────────────────────────────────
  const showFeel = !statusBadge && activeTab === 'Beaten' && game.feel;
  const badge = statusBadge
    ? statusBadge
    : showFeel
      /* Unknown values fall to the colourless token rather than borrowing a
         real scale value — the old fallbacks read an unrecognised rating as
         Timepass amber, and PRIORITY_BADGE['Medium'] was a key that never
         existed, so it resolved to undefined. */
      ? feelBadge(game.feel)
      : game.priority
        ? priorityBadge(game.priority)
        : null;
  const badgeLabel = statusBadge ? statusBadge.label : showFeel ? game.feel : game.priority;

  // ── Subtitle ─────────────────────────────────────────────────────
  const dev = game.dev && game.dev !== 'Unknown Developer' ? game.dev : null;
  const dateStr =
    activeTab === 'Beaten'
      ? game.dateCompleted
        ? new Date(game.dateCompleted).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        : null
      : game.release_year && game.release_year !== 'Unknown Year'
        ? String(game.release_year)
        : null;
  const subtitle = [dateStr, dev].filter(Boolean).join(' • ');

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`group flex flex-col relative select-none ${isDragging
        ? 'lib-card-dragging'
        : draggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
    >
      {/* Invisible full-card link */}
      <Link
        to={href}
        className="absolute inset-0 z-10"
        onClick={(e) => isDraggingRef.current && e.preventDefault()}
      />

      {/* Banner — raw 16:9 image behind a sharp 1px frame */}
      <div
        className="w-full bg-neutral-900 border border-white/20 group-hover:border-white/70 transition-colors overflow-hidden relative"
        style={{ aspectRatio: '16/9' }}
      >
        {game.cover_id ? (
          <img
            className="w-full h-full object-cover block"
            src={`https://images.igdb.com/igdb/image/upload/t_screenshot_big/${game.cover_id}.jpg`}
            alt={game.name}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff className="text-neutral-700 w-10 h-10" />
          </div>
        )}

        {/* Feel / Priority badge */}
        {badge && (
          <div className="absolute bottom-1.5 right-1.5 z-20">
            <span className="inline-flex items-center gap-1.5 px-1.5 py-1 bg-black border border-white/30">
              <span
                style={{ backgroundColor: badge.dot }}
                className="w-1.5 h-1.5 shrink-0"
              />
              {badgeLabel && (
                <span
                  style={{ color: badge.text }}
                  className="lh-label leading-none whitespace-nowrap"
                >
                  {badgeLabel}
                </span>
              )}
            </span>
          </div>
        )}

        {/* Drag indicator (only when draggable) */}
        {draggable && (
          <div className="absolute top-1.5 left-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="p-1 bg-black border border-white/30 text-white/70 flex items-center justify-center">
              <GripVertical className="w-3 h-3" />
            </div>
          </div>
        )}

        {/* Top-right slot — e.g. rating badge from Discover */}
        {topBadge && (
          <div className="absolute top-1.5 right-1.5 z-20">
            {topBadge}
          </div>
        )}

      </div>

      {/* Caption — stark type resting directly under the banner */}
      <div className="pt-2 relative z-20 pointer-events-none">
        <div className="flex justify-between items-start gap-1">
          <div className="flex-1 min-w-0 overflow-hidden">
            <MarqueeText
              as="h3"
              text={game.name}
              className="lh-display text-sm leading-tight text-white/90 group-hover:text-white transition-colors"
            />
            {subtitle && (
              <div className="mt-1.5">
                <MarqueeText text={subtitle} className="lh-label text-white/60" />
              </div>
            )}
          </div>
          {menuOptions?.length > 0 && (
            <DropdownMenu options={menuOptions} align="right">
              <button aria-label={`More options for ${game.name}`} className="text-white/60 hover:text-white shrink-0 pointer-events-auto cursor-pointer relative z-30 p-2 -m-1.5 outline-none flex items-center justify-center">
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
