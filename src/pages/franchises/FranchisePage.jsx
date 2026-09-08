import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useMemo } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import GameCard from '../../components/games/GameCard';
import { useGameGridControls, GroupHeader } from '../../components/games/GameGridControls';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toast';
import { getGamesByFranchiseId, getRelatedFranchises } from '../../services/igdb';
import { getLibrary, isFranchiseSaved, saveFranchise, removeFranchise } from '../../services/db';
import { statusBadge as makeStatusBadge } from '../../constants/stateColors';

/* Map a raw IGDB game object to the shape GameCard + grid controls read */
const mapGame = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
  first_release_date: g.first_release_date || null,
  total_rating: g.total_rating || null,
  game_type: g.game_type ?? null,
  platforms: g.platforms || [],
});

export default function FranchisePage() {
  const { franchiseId } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [games, setGames] = useState([]);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [libraryMap, setLibraryMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGames([]);
    setRelated([]);
    setSaved(isFranchiseSaved(franchiseId));

    const lib = getLibrary();
    const map = {};
    lib.forEach(g => { map[String(g.id)] = g.status; });
    setLibraryMap(map);

    (async () => {
      try {
        setLoadError(null);
        const { franchiseName, games: fetched } = await getGamesByFranchiseId(franchiseId);
        if (cancelled) return;
        setName(franchiseName);
        setGames((fetched || []).map(mapGame));

        // Related franchises share games with this one — fetched after the main list
        const gameIds = (fetched || []).map(g => g.id);
        getRelatedFranchises(franchiseId, gameIds)
          .then(rel => { if (!cancelled) setRelated(rel || []); })
          .catch(() => {});
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [franchiseId]);

  const { toolbar, groups, visibleCount } = useGameGridControls(games, libraryMap);

  const yearSpan = useMemo(() => {
    const years = games.map(g => g.release_year).filter(Boolean);
    if (years.length === 0) return null;
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? String(min) : `${min} — ${max}`;
  }, [games]);

  const ownedCount = useMemo(
    () => games.filter(g => libraryMap[String(g.id)]).length,
    [games, libraryMap]
  );

  const handleToggleSaved = () => {
    if (saved) {
      removeFranchise(franchiseId);
      setSaved(false);
      toast(`Removed ${name} from saved franchises`);
    } else {
      if (!name) { toast('This franchise has no name to save yet'); return; }
      saveFranchise({ id: Number(franchiseId), name });
      setSaved(true);
      toast(`Saved ${name}`);
    }
  };

  const statusBadge = (game) => {
    const status = libraryMap[String(game.id)];
    if (!status) return null;
    return makeStatusBadge(status);
  };

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        {/* ── Header — editorial index ── */}
        <PageHeader
          back={{ label: 'Back', onClick: () => navigate(-1), ariaLabel: 'Go back to previous page' }}
          /* Never ship a placeholder as a finished heading. The three states are
             different facts: still asking, asked and got nothing, asked and failed. */
          title={loading ? 'Loading' : (name || (loadError ? 'Franchise Unavailable' : 'Franchise Not Found'))}
          count={`${games.length} ${games.length === 1 ? 'Title' : 'Titles'}`}
          meta={[
            ownedCount > 0 && `${ownedCount} in Library`,
            yearSpan ? `Franchise — ${yearSpan}` : 'Franchise',
          ]}
          actions={
            <button
              onClick={handleToggleSaved}
              disabled={!name && !saved}
              className={`lh-label flex items-center gap-1.5 px-3 py-2 border transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${saved
                ? 'bg-white text-black border-white'
                : 'border-white/20 text-white/60 hover:text-white hover:border-white'
                }`}
            >
              {saved ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
              {saved ? 'Saved' : 'Save'}
            </button>
          }
        />

        <div className="h-px bg-white/15 mb-6" />

        {/* ── Controls + grid ── */}
        {loading ? (
          <div className="game-grid">
            {Array.from({ length: 10 }).map((_, i) => <GameCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
        ) : games.length === 0 ? (
          <EmptyPlate title="No Entries" body="IGDB lists no titles for this franchise" />
        ) : (
          <>
            {toolbar}
            {visibleCount === 0 ? (
              <EmptyPlate title="Nothing matches the current filters" body="Widen or clear a filter to bring the rest back." />
            ) : (
              <div className="flex flex-col gap-8">
                {groups.map(group => (
                  <div key={group.label || 'all'}>
                    {group.label && <GroupHeader label={group.label} count={group.games.length} />}
                    <div className="game-grid animate-in slide-in-from-bottom-4 fade-in">
                      {group.games.map(game => (
                        <GameCard key={game.id} game={game} statusBadge={statusBadge(game)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Related franchises — share titles with this one ── */}
        {related.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Related Franchises</h2>
              <div className="flex-1 h-px bg-white/15" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {related.map(fr => (
                <Link
                  key={fr.id}
                  to={`/franchise/${fr.id}`}
                  className="lh-label px-3 py-2 border border-white/15 text-white/60 hover:bg-white hover:text-black transition-colors"
                >
                  {fr.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
