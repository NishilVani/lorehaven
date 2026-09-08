import { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ImageOff,
  GripVertical,
  MoreVertical,
  Gamepad2,
  List as ListIcon,
  Heart,
  Trophy,
  CircleMinus,
  CalendarClock,
  X,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import MarqueeText from '../ui/MarqueeText';
import DropdownMenu from '../ui/DropdownMenu';
import { saveToLibrary, removeFromLibrary, getLibraryIndex, getRecFeedbackIndex } from '../../services/db';
import { toast } from '../ui/Toast';
import { statusBadge as makeStatusBadge } from '../../constants/stateColors';
import { PRIORITY_MENU, FEEL_MENU, priorityBadge, feelColor, statusColor } from '../../constants/stateColors';
import useConfirm from '../../hooks/useConfirm';
import ConfirmDialog from '../ui/ConfirmDialog';

/* This card paints `badge.text` as the sticker's FILL, not as text, so both
   fields carry the saturated value. CollectionCard renders it as actual text
   and does want the lighter Perfection variant — hence feelBadge() there. */
const feelSticker = (feel) => ({ dot: feelColor(feel), text: feelColor(feel), label: feel });

const GAME_TYPE_LABELS = {
  0: 'Main Game',
  1: 'DLC',
  2: 'Expansion',
  3: 'Bundle',
  4: 'Standalone Expansion',
  5: 'Mod',
  6: 'Episode',
  7: 'Season',
  8: 'Remake',
  9: 'Remaster',
  10: 'Expanded Game',
  11: 'Port',
  12: 'Fork',
  13: 'Pack',
  14: 'Update',
};

/**
 * GameCard — reusable library card component.
 *
 * Props:
 *  game          {object}   — game data (id, name, cover_id, dev, release_year,
 *                             feel, priority, dateCompleted, status)
 *  activeTab     {string}   — current tab label ('Beaten', 'Backlog', …)
 *  statusBadge   {object}   — optional override badge: { dot, text, label }
 *                             e.g. library status from FranchisePage
 *  topBadge      {node}     — optional JSX rendered top-right of the cover
 *                             e.g. rating pill from Discover
 *  draggable     {boolean}  — enable native drag-and-drop (default: false)
 *  isDragging    {boolean}  — true when THIS card is being dragged
 *  onDragStart   {fn}       — (e, game) => void
 *  onDragEnd     {fn}       — () => void
 *  isDraggingAny {boolean}  — any card is being dragged (for grid-blur)
 *  linkTo        {string}   — override link target (default: /game/:id)
 *  menuOptions   {Array}    — extra options [{label, icon, onClick, variant, dividerAbove}]
 *                             merged after default options
 */
export default function GameCard({
  game,
  activeTab = '',
  statusBadge = null,
  topBadge = null,
  draggable = false,
  isDragging = false,
  onDragStart,
  onLift,
  onDragEnd,
  isDraggingAny = false,
  linkTo,
  menuOptions = [],
  onLibraryChange,   // (gameId) => void — after any internal add/move/remove
  onFeedback,        // (game, 'interested' | 'not_interested') — adds rec-feedback menu items
  subtitle = null,
  subtitleClassName = '',
}) {
  const [confirm, confirmProps] = useConfirm();
  const isDraggingRef = useRef(false);
  const touchStartPos = useRef({ isTouch: false });
  const navigate = useNavigate();

  const [libraryEntry, setLibraryEntry] = useState(null);
  const [fbVerdict, setFbVerdict] = useState(null);   // 'interested' | 'not_interested' | null

  useEffect(() => {
    /* One lookup, not two scans. These indexes are built once per version of
       the underlying list and shared by every card, so a grid of N cards costs
       one pass rather than N scans of the whole library -- which is what a
       library event used to cost, per card, every time. */
    const updateEntry = () => {
      setLibraryEntry(getLibraryIndex().get(String(game.id)) || null);
      setFbVerdict(getRecFeedbackIndex().get(String(game.id)) || null);
    };

    updateEntry();

    // 'moctale_sync_update' = cloud pull (App remounts routes on it);
    // 'moctale_lib_update' = local library action (badge refresh only, no remount)
    window.addEventListener('moctale_sync_update', updateEntry);
    window.addEventListener('moctale_lib_update', updateEntry);
    return () => {
      window.removeEventListener('moctale_sync_update', updateEntry);
      window.removeEventListener('moctale_lib_update', updateEntry);
    };
  }, [game.id]);

  const hasPropOptions = menuOptions && menuOptions.length > 0;

  // Local library actions refresh card badges without remounting the app
  const afterLibChange = () => {
    window.dispatchEvent(new Event('moctale_lib_update'));
    onLibraryChange?.(game.id);
  };

  const autoOptions = useMemo(() => {
    if (hasPropOptions) return [];

    const entry = libraryEntry;

    const statusIcons = {
      Playing: Gamepad2,
      Backlog: ListIcon,
      Wishlist: Heart,
      Beaten: Trophy,
      Dropped: CircleMinus,
      Unreleased: CalendarClock,
    };

    /* Selection is carried by `isActive`, not by a U+2713 appended to the label.
       DropdownMenu already turns that into role="menuitemradio" + aria-checked and
       pins the accent strip on, so the state is announced as state instead of read
       out as the word "check mark" inside the item's name — and the project's
       no-dingbat rule stops being violated in an accessible name. */
    const feedbackOpts = onFeedback ? [
      {
        label: 'Interested',
        isActive: fbVerdict === 'interested',
        icon: () => <ThumbsUp className="w-2.5 h-2.5" />,
        dividerAbove: true,
        onClick: () => onFeedback(game, fbVerdict === 'interested' ? null : 'interested'),
      },
      {
        label: 'Not Interested',
        isActive: fbVerdict === 'not_interested',
        icon: () => <ThumbsDown className="w-2.5 h-2.5" />,
        variant: 'danger',
        onClick: () => onFeedback(game, fbVerdict === 'not_interested' ? null : 'not_interested'),
      },
    ] : [];

    if (!entry) {
      const addStatuses = ['Wishlist', 'Backlog', 'Playing', 'Beaten', 'Dropped'];
      return [...addStatuses.map((status) => {
        const IconComponent = statusIcons[status];
        return {
          label: `Add to ${status}`,
          icon: IconComponent ? () => <IconComponent className="w-2.5 h-2.5" /> : null,
          color: statusColor(status),
          variant: status === 'Wishlist' ? 'accent' : 'default',
          onClick: () => {
            const data = {
              id: game.id,
              name: game.name,
              status: status,
              is_custom: game.is_custom || false,
              cover_id: game.cover_id || null,
              dev: game.dev || null,
              release_year: game.release_year || null,
              first_release_date: game.first_release_date || null,
              total_rating: game.total_rating || null,
              cover_width: game.cover_width || 264,
              cover_height: game.cover_height || 374,
            };
            saveToLibrary(data);
            afterLibChange();
            toast(`Added to ${status}`);
          }
        };
      }), ...feedbackOpts];
    }

    const targetStatuses = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped'].filter(s => s !== entry.status);
    const moveOpts = targetStatuses.map(status => {
      const IconComponent = statusIcons[status];
      return {
        label: `Move to ${status}`,
        icon: IconComponent ? () => <IconComponent className="w-2.5 h-2.5" /> : null,
        color: statusColor(status),
        onClick: () => {
          const updated = { ...entry, status };
          saveToLibrary(updated);
          afterLibChange();
          toast(`Moved to ${status}`);
        }
      };
    });

    let subOpts = [];
    if (entry.status === 'Beaten') {
      /* FEEL_MENU, not a local copy — this list was an eleventh inline duplicate
         of the rating scale. */
      subOpts = FEEL_MENU.map((f, i) => ({
        label: f.label,
        color: f.color,
        icon: () => <div className="w-2.5 h-2.5 rounded-none" style={{ backgroundColor: f.color }} />,
        dividerAbove: i === 0,
        onClick: () => {
          const updated = { ...entry, feel: f.label };
          saveToLibrary(updated);
          afterLibChange();
          toast(`Rated: ${f.label}`);
        }
      }));
      if (entry.feel) {
        subOpts.push({
          label: 'Clear Rating',
          icon: () => <X className="w-2.5 h-2.5" />,
          onClick: () => {
            const { feel, ...rest } = entry;
            const updated = { ...rest, feel: null };
            saveToLibrary(updated);
            afterLibChange();
            toast('Rating cleared');
          }
        });
      }
    } else {
      subOpts = PRIORITY_MENU.map((p, i) => ({
        label: p.label,
        color: p.color,
        icon: () => <div className="w-2.5 h-2.5 rounded-none" style={{ backgroundColor: p.color }} />,
        dividerAbove: i === 0,
        onClick: () => {
          const updated = { ...entry, priority: p.label };
          saveToLibrary(updated);
          afterLibChange();
          toast(`Priority: ${p.label}`);
        }
      }));
      if (entry.priority) {
        subOpts.push({
          label: 'Clear Priority',
          icon: () => <X className="w-2.5 h-2.5" />,
          onClick: () => {
            const { priority, ...rest } = entry;
            const updated = { ...rest, priority: null };
            saveToLibrary(updated);
            afterLibChange();
            toast('Priority cleared');
          }
        });
      }
    }

    const removeOpt = {
      label: 'Remove from Library',
      icon: () => <X className="w-2.5 h-2.5" />,
      variant: 'danger',
      dividerAbove: true,
      /* Removing is one click from a menu and takes accumulated data with it, so
         it asks. The dialog is scoped to one game, so a plain confirm is the right
         tier — no typed phrase. */
      onClick: () => confirm(
        {
          eyebrow: 'Library',
          title: `Remove ${game.name}?`,
          body: 'Its status, rating, priority, notes and completion date go with it. There is no undo.',
          confirmLabel: 'Remove',
        },
        () => {
          removeFromLibrary(entry.id);
          afterLibChange();
          toast('Removed from Library');
        },
      )
    };

    return [...moveOpts, ...subOpts, ...feedbackOpts, removeOpt];
  }, [hasPropOptions, libraryEntry, game, onFeedback, fbVerdict]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (e) => {
    /* Native HTML5 drag stays desktop-only — it does not fire on touch anyway,
       and letting it try only fights the scroller. Touch gets the long-press
       lift below instead, which is the same capability by a different route.
       (This used to claim the ⋯ menu covered status moves on touch. It did not:
       on the Beaten shelf the menu emits no move rows at all.) */
    if (touchStartPos.current.isTouch) {
      e.preventDefault();
      return;
    }
    isDraggingRef.current = true;
    onDragStart?.(e, game);
  };

  /* Long-press to lift, for touch.
     A press that stays put is unambiguous; a press that moves is a scroll, and
     the scroll must win. So the timer is armed on pointerdown and cancelled by
     any real movement before it fires — the grid never becomes sticky to drag
     through. Deliberate on purpose: moving a game between shelves is a real
     mutation, and a gesture that fires from a careless flick would be worse
     than no gesture. */
  const LIFT_DELAY_MS = 420;
  const LIFT_SLOP = 10;
  const liftTimerRef = useRef(null);
  const liftOriginRef = useRef({ x: 0, y: 0 });
  const liftedRef = useRef(false);

  const cancelLift = () => {
    if (liftTimerRef.current) { clearTimeout(liftTimerRef.current); liftTimerRef.current = null; }
  };

  const onCardPointerDown = (e) => {
    if (!draggable || !onLift) return;
    if (e.pointerType === 'mouse') return;           // desktop keeps native drag
    // The ⋯ button sits on top of the card; a long press on it is aiming at it.
    if (e.target.closest('button')) return;
    liftOriginRef.current = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget;
    cancelLift();
    liftTimerRef.current = setTimeout(() => {
      liftTimerRef.current = null;
      liftedRef.current = true;
      onLift(game, el, liftOriginRef.current.x, liftOriginRef.current.y);
    }, LIFT_DELAY_MS);
  };

  const onCardPointerMove = (e) => {
    if (!liftTimerRef.current) return;
    const o = liftOriginRef.current;
    if (Math.abs(e.clientX - o.x) > LIFT_SLOP || Math.abs(e.clientY - o.y) > LIFT_SLOP) cancelLift();
  };

  useEffect(() => cancelLift, []);

  const handleDragEnd = (e) => {
    isDraggingRef.current = false;
    onDragEnd?.(e);
  };

  const href = linkTo ?? `/game/${game.id}`;

  // ── Badge logic ──────────────────────────────────────────────────
  // statusBadge (e.g. library status) takes priority over feel/priority
  const entry = libraryEntry || game;
  const showFeel = !statusBadge && (activeTab === 'Beaten' || (entry && entry.status === 'Beaten')) && (game.feel || entry?.feel);

  /* A finished game must never wear a planning priority. Moving a game to Beaten
     patches only its status, so `priority` survives — and the badge chain below
     falls through to it whenever there is no rating yet, which is most of a
     fresh Beaten shelf. Measured: cards reading "A GAME OF DWARVES / ZEAL GAME
     STUDIO / SOON". Soon is a statement about something you have not played.
     The data is kept, not cleared, so moving the game back to Backlog restores
     the priority intact; only the assertion on the card is suppressed. */
  const isBeaten = activeTab === 'Beaten' || entry?.status === 'Beaten';

  const getStatusBadge = (status) => {
    if (!status) return null;
    return makeStatusBadge(status);
  };

  const badge = statusBadge
    ? statusBadge
    : entry && !activeTab && entry.status
      ? getStatusBadge(entry.status)
      : showFeel
        ? feelSticker(game.feel || entry?.feel)
        : (!isBeaten && (game.priority || entry?.priority))
          ? priorityBadge(game.priority || entry?.priority)
          : null;

  const badgeLabel = statusBadge
    ? statusBadge.label
    : (entry && !activeTab && entry.status)
      ? entry.status
      : showFeel
        ? (game.feel || entry?.feel)
        /* Must mirror the badge chain exactly. Suppressing only the visual would
           leave a screen reader announcing a priority nobody can see. */
        : (!isBeaten ? (game.priority || entry?.priority) : null);

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
        /* No date on an IGDB row means it has none yet; an empty footer slot read
           as a missing value. A custom entry simply has no year to show. */
        : game.is_custom ? null : 'TBA';
  // Band shows dev/genre (the disc-case "publisher strip"); subtitle keeps the rest
  const bandText = dev || game.game_type_label || null;
  const gameType = game.game_type_label || (game.game_type !== undefined && game.game_type !== null ? (GAME_TYPE_LABELS[game.game_type] || 'Main Game') : null);
  /* A custom entry has no developer and no IGDB type; an empty band beside a
     neighbour reading MAIN GAME looked like a rendering failure. Say what it is. */
  const bandLabel = bandText || gameType || (game.is_custom ? 'Custom Entry' : null);
  const displaySubtitle = (subtitle !== undefined && subtitle !== null)
    ? subtitle
    : [dateStr, dev, game.game_type_label]
        .filter(Boolean)
        .filter((x) => x !== bandText)
        .join(' • ');
  const isUnreleased = game.first_release_date && (game.first_release_date * 1000 > Date.now());



  return (
    <>
      <ConfirmDialog {...confirmProps} />
      <div
        draggable={draggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onMouseDown={() => { touchStartPos.current.isTouch = false; }}
        onTouchStart={() => { touchStartPos.current.isTouch = true; }}
        onPointerDown={onCardPointerDown}
        onPointerMove={onCardPointerMove}
        onPointerUp={cancelLift}
        onPointerCancel={cancelLift}
        /* Android and iOS answer a long press over cover art with their own
           save-image callout, which would land on top of the lifted card. The
           press already means something here. */
        onContextMenu={(e) => { if (draggable && onLift) e.preventDefault(); }}
        /* overflow-clip, not overflow-hidden. This box clips decoration; it is
           not a scroller, and `hidden` makes one anyway — an overflow:hidden
           element is still programmatically scrollable, it just has no scrollbar
           to scroll back with. The card's height lands fractional (279.328px)
           because the poster drives it, so clientHeight rounds down to 279 while
           scrollHeight rounds up to 281: two phantom pixels of scrollable range
           over content that does not actually overflow. Any focus() inside then
           scrolled the card up by exactly that and its top border disappeared
           under the clip, permanently — Tab through the grid and every card lost
           its border in turn. `clip` establishes no scroll container at all. */
        className={`group flex flex-col hover-game-card overflow-clip relative select-none ${
          isDragging ? 'lib-card-dragging' : 'opacity-100 z-10'
        } ${draggable
          ? ' sm:cursor-grab sm:active:cursor-grabbing'
          : ''
        }`}
      >
      {/* Invisible full-card clickable area - Replaces <Link> to avoid native <a> tag URL drag blocking.
          role="link" + tabIndex keeps it keyboard-reachable without reintroducing the native <a> drag block. */}
      <div
        role="link"
        tabIndex={0}
        aria-label={game.name}
        /* ring-INSET is required, not cosmetic: this overlay is inset-0 of a parent
           with overflow-hidden, so an outward ring paints outside the clip box and is
           never visible. Verified: overlay 178x255 == parent 178x255. */
        className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
        onClick={(e) => {
          /* A lift released back over its own card still emits a click. Opening
             the game the user just decided not to move is the one outcome the
             gesture must never produce. */
          if (liftedRef.current) { liftedRef.current = false; return; }
          if (!isDraggingRef.current) {
            navigate(href);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            navigate(href);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && !isDraggingRef.current) {
            window.open(href, '_blank');
          }
        }}
      />

      {/* ── Disc box: spine + banded cover, sharp 1px frame ── */}
      <div className="pointer-events-none flex w-full border border-white/20 bg-black transition-colors duration-300 group-hover:border-white/70">

        {/* Spine — vertical title strip, like a case on a shelf.
            Absolutely positioned so long titles never stretch the row (and the poster). */}
        <div className="w-4 shrink-0 border-r border-white/20 relative overflow-hidden">
          {/* inset-x-0, not left-1/2: an absolute box with `left` and no `right`
              and no width is shrink-to-fit, and WebKit resolves that to 0 here,
              so the h3's overflow-hidden clips the whole title away. */}
          <div className="absolute top-1.5 bottom-5 inset-x-0 flex justify-center">
            <MarqueeText as="h3" vertical text={game.name} className="lh-label text-white/60" />
          </div>
          <span className="w-1.5 h-1.5 border border-white/40 absolute bottom-1.5 left-1/2 -translate-x-1/2" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top band — dev/genre strip, like a console banner */}
          <div className="h-5 shrink-0 border-b border-white/20 flex items-center px-1.5">
            <div className="flex-1 min-w-0">
              {bandLabel ? (
                <MarqueeText text={bandLabel} className="lh-label text-white/60" />
              ) : null}
            </div>
          </div>

          {/* Cover art — the only color on screen */}
          <div className="w-full bg-neutral-900 overflow-hidden relative aspect-[3/4]">
            {game.cover_id ? (
              <img
                className="w-full h-full object-cover"
                src={`https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover_id}.jpg`}
                alt={game.name}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                <ImageOff className="text-neutral-700 w-10 h-10" />
              </div>
            )}

            {/* Drag indicator (only when draggable) */}
            {draggable && (
              <div
                className="hidden sm:block absolute top-1.5 left-1.5 z-20 opacity-0 group-hover:opacity-100 duration-200"
                title="Drag to organize"
              >
                <div className="p-1 bg-black border border-white/30 text-white/70 flex items-center justify-center">
                  <GripVertical className="w-3 h-3" />
                </div>
              </div>
            )}

            {/* Top-right slot — e.g. rating badge from Discover */}
            {topBadge && (
              <div className="absolute top-1.5 right-1.5 z-20 pointer-events-auto">
                {topBadge}
              </div>
            )}

            {/* Status sticker — angled rental-style sticker with a peeled bottom-left corner */}
            {badge && (
              /* left-1, not -left-1. The cover box clips (overflow-hidden), so the
                 negative offset put 5.9px of the sticker's rotated left edge
                 outside the clip where it was cut flat — measured on a Backlog
                 card. Letting it overhang instead was the other option, but the
                 16px spine sits immediately left and carries the vertical title,
                 so the sticker would occlude it. Inset by the smallest amount that
                 contains the rotated box. */
              <div className="absolute bottom-3 left-1 z-20 -rotate-6 origin-bottom-left">
                <span
                  style={{
                    backgroundColor: badge.text,
                    color: '#000000',
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                  }}
                  className="block pl-2.5 pr-2 py-1 text-[10px] font-bold tracking-widest uppercase leading-none whitespace-nowrap"
                >
                  {badgeLabel}
                </span>
                {/* Folded flap — darker triangle over the cut corner */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 right-0 w-2 h-2"
                  style={{
                    backgroundColor: badge.text,
                    filter: 'brightness(0.55)',
                    clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                  }}
                />
              </div>
            )}

          </div>

          {/* Bottom strip — date + menu, like the rating/barcode strip on a case */}
          <div className="h-5 shrink-0 border-t border-white/20 flex items-center justify-between gap-1.5 px-1.5">
            <MarqueeText text={displaySubtitle} className={`lh-label truncate ${subtitleClassName || 'text-white/60'}`} />
            {(hasPropOptions || autoOptions.length > 0) && (
              <DropdownMenu
                options={hasPropOptions ? menuOptions : autoOptions}
                align="right"
              >
                <button
                  aria-label={`More options for ${game.name}`}
                  /* Same clip as the card overlay above, so the replacement for the
                     suppressed UA outline must also be inset. */
                  className="flex text-white/60 hover:text-white shrink-0 pointer-events-auto cursor-pointer relative z-30 p-1.5 -m-1 pointer-coarse:p-3 pointer-coarse:-m-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white items-center justify-center"
                >
                  <MoreVertical className="w-3 h-3" />
                </button>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
