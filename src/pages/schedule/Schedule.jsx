import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useSearchParams } from 'react-router-dom';
import GameCard from '../../components/games/GameCard';
import { GroupHeader } from '../../components/games/GameGridControls';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { getReleaseDates, getAnnouncedGames } from '../../services/igdb';

/* ─── constants ─── */
const CURRENT_YEAR = new Date().getFullYear();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAGE_SIZE = 50;

const TIME_FILTERS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'released', label: 'Recent' },
  { id: 'announced', label: 'Announced' },
];

const GAME_TYPE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'base', label: 'Base' },
  { id: 'dlc', label: 'DLC' },
];

const GAME_TYPE_LABELS = {
  1: 'DLC', 2: 'Expansion', 3: 'Bundle', 4: 'Standalone Expansion',
  5: 'Mod', 6: 'Episode', 7: 'Season', 8: 'Remake', 9: 'Remaster',
  10: 'Expanded Game', 11: 'Port', 12: 'Fork', 13: 'Pack', 14: 'Update',
};

/* Released looks backwards, Upcoming looks forwards */
const yearsFor = (timeFilter) =>
  timeFilter === 'released'
    ? [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3]
    : [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2, CURRENT_YEAR + 3];

/* Map a release_date entry → the shape GameCard reads.
   `dev` feeds the card's band strip — platforms are the useful signal here. */
const mapEntry = (e) => ({
  id: e.game.id,
  name: e.game.name,
  cover_id: e.game.cover?.image_id || null,
  dev: (e._platforms || []).map(p => p.abbreviation || p.name).filter(Boolean).join(' · ') || null,
  game_type_label: GAME_TYPE_LABELS[e.game.game_type] || null,
  release_year: e.date ? new Date(e.date * 1000).getUTCFullYear() : null,
  first_release_date: e.date || null,
  total_rating: e.game.total_rating || null,
  game_type: e.game.game_type ?? null,
  _label: e.human || (e.date
    ? new Date(e.date * 1000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'TBA'),
});

const mapAnnounced = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  dev: (g.platforms || []).map(p => p.abbreviation || p.name).filter(Boolean).join(' · ') || null,
  game_type_label: GAME_TYPE_LABELS[g.game_type] || null,
  release_year: null,
  first_release_date: null,
  total_rating: null,
  game_type: g.game_type ?? null,
  _label: null,
});

