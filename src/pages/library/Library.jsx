import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getLibrary, saveToLibrary, removeFromLibrary } from '../../services/db';
import { getGamesByIds } from '../../services/igdb';
import { sortGames, groupDirection } from './librarySort';
import GameCard from '../../components/games/GameCard';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import { PlatformLogo, PlatformGlyph } from '../../components/platforms/PlatformLogo';
import DropdownMenu from '../../components/ui/DropdownMenu';
import TransferDataModal from '../../components/games/TransferDataModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Dialog from '../../components/ui/Dialog';
import PickNextDialog from '../../components/games/PickNextDialog';
import {
  Gamepad2, List as ListIcon, Heart, Trophy, CircleMinus, CalendarClock,
  FilterX, Database, Edit3, Puzzle, Store,
  ArrowDownAZ, ArrowUpZA, AlertCircle, Star, Globe, Timer, Calendar, CalendarCheck,
  Search, X, ChevronDown, Filter, Grid, RefreshCw, Trash2, ArrowUpDown, Target
} from 'lucide-react';
/* The shared toast, not a private one. This page used to define its own —
   bottom-centre, 2300ms, pointer-events-none, no role, no aria-live, no dismiss —
   so every confirmation on the app's most-used page was silent to a screen reader
   and undismissable, and 2.3s fails WCAG 2.2.1 (which Toast.jsx's own comment
   states). It also meant "Moved to Beaten" appeared in a different corner
   depending on which page fired it. Per-message icons went with it: one status
   channel, one appearance. */
import { toast } from '../../components/ui/toastBus';
import useAnnounce from '../../components/ui/useAnnounce';
import useSwipe from '../../hooks/useSwipe';
import { PRIORITY_MENU, FEEL_MENU, priorityColor, statusColor, normalizeStatus } from '../../constants/stateColors';
import useConfirm from '../../hooks/useConfirm';

/* Group-heading swatches, keyed by the labels the grouping code actually emits.
   This map was declared and never read: grouping by Priority or Rating drew five
   identical white headings over cards that each carried the matching coloured
   sticker, so the heading disagreed with everything filed under it. The five
   public-rating keys that used to sit here (Masterpiece, Great, Good, Mixed,
   Poor) went with the dead code — no grouping produces those labels, so nothing
   could ever have looked them up. `hexToRgba` went too: its only purpose was
   tinting these headings, and a swatch needs no tint. */
const GROUP_COLORS = {
  // Priority — groupBy 'priority'
  'Next Up': priorityColor('Next Up'),
  'Soon': priorityColor('Soon'),
  'Maybe': priorityColor('Maybe'),
  'Someday': priorityColor('Someday'),
  'Unprioritized': priorityColor(null),
  // Feel — groupBy 'rating'
  'Perfection': 'var(--feel-perfection)',
  'Go for it': 'var(--feel-go-for-it)',
  'Timepass': 'var(--feel-timepass)',
  'Skip': 'var(--feel-skip)',
  'Unrated': 'var(--feel-none)',
};



/* Drag ghost. LIFT_SCALE is the pickup — the card comes up off the shelf at very
   near full size, which is the gesture worth keeping. After PICKUP_MS it drops to
   GHOST_SCALE and hangs LEAD px below and right of the cursor, so it stops
   covering the status tabs it is being carried to. */
/* One screenful. The rest of the shelf mounts on the following frame. */
const FIRST_PAINT_CARDS = 12;

/* Undo exists for mis-drops, which is exactly the case where WHICH game you
   just moved is the only fact that matters — and every toast used to read
   "Moved to Backlog" with no name, so three quick moves gave three identical
   reversal buttons and no way to tell them apart. Quoted and clipped, because
   the toast is 280px wide and IGDB titles run long. */
const NAME_MAX = 28;
const nameFor = (game) => {
  const n = (game?.name || 'this game').trim();
  return `"${n.length > NAME_MAX ? n.slice(0, NAME_MAX - 1).trimEnd() + '…' : n}"`;
};

const LIFT_HINT_KEY = 'moctale_lift_hint_done';
const LIFT_SCALE = 1.03;
const GHOST_SCALE = 0.45;
const PICKUP_MS = 120;
const SHRINK_MS = 160;
const LEAD = 24;

const TABS = ["Playing", "Backlog", "Wishlist", "Beaten", "Dropped", "Unreleased"];

const TAB_ICON = {
  'Playing': Gamepad2,
  'Backlog': ListIcon,
  'Wishlist': Heart,
  'Beaten': Trophy,
  'Dropped': CircleMinus,
  'Unreleased': CalendarClock,
};


// Per-tab controls — one source of truth for which sorts/groups apply to each
// shelf and its defaults. Only options that make sense for a shelf are offered
// (e.g. user-rating needs a "feel", which only Beaten/Dropped games carry;
// time-to-beat is for planning, so not on Beaten).
const TAB_CONFIG = {
  Playing:    { sorts: ['priority', 'ttb-asc', 'public-desc', 'year-desc', 'year-asc', 'alpha', 'alpha-desc'],
                groups: ['none', 'priority', 'year', 'platform', 'franchise'], sort: 'priority', group: 'priority' },
  Backlog:    { sorts: ['priority', 'ttb-asc', 'public-desc', 'year-desc', 'year-asc', 'alpha', 'alpha-desc'],
                groups: ['none', 'priority', 'year', 'platform', 'franchise'], sort: 'priority', group: 'priority' },
  Wishlist:   { sorts: ['priority', 'ttb-asc', 'public-desc', 'year-desc', 'year-asc', 'alpha', 'alpha-desc'],
                groups: ['none', 'priority', 'year', 'platform', 'franchise'], sort: 'priority', group: 'none' },
  Beaten:     { sorts: ['date-desc', 'date-asc', 'rating-desc', 'public-desc', 'year-desc', 'year-asc', 'alpha', 'alpha-desc'],
                groups: ['none', 'completed-year', 'rating', 'year', 'platform', 'franchise'], sort: 'date-desc', group: 'completed-year' },
  Dropped:    { sorts: ['rating-desc', 'public-desc', 'year-desc', 'year-asc', 'alpha', 'alpha-desc'],
                groups: ['none', 'rating', 'year', 'platform', 'franchise'], sort: 'alpha', group: 'none' },
  Unreleased: { sorts: ['priority', 'year-desc', 'year-asc', 'public-desc', 'alpha', 'alpha-desc'],
                groups: ['none', 'priority', 'year', 'platform', 'franchise'], sort: 'year-desc', group: 'year' },
};
const FALLBACK_CONFIG = { sorts: ['alpha'], groups: ['none'], sort: 'alpha', group: 'none' };
const tabCfg = (tab) => TAB_CONFIG[tab] || FALLBACK_CONFIG;


/* What each shelf is FOR, and where its next step actually leads. An empty state
   that only says "nothing here" teaches nothing; naming the shelf's job is what
   tells a first-run user why they would ever put something in it.

   The action differs per shelf because the honest next step does. You fill
   Wishlist by exploring, but you fill Beaten by finishing something you are
   already playing — sending someone to Explore from an empty Beaten shelf is a
   non-sequitur. Dropped is the one shelf nobody should be encouraged to fill. */
const SHELF_EMPTY = {
  Playing: { purpose: 'Games you have on the go right now.', label: 'Start Something From Backlog', to: '/library/backlog' },
  Backlog: { purpose: 'Games you own and intend to play next.', label: 'Explore Games', to: '/' },
  Wishlist: { purpose: 'Games you want but have not bought yet.', label: 'Explore Games', to: '/' },
  Beaten: { purpose: 'Games you have finished, with your rating and notes.', label: 'See What You Are Playing', to: '/library/playing' },
  Dropped: { purpose: 'Games you have stopped playing, kept for the record. An empty shelf here is a good sign.', label: null, to: null },
  Unreleased: { purpose: 'Games you are waiting on. They move here on release day.', label: 'Explore Games', to: '/' },
};

/** Bordered plate, house style — matches the Discover and Collections empty states. */
const EmptyPlate = ({ title, children, actions }) => (
  <div className="border border-white/15 text-center py-16 px-4">
    <h2 className="lh-display text-xl text-white/60 mb-2 m-0">{title}</h2>
    <p className="text-[15px] leading-relaxed text-white/60 max-w-prose mx-auto">{children}</p>
    {actions && <div className="flex flex-wrap items-center justify-center gap-2 mt-6">{actions}</div>}
  </div>
);

const PlateButton = ({ onClick, children, primary }) => (
  <button
    onClick={onClick}
    className={`lh-label px-4 py-2 border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${primary
      ? 'border-white bg-white text-black hover:bg-neutral-200'
      : 'border-white/40 text-white hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black'}`}
  >
    {children}
  </button>
);

/**
 * The library's empty state, split by WHY it is empty — the three cases used to
 * share one dead-end message.
 *
 *   filtered      you have games, a query or filter just hides them → give them back
 *   libraryEmpty  genuine first run → the only screen that should sell the product
 *   otherwise     this shelf is empty but others are not → explain the shelf
 */
