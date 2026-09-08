/* ── DIRECTION CONTRACT ──────────────────────────────────────────────────────
   THESIS: a taxonomy page should tell you what the taxonomy IS. This one
   refuses the filtered-grid-with-a-toolbar every catalogue ships: the genre's
   own release density opens the page, drawn from counted facts, and it is the
   primary filter rather than an ornament above one.
   OWN-WORLD: DESIGN.md unchanged — #000000 ground, white type, hairline
   white/15 rules, rounded-none, no shadow, inversion as the only elevation,
   .lh-label 11px/0.18em, .lh-display. The histogram is drawn in that same
   language: hairline columns, no fills but the one that means "yours".
   STORY: you arrive, see when this genre lived and how much of it you have
   played, pull a span of years, and work the grid inside it.
   FIRST VIEWPORT: masthead naming the taxonomy and only countable facts, the
   density chart at full content width, the control rule, the first grid row.
   FORM: release-density histogram as portrait and filter. Candidate 3 of 7
   grounded structures; surface seed 3f9ff8e6, mode read.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the
   finish review, the verdict, and DESIGN.md.

   Every number here is counted, never sampled: the chart is one /count per
   bucket (getCategoryReleaseHistogram) and the coverage layer is one id query
   (getCategoryLibraryDates). Estimating from the loaded page would have been
   free and would have reported two pages of games as the shape of a genre.
   ────────────────────────────────────────────────────────────────────────── */

import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  getGenreById,
  getCompanyById,
  getThemeById,
  getPlatformById,
  getEngineById,
  getGameModeById,
  getGamesByCategory,
  getGamesCountByCategory,
  getCategoryPlatforms,
  getCategoryReleaseHistogram,
  getCategoryLibraryDates,
} from '../../services/igdb';
import { getLibrary, saveToLibrary } from '../../services/db';
import GameCard from '../../components/games/GameCard';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import { ChevronDown, HeartPlus, X, Info, RefreshCw } from 'lucide-react';
import { toast } from '../../components/ui/toastBus';
import useAnnounce from '../../components/ui/useAnnounce';
import { PRIORITY_MENU, statusBadge as makeStatusBadge } from '../../constants/stateColors';
import { PlatformGlyph } from '../../components/platforms/PlatformLogo';

const IGDB_CATEGORIES = {
  0: 'Game', 1: 'DLC', 2: 'Expansion', 3: 'Bundle', 4: 'Standalone', 5: 'Mod',
  6: 'Episode', 7: 'Season', 8: 'Remake', 9: 'Remaster', 10: 'Expanded',
  11: 'Port', 12: 'Fork', 13: 'Pack', 14: 'Update',
};

/* First page small, the rest large. The two pages are answering different
   questions: page one decides how fast anything appears at all, and a bigger
   one measurably slowed it (first covers 4.9s -> 5.9s on a cold RPG); every
   page after decides how much runway is left when you scroll, and there the
   round trip dominates, so a bigger page buys twice the buffer for the same
   wait. Covers are lazy, so the extra rows cost JSON, not bandwidth. */
const FIRST_PAGE = 24;
const NEXT_PAGE = 48;
const pageLimit = (n) => (n === 0 ? FIRST_PAGE : NEXT_PAGE);
const pageOffset = (n) => (n === 0 ? 0 : FIRST_PAGE + (n - 1) * NEXT_PAGE);
const SORTS = ['Popularity', 'Newest', 'Top Rated', 'A-Z'];
const HISTOGRAM_EPOCH_YEAR = 1980;
const yearOf = (unix) => (unix ? new Date(unix * 1000).getUTCFullYear() : null);

/* ── The density chart ───────────────────────────────────────────────────────
   One column per five-year bucket, height proportional to how many games IGDB
   actually holds. The filled portion is how many of them are on your shelves,
   so coverage reads continuously across time instead of as a two-state toggle.

   It is a control, not a picture: clicking a column narrows the grid to that
   span, and clicking it again releases. Every column is a real button, so the
   whole chart is reachable by keyboard — a chart that only answers a drag is a
   chart half the audience cannot use. */