export default function Schedule() {
  // Time filters live in the URL so /schedule links are shareable and survive refresh.
  // Defaults (when=upcoming, no year/month) are omitted so bare /schedule stays clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const timeFilter = searchParams.get('when') || 'upcoming';
  const year = searchParams.get('year') ? Number(searchParams.get('year')) : null;
  const month = searchParams.get('month') ? Number(searchParams.get('month')) : null;

  const patchParams = useCallback((patch) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || (k === 'when' && v === 'upcoming')) next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setTimeFilter = (v) => patchParams({ when: v });
  const setYear = (v) => patchParams({ year: v });
  const setMonth = (v) => patchParams({ month: v });

  const [gameType, setGameType] = useState('all');

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const sentinelRef = useRef(null);

  const isAnnounced = timeFilter === 'announced';

  /* ── data ── */
  const fetchData = useCallback(async (apiOffset = 0, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      if (timeFilter === 'announced') {
        if (!append) setLoadError(null);
        const data = await getAnnouncedGames({ gameType, limit: PAGE_SIZE, offset: apiOffset });
        const items = data.map(mapAnnounced);
        setEntries(prev => {
          if (!append) return items;
          const seen = new Set(prev.map(g => g.id));
          return [...prev, ...items.filter(g => !seen.has(g.id))];
        });
        setHasMore(data.length >= PAGE_SIZE);
        setOffset(apiOffset + data.length);
      } else {
        // rawCount (not the deduped length) drives the API offset
        if (!append) setLoadError(null);
        const { results, rawCount } = await getReleaseDates({
          timeFilter, year, month, gameType, limit: PAGE_SIZE, offset: apiOffset,
        });
        const items = results.map(mapEntry);
        setEntries(prev => {
          if (!append) return items;
          const seen = new Set(prev.map(g => g.id));
          return [...prev, ...items.filter(g => !seen.has(g.id))];
        });
        setHasMore(rawCount >= PAGE_SIZE);
        setOffset(apiOffset + rawCount);
      }
    } catch (err) {
      console.error('Schedule fetch error:', err);
      setLoadError(err);
      // A throw skips setHasMore, and a sentinel that keeps firing into a failing
      // index is a request storm (measured: ~340 requests in six seconds).
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [timeFilter, gameType, year, month]);

  useEffect(() => {
    setEntries([]);
    setOffset(0);
    setHasMore(true);
    fetchData(0, false);
  }, [fetchData]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && hasMore && !loading && !loadingMore) fetchData(offset, true);
    }, { rootMargin: '600px' });   // 2500px kept the sentinel intersecting with the viewport parked at the top
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, offset, fetchData]);

  /* ── group by release date; Map keeps the API's chronological order ── */
  const groups = useMemo(() => {
    if (isAnnounced) return [{ label: null, games: entries }];
    const m = new Map();
    entries.forEach(e => {
      if (!m.has(e._label)) m.set(e._label, []);
      m.get(e._label).push(e);
    });
    return [...m.entries()].map(([label, games]) => ({ label, games }));
  }, [entries, isAnnounced]);

  const years = yearsFor(timeFilter);

  const cell = (active) =>
    `lh-label px-4 py-2.5 border-r last:border-r-0 border-white/10 whitespace-nowrap transition-colors cursor-pointer ${
      active ? 'bg-white text-black' : 'text-white/50 hover:text-white'
    }`;
  const pill = (active) =>
    `flex shrink-0 items-center h-8 px-3 border transition-colors lh-label cursor-pointer select-none ${
      active ? 'bg-white text-black border-white' : 'border-white/20 text-white/60 hover:text-white hover:border-white/70'
    }`;

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4 lg:py-12">

        <PageHeader
          className="mb-5"
          title="Schedule"
          count={`${entries.length} ${entries.length === 1 ? 'Title' : 'Titles'}`}
        />

        {/* ── Time filter — primary index ── */}
        <div className="flex overflow-x-auto no-scrollbar border border-white/15 w-max max-w-full mb-4">
          {TIME_FILTERS.map(f => (
            <button key={f.id} onClick={() => setTimeFilter(f.id)} aria-pressed={timeFilter === f.id} className={cell(timeFilter === f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Type + date narrowing ── */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <div className="flex overflow-x-auto no-scrollbar border border-white/15 w-max max-w-full">
            {GAME_TYPE_TABS.map(t => (
              <button key={t.id} onClick={() => setGameType(t.id)} aria-pressed={gameType === t.id} className={cell(gameType === t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {!isAnnounced && (
            <>
              <DropdownMenu
                align="left"
                options={[
                  { label: 'Any Year', onClick: () => patchParams({ year: null, month: null }), isActive: year === null },
                  ...years.map(y => ({ label: String(y), onClick: () => setYear(y), isActive: year === y })),
                ]}
              >
                <button className={pill(year !== null)}>{year ?? 'Any Year'}</button>
              </DropdownMenu>

              <DropdownMenu
                align="left"
                options={[
                  { label: 'Any Month', onClick: () => setMonth(null), isActive: month === null },
                  // A month only narrows within a year — pin the current one if none is set
                  ...MONTHS.map((m, i) => ({
                    label: m,
                    onClick: () => patchParams(year === null ? { month: i + 1, year: CURRENT_YEAR } : { month: i + 1 }),
                    isActive: month === i + 1,
                  })),
                ]}
              >
                <button className={pill(month !== null)}>{month ? MONTHS[month - 1] : 'Any Month'}</button>
              </DropdownMenu>
            </>
          )}
        </div>

        {/* ── Calendar ── */}
        {loading ? (
          <div className="game-grid">
            {Array.from({ length: 10 }).map((_, i) => <GameCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
        ) : entries.length === 0 ? (
          <EmptyPlate title="Nothing Scheduled" body="No releases match the current filters" />
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map(group => (
              <div key={group.label || 'all'}>
                {group.label && <GroupHeader label={group.label} count={group.games.length} />}
                <div className="game-grid animate-in slide-in-from-bottom-4 fade-in">
                  {group.games.map(game => (
                    <GameCard
                      key={game.id}
                      game={game}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Infinite scroll ── */}
        <div ref={sentinelRef} className="h-px" />
        {loadingMore && <div className="lh-label text-white/60 text-center py-8">Loading…</div>}
        {!loading && !hasMore && entries.length > 0 && (
          <div className="lh-label text-white/50 text-center py-8">End of List</div>
        )}
      </div>
    </div>
  );
}