function LibraryEmptyState({ tab, libraryEmpty, filtered, onClearFilters, onExplore, onImport, onGo }) {
  if (filtered) {
    return (
      <EmptyPlate
        title="No Matches"
        actions={<PlateButton primary onClick={onClearFilters}>Clear Search &amp; Filters</PlateButton>}
      >
        Nothing on this shelf matches what you are looking for. Your games are still here.
      </EmptyPlate>
    );
  }

  if (libraryEmpty) {
    return (
      <EmptyPlate
        title="Your Library Is Empty"
        actions={
          <>
            <PlateButton primary onClick={onExplore}>Explore Games</PlateButton>
            <PlateButton onClick={onImport}>Import A Library</PlateButton>
          </>
        }
      >
        Shelve a game and it lands here, with its status, priority, rating and notes.
        Start from scratch, or bring a collection across from somewhere else.
      </EmptyPlate>
    );
  }

  const shelf = SHELF_EMPTY[tab];
  return (
    <EmptyPlate
      title={`Nothing In ${tab}`}
      actions={shelf?.to
        ? <PlateButton primary onClick={() => onGo(shelf.to)}>{shelf.label}</PlateButton>
        : null}
    >
      {shelf?.purpose || 'Nothing on this shelf yet.'} Your other shelves still have games.
    </EmptyPlate>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const { status } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  // An unknown shelf used to serve Backlog while the URL kept the bad value.
  const unknownShelf = !!status && !TABS.some(t => t.toLowerCase() === status.toLowerCase());
  useEffect(() => {
    if (unknownShelf) navigate('/library/backlog', { replace: true });
  }, [unknownShelf, navigate]);

  const activeTab = useMemo(() => {
    if (!status) return 'Backlog';
    const matched = TABS.find(t => t.toLowerCase() === status.toLowerCase());
    return matched || 'Backlog';
  }, [status]);

  const [library, setLibrary] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirm, confirmProps] = useConfirm();
  const searchInputRef = useRef(null);

  // ── Transfer Data state ──────────────────────────────────────────
  const [transferSourceGame, setTransferSourceGame] = useState(null);

  // ── Sidebar filter/sort state ────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [isSearchOpen, setIsSearchOpen] = useState(() => !!searchParams.get('q'));

  // An inline `ref={el => el.focus()}` fired on every render, yanking focus back to
  // the search field from whatever the user had moved to. Focus once, on open.
  useEffect(() => { if (isSearchOpen) searchInputRef.current?.focus(); }, [isSearchOpen]);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const [tabSettings, setTabSettings] = useState(() => {
    const saved = localStorage.getItem('moctale_tab_settings');
    const DEFAULT_TAB_SETTINGS = Object.fromEntries(
      TABS.map(t => [t, { filter: 'all', sort: tabCfg(t).sort, group: tabCfg(t).group }])
    );
    // Seed from URL params if present (restoring from back navigation)
    const urlFilter = searchParams.get('filter');
    const urlSort = searchParams.get('sort');
    const urlGroup = searchParams.get('group');
    const activeTabInit = (() => {
      if (!status) return 'Backlog';
      return TABS.find(t => t.toLowerCase() === status.toLowerCase()) || 'Backlog';
    })();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const merged = { ...DEFAULT_TAB_SETTINGS };
        Object.keys(DEFAULT_TAB_SETTINGS).forEach(tab => {
          if (parsed[tab]) merged[tab] = { ...DEFAULT_TAB_SETTINGS[tab], ...parsed[tab] };
        });
        if (urlFilter) merged[activeTabInit] = { ...merged[activeTabInit], filter: urlFilter };
        if (urlSort) merged[activeTabInit] = { ...merged[activeTabInit], sort: urlSort };
        if (urlGroup) merged[activeTabInit] = { ...merged[activeTabInit], group: urlGroup };
        return merged;
      } catch (e) {
        console.error('Failed to parse tab settings:', e);
      }
    }
    const base = { ...DEFAULT_TAB_SETTINGS };
    if (urlFilter) base[activeTabInit] = { ...base[activeTabInit], filter: urlFilter };
    if (urlSort) base[activeTabInit] = { ...base[activeTabInit], sort: urlSort };
    if (urlGroup) base[activeTabInit] = { ...base[activeTabInit], group: urlGroup };
    return base;
  });

  useEffect(() => {
    localStorage.setItem('moctale_tab_settings', JSON.stringify(tabSettings));
  }, [tabSettings]);

  // ── Keep URL in sync with current tab's settings ──────────────────
  const syncUrlParams = useCallback((overrides = {}) => {
    const current = tabSettings[activeTab] || {};
    const params = {};
    const q = overrides.q !== undefined ? overrides.q : searchQuery;
    const filter = overrides.filter !== undefined ? overrides.filter : (current.filter || 'all');
    const sort = overrides.sort !== undefined ? overrides.sort : (current.sort || 'alpha');
    const group = overrides.group !== undefined ? overrides.group : (current.group || 'none');
    if (q) params.q = q;
    if (filter !== 'all') params.filter = filter;
    if (sort) params.sort = sort;
    if (group) params.group = group;
    /* Own q/filter/sort/group and nothing else. Building the URL from {} deleted
       the shell's search=true, so the search overlay could not be deep-linked
       and did not survive a reload. */
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ['q', 'filter', 'sort', 'group'].forEach(k => next.delete(k));
      Object.entries(params).forEach(([k, v]) => next.set(k, v));
      return next;
    }, { replace: true });
  }, [activeTab, tabSettings, searchQuery, setSearchParams]);

  // Sync URL whenever tab changes
  // Not while the redirect above is in flight: setSearchParams resolves against the
  // stale pathname and would put the unknown shelf straight back into the URL.
  useEffect(() => { if (!unknownShelf) syncUrlParams(); }, [activeTab, unknownShelf]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSettings = tabSettings[activeTab] || { filter: 'all', sort: 'alpha', group: 'none' };
  const filterOption = currentSettings.filter;
  const sortOption = currentSettings.sort;
  const groupBy = currentSettings.group;

  const setFilterOption = useCallback((val) => {
    setTabSettings(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], filter: val } }));
    syncUrlParams({ filter: val });
  }, [activeTab, syncUrlParams]);

  const setSortOption = useCallback((val) => {
    setTabSettings(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], sort: val } }));
    syncUrlParams({ sort: val });
  }, [activeTab, syncUrlParams]);

  const setGroupBy = useCallback((val) => {
    setTabSettings(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], group: val } }));
    syncUrlParams({ group: val });
  }, [activeTab, syncUrlParams]);

  const setSearchQueryAndUrl = useCallback((val) => {
    setSearchQuery(val);
    syncUrlParams({ q: val });
  }, [syncUrlParams]);

  // Migrate any saved sort/group that a tab no longer offers back to its default
  // (e.g. after trimming an option, or a setting saved under a different tab).
  /* Done during render rather than in an effect: an invalid saved sort would
     otherwise order one painted frame before being migrated, so the shelf
     visibly re-sorted itself on arrival. The updater returns `prev` unchanged
     when nothing needs migrating, so this settles in a single pass. */
  const [migratedTab, setMigratedTab] = useState(null);
  if (migratedTab !== activeTab) {
    setMigratedTab(activeTab);
    const cfg = tabCfg(activeTab);
    setTabSettings(prev => {
      const current = prev[activeTab];
      if (!current) return prev;
      const isSortValid = cfg.sorts.includes(current.sort);
      const isGroupValid = cfg.groups.includes(current.group);
      if (isSortValid && isGroupValid) return prev;
      return {
        ...prev,
        [activeTab]: {
          ...current,
          sort: isSortValid ? current.sort : cfg.sort,
          group: isGroupValid ? current.group : cfg.group,
        },
      };
    });
  }

  const toggleGroupCollapse = (groupLabel) => {
    const key = `${groupBy}:${groupLabel}`;
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };


  // ── Drag-and-drop state ──────────────────────────────────────────
  const [draggedGame, setDraggedGame] = useState(null);
  const isDraggingRef = useRef(false);
  const ghostRef = useRef(null);
  const ghostUpdateRef = useRef(null);

  // ── Toast state ──────────────────────────────────────────────────

  const hydrateLibrary = async () => {
    setIsLoading(true);
    const localData = getLibrary();
    const normalizedLocalData = localData.map((game) => ({
      ...game,
      status: normalizeStatus(game.status) || game.status || 'Backlog',
    }));
    try {
      const igdbIds = normalizedLocalData.filter(g => !g.is_custom && !String(g.id).startsWith('custom_')).map(g => g.id);
      let fetchedIgdbGames = [];
      if (igdbIds.length > 0) fetchedIgdbGames = await getGamesByIds(igdbIds);
      const hydratedLibrary = normalizedLocalData.map(localGame => {
        if (localGame.is_custom || String(localGame.id).startsWith('custom_')) return { ...localGame, cover_id: null, dev: localGame.dev || 'Unknown Developer', release_year: localGame.release_year || 'Unknown Year' };
        const igdbData = fetchedIgdbGames.find(g => g.id.toString() === localGame.id.toString());
        if (!igdbData) return localGame;
        let devName = 'Unknown Developer';
        if (igdbData.involved_companies?.length > 0) {
          const dev = igdbData.involved_companies.find(c => c.developer);
          devName = dev?.company?.name || igdbData.involved_companies[0].company?.name || 'Unknown Developer';
        }
        return {
          ...localGame,
          name: igdbData.name,
          cover_id: igdbData.cover?.image_id || null,
          cover_width: igdbData.cover?.width || null,
          cover_height: igdbData.cover?.height || null,
          dev: devName,
          first_release_date: igdbData.first_release_date || null,
          release_year: igdbData.first_release_date ? new Date(igdbData.first_release_date * 1000).getFullYear() : 'Unknown Year',
          total_rating: igdbData.total_rating || null,
          game_type: igdbData.game_type ?? null,
          franchises: igdbData.franchises || [],
          collections: igdbData.collections || [],
          game_time_to_beat: igdbData.game_time_to_beat || null,
          _igdb_synced: true,
        };
      });


      // ── Auto-Migration: Release Status Sync ─────────────────────
      let migrationHappened = false;
      const migratedLibrary = hydratedLibrary.map(g => {
        if (g.is_custom || String(g.id).startsWith('custom_')) return g;
        if (!g._igdb_synced) return g;

        const hasReleaseDate = !!g.first_release_date;
        const isUnreleased = hasReleaseDate && (g.first_release_date * 1000 > Date.now());
        const shouldBeUnreleased = !hasReleaseDate || isUnreleased;

        if (shouldBeUnreleased && g.status !== 'Unreleased') {
          migrationHappened = true;
          const updated = { ...g, status: 'Unreleased' };
          saveToLibrary(updated);
          return updated;
        }

        if (hasReleaseDate && !isUnreleased && g.status === 'Unreleased') {
          migrationHappened = true;
          const updated = { ...g, status: 'Wishlist' };
          saveToLibrary(updated);
          return updated;
        }

        return g;
      });

      setLibrary(migrationHappened ? migratedLibrary : hydratedLibrary);
    } catch (error) {
      console.error('Library hydration failed:', error);
      setLibrary(normalizedLocalData);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       hydrateLibrary opens with setIsLoading(true), which on mount is the value
       isLoading already holds, so nothing changes. It cannot be split out: the
       same function is the refresh path further down, where the flag does have
       to be raised. */
    hydrateLibrary();
    return () => {
      if (ghostUpdateRef.current) {
        document.removeEventListener('dragover', ghostUpdateRef.current);
      }
      if (ghostRef.current) {
        ghostRef.current.remove();
      }
    };
  }, []);

  const availablePlatforms = useMemo(() => {
    const set = new Set();
    library.forEach(game => {
      game.user_platforms?.forEach(p => {
        if (!p.category || p.category === 'hardware') {
          set.add(p.name);
        }
      });
    });
    return Array.from(set).sort();
  }, [library]);

  const availableStores = useMemo(() => {
    const set = new Set();
    library.forEach(game => {
      game.user_stores?.forEach(s => set.add(s.name));
      game.user_platforms?.forEach(p => {
        if (p.category === 'store' || p.category === 'subscription') {
          set.add(p.name);
        }
      });
    });
    return Array.from(set).sort();
  }, [library]);

  const filterOptions = useMemo(() => {
    const opts = [
      { value: 'all', label: 'All', icon: FilterX },
      { value: 'igdb', label: 'Official', icon: Database, dividerAbove: true },
      { value: 'custom', label: 'Custom', icon: Edit3 },
      { value: 'type:main', label: 'Main', icon: Gamepad2, dividerAbove: true },
      { value: 'type:dlc', label: 'DLCs', icon: Puzzle }
    ];
    if (availablePlatforms.length > 0) {
      /* Each platform's own mark, the same brand-coloured treatment this page
         already gives its platform group headings. Every row here carried the
         same Gamepad2, so a list of PS5, Xbox and Switch rendered as three
         identical icons -- which is worse than no icon, because it occupies the
         position where the thing that distinguishes the rows should be. */
      availablePlatforms.forEach((name, i) => {
        opts.push({
          value: `platform:${name}`,
          label: name,
          icon: <PlatformGlyph platform={name} />,
          ...(i === 0 ? { dividerAbove: true } : {}),
        });
      });
    }
    if (availableStores.length > 0) {
      opts.push({ value: `store:${availableStores[0]}`, label: availableStores[0], icon: Store, dividerAbove: true });
      for (let i = 1; i < availableStores.length; i++) {
        opts.push({ value: `store:${availableStores[i]}`, label: availableStores[i], icon: Store });
      }
    }
    return opts;
  }, [availablePlatforms, availableStores]);

  // Options are filtered to the current tab (tabCfg) and shown in this fixed,
  // grouped order; the first visible item never carries a divider.
  const sortOptions = useMemo(() => {
    const allowed = tabCfg(activeTab).sorts;
    const allOptions = [
      { value: 'priority', label: 'Priority', icon: AlertCircle },
      { value: 'date-desc', label: 'Completed · New', icon: CalendarCheck, dividerAbove: true },
      { value: 'date-asc', label: 'Completed · Old', icon: CalendarCheck },
      { value: 'rating-desc', label: 'Your Rating', icon: Star, dividerAbove: true },
      { value: 'public-desc', label: 'Public Rating', icon: Globe },
      { value: 'ttb-asc', label: 'Time to Beat', icon: Timer },
      { value: 'year-desc', label: 'Release · New', icon: Calendar, dividerAbove: true },
      { value: 'year-asc', label: 'Release · Old', icon: Calendar },
      { value: 'alpha', label: 'A → Z', icon: ArrowDownAZ, dividerAbove: true },
      { value: 'alpha-desc', label: 'Z → A', icon: ArrowUpZA },
    ];
    return allOptions
      .filter(o => allowed.includes(o.value))
      .map((o, idx) => (idx === 0 ? { ...o, dividerAbove: false } : o));
  }, [activeTab]);

  const groupByOptions = useMemo(() => {
    const allowed = tabCfg(activeTab).groups;
    const allOptions = [
      { value: 'none', label: 'None', icon: ListIcon },
      { value: 'priority', label: 'Priority', icon: AlertCircle, dividerAbove: true },
      { value: 'rating', label: 'Your Rating', icon: Star },
      { value: 'completed-year', label: 'Completion Year', icon: CalendarCheck, dividerAbove: true },
      { value: 'year', label: 'Release Year', icon: Calendar },
      { value: 'platform', label: 'Platform', icon: Gamepad2, dividerAbove: true },
      { value: 'franchise', label: 'Franchise', icon: Database },
    ];
    return allOptions
      .filter(o => allowed.includes(o.value))
      .map((o, idx) => (idx === 0 ? { ...o, dividerAbove: false } : o));
  }, [activeTab]);

  const displayedGamesData = useMemo(() => {
    let games = library.filter(game => normalizeStatus(game.status) === activeTab);

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      games = games.filter(g =>
        g.name?.toLowerCase().includes(q) ||
        g.dev?.toLowerCase().includes(q)
      );
    }

    // Filter logic
    if (filterOption === 'igdb') {
      games = games.filter(g => !g.is_custom && !String(g.id).startsWith('custom_'));
    } else if (filterOption === 'custom') {
      games = games.filter(g => g.is_custom || String(g.id).startsWith('custom_'));
    } else if (filterOption.startsWith('platform:')) {
      const platformName = filterOption.replace('platform:', '');
      games = games.filter(g => g.user_platforms?.some(p => p.name === platformName && (!p.category || p.category === 'hardware')));
    } else if (filterOption.startsWith('store:')) {
      const storeName = filterOption.replace('store:', '');
      games = games.filter(g =>
        g.user_stores?.some(s => s.name === storeName) ||
        g.user_platforms?.some(p => p.name === storeName && (p.category === 'store' || p.category === 'subscription'))
      );
    } else if (filterOption.startsWith('type:')) {
      const typeStr = filterOption.replace('type:', '');
      games = games.filter(g => {
        if (typeStr === 'main') return g.game_type === 0;
        if (typeStr === 'dlc') return g.game_type === 1 || g.game_type === 2 || g.game_type === 3 || g.game_type === 4;
        if (typeStr === 'remake') return g.game_type === 8 || g.game_type === 9;
        return true;
      });
    }

    const sortedGames = sortGames(games, sortOption);

    if (groupBy === 'none') {
      return [{ label: null, games: sortedGames }];
    }

    if (groupBy === 'priority') {
      const groups = [
        { label: 'Next Up', games: [] },
        { label: 'Soon', games: [] },
        { label: 'Maybe', games: [] },
        { label: 'Someday', games: [] },
        { label: 'Unprioritized', games: [] },
      ];
      sortedGames.forEach(g => {
        const group = groups.find(gr => gr.label === g.priority) || groups[4];
        group.games.push(g);
      });
      return groups.filter(gr => gr.games.length > 0);
    }

    if (groupBy === 'rating') {
      const groups = [
        { label: 'Perfection', games: [] },
        { label: 'Go for it', games: [] },
        { label: 'Timepass', games: [] },
        { label: 'Skip', games: [] },
        { label: 'Unrated', games: [] },
      ];
      sortedGames.forEach(g => {
        const group = groups.find(gr => gr.label === g.feel) || groups[4];
        group.games.push(g);
      });
      return groups.filter(gr => gr.games.length > 0);
    }

    if (groupBy === 'platform') {
      const groupsMap = new Map();
      sortedGames.forEach(g => {
        const targets = [];
        g.user_platforms?.forEach(p => {
          if (p.name) targets.push(p.name);
        });
        g.user_stores?.forEach(s => {
          if (s.name) targets.push(s.name);
        });
        const uniqueTargets = Array.from(new Set(targets));
        if (uniqueTargets.length === 0) {
          const fallback = 'Unknown Platform';
          if (!groupsMap.has(fallback)) groupsMap.set(fallback, []);
          groupsMap.get(fallback).push(g);
        } else {
          uniqueTargets.forEach(target => {
            if (!groupsMap.has(target)) groupsMap.set(target, []);
            groupsMap.get(target).push(g);
          });
        }
      });
      return Array.from(groupsMap.entries()).map(([label, games]) => ({ label, games })).sort((a, b) => a.label.localeCompare(b.label));
    }

    if (groupBy === 'completed-year') {
      const groupsMap = new Map();
      sortedGames.forEach(g => {
        const year = g.dateCompleted ? new Date(g.dateCompleted).getFullYear() : 'No Date';
        if (!groupsMap.has(year)) groupsMap.set(year, []);
        groupsMap.get(year).push(g);
      });
      return Array.from(groupsMap.entries())
        .map(([label, games]) => ({ label: String(label), games }))
        .sort((a, b) => {
          if (a.label === 'No Date') return 1;
          if (b.label === 'No Date') return -1;
          /* Follows the sort. Hardcoded descending, picking "Completed . Old"
             still listed the newest year first, so the control looked broken in
             exactly the way the release sort did on Unreleased. */
          return groupDirection(sortOption) * (parseInt(a.label) - parseInt(b.label));
        });
    }

    if (groupBy === 'year') {
      const groupsMap = new Map();
      sortedGames.forEach(g => {
        const year = g.release_year || 'Unknown Year';
        if (!groupsMap.has(year)) groupsMap.set(year, []);
        groupsMap.get(year).push(g);
      });
      return Array.from(groupsMap.entries())
        .map(([label, games]) => ({ label: String(label), games }))
        .sort((a, b) => {
          if (a.label === 'Unknown Year') return 1;
          if (b.label === 'Unknown Year') return -1;
          /* Follows the sort rather than always descending. With the old
             hardcoded order, "Release . Old" on the Unreleased shelf -- which
             defaults to grouping by this very key -- left 2028 above 2026 while
             the cards inside had already flipped. */
          return groupDirection(sortOption) * (parseInt(a.label) - parseInt(b.label));
        });
    }

    if (groupBy === 'franchise') {
      const groupsMap = new Map();
      const ungroupedGames = [];

      sortedGames.forEach(g => {
        const franchises = g.franchises || [];

        const groupNames = new Set();
        franchises.forEach(f => {
          if (f.name) groupNames.add(f.name);
        });

        if (groupNames.size === 0) {
          ungroupedGames.push(g);
        } else {
          groupNames.forEach(name => {
            if (!groupsMap.has(name)) groupsMap.set(name, []);
            groupsMap.get(name).push(g);
          });
        }
      });

      const resultGroups = Array.from(groupsMap.entries())
        .map(([label, games]) => ({ label, games }))
        .sort((a, b) => a.label.localeCompare(b.label));

      if (ungroupedGames.length > 0) {
        resultGroups.push({ label: 'Standalone / Unknown Franchise', games: ungroupedGames });
      }
      return resultGroups;
    }

    return [{ label: null, games: sortedGames }];
  }, [library, activeTab, searchQuery, sortOption, filterOption, groupBy]);

  /* Clearing now happens from the account menu, off this page, so the page has
     to hear about it. Re-reading local storage is cheap and synchronous; a full
     hydrate would refetch IGDB on every ordinary status change, since every
     card dispatches this same event. */
  useEffect(() => {
    const onLibChange = () => { if (getLibrary().length === 0) setLibrary([]); };
    window.addEventListener('moctale_lib_update', onLibChange);
    return () => window.removeEventListener('moctale_lib_update', onLibChange);
  }, []);


  const dragRafRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const ghostScaleRef = useRef(LIFT_SCALE);
  const ghostShrinkRef = useRef(null);
  const lastPointRef = useRef({ x: 0, y: 0 });

  /* One writer for the ghost transform, because the shrink has to be able to
     repaint on its own. The transform was only ever rewritten from a dragover,
     so flipping the scale on a timer did nothing until the pointer next moved —
     pick a card up and hold still and it stayed at full size indefinitely. */
  const paintGhost = useCallback((clientX, clientY) => {
    if (!ghostRef.current) return;
    const { x, y } = dragOffsetRef.current;
    ghostRef.current.style.transform =
      `translate3d(${clientX - x}px, ${clientY - y}px, 0) rotate(2.5deg) scale(${ghostScaleRef.current})`;
  }, []);

  const handleDrag = useCallback((e) => {
    e.preventDefault(); // Required to make document a valid drop target and fire events continuously
    if (ghostRef.current && (e.clientX !== 0 || e.clientY !== 0)) {
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = requestAnimationFrame(() => paintGhost(e.clientX, e.clientY));
    }
  }, [paintGhost]);

  /* Ghost — a live clone of the real card, lifted in place under the pointer.
     Cloning (vs. native setDragImage) keeps the manual-follow mechanism Tauri
     needs, and it is what lets a touch lift look identical to a mouse drag:
     both raise the same card the same way, so this is one function and not two
     that drift apart. */
  const raiseGhost = useCallback((cardEl, x, y) => {
    const rect = cardEl.getBoundingClientRect();
    dragOffsetRef.current = { x: (x || 0) - rect.left, y: (y || 0) - rect.top };
    /* Seeded here so the shrink can repaint even if the pointer never moves. */
    lastPointRef.current = { x: x || rect.left, y: y || rect.top };
    ghostScaleRef.current = LIFT_SCALE;

    const ghost = cardEl.cloneNode(true);
    ghost.style.cssText = `position:fixed;left:0;top:0;width:${rect.width}px;margin:0;pointer-events:none;z-index:99999;will-change:transform;transform:translate3d(${rect.left}px,${rect.top}px,0) rotate(2.5deg) scale(${LIFT_SCALE});transform-origin:${dragOffsetRef.current.x}px ${dragOffsetRef.current.y}px;`;
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    /* The ghost is a 1:1 clone pinned at the grab point, which means it sits on
       top of the very tabs it is being carried to: with the cursor over Playing
       it covered Playing and Backlog outright, and the drop-target highlight is
       the only confirmation of where the game will land. Drawing it underneath
       the thing in your hand is what makes mis-drops routine — and mis-drops are
       the reason undo exists.

       The lift stays. It is the best moment in the product and it needs to be
       read at full size, so the shrink waits PICKUP_MS and then re-anchors the
       card below and right of the cursor, where it can never cover a target that
       is above it. transform-origin never changes — the offset absorbs the scale
       instead — so there is no discontinuity to animate around. */
    const gx = dragOffsetRef.current.x, gy = dragOffsetRef.current.y;
    ghostShrinkRef.current = setTimeout(() => {
      const el = ghostRef.current;
      if (!el) return;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.style.transition = `transform ${SHRINK_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        setTimeout(() => { if (ghostRef.current) ghostRef.current.style.transition = ''; }, SHRINK_MS + 20);
      }
      ghostScaleRef.current = GHOST_SCALE;
      /* Solving tx + ox(1 - s) = clientX + LEAD for the offset paintGhost subtracts. */
      dragOffsetRef.current = { x: gx * (1 - GHOST_SCALE) - LEAD, y: gy * (1 - GHOST_SCALE) - LEAD };
      paintGhost(lastPointRef.current.x, lastPointRef.current.y);
    }, PICKUP_MS);

    document.body.classList.add('dragging-active');
  }, [paintGhost]);

  const handleDragStart = useCallback((e, game) => {
    isDraggingRef.current = true;
    setDraggedGame(game);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', game.id ? game.id.toString() : '');

    // Create transparent pixel to hide default browser translucent ghost
    try {
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
    } catch {
      // Ignore
    }

    raiseGhost(e.currentTarget, e.clientX, e.clientY);

    // Attach global listeners for continuous coordinate updates in Tauri
    document.addEventListener('dragover', handleDrag, { passive: false });
    document.addEventListener('dragenter', handleDrag, { passive: false });
    ghostUpdateRef.current = handleDrag;
  }, [handleDrag, raiseGhost]);

  /* Touch lift — the same capability as the desktop drag, by a different route.
     HTML5 drag-and-drop does not fire on touch at all, so the best interaction
     in the product was mouse-only. See beginLift below. */
  /* Re-entrancy guard. A ref, not state: a second finger can long-press a
     second card before React has re-rendered from the first, and only a ref is
     true by then. */
  const liftingRef = useRef(false);

  /* Below xl the strip is ONE row: the shelf you are on, its count, and a way to
     change it. Six shelves in three rows cost 99px — 15% of an iPhone viewport —
     held permanently for a control you touch once a session.

     It holds that one shape at rest and changes it only on a deliberate act.
     The previous version folded on scroll, and every problem it had came from
     that: a two-phase leave whose fade read as the cells turning black, a 110ms
     gap before the row closed, a document reflow on every crossing, and a
     threshold that had to out-run the browser's own scroll compensation. A strip
     that does not change shape while you scroll has none of those to get wrong,
     and it reclaims the space at EVERY scroll position rather than only once you
     have scrolled past 96px.

     There is exactly one shape change left: a lifted card needs somewhere to
     land, so the whole set of shelves comes back for the duration of a drag.
     That one is free — it fires once per drag rather than once per scroll,
     nothing is competing for the frame, and the grid underneath is already
     dimmed to 0.11 and inert, so pushing it down is invisible. It rides
     `draggedGame`, which React already re-renders for. */
  const [shelfPickerOpen, setShelfPickerOpen] = useState(false);
  const stripRef = useRef(null);

  /* The shelves stagger in when a lift brings them back. Written straight to the
     nodes: a shelf strip has no business costing a render of the grid, which is
     the lesson the drag-over highlight below already records and the scroll fold
     had to learn twice. */
  const stripEnterRef = useRef(false);
  useEffect(() => {
    const el = stripRef.current;
    const on = !!draggedGame;
    if (!el || stripEnterRef.current === on) return;
    stripEnterRef.current = on;
    if (!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The app's curve, shared with the toast, tooltip and wallpaper lightbox.
    const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    [...el.querySelectorAll('.lh-tab')]
      .filter((cell) => cell.offsetParent !== null)
      .forEach((cell, i) => cell.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 200, easing: EASE, delay: i * 16, fill: 'backwards' },
      ));
  }, [draggedGame]);

  /* A long press is an invisible gesture. Nothing on the card suggests it, the
     ⋯ menu does not mention it, and the best interaction in the library was
     findable only by accident — so it is said once, in words, and then never
     again. Retired by using it, not only by dismissing it: someone who has
     lifted a card has learned the thing this line exists to teach.

     Touch only. On a mouse the card is already draggable and says so with a
     grab cursor, so the hint would be noise about a gesture that does not
     apply. localStorage directly, matching moctale_tab_settings above rather
     than adding a service for one boolean. */
  const [liftHintDone, setLiftHintDone] = useState(
    () => localStorage.getItem(LIFT_HINT_KEY) === '1'
      || !window.matchMedia('(pointer: coarse)').matches,
  );
  const retireLiftHint = useCallback(() => {
    localStorage.setItem(LIFT_HINT_KEY, '1');
    setLiftHintDone(true);
  }, []);

  const dropOverElRef = useRef(null);
  const setDropOverEl = useCallback((el) => {
    if (dropOverElRef.current === el) return;
    dropOverElRef.current?.classList.remove('is-drop-over');
    dropOverElRef.current = el;
    el?.classList.add('is-drop-over');
  }, []);

  const cleanupGhostDOM = useCallback(() => {
    if (ghostShrinkRef.current) {
      clearTimeout(ghostShrinkRef.current);
      ghostShrinkRef.current = null;
    }
    ghostScaleRef.current = LIFT_SCALE;
    if (ghostUpdateRef.current) {
      document.removeEventListener('dragover', ghostUpdateRef.current);
      document.removeEventListener('dragenter', ghostUpdateRef.current);
      ghostUpdateRef.current = null;
    }
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }
    document.body.classList.remove('dragging-active');
    // A cancelled drag (Escape, or a drop outside any target) fires no
    // dragleave, so the lit cell would stay lit until the next drag.
    setDropOverEl(null);
  }, [setDropOverEl]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    setDraggedGame(null);
    cleanupGhostDOM();
  }, [cleanupGhostDOM]);

  const handleRemoveGame = useCallback((gameId, gameName) => confirm(
    { eyebrow: 'Library', title: `Remove ${gameName}?`, body: 'Its status, rating, priority, notes and completion date go with it. There is no undo.', confirmLabel: 'Remove' },
    () => {
      removeFromLibrary(gameId);
      setLibrary(prev => prev.filter(g => g.id.toString() !== gameId.toString()));
      toast(`Removed "${gameName}"`);
    },
  ), [confirm]);

  /* The drag-over highlight is a class toggled on one element, not React state.
     It used to be state, which meant every dragover that crossed a tab boundary
     re-rendered the page and every card on it — with 297 cards on a 4x-throttled
     CPU that was a 57.5ms median frame and not one frame of the drag under 32ms.
     Nothing in the grid depends on which tab is hovered, so nothing in the grid
     needs to hear about it.

     A ref-guard against repeated values is deliberately NOT here: React already
     bails out of an unchanged useState write, and an A/B measured that guard as
     worth nothing (16.9ms median with it, 16.6ms without). The cost was never
     the repeats — it was the genuine changes. */
  const handleTabDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropOverEl(e.currentTarget);
  }, [setDropOverEl]);

  /* Only clear when leaving the cell that is actually lit: dragleave also fires
     when the pointer crosses onto a child span. */
  const handleTabDragLeave = useCallback((e) => {
    if (dropOverElRef.current === e.currentTarget) setDropOverEl(null);
  }, [setDropOverEl]);

  /* One writer for every field mutation, so every one of them offers the same
     reversal. Each used to write and toast with no way back — and the most common
     of them is fired by a drag, the least precise gesture in the app. Declared
     above handleTabDrop because the drop path had its own inline copy of this
     write; routing that through here is the whole point, since a mis-drop is
     exactly what a user needs to undo. The snapshot is the entire prior entry, so
     undo restores the field as it was, including "unset". */
  const mutateGame = useCallback((game, patch, message) => {
    const before = { ...game };
    const updated = { ...game, ...patch };
    saveToLibrary(updated);
    setLibrary(prev => prev.map(g => g.id === game.id ? updated : g));

    /* Undo has to name the keys it is reversing rather than hand back the whole
       prior entry, because saveToLibrary MERGES. Passing `before` therefore
       restored a field that had a previous value and silently failed on one that
       had none: setting a priority on a game that had never had one, then
       undoing, left the new priority in storage while the card reverted from
       React state -- so it looked undone until the next refresh. Reproduced:
       a game with `priority: 'Soon'` undid correctly, one with no `priority` key
       did not.

       null, not undefined or a deleted key, because null is what this app
       already means by "unset" for these fields: Clear Priority and Clear Rating
       both write it, and every reader treats null and absent alike. */
    const reverted = Object.fromEntries(Object.keys(patch).map(k =>
      [k, Object.prototype.hasOwnProperty.call(game, k) ? game[k] : null]));

    toast(message, 'info', {
      label: 'Undo',
      onClick: () => {
        /* Only the id and the reverted keys: the rows on this page carry IGDB
           fields merged in by hydrateLibrary, and an undo has no business
           writing those back into the stored entry. */
        saveToLibrary({ id: game.id, ...reverted });
        setLibrary(prev => prev.map(g => g.id === before.id ? before : g));
      },
    });
  }, []);

  /* Every rule about where a game may land, in one place. It used to live inside
     the drop handler, which meant the touch lift added later would have had to
     restate it — and a second copy of "IGDB unreleased games must stay put" is a
     second copy that can go out of date. Both gestures call this. */
  const commitShelfMove = useCallback((game, targetTab) => {
    if (targetTab === 'remove') return handleRemoveGame(game.id, game.name);

    const isCustomGame = game.is_custom || String(game.id).startsWith('custom_');
    if (!isCustomGame && targetTab === 'Unreleased') {
      return toast('Only custom or unreleased games can be in this tab', 'error');
    }
    if (!isCustomGame && normalizeStatus(game.status) === 'Unreleased') {
      return toast('IGDB unreleased games must stay in this tab', 'error');
    }
    if (normalizeStatus(game.status) === targetTab) return;   // already there

    mutateGame(game, { status: targetTab }, `Moved ${nameFor(game)} to ${targetTab}`);
  }, [handleRemoveGame, mutateGame]);

  const handleTabDrop = useCallback((e, targetTab) => {
    e.preventDefault();
    setDropOverEl(null);
    if (!draggedGame) return;

    const gameToMove = draggedGame;
    cleanupGhostDOM();
    setDraggedGame(null);
    isDraggingRef.current = false;
    commitShelfMove(gameToMove, targetTab);
  }, [draggedGame, cleanupGhostDOM, commitShelfMove, setDropOverEl]);

  /* Begins a touch lift: the same ghost, the same rules, plus a shelf bar within
     thumb reach. The bar exists because the status strip is at the TOP of the
     page — fine for a mouse that crosses the screen for free, useless for a
     thumb already holding a card near the bottom.

     GameCard decides WHEN to lift (a press that stays put); this owns what
     happens after, and routes the result through commitShelfMove so a touch move
     and a mouse move are the same move, Undo toast included. */
  const beginLift = useCallback((game, cardEl, x, y) => {
    if (liftingRef.current) return;
    liftingRef.current = true;
    retireLiftHint();          // they know; stop saying it

    raiseGhost(cardEl, x, y);
    setDraggedGame(game);
    isDraggingRef.current = true;
    if (navigator.vibrate) navigator.vibrate(8);   // it left the shelf; say so

    const shelfUnder = (cx, cy) =>
      document.elementFromPoint(cx, cy)?.closest('[data-lift-target]') || null;

    /* Highlighted through the same class the mouse drag uses, not through
       state. State would re-render the page — and every card on it — on every
       boundary the finger crosses, which is the exact cost the drag-over
       highlight was moved out of state to avoid. */
    const onMove = (ev) => {
      lastPointRef.current = { x: ev.clientX, y: ev.clientY };
      paintGhost(ev.clientX, ev.clientY);
      setDropOverEl(shelfUnder(ev.clientX, ev.clientY));
    };
    /* The page must not scroll while a card is in the air. touch-action cannot
       help — the browser settled that at gesture start, long before the press
       became a lift — so the scroll is cancelled directly. */
    const blockScroll = (ev) => ev.preventDefault();

    const finish = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('touchmove', blockScroll);

      // A cancelled lift drops the card back where it was, deliberately.
      const target = ev.type === 'pointerup'
        ? shelfUnder(ev.clientX, ev.clientY)?.dataset.liftTarget
        : null;
      liftingRef.current = false;
      setDraggedGame(null);
      isDraggingRef.current = false;
      cleanupGhostDOM();   // clears the highlight too
      if (target) commitShelfMove(game, target);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('touchmove', blockScroll, { passive: false });
  }, [raiseGhost, paintGhost, cleanupGhostDOM, commitShelfMove, setDropOverEl, retireLiftHint]);

  const handleMoveStatus = useCallback((game, targetStatus) => {
    mutateGame(game, { status: targetStatus }, `Moved ${nameFor(game)} to ${targetStatus}`);
  }, [mutateGame]);

  const handlePriorityGame = useCallback((game, priority) => {
    mutateGame(game, { priority }, priority
      ? `${nameFor(game)}: ${priority}`
      : `Priority cleared on ${nameFor(game)}`);
  }, [mutateGame]);

  const handleRateGame = useCallback((game, feel) => {
    mutateGame(game, { feel }, feel
      ? `${nameFor(game)}: ${feel}`
      : `Rating cleared on ${nameFor(game)}`);
  }, [mutateGame]);

  const tabCounts = useMemo(() => {
    const counts = {};
    TABS.forEach(tab => {
      counts[tab] = library.filter(g => normalizeStatus(g.status) === tab).length;
    });
    return counts;
  }, [library]);

  /* Mounting a whole shelf at once IS the tab-switch delay. Measured on a
     6x-throttled CPU: an empty shelf commits in 111ms, a 58-card shelf in
     ~1000ms with ~600ms of blocking, and the cost tracks the card count almost
     exactly. Nothing below makes a card cheaper — it stops the cards below the
     fold from standing between the click and the shelf you asked for. The
     first frame renders one screenful; the rest mount on the next frame, off
     the critical path. Two rAFs because one still lands inside the same commit.
     Safe against scroll jumps only because ScrollToTop resets to 0 on every
     route change, so a briefly shorter document cannot move the viewport. */
  const [pickNextOpen, setPickNextOpen] = useState(false);

  /* Swipe the grid sideways to change shelf, in the order the strip shows them.
     Six shelves and a three-row strip is a lot of tapping on a phone, and the
     grid is the biggest target on the page.

     Not enabled on desktop: a horizontal drag there is how you select cards and
     text, and there is no shortage of room to click a tab. Not enabled during a
     drag either — a card is already being carried and this would fight it.

     EDGE_GUARD keeps the first 24px out of it. iOS and Android both own an
     edge-swipe for back-navigation, and a handler that starts there either
     loses to the system gesture or, worse, wins and strands people who expect
     to go back. */
  const EDGE_GUARD = 24;
  const shelfIndex = TABS.indexOf(activeTab);
  const rawShelfSwipe = useSwipe({
    axis: 'x',
    threshold: 80,
    enabled: !draggedGame,
    onSwipe: (dir) => {
      const next = TABS[shelfIndex + (dir === 'left' ? 1 : -1)];
      if (next) navigate(`/library/${next.toLowerCase()}`);
    },
  });
  const shelfSwipe = {
    ...rawShelfSwipe,
    onPointerDown: (e) => {
      if (!window.matchMedia('(pointer: coarse)').matches) return;
      if (e.clientX < EDGE_GUARD || e.clientX > window.innerWidth - EDGE_GUARD) return;
      rawShelfSwipe.onPointerDown?.(e);
    },
  };
  const [paintAll, setPaintAll] = useState(false);
  const [paintKey, setPaintKey] = useState(null);
  const currentPaintKey = `${activeTab}|${groupBy}|${sortOption}|${filterOption}|${searchQuery}`;
  /* Reset during render, not in an effect. An effect runs after the render it
     belongs to, so on a tab change the first render still had paintAll from the
     previous shelf and mounted all 60 cards before anything could stop it —
     measured cardsAtCommit=60, exactly the behaviour this exists to avoid. This
     is React's supported "adjust state when props change" path: the re-render
     happens before the browser paints, so the budget applies to the first
     commit rather than the second. */
  if (currentPaintKey !== paintKey) {
    setPaintKey(currentPaintKey);
    setPaintAll(false);
  }
  useEffect(() => {
    if (paintAll) return;
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPaintAll(true));
    });
    return () => { cancelAnimationFrame(outer); if (inner) cancelAnimationFrame(inner); };
  }, [paintAll, paintKey]);

  const paintedGroups = useMemo(() => {
    if (paintAll) return displayedGamesData;
    let budget = FIRST_PAINT_CARDS;
    const out = [];
    for (const g of displayedGamesData) {
      if (budget <= 0) break;
      out.push(g.games.length > budget ? { ...g, games: g.games.slice(0, budget) } : g);
      budget -= g.games.length;
    }
    return out;
  }, [displayedGamesData, paintAll]);

  // Tab switch, search and filter changed the grid with no announcement. 4.1.3.
  // Counted from the full set, never the painted slice — the announcement must
  // state what the shelf holds, not how much of it has mounted yet.
  const shownCount = displayedGamesData.reduce((n, g) => n + g.games.length, 0);
  useAnnounce(isLoading ? 'Loading library'
    : `${activeTab}: ${shownCount} ${shownCount === 1 ? 'game' : 'games'}`);

  return (
    <div className="antialiased text-gray-300 py-4 lg:py-12">
      <div className="content-container">

        <div className="flex flex-col">
          {/* ── Main content area: games or franchises ── */}
          <div className="flex-1 min-w-0 flex flex-col mt-0 lg:mt-0">
            {/* ── Page header — editorial index ──
                Screen-reader-only below lg, because on a phone it is the third
                thing telling you the same fact: the strip's active cell already
                reads "BACKLOG 9", filled in the shelf's own colour, and the
                header's own title says Library. It cost 40px of display type
                plus a 20px gap on a viewport where the first card did not appear
                until 461px down.
                sr-only, not removed: this is the page's only h1, and deleting it
                on mobile would leave the document with no top-level heading.
                Desktop has the room and keeps it. */}
            <PageHeader
              className="sr-only lg:not-sr-only lg:mb-5"
              title={activeTab}
              count={`${tabCounts[activeTab]} ${tabCounts[activeTab] === 1 ? 'Title' : 'Titles'}`}
            />

            {/* ── Status strip — horizontal index, all breakpoints.
                 Tabs are also drag-and-drop targets; utility cells sit at the end. ── */}
            {/* Sticks below the fixed mobile chrome, not at viewport 0 — at top-0 a
                focused tab parked underneath the nav bar. WCAG 2.4.11. */}
            <div
              ref={stripRef}
              /* Below sm this is a grid, not a wrapping flex row. Wrapping sized
                 every cell to its own label, so no two rows ended at the same x
                 and the hairline box never closed; the `flex-1` spacer that
                 right-aligns the utility cell on desktop became a full-width
                 line break, orphaning Clear on a row of its own. Equal columns
                 close the box and put the counts in a readable column.
                 One column under 300px: at 280 a two-column cell cannot hold
                 "Unreleased" plus a three-digit count, and it clips inside the
                 cell without overflowing the document — invisible to the
                 responsive gate, which only watches scrollWidth.
                 The single row starts at xl, not sm: six tabs need ~645px of
                 label and a 640px viewport has ~600px of content, so the flex
                 row was shrinking cells into each other between sm and lg.
                 Three columns carry that band instead — and at 1024 six tabs still need 747px against a 728px container, so the crossover is xl, not lg. */
              /* Pinned to where the header's bottom edge IS, not to the space it
                 reserves. The header auto-hides on scroll-down by translating
                 itself away, but --mobile-nav-h stays 56 because App.jsx's
                 padding depends on it — so the strip held a 56px gap above
                 itself with live, scrolling cover art showing through it, which
                 reads as a rendering fault rather than a design. The transition
                 matches the header's own 300ms ease-in-out so the two edges
                 travel together instead of one snapping ahead of the other. */
              /* Pinned at the header's FULL height and translated up by however
                 much of it is currently hidden, rather than animating `top`.
                 Same place on screen, same 300ms, same curve — but `top` is a
                 layout property and this runs on every scroll direction change:
                 measured 27 layouts and 13.9ms per fold against 8 and 3.7ms with
                 it off. transform composites instead. */
              /* `lh-strip-open` is the ONE shape change: a lifted card needs
                 somewhere to land, so every shelf comes back for the drag. Below
                 xl, CSS shows the compact row otherwise. */
              className={`lh-strip sticky z-30 bg-black grid grid-cols-1 min-[300px]:grid-cols-2 sm:grid-cols-3 xl:flex xl:flex-nowrap border-l border-white/15 mb-6 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
                draggedGame ? 'lh-strip-open' : ''
              }`}
              style={{
                top: 'calc(var(--mobile-nav-h, 0px) + env(safe-area-inset-top, 0px) + var(--titlebar-h, 0px))',
                transform: 'translateY(calc(var(--mobile-nav-offset, 0px) - var(--mobile-nav-h, 0px) - env(safe-area-inset-top, 0px)))',
              }}
            >
              {TABS.map(tab => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => {
                      if (draggedGame) return;
                      navigate(`/library/${tab.toLowerCase()}`);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    onDragOver={(e) => handleTabDragOver(e, tab)}
                    onDragLeave={handleTabDragLeave}
                    onDrop={(e) => handleTabDrop(e, tab)}
                    /* And the touch-lift target. One shelf surface, here, where
                       the shelves have always been — a second set at the bottom
                       of the screen meant two places to read with a card in your
                       hand, and standing this one down to compensate left a fifth
                       of the viewport empty. */
                    data-lift-target={tab}
                    /* The strip names itself "Status strip" but rendered every tab
                       identically. It now carries the solid status ramp, in the same
                       shape the game-detail state rows use: a swatch at rest, a
                       filled cell with black text when selected. Measured black-on-
                       status 7.59:1 (Dropped) to 14.56:1 (Beaten) — AAA throughout.
                       The label still names the status, so colour is never alone. */
                    /* No transition: this is navigation, and a 150ms colour fade
                       on the thing you just clicked reads as lag, not polish.
                       min-w-0 lets a grid cell size to its column; at lg it must
                       not, or the flex row shrinks labels into each other. */
                    /* Inactive tabs rest at 50% white — 5.32:1, correct for a
                       control you are not currently using. While a card is in the
                       air they are the targets, so they come up to full white:
                       at 50% they read as disabled next to Remove, which sits at
                       7.59:1 and was the brightest thing in the strip. Raising the
                       six rather than dimming the one keeps Remove's colour as its
                       only distinction, which is what it should have been. */
                    className={`lh-tab flex items-baseline gap-1 sm:gap-1.5 min-w-0 xl:min-w-max px-2 sm:px-3 lg:px-4 py-2.5 whitespace-nowrap border-t border-r border-b border-white/15 ${!draggedGame ? 'cursor-pointer' : ''} ${
                      isActive ? '' : (draggedGame ? 'text-white' : 'text-white/50 hover:text-white')
                      }`}
                    /* --tab-color carries this shelf's colour into CSS so the
                       drag-over highlight can be a class rather than React state.
                       Holding it in state meant every dragover that crossed a tab
                       boundary re-rendered the whole page: measured 297 cards on a
                       4x-throttled CPU, EVERY frame of the drag ran over 32ms and
                       the median was 57.5. The highlight touches seven cells; it
                       has no business costing a render of the grid. */
                    style={{ '--tab-color': statusColor(tab), ...(isActive ? { backgroundColor: statusColor(tab), color: '#000000' } : null) }}
                  >
                    <span
                      aria-hidden="true"
                      className="lh-swatch w-2 h-2 shrink-0 self-center pointer-events-none"
                      style={{ backgroundColor: isActive ? '#000000' : statusColor(tab) }}
                    />
                    {/* .lh-label tracks at 0.18em, which trails the last glyph as
                        dead space. Two of those cost `Unreleased` its count at
                        280px. Reclaimed, not padded away — trailing tracking on a
                        right-aligned numeral is a spacing bug at any width. */}
                    <span className="lh-label pointer-events-none -mr-[0.18em]">{tab}</span>
                    <span className="lh-label tabular-nums pointer-events-none ml-auto xl:ml-0 -mr-[0.18em]">{tabCounts[tab]}</span>
                  </button>
                );
              })}

              {/* The mobile strip. One row, always: which shelf you are on, how
                  much is on it, and a way to change it. It is also the page's
                  shelf identity, because the h1 is screen-reader-only here.

                  The swatch carries the colour rather than a filled bar —
                  DESIGN.md reserves saturated fill for cover art, and this is
                  chrome. Always mounted and gated by CSS below, so opening and
                  closing it costs no React render and `display: none` keeps it
                  out of the tab order and the a11y tree when it does not apply. */}
              <button
                onClick={() => setShelfPickerOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={shelfPickerOpen}
                aria-label={`${activeTab}, ${tabCounts[activeTab]} ${tabCounts[activeTab] === 1 ? 'game' : 'games'}. Change shelf`}
                /* An explicit 44px box rather than padding: the button inherits
                   the page's 16px line-height, so `py-3` measured 63px — half
                   again the target size, spent on a line box nothing sits in. */
                /* Filled with the shelf's own colour, black on top — the same
                   "filled means you are here" the desktop strip has always used
                   for its active tab, so the two read as one system. The border
                   goes with it: a filled bar carries its own edge. */
                className="lh-tab lh-strip-compact xl:hidden col-span-full flex items-center gap-2 min-h-[44px] px-4 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-black"
                style={{ backgroundColor: statusColor(activeTab), color: '#000000' }}
              >
                <span
                  aria-hidden="true"
                  className="lh-swatch w-2 h-2 shrink-0 bg-black pointer-events-none"
                />
                <span className="lh-label pointer-events-none -mr-[0.18em]">{activeTab}</span>
                {/* Black at 70%, not the 60% the mock used. 60% is fine on Beaten
                    (5.13:1) and fails on half the ramp — Wishlist 3.88:1, Dropped
                    3.91:1, Backlog 4.04:1. 70% is the first step that clears AA on
                    every shelf, worst 4.92:1 on Dropped. */}
                <span className="lh-label tabular-nums text-black/70 pointer-events-none">{tabCounts[activeTab]}</span>
                <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0 text-black/70 pointer-events-none" />
              </button>

              {/* Spacer pushes the drop target to the right edge on the lg row,
                  and closes the box there when nothing is being dragged. It is a
                  flex-only device: in the grid it would eat a whole cell. */}
              <div className="hidden xl:block flex-1 min-w-4" />

              {/* Only the drag target lives here now. "Clear library" was the one
                  cell in a status strip that did not select a status — it wiped
                  the whole library, sitting one tab-width from Wishlist. It moved
                  to the account menu, next to Log out, where the other
                  library-wide actions already are. */}
              {/* Always in the grid, only conditional in the flex row. Rendering
                  this on drag alone added a whole `col-span-full` row the moment
                  the gesture began: measured +33px of strip and a 33px downward
                  jump of the entire game grid at 1024px, at the exact instant the
                  user commits to a precision drag. `invisible` reserves the row
                  and keeps the cell out of the tab order; `xl:hidden` keeps it out
                  of the flex row, where the spacer already holds the space and
                  height never changed. */}
              <button
                  aria-hidden={!draggedGame}
                  onDragOver={(e) => handleTabDragOver(e, 'remove')}
                  onDragLeave={handleTabDragLeave}
                  onDrop={(e) => handleTabDrop(e, 'remove')}
                  data-lift-target="remove"
                  hidden={!draggedGame}
                  className={`lh-tab lh-tab-remove col-span-full flex items-center justify-end xl:justify-start gap-1.5 px-4 py-2.5 whitespace-nowrap border border-white/15 ${draggedGame ? '' : 'invisible pointer-events-none xl:hidden'} ${'text-[var(--destructive)]'
                    }`}
                >
                  <Trash2 className="w-3 h-3 pointer-events-none" />
                  <span className="lh-label pointer-events-none">Remove</span>
              </button>
            </div>

            {/* ── Library Toolbar ── */}
            {/* Both layers stay mounted for the cross-fade, so the hidden one needs
                `inert` — opacity-0 + pointer-events-none still leaves it tabbable. */}
            {/* The two layers stack in one grid cell rather than being absolutely
                positioned in a fixed h-8 box. The old fixed height is what forced
                the pills into a single scrolling row, and at 393px that row was
                473px wide against 309px of space: `Group` sat entirely outside the
                visible box, with mask-fade-right starting at 85% so the only cue
                landed on the tail of `Sort`. Grid stacking lets the container take
                the height of whichever layer is taller, so the pills can simply
                wrap. */}
            {/* grid-cols-1 is minmax(0, 1fr), not the implicit auto column: an auto
                column sizes to its content's min-content width, so the search
                layer's input-plus-button pushed the page 11px wide at 280px. The
                old absolute positioning clamped that for free. */}
            {/* Recedes with the grid while a card is in the air. It used to hold
                full-strength borders against a grid dimmed to 0.11, which made
                filter/sort/group — five controls that are not drop targets and do
                nothing during a drag — the brightest thing on the screen after the
                card itself. Whatever cannot be dropped on should not compete with
                what can. `inert` because opacity alone still leaves it tabbable. */}
            <div className={`grid grid-cols-1 w-full mb-8 transition-all duration-500 ${draggedGame ? 'grid-blur-active' : ''}`}
                 inert={!!draggedGame}>
              {/* Layer 1: Controls & Search Trigger */}
              <div className={`col-start-1 row-start-1 transition-all duration-300 ease-in-out transform flex flex-row items-start justify-between gap-2 ${
                isSearchOpen ? 'opacity-0 pointer-events-none -translate-y-2' : 'opacity-100 pointer-events-auto translate-y-0'
              }`} inert={isSearchOpen}>
                {/* Wrapping is content-driven, not breakpoint-driven: the label
                    lengths change per shelf, so no breakpoint is right for all of
                    them. Pinning the switch to `sm` just moved the defect — at 640
                    exactly, Beaten's "Sort · Completed · New" and "Group ·
                    Completion Year" overflowed the nowrap row by 57px and hid
                    Group again. flex-wrap only wraps when a line genuinely does
                    not fit, so one row survives wherever there is room and the
                    scroller, its hidden scrollbar and its fade mask all go away. */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                  {/* Filter Pill */}
                  <DropdownMenu
                    options={filterOptions.map(o => ({
                      label: o.label,
                      icon: o.icon,
                      dividerAbove: o.dividerAbove,
                      onClick: () => setFilterOption(o.value),
                      isActive: filterOption === o.value
                    }))}
                    align="left"
                  >
                    {/* The axis word is worth its width wherever there is width:
                        two adjacent pills both reading "PRIORITY" is what it was
                        added to fix. There is no width at 393px — the three pills
                        need 483px against a 309px container, and 317px even with
                        every prefix stripped — so below sm the icon carries the
                        axis and the accessible name carries it in full, which is
                        the one place ambiguity actually costs someone. */}
                    <button
                      aria-label={`Filter · ${filterOptions.find(o => o.value === filterOption)?.label || 'All'}`}
                      className="flex min-w-0 items-center gap-1.5 md:gap-2 h-8 px-2 md:px-3 border border-white/20 hover:border-white/70 transition-colors lh-label text-white/60 hover:text-white cursor-pointer select-none"
                    >
                      <Filter className="w-4 h-4 shrink-0" />
                      <span className="truncate -mr-[0.18em]">
                        <span className="hidden md:inline">Filter&nbsp;·&nbsp;</span>
                        {filterOptions.find(o => o.value === filterOption)?.label || 'All'}
                      </span>
                    </button>
                  </DropdownMenu>

                  {/* Sort Pill */}
                  <DropdownMenu
                    options={sortOptions.map(o => ({
                      label: o.label,
                      icon: o.icon,
                      dividerAbove: o.dividerAbove,
                      onClick: () => setSortOption(o.value),
                      isActive: sortOption === o.value
                    }))}
                    align="left"
                  >
                    <button
                      aria-label={`Sort · ${sortOptions.find(o => o.value === sortOption)?.label || 'A → Z'}`}
                      className="flex min-w-0 items-center gap-1.5 md:gap-2 h-8 px-2 md:px-3 border border-white/20 hover:border-white/70 transition-colors lh-label text-white/60 hover:text-white cursor-pointer select-none"
                    >
                      <ArrowUpDown className="w-4 h-4 shrink-0" />
                      <span className="truncate -mr-[0.18em]">
                        <span className="hidden md:inline">Sort&nbsp;·&nbsp;</span>
                        {sortOptions.find(o => o.value === sortOption)?.label || 'A → Z'}
                      </span>
                    </button>
                  </DropdownMenu>

                  {/* Group By Pill */}
                  <DropdownMenu
                    options={groupByOptions.map(o => ({
                      label: o.label,
                      icon: o.icon,
                      dividerAbove: o.dividerAbove,
                      onClick: () => setGroupBy(o.value),
                      isActive: groupBy === o.value
                    }))}
                    align="left"
                  >
                    <button
                      aria-label={`Group · ${groupByOptions.find(o => o.value === groupBy)?.label || 'None'}`}
                      className="flex min-w-0 items-center gap-1.5 md:gap-2 h-8 px-2 md:px-3 border border-white/20 hover:border-white/70 transition-colors lh-label text-white/60 hover:text-white cursor-pointer select-none"
                    >
                      <Grid className="w-4 h-4 shrink-0" />
                      <span className="truncate -mr-[0.18em]">
                        <span className="hidden md:inline">Group&nbsp;·&nbsp;</span>
                        {groupByOptions.find(o => o.value === groupBy)?.label || 'None'}
                      </span>
                    </button>
                  </DropdownMenu>
                </div>
                
                {/* Right side: Pick Next + Search Toggle */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Sits with the controls rather than above the shelves: it is
                      something you reach for, not something you read.

                      Target, not a die. The die was the button arguing with the
                      dialog it opens: pickNextGame scores every shelved game
                      against the themes, studios and franchises you play and the
                      priority you set, and only breaks a tie among the top eight
                      at random. A die promises the one part of that which is
                      arbitrary and hides the rest, so people read the answer as
                      a shrug. The words were already right. */}
                  <button
                    onClick={() => setPickNextOpen(true)}
                    aria-label="Pick a game to play next"
                    className="inline-flex items-center justify-center gap-2 h-8 px-2 md:px-3 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    <Target className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="lh-label hidden md:inline -mr-[0.18em]">Pick For Me</span>
                  </button>
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="inline-flex items-center justify-center p-2 h-8 w-8 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                    aria-label="Search library"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Layer 2: Search Input */}
              <div className={`col-start-1 row-start-1 self-start transition-all duration-300 ease-in-out transform flex items-center gap-2 ${
                isSearchOpen ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none translate-y-2'
              }`} inert={!isSearchOpen}>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/60" />
                  <input
                aria-label="Search library"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQueryAndUrl(e.target.value)}
                    placeholder="SEARCH LIBRARY"
                    className="w-full h-8 pl-10 pr-4 bg-black border border-white/40 lh-label text-white placeholder:text-white/50 focus:outline-none focus:border-white/70 focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
                    ref={searchInputRef}
                  />
                </div>
                <button
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQueryAndUrl('');
                  }}
                  className="inline-flex items-center justify-center p-2 h-8 w-8 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                  aria-label="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Said before the gesture, once. The banner below says what to do
                once a card is already in the air; nothing said the card could be
                picked up in the first place. Sits in the flow above the grid
                rather than floating over it — an overlay teaching a gesture would
                cover the very cards it is talking about. */}
            {!liftHintDone && !isLoading && displayedGamesData.some(g => g.games.length > 0) && (
              <div className="flex items-center justify-between gap-3 border border-white/15 px-4 py-3 mb-6">
                {/* Short enough to hold one line at 393px: the longer version
                    wrapped and split "another shelf" across it. The verb leads,
                    and it is the verb that is being taught — where the card can
                    go is what the drag banner says once one is in the air. */}
                <span className="lh-label text-white/60">
                  <span className="text-white">Hold</span> a card to move it
                </span>
                <button
                  onClick={retireLiftHint}
                  aria-label="Dismiss hint"
                  className="flex items-center justify-center shrink-0 p-1.5 -m-1.5 pointer-coarse:p-3 pointer-coarse:-m-3 text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* ── Games Grid ── */}
            <>
              {/* ── Drag hint banner (Toast style) ── */}
              {draggedGame && (
                /* Centred on the CONTENT, not the viewport. The rail is 220px
                   (Navbar.jsx w-[220px], App.jsx lg:pl-[220px]), so the content
                   centre sits half of that — 110px — right of the viewport
                   centre. The old 144px was not derived from anything and put
                   the hint 34px off-centre on every desktop screen. */
                <div className="fixed bottom-24 lg:bottom-10 left-1/2 -translate-x-1/2 lg:ml-[110px] z-[110] pointer-events-none animate-in slide-in-from-bottom-8 fade-in duration-300 ease-out">
                  <div className="px-5 py-3 border border-white/30 bg-black">
                    <span className="lh-label text-white/60 whitespace-nowrap">
                      Drop on a <span className="text-white">status tab</span> to move
                    </span>
                  </div>
                </div>
              )}

              {/* Card Grid Layout */}
              {isLoading ? (
                <div className="game-grid">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <GameCardSkeleton key={index} />
                  ))}
                </div>
              ) : displayedGamesData.length === 0 || (displayedGamesData.length === 1 && displayedGamesData[0].games.length === 0) ? (
                /* Three different situations used to share one message. "Nothing
                   Shelved — time to explore" was shown to a first-run user with no
                   library AND to someone with 200 games who had just typed a query
                   that matched none of them. The first needs a way in; the second
                   needs their filters back. Nav item 02 lands new users here, so
                   this is the most consequential empty state in the product. */
                <LibraryEmptyState
                  tab={activeTab}
                  libraryEmpty={library.length === 0}
                  filtered={!!searchQuery || filterOption !== 'all'}
                  onClearFilters={() => {
                    /* The URL-syncing setter, not the bare one. Clearing with
                       setSearchQuery left `?q=` in the address bar, so reloading or
                       sharing the link brought the dismissed filter back. This was
                       the one call site in the file bypassing the helper at :303. */
                    setSearchQueryAndUrl('');
                    setTabSettings(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], filter: 'all' } }));
                  }}
                  onExplore={() => navigate('/')}
                  onImport={() => navigate('/import')}
                  onGo={navigate}
                />
              ) : (
                <div
                  {...shelfSwipe}
                  /* Where focus lands when a card menu action removes the card that
                     owned the menu: the grid that just changed, beside the live-region
                     announcement of the move. Read by DropdownMenu's item click. */
                  data-focus-fallback
                  tabIndex={-1}
                  className={`flex flex-col gap-5 transition-all duration-500 outline-none ${draggedGame ? 'grid-blur-active' : ''}`}
                >
                  {paintedGroups.map((group) => {
                    const key = `${groupBy}:${group.label}`;
                    const isCollapsed = collapsedGroups[key];


                    return (
                      <div key={group.label || 'none'} className="flex flex-col gap-3">
                        {/* Ungrouped, the page went h1 (shelf name) straight to h3
                            (card titles), so anyone navigating by heading fell
                            from the page title into the cards with nothing naming
                            the list in between. The grouped view already has an h2
                            per group; this gives the ungrouped view the same rung
                            without drawing anything. */}
                        {!group.label && (
                          <h2 className="sr-only">{`${activeTab} games`}</h2>
                        )}
                        {group.label && (
                          <div className="z-20 flex items-center gap-3 py-2 bg-black mb-2 select-none">
                            {/* min-h-6 is WCAG 2.5.8. Baseline-aligned 11px content
                                measured 23px tall — one pixel under, which is the
                                least visible way to fail a target-size rule and
                                the reason it went unnoticed: the gate only sees
                                this control once the library has enough games to
                                group, and it ran against an empty one. */}
                            <button
                              className="inline-flex items-baseline gap-2.5 min-h-6 cursor-pointer group"
                              onClick={() => toggleGroupCollapse(group.label)}
                              aria-expanded={!isCollapsed}
                            >
                              {/* A 16px chevron at the heading's own alpha, rotated rather than
                                  swapped: the 6px text glyph it replaces was dim enough that two
                                  screenshots had to be compared to find it. */}
                              <ChevronDown
                                aria-hidden="true"
                                className={`w-4 h-4 self-center shrink-0 text-white/80 group-hover:text-white transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                              />
                              {groupBy === 'platform' && group.label !== 'Unknown Platform' && (
                                <PlatformLogo
                                  platform={group.label}
                                  className="w-3.5 h-3.5 self-center opacity-80 group-hover:opacity-100 transition-opacity"
                                  disableTooltip
                                />
                              )}
                              {/* Same slot the platform logo uses, and the same
                                  8px square the status strip and the cards use,
                                  so a Priority or Rating heading now carries the
                                  colour its own cards are stickered with. The
                                  label sits beside it, so colour is never the
                                  only carrier. */}
                              {GROUP_COLORS[group.label] && (
                                <span
                                  aria-hidden="true"
                                  className="lh-swatch w-2 h-2 shrink-0 self-center"
                                  style={{ backgroundColor: GROUP_COLORS[group.label] }}
                                />
                              )}
                              <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 group-hover:text-white transition-colors m-0">
                                {group.label}
                              </h2>
                              <span className="lh-label text-white/60 tabular-nums">
                                {group.games.length}
                              </span>
                            </button>
                            <div className="flex-1 h-px bg-white/15"></div>
                          </div>
                        )}

                        {!isCollapsed && (
                          <div className="game-grid animate-in slide-in-from-bottom-4 fade-in">
                            {group.games.map((game) => (
                              <GameCard
                                key={game.id}
                                game={game}
                                activeTab={activeTab}
                                draggable={true}
                                isDragging={draggedGame?.id === game.id}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                                onLift={beginLift}
                                isDraggingAny={!!draggedGame}
                                isInLibrary={true}
                                menuOptions={[
                                  /* The Unreleased shelf used to emit no move rows at
                                     all, for every game. But handleTabDrop permits a
                                     custom game to leave — both its guards test
                                     !isCustomGame first — and GameCard blocks drag on
                                     touch on the grounds that "the menu covers status
                                     moves", which was false on exactly this shelf. So
                                     a custom unreleased game was movable by mouse and
                                     by nothing else: not touch, not keyboard, not a
                                     screen reader. Same predicate as the drop handler,
                                     so the two can't drift apart again. */
                                  ...(activeTab !== 'Unreleased' || game.is_custom || String(game.id).startsWith('custom_')
                                    ? TABS.filter(t => t !== activeTab && t !== 'Unreleased').map(t => ({
                                      label: `Move to ${t}`,
                                      icon: TAB_ICON[t],
                                      color: statusColor(t),
                                      variant: 'default',
                                      onClick: () => handleMoveStatus(game, t),
                                    }))
                                    /* One disabled row, not four. An IGDB game really
                                       cannot leave this shelf, and saying why once
                                       beats enumerating four dead destinations.
                                       Kept to the length of "Move to Wishlist": any
                                       longer and MarqueeText starts scrolling the row
                                       forever, which is the last thing a row that
                                       exists purely to be read should do. */
                                    : [{
                                      label: 'Moves on release',
                                      icon: TAB_ICON.Unreleased,
                                      color: statusColor('Unreleased'),
                                      variant: 'default',
                                      disabled: true,
                                    }]
                                  ),
                                  ...(activeTab === 'Beaten' ? [
                                    /* FEEL_MENU, not a local copy. These four hexes had
                                       drifted off the tokens — #c084fc vs #B048FF,
                                       #4ade80 vs #00d391, #fbbf24 vs #fcb700, #f87171
                                       vs #fe647e — so the same rating rendered one
                                       colour in this menu and another everywhere else. */
                                    ...FEEL_MENU.map((f, i) => ({
                                      label: f.label,
                                      groupLabel: 'Set rating',
                                      color: f.color,
                                      icon: () => <div className="w-2.5 h-2.5" style={{ backgroundColor: f.color }} />,
                                      variant: 'default',
                                      dividerAbove: i === 0,
                                      onClick: () => handleRateGame(game, f.label)
                                    })),
                                    {
                                      label: 'Clear',
                                      groupLabel: 'Set rating',
                                      icon: X,
                                      variant: 'default',
                                      onClick: () => handleRateGame(game, null)
                                    }
                                  ] : []),
                                  ...(activeTab !== 'Beaten' ? [
                                    ...PRIORITY_MENU.map((p, i) => ({
                                      label: p.label,
                                      groupLabel: 'Set priority',
                                      color: p.color,
                                      icon: () => <div className="w-2.5 h-2.5" style={{ backgroundColor: p.color }} />,
                                      variant: 'default',
                                      dividerAbove: i === 0 && activeTab !== 'Unreleased',
                                      onClick: () => handlePriorityGame(game, p.label)
                                    })),
                                    {
                                      /* Just 'Clear': the group heading above already says which axis. */
                                      label: 'Clear',
                                      groupLabel: 'Set priority',
                                      icon: X,
                                      variant: 'default',
                                      onClick: () => handlePriorityGame(game, null)
                                    }
                                  ] : []),
                                  {
                                    label: 'Transfer Data',
                                    icon: RefreshCw,
                                    variant: 'default',
                                    dividerAbove: true,
                                    onClick: () => setTransferSourceGame(game),
                                  },
                                  {
                                    label: 'Remove from Library',
                                    icon: X,
                                    variant: 'danger',
                                    onClick: () => handleRemoveGame(game.id, game.name),
                                  }
                                ]}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          </div>
        </div>
      </div>

      {/* ── Transfer Data Modal ── */}
      {transferSourceGame && (
        <TransferDataModal
          sourceGame={transferSourceGame}
          onClose={() => setTransferSourceGame(null)}
          onComplete={() => {
            setTransferSourceGame(null);
            hydrateLibrary();
            toast('Data transferred successfully');
          }}
        />
      )}

      <ConfirmDialog {...confirmProps} />
      {pickNextOpen && <PickNextDialog onClose={() => setPickNextOpen(false)} />}

      {/* Shelf picker. A sheet at the BOTTOM, not a menu dropping from the row:
          the strip lives at the top of the phone and a picker that also opens up
          there is a reach on a screen you are holding one-handed. It is summoned
          and dismissed, so it is not a second resident shelf surface — the thing
          the bottom drop bar was removed for being.

          Dialog gives it a focus trap, Escape, drag-down-to-dismiss and
          safe-area padding for free. */}
      {shelfPickerOpen && (
        <Dialog
          open
          onClose={() => setShelfPickerOpen(false)}
          labelledBy="shelf-picker-title"
          alignClassName="items-end justify-center"
          className="p-0"
          panelClassName="w-full max-w-lg border-t border-white/15 pb-[env(safe-area-inset-bottom,0px)]"
        >
          <h2 id="shelf-picker-title" className="lh-label text-white/60 px-4 py-3 border-b border-white/15">
            Shelf
          </h2>
          <div>
            {TABS.map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => {
                    setShelfPickerOpen(false);
                    if (!isActive) navigate(`/library/${tab.toLowerCase()}`);
                  }}
                  /* 52px rows: this is the one place every shelf is chosen by
                     thumb, so it gets more than the recommended target size.

                     The shelf you are on is FILLED with its own colour rather
                     than ticked. Same treatment as the strip's active tab and
                     the compact row, so "filled means you are here" means one
                     thing everywhere. It also survives greyscale — the filled
                     row inverts to light-on-dark, which a tick beside identical
                     text does not — so colour is not carrying it alone, and
                     aria-current still says it outright. */
                  className={`w-full flex items-center gap-3 min-h-[52px] px-4 border-b border-white/10 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset ${
                    isActive ? 'focus-visible:ring-black' : 'text-white/60 hover:text-white focus-visible:ring-white'
                  }`}
                  style={isActive ? { backgroundColor: statusColor(tab), color: '#000000' } : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="lh-swatch w-2 h-2 shrink-0"
                    style={{ backgroundColor: isActive ? '#000000' : statusColor(tab) }}
                  />
                  <span className="lh-label -mr-[0.18em]">{tab}</span>
                  {/* 70%, not 60%: black at 60% clears AA on Beaten and fails on
                      Wishlist, Dropped and Backlog. 70% is the first step that
                      holds across the whole ramp. */}
                  <span className={`lh-label tabular-nums ml-auto ${isActive ? 'text-black/70' : 'text-white/60'}`}>
                    {tabCounts[tab]}
                  </span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
    </div>
  );
}