function DensityChart({ buckets, selected, onSelect, loading, failed }) {
  if (loading) {
    return (
      <div className="h-20 border-b border-white/15 flex items-end gap-px" aria-hidden="true">
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} className="flex-1 bg-white/[0.06]" style={{ height: `${18 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
    );
  }
  /* All-zero is not "we have buckets", and a failed page must not draw a chart
     of what it says does not exist. An unknown category yields twelve zero
     counts, which drew a full confident axis under an empty plot. */
  if (failed || !buckets.length || !buckets.some(b => typeof b.count === 'number' && b.count > 0)) return null;

  /* A bucket whose count never came back is `null`, not 0. It is excluded from
     the peak and the total and drawn as a baseline tick, because a zero-height
     column and "we did not manage to count this" look identical and only one
     of them is true. */
  const counted = buckets.filter(b => typeof b.count === 'number');
  const peak = Math.max(...counted.map(b => b.count), 1);
  const total = counted.reduce((a, b) => a + b.count, 0);
  const owned = counted.reduce((a, b) => a + (b.owned || 0), 0);
  const uncounted = buckets.length - counted.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <span className="lh-label text-white/60">Releases by year</span>
        <span className="lh-label text-white/60 tabular-nums">
          {owned > 0 && <>{owned} of {total.toLocaleString()} shelved</>}
          {uncounted > 0 && <span className="ml-3">{uncounted} period{uncounted === 1 ? '' : 's'} not counted</span>}
        </span>
      </div>

      <div className="flex items-end gap-px h-20 border-b border-white/15" role="group" aria-label="Filter by release period">
        {buckets.map(b => {
          const on = selected === b.label;
          const known = typeof b.count === 'number';
          const h = known && b.count ? Math.max(2, Math.round((b.count / peak) * 100)) : 0;
          const ownedH = known && b.count ? Math.round(((b.owned || 0) / b.count) * 100) : 0;
          const reading = !known ? 'not counted'
            : `${b.count.toLocaleString()} game${b.count === 1 ? '' : 's'}${b.owned ? `, ${b.owned} shelved` : ''}`;
          return (
            <button
              key={b.label}
              onClick={() => onSelect(on ? null : b)}
              aria-pressed={on}
              disabled={!known || !b.count}
              title={`${b.label}: ${reading}`}
              aria-label={`${b.label}, ${reading}`}
              className="group relative flex-1 h-full flex items-end cursor-pointer disabled:cursor-default outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
            >
              {/* The column. Outline at rest so the ground stays black; it
                  inverts to a solid fill when it is the active span, which is
                  the only elevation this world has. */}
              {!known && <span className="absolute bottom-0 left-0 right-0 h-px bg-white/25" aria-hidden="true" />}
              {/* white/55, not white/15. A bar is a meaningful graphic under
                  1.4.11 and needs 3:1 against the ground; /15 measured about
                  2.2:1 and read as a ghost of the page's opening statement.
                  Selection inverts to solid, which is this world's only
                  elevation. */}
              <span
                className={`relative w-full overflow-hidden transition-colors ${
                  on ? 'bg-white' : 'bg-white/55 group-hover:bg-white/80 group-disabled:group-hover:bg-white/55'
                }`}
                style={{ height: `${h}%` }}
              >
                {/* Yours, knocked out of the column from the bottom. Anchored,
                    not margined: a percentage margin resolves against the
                    containing block's WIDTH, so `margin-top: 100%` shoved this
                    band ~150px below its own column and painted two stray white
                    rules across the controls underneath. Percentage HEIGHT does
                    resolve against the parent's height, which is what this
                    needs. Floored at 2px, because four shelved games against
                    eighty thousand is a true fraction and a sub-pixel band. */}
                {b.owned > 0 && (
                  <span
                    className={`absolute bottom-0 left-0 right-0 ${on ? 'bg-black/70' : 'bg-white'}`}
                    style={{ height: `max(2px, ${ownedH}%)` }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* The axis. Every other tick, and the short form on a phone: eleven
          columns across 390px leaves ~32px each, and "85–89" at 11px with
          0.18em tracking needs about 40 — every label truncated to "85…",
          which is not a legend, it is noise. */}
      <div className="flex gap-px mt-1.5" aria-hidden="true">
        {buckets.map((b, i) => {
          const short = b.from === null ? `<${String(HISTOGRAM_EPOCH_YEAR).slice(2)}`
            : b.to === null ? b.label
              : String(b.from).slice(2);
          return (
            <span key={b.label} className="flex-1 lh-label text-white/60 tabular-nums text-center overflow-hidden whitespace-nowrap">
              {i % 2 === 0 ? (
                <>
                  <span className="lg:hidden">{short}</span>
                  <span className="hidden lg:inline">{b.label}</span>
                </>
              ) : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function CategoryPage() {
  const { type, id } = useParams();
  const numericId = Number(id);

  const [categoryName, setCategoryName] = useState('');
  const [games, setGames] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  /* Synchronous localStorage read, so it is seeded here rather than through an
     effect. The page is remounted per category, so this runs once per category
     exactly as the old [type, id] effect did. */
  const [libraryMap, setLibraryMap] = useState(() => {
    const map = {};
    getLibrary().forEach(g => { map[String(g.id)] = g; });
    return map;
  });
  const [rawBuckets, setRawBuckets] = useState([]);   // counted, filter-blind
  const [buckets, setBuckets] = useState([]);        // the same, plus the shelved overlay
  const [chartLoading, setChartLoading] = useState(true);
  /* One-way: false until the first grid page has landed, then true for the
     rest of this category. It drives the page-two prefetch. A plain `loading`
     check cannot: with `loading` in the deps the effect refires on every page
     turn, and without it the effect reads a stale `true` and never fires at
     all — which is exactly how the chart once failed to appear. */
  const [gridReady, setGridReady] = useState(false);
  const [allPlatforms, setAllPlatforms] = useState([]);

  // ── The narrowing. One shape, all of it server-side. ──
  const [span, setSpan] = useState(null);            // { from, to, label } | null
  const [sortBy, setSortBy] = useState('Popularity');
  const [platformFilters, setPlatformFilters] = useState([]);
  const [gameTypeTab, setGameTypeTab] = useState('All');
  const [highlyRatedOnly, setHighlyRatedOnly] = useState(false);
  const [shelvedOnly, setShelvedOnly] = useState(false);

  const sentinelRef = useRef(null);

  /* The whole narrowing as one value. Every fetch keys off this, so there is
     one code path instead of the old split where library filters ran a second,
     client-side engine that pulled 500 rows and then could not paginate. */
  const query = useMemo(() => ({
    sortBy, platformFilters, gameTypeTab, highlyRatedOnly,
    from: span?.from ?? null, to: span?.to ?? null,
  }), [sortBy, platformFilters, gameTypeTab, highlyRatedOnly, span]);

  // ── Taxonomy name ──
  useEffect(() => {
    if (!type || !id) return;
    const byType = {
      genre: getGenreById, company: getCompanyById, theme: getThemeById,
      platform: getPlatformById, engine: getEngineById, mode: getGameModeById,
    };
    const fetcher = byType[type];
    if (!fetcher) { setCategoryName(type.charAt(0).toUpperCase() + type.slice(1)); return; }
    fetcher(numericId)
      .then(meta => setCategoryName(meta?.name || type))
      .catch(err => console.error('Error fetching category name:', err));
  }, [type, id, numericId]);

  // ── Library, read once per category ──
  /* The reset that used to live here is gone. Every setter in it wrote the
     value its useState already starts with, so keying the page by category in
     App.jsx does the same job a render earlier and without the intermediate
     frame. */

  // ── The chart: counted per bucket, then the library layer laid over it ──
  /* Two effects, not one. Folding the coverage overlay in here made the whole
     chart depend on libraryMap, and libraryMap is a fresh object each time it
     is written — so the histogram refetched on every change to it, three times
     per cold load. The counts describe the taxonomy and never move; only the
     overlay depends on what is shelved.

     Fired with the grid, not behind it: the old defer existed because the chart
     was eleven separate counts fighting the grid for IGDB's four-per-second
     budget. Multiquery made it two, so waiting only cost the chart the grid's
     whole latency on top of its own. */
  useEffect(() => {
    if (!type || !id) return;
    let alive = true;
    getCategoryReleaseHistogram({ categoryType: type, categoryId: numericId })
      .then(raw => { if (alive) setRawBuckets(raw || []); })
      .catch(err => { console.error('Error building category histogram:', err); if (alive) setRawBuckets([]); })
      .finally(() => { if (alive) setChartLoading(false); });
    return () => { alive = false; };
  }, [type, id, numericId]);

  // The shelved layer, laid over counts that are already in hand.
  useEffect(() => {
    if (!rawBuckets.length) { setBuckets([]); return; }
    const ids = Object.keys(libraryMap);
    if (!ids.length) { setBuckets(rawBuckets.map(b => ({ ...b, owned: 0 }))); return; }
    let alive = true;
    getCategoryLibraryDates({ categoryType: type, categoryId: numericId, ids })
      .then(owned => {
        if (!alive) return;
        const years = owned.map(g => yearOf(g.first_release_date)).filter(Boolean);
        setBuckets(rawBuckets.map(b => ({
          ...b,
          owned: years.filter(y => (b.from === null ? y < b.to : b.to === null ? y >= b.from : y >= b.from && y < b.to)).length,
        })));
      })
      .catch(() => { if (alive) setBuckets(rawBuckets.map(b => ({ ...b, owned: 0 }))); });
    return () => { alive = false; };
  }, [rawBuckets, libraryMap, type, id, numericId]);

  // ── Platforms present in this taxonomy ──
  useEffect(() => {
    if (!type || !id) return;
    getCategoryPlatforms({ categoryType: type, categoryId: numericId })
      .then(setAllPlatforms)
      .catch(err => console.error('Error fetching category platforms:', err));
  }, [type, id, numericId]);

  // Narrowing changed: the result set is a different set, so start it over.
  useEffect(() => { setPage(0); setGames([]); setHasMore(true); }, [type, id, query]);

  // ── The one fetch ──
  useEffect(() => {
    if (!type || !id) return;
    let alive = true;
    const first = page === 0;
    if (first) { setLoading(true); setLoadError(null); } else setLoadingMore(true);

    (async () => {
      try {
        const list = await getGamesByCategory({
          categoryType: type,
          categoryId: numericId,
          limit: pageLimit(page),
          offset: pageOffset(page),
          sortBy: query.sortBy,
          gameTypeTab: query.gameTypeTab,
          platformFilter: query.platformFilters.length ? query.platformFilters : null,
          highlyRatedOnly: query.highlyRatedOnly,
          releasedFrom: query.from,
          releasedBefore: query.to,
        });
        if (!alive) return;
        /* Appended by id, never by position: IGDB can return a row twice across
           pages when the sort key ties, and a duplicate key is a React warning
           plus a card that cannot be told apart from its twin. */
        setGames(prev => {
          if (first) return list;
          const seen = new Set(prev.map(g => g.id));
          return [...prev, ...list.filter(g => !seen.has(g.id))];
        });
        setHasMore(list.length === pageLimit(page));
      } catch (err) {
        console.error('Error fetching category games:', err);
        /* Held in state, not just logged. The old page swallowed this and left
           an empty grid that read as "no games in this genre". */
        if (alive && first) setLoadError(err?.message || 'The request did not complete');
      } finally {
        if (alive) {
          setLoading(false);
          setLoadingMore(false);
          if (first) setGridReady(true);
        }
      }
    })();
    return () => { alive = false; };
  }, [type, id, numericId, page, query]);

  // ── The count, for the same narrowing ──
  useEffect(() => {
    if (!type || !id) return;
    let alive = true;
    setTotalCount(null);
    getGamesCountByCategory({
      categoryType: type,
      categoryId: numericId,
      gameTypeTab: query.gameTypeTab,
      platformFilter: query.platformFilters.length ? query.platformFilters : null,
      highlyRatedOnly: query.highlyRatedOnly,
      releasedFrom: query.from,
      releasedBefore: query.to,
    }).then(n => { if (alive) setTotalCount(n); })
      .catch(() => { if (alive) setTotalCount(null); });
    return () => { alive = false; };
  }, [type, id, numericId, query]);

  // ── Infinite scroll ──
  /* Keep roughly three screens of unread grid below the fold at all times.
     Measured at 1600px: a page of 24 adds about 1500px on a desktop column
     count, so the buffer sagged to ~1.4 screens before the next batch even
     started — outrun it and you land on the sentinel with nothing under it.

     This is self-levelling rather than a one-shot trigger: appending changes
     games.length, the effect re-runs, and if the sentinel is still inside the
     margin it fetches again. It settles at whatever page count keeps the
     buffer, and stops on its own once it is deep enough. */
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;
    const lead = Math.max(3000, Math.round(window.innerHeight * 3));
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setPage(p => p + 1); }, { rootMargin: `${lead}px` });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, games.length]);

  useEffect(() => {
    if (page === 0 && gridReady && hasMore && !loadingMore) setPage(1);
  }, [gridReady, page, hasMore, loadingMore]);

  /* Shelved-only is the one narrowing IGDB cannot express, because it depends
     on a list that lives on this device. It filters the loaded page rather than
     the query, and the count line says so instead of implying otherwise. */
  const shown = useMemo(
    () => (shelvedOnly ? games.filter(g => libraryMap[String(g.id)]) : games),
    [games, shelvedOnly, libraryMap],
  );

  const handlePriority = useCallback((game, priority) => {
    const libGame = libraryMap[String(game.id)];
    if (!libGame) return;
    const updated = { ...libGame, priority };
    saveToLibrary(updated);
    setLibraryMap(prev => ({ ...prev, [String(game.id)]: updated }));
    toast(priority ? `Priority: ${priority}` : 'Priority cleared');
  }, [libraryMap]);

  const handleAddToWishlist = useCallback((e, game) => {
    e.preventDefault();
    e.stopPropagation();
    const gameData = {
      id: game.id,
      name: game.name,
      status: 'Wishlist',
      is_custom: false,
      cover_id: game.cover?.image_id || null,
      first_release_date: game.first_release_date || null,
      cover_width: game.cover?.width || null,
      cover_height: game.cover?.height || null,
    };
    saveToLibrary(gameData);
    setLibraryMap(prev => ({ ...prev, [String(game.id)]: gameData }));
    toast('Added to Wishlist');
  }, []);

  const isNarrowed = !!span || platformFilters.length > 0 || gameTypeTab !== 'All' || highlyRatedOnly || shelvedOnly;
  const clearNarrowing = useCallback(() => {
    setSpan(null); setPlatformFilters([]); setGameTypeTab('All');
    setHighlyRatedOnly(false); setShelvedOnly(false);
  }, []);

  /* The span the taxonomy actually covers, from the counted buckets — the only
     honest way to state it, since the grid only ever holds a page or two. */
  const coverage = useMemo(() => {
    const live = buckets.filter(b => typeof b.count === 'number' && b.count > 0);
    if (!live.length) return null;
    const first = live[0], last = live[live.length - 1];
    return {
      from: first.from,                        // null = the open bucket below 1980
      to: last.to === null ? null : last.to - 1, // null = the open bucket at the top
      label: last.label,
    };
  }, [buckets]);

  const platformLabel = platformFilters.length === 0 ? 'Platform'
    : platformFilters.length === 1
      ? (allPlatforms.find(p => p.id === platformFilters[0])?.abbreviation
        || allPlatforms.find(p => p.id === platformFilters[0])?.name || '1 platform')
      : `${platformFilters.length} platforms`;

  useAnnounce(loading ? 'Loading games'
    : loadError ? 'Could not load games'
      : `${shown.length} of ${totalCount ?? shown.length} games`);

  const chip = (on) => `lh-label h-8 px-3 flex items-center whitespace-nowrap border transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
    on ? 'bg-white text-black border-white' : 'border-white/15 text-white/60 hover:border-white/60 hover:text-white'
  }`;

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        {/* ── Masthead. Only what has been counted. ── */}
        <PageHeader
          className="mb-4"
          titleClassName="text-[28px] lg:text-[36px] leading-none"
          title={/* a blank string is not a heading; say which state this is */
            categoryName || (loadError ? 'Category Unavailable' : 'Loading')}
          count={totalCount !== null && !loadError
            ? `${totalCount.toLocaleString()} ${totalCount === 1 ? 'Game' : 'Games'}`
            : null}
          meta={[
            // The count beside it is filtered by the selected span, so the years are too.
            span ? span.label : coverage && `${coverage.from === null ? 'Pre-1980' : coverage.from}–${coverage.to === null ? 'Now' : coverage.to}`,
            type || 'Category',
          ]}
        />

        {/* ── The portrait, and the primary filter ── */}
        <section className="mb-4">
          <DensityChart
            failed={!!loadError}
            buckets={buckets}
            selected={span?.label ?? null}
            onSelect={setSpan}
            loading={chartLoading}
          />
        </section>

        {/* ── The control rule ── */}
        <div className="flex items-center gap-1.5 flex-wrap py-3 border-b border-white/15 mb-5">
          {span && (
            <button onClick={() => setSpan(null)} className={chip(true)}>
              {span.label}
              <X className="w-3 h-3 ml-1.5" aria-hidden="true" />
            </button>
          )}

          <DropdownMenu
            align="left"
            menuWidth={190}
            options={['All', 'Game', 'Others'].map(t => ({
              label: t === 'Others' ? 'DLC & Editions' : t === 'Game' ? 'Main games' : 'All types',
              isActive: gameTypeTab === t,
              onClick: () => setGameTypeTab(t),
            }))}
          >
            <button className={chip(gameTypeTab !== 'All')}>
              {gameTypeTab === 'All' ? 'Type' : gameTypeTab === 'Game' ? 'Main games' : 'DLC & Editions'}
              <ChevronDown className="w-3 h-3 ml-1.5" aria-hidden="true" />
            </button>
          </DropdownMenu>

          {allPlatforms.length > 0 && (
            <DropdownMenu
              align="left"
              menuWidth={240}
              options={allPlatforms.slice(0, 24).map(pf => ({
                label: pf.name,
                /* The mark, in its own brand colour, matching the platform group
                   headings in the library. A list of two dozen platform names is
                   read by shape long before it is read by word, and colour is
                   most of the shape -- PlayStation blue and Xbox green separate
                   at a glance in a way two white silhouettes do not.
                   getPlatformLogoUrl falls back to a stable console glyph for
                   anything unmapped, so no row is left without one. */
                icon: <PlatformGlyph platform={pf} />,
                isActive: platformFilters.includes(pf.id),
                onClick: () => setPlatformFilters(prev =>
                  prev.includes(pf.id) ? prev.filter(x => x !== pf.id) : [...prev, pf.id]),
              }))}
            >
              <button className={chip(platformFilters.length > 0)}>
                {platformLabel}
                <ChevronDown className="w-3 h-3 ml-1.5" aria-hidden="true" />
              </button>
            </DropdownMenu>
          )}

          <button onClick={() => setHighlyRatedOnly(v => !v)} aria-pressed={highlyRatedOnly} className={chip(highlyRatedOnly)}>
            Acclaimed
          </button>
          <button onClick={() => setShelvedOnly(v => !v)} aria-pressed={shelvedOnly} className={chip(shelvedOnly)}>
            On my shelves
          </button>

          {isNarrowed && (
            <button onClick={clearNarrowing} className="lh-label h-8 px-3 flex items-center border border-white/15 hover:border-white/40 text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white">
              Clear
            </button>
          )}

          <span className="flex-1" />

          <DropdownMenu
            align="right"
            menuWidth={180}
            options={SORTS.map(s => ({ label: s, isActive: sortBy === s, onClick: () => setSortBy(s) }))}
          >
            <button className={chip(false)}>
              Sort: {sortBy}
              <ChevronDown className="w-3 h-3 ml-1.5" aria-hidden="true" />
            </button>
          </DropdownMenu>
        </div>

        {/* ── The grid ── */}
        {loading ? (
          <div className="game-grid">
            {Array.from({ length: 12 }).map((_, i) => <GameCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <div className="border border-white/15 text-center px-6 py-16">
            <div className="lh-display text-xl text-white mb-2">The Index Did Not Answer</div>
            <p className="lh-label text-white/60 max-w-sm mx-auto mb-6">
              Games could not be loaded from IGDB. Your library is untouched.
            </p>
            <button
              onClick={() => setPage(0)}
              className="lh-label inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-white text-white hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Try Again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="border border-white/15 text-center px-6 py-16">
            <div className="lh-display text-xl text-white mb-2">Nothing In This Span</div>
            <p className="lh-label text-white/60 mb-6">
              {shelvedOnly
                ? 'None of the games loaded so far are on your shelves'
                : 'No games in this category answer the current narrowing'}
            </p>
            {isNarrowed && (
              <button onClick={clearNarrowing} className="lh-label inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] border border-white text-white hover:bg-white hover:text-black transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-white">
                Clear Narrowing
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="game-grid">
              {shown.map((game) => {
                const libGame = libraryMap[String(game.id)];
                const libStatus = libGame?.status;
                const cardGame = {
                  id: game.id,
                  name: game.name,
                  cover_id: game.cover?.image_id || null,
                  cover_width: game.cover?.width || null,
                  cover_height: game.cover?.height || null,
                  release_year: yearOf(game.first_release_date),
                  game_type_label: IGDB_CATEGORIES[game.game_type] || 'Game',
                  priority: libGame?.priority,
                };
                return (
                  <GameCard
                    key={game.id}
                    game={cardGame}
                    /* The shared helper. This page used to keep its own
                       STATUS_COLORS aimed at the monochrome ramp, so a status
                       rendered grey here and mint everywhere else. */
                    statusBadge={libStatus ? makeStatusBadge(libStatus) : null}
                    menuOptions={[
                      ...(libStatus && libStatus !== 'Beaten' ? [
                        ...PRIORITY_MENU.map((pr, i) => ({
                          label: pr.label,
                          icon: () => <div className="w-2.5 h-2.5" style={{ backgroundColor: pr.color }} />,
                          variant: 'default',
                          dividerAbove: i === 0,
                          onClick: () => handlePriority(game, pr.label),
                        })),
                        { label: 'Clear Priority', icon: X, variant: 'default', onClick: () => handlePriority(game, null) },
                      ] : []),
                      ...(libStatus
                        ? [{ label: `Status: ${libStatus}`, icon: Info, variant: 'default', dividerAbove: true }]
                        : [{ label: 'Add to Wishlist', icon: HeartPlus, variant: 'accent', onClick: (e) => handleAddToWishlist(e, game) }]),
                    ]}
                  />
                );
              })}
            </div>

            {/* Says what is left rather than spinning. Nothing is loading while
                this sits still; it is the scroll sentinel. */}
            {hasMore && (
              <div ref={sentinelRef} className="w-full flex justify-center py-8">
                {/* Never "Loading". The next page is already being fetched
                    long before this scrolls into view, so a busy word would be
                    describing a wait the reader is not having. */}
                <span className="lh-label text-white/60 tabular-nums">
                  {totalCount !== null
                    ? `${Math.max(0, totalCount - games.length).toLocaleString()} More`
                    : 'More'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
