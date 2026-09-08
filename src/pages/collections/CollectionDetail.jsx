import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useMemo, useRef } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { X, Bookmark, BookmarkCheck, Trash2, Search, Plus, Pencil, Copy } from 'lucide-react';
import GameCard from '../../components/games/GameCard';
import { useGameGridControls } from '../../components/games/GameGridControls';
import { GroupHeader } from '../../components/games/GroupHeader';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/toastBus';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import {
  getCollections, saveCollection, deleteCollection, removeGameFromCollection, addGameToCollection,
  saveIgdbCollection, removeIgdbCollection, isIgdbCollectionSaved,
  getLibrary,
} from '../../services/db';
import { getCollectionsByIds, getCollectionMembershipsByCollectionId, getGamesByIds, searchGames } from '../../services/igdb';
import { statusBadge as makeStatusBadge } from '../../constants/stateColors';

/* Map a raw IGDB game object to the shape GameCard + grid controls read */
const mapGame = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
  first_release_date: g.first_release_date || null,
  total_rating: g.total_rating || null,
  game_type: g.game_type ?? null,
  platforms: g.platforms || [],
});

export default function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isIgdb = location.pathname.includes('/collection/igdb/');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [meta, setMeta] = useState(null);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saved, setSaved] = useState(false);
  /* Synchronous localStorage read, seeded here rather than in the load effect. */
  const [libraryMap] = useState(() => {
    const map = {};
    getLibrary().forEach(g => { map[String(g.id)] = g.status; });
    return map;
  });

  useEffect(() => {
    let cancelled = false;
    /* No reset here: the route is keyed by pathname, so loading and games
       already hold their initial true / [], and libraryMap is seeded above. */

    (async () => {
      try {
        setLoadError(null);
        if (isIgdb) {
          setSaved(isIgdbCollectionSaved(id));
          const [cols, memberships] = await Promise.all([
            getCollectionsByIds([id]),
            getCollectionMembershipsByCollectionId(id),
          ]);
          if (cancelled) return;
          const col = cols?.[0];
          setName(col?.name || 'Collection');
          setMeta(col?.type?.name || 'IGDB');
          const memberGames = (memberships || []).map(m => m.game).filter(Boolean);
          setGames(memberGames.map(mapGame));
        } else {
          const col = getCollections().find(c => String(c.id) === String(id));
          if (!col) {
            setName('');
            setGames([]);
            return;
          }
          setName(col.name);
          setDescription(col.description || '');
          setMeta('Custom');
          const ids = col.games || [];
          if (ids.length > 0) {
            const fetched = await getGamesByIds(ids);
            if (cancelled) return;
            setGames((fetched || []).map(mapGame));
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isIgdb]);

  const { toolbar, groups, visibleCount } = useGameGridControls(games, libraryMap);

  /* ── Add games to a custom collection via IGDB search ── */
  const [addQuery, setAddQuery] = useState('');
  /* Results carry the query they answer, so "searching" is a comparison rather
     than a flag an effect raises and lowers. */
  const [addSearch, setAddSearch] = useState({ for: '', items: [] });
  const trimmedAdd = addQuery.trim();
  const addResults = addSearch.for === trimmedAdd ? addSearch.items : [];
  const addSearching = !isIgdb && trimmedAdd !== '' && addSearch.for !== trimmedAdd;
  const addTimer = useRef(null);

  useEffect(() => {
    const q = addQuery.trim();
    /* Nothing to clear: results are keyed by the query they answer, so a stale
       set stops matching the moment the box empties. */
    if (isIgdb || !q) return;
    if (addTimer.current) clearTimeout(addTimer.current);
    addTimer.current = setTimeout(async () => {
      try {
        const found = await searchGames(q);
        setAddSearch({ for: q, items: found || [] });
      } catch {
        /* Still record the query, or `addSearching` never goes false. */
        setAddSearch({ for: q, items: [] });
      }
    }, 350);
    return () => { if (addTimer.current) clearTimeout(addTimer.current); };
  }, [addQuery, isIgdb]);

  const inCollection = useMemo(() => new Set(games.map(g => String(g.id))), [games]);

  const handleAddGame = (igdbGame) => {
    addGameToCollection(id, igdbGame.id);
    setGames(prev => [...prev, mapGame(igdbGame)]);
    toast(`Added "${igdbGame.name}"`);
  };

  const handleToggleSaved = () => {
    if (saved) {
      removeIgdbCollection(id);
      setSaved(false);
      toast(`Removed "${name}"`);
    } else {
      saveIgdbCollection(id);
      setSaved(true);
      toast(`Saved "${name}"`);
    }
  };

  /* ── Edit name/description — custom collections only ── */
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const handleStartEdit = () => {
    setEditName(name);
    setEditDesc(description);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) { toast('Enter a name for the collection'); return; }
    saveCollection({ id, name: editName.trim(), description: editDesc.trim() });
    setName(editName.trim());
    setDescription(editDesc.trim());
    setIsEditing(false);
    toast('Collection updated');
  };

  /* Clone a community (IGDB) collection into My Collections */
  const handleClone = () => {
    const newCol = saveCollection({
      name: `${name} (Clone)`,
      description: 'Cloned from community collection.',
      games: games.map(g => Number(g.id)),
    });
    toast('Cloned to My Collections');
    navigate(`/collection/${newCol.id}`);
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const handleDelete = () => setConfirmDelete(true);
  const doDelete = () => {
    deleteCollection(id);
    toast(`Deleted "${name}"`);
    navigate('/collections');
  };

  const handleRemoveGame = (game) => {
    removeGameFromCollection(id, game.id);
    setGames(prev => prev.filter(g => String(g.id) !== String(game.id)));
    toast(`Removed "${game.name}"`);
  };

  const statusBadge = (game) => {
    const status = libraryMap[String(game.id)];
    if (!status) return null;
    return makeStatusBadge(status);
  };

  /* A failed index must not read as a missing collection: name never arrives on
     a throw, so this has to come before the not-found branch. */
  if (!loading && loadError) {
    return (
      <div className="content-container py-4 lg:py-12">
        <PageHeader back={{ label: 'Collections', onClick: () => navigate('/collections') }} title="Collection Unavailable" />
        <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
      </div>
    );
  }

  if (!loading && !name) {
    return (
      <div className="content-container py-4">
        <EmptyPlate
          title="Not Found"
          body="This collection does not exist"
          action={<button onClick={() => navigate('/collections')} className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer">Back to Collections</button>}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        {/* ── Header — editorial index ── */}
        {isEditing ? (
          <header className="mb-8">
            <button
              onClick={() => navigate('/collections')}
              className="lh-label text-white/60 hover:text-white transition-colors cursor-pointer mb-4 block"
            >
              ← Collections
            </button>
            <div className="max-w-2xl flex flex-col gap-3">
              <div>
                <label htmlFor="collection-name" className="lh-label text-white/60 block mb-1.5">Name</label>
                <input
                  id="collection-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-10 px-3 bg-black border border-white/40 focus:border-white text-white outline-none transition-colors"
                />
              </div>
              <div>
                <label htmlFor="collection-desc" className="lh-label text-white/60 block mb-1.5">Description</label>
                <textarea
                  id="collection-desc"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-black border border-white/40 focus:border-white text-sm text-white outline-none transition-colors resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  className="lh-label px-4 py-2.5 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer"
                >
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="lh-label px-4 py-2.5 border border-white/20 text-white/60 hover:text-white hover:border-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </header>
        ) : (
          <>
            <PageHeader
              className={description ? 'mb-3' : 'mb-8'}
              back={{ label: 'Collections', onClick: () => navigate('/collections') }}
              title={name || 'Loading'}
              count={`${games.length} ${games.length === 1 ? 'Title' : 'Titles'}`}
              meta={meta ? `Collection — ${meta}` : 'Collection'}
              actions={
                <div className="flex items-center gap-2 shrink-0">
                  {isIgdb ? (
                    <>
                      <button
                        onClick={handleToggleSaved}
                        disabled={!!loadError}
                        className={`lh-label flex items-center gap-1.5 px-3 py-2 border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${saved
                          ? 'bg-white text-black border-white'
                          : 'border-white/20 text-white/60 hover:text-white hover:border-white'
                          }`}
                      >
                        {saved ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                        {saved ? 'Saved' : 'Save'}
                      </button>
                      <button
                        onClick={handleClone}
                        disabled={!!loadError}
                        className="lh-label flex items-center gap-1.5 px-3 py-2 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Copy className="w-3 h-3" />
                        Clone
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleStartEdit}
                        className="lh-label flex items-center gap-1.5 px-3 py-2 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      <button
                        onClick={handleDelete}
                        className="lh-label flex items-center gap-1.5 px-3 py-2 border border-white/15 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              }
            />
            {description && (
              <p className="text-sm text-white/60 leading-relaxed max-w-2xl mb-8">
                {description}
              </p>
            )}
          </>
        )}

        <div className="h-px bg-white/15 mb-6" />

        {/* ── Add games — custom collections only ── */}
        {!isIgdb && (
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
              <input
                aria-label="Search games to add"
                type="text"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                id="collection-add-search"
                placeholder="ADD GAMES — SEARCH IGDB"
                className="w-full h-10 pl-10 pr-9 bg-black border border-white/40 focus:border-white/70 lh-label text-white placeholder:text-white/50 outline-none transition-colors"
              />
              {addQuery && (
                <button
                  onClick={() => setAddQuery('')}
                  aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {addSearching ? (
              <div className="lh-label text-white/60 py-4 text-center border border-t-0 border-white/15">Searching…</div>
            ) : addResults.length > 0 ? (
              <div className="border border-t-0 border-white/15 max-h-80 overflow-y-auto custom-scrollbar">
                {addResults.map((g, i) => {
                  const added = inCollection.has(String(g.id));
                  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
                  return (
                    <div
                      key={g.id}
                      className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? 'border-t border-white/10' : ''}`}
                    >
                      <div className="w-8 h-10 shrink-0 bg-neutral-900 border border-white/10 overflow-hidden">
                        {g.cover?.image_id && (
                          <img
                            src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${g.cover.image_id}.jpg`}
                            alt=""
                            className="w-full h-full object-cover block"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-white block truncate">{g.name}</span>
                        {year && <span className="lh-label text-white/60">{year}</span>}
                      </div>
                      <button
                        onClick={() => !added && handleAddGame(g)}
                        /* Adding sets `added`; `disabled` would drop focus out of the
                           results list after every add. WCAG 2.4.3. */
                        aria-disabled={added}
                        className={`lh-label flex items-center gap-1.5 px-3 py-2 border transition-colors shrink-0 ${added
                          ? 'bg-white text-black border-white cursor-default'
                          : 'border-white/20 text-white/60 hover:text-white hover:border-white cursor-pointer'
                          }`}
                      >
                        <Plus className="w-3 h-3" />
                        {added ? 'Added' : 'Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : addQuery.trim() ? (
              <div className="lh-label text-white/60 py-4 text-center border border-t-0 border-white/15">No games found</div>
            ) : null}
          </div>
        )}

        {/* ── Controls + grid ── */}
        {loading ? (
          <div className="game-grid">
            {Array.from({ length: 10 }).map((_, i) => <GameCardSkeleton key={i} />)}
          </div>
        ) : loadError ? (
          <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
        ) : games.length === 0 ? (
          <EmptyPlate
            title="Empty Shelf"
            body={isIgdb ? 'IGDB lists no titles for this collection' : 'Search IGDB above to add your first title.'}
            action={isIgdb ? null : <button onClick={() => document.getElementById('collection-add-search')?.focus()} className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer">Search IGDB</button>}
          />
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
                        <GameCard
                          key={game.id}
                          game={game}
                          statusBadge={statusBadge(game)}
                          menuOptions={!isIgdb ? [
                            {
                              label: 'Remove from Collection',
                              icon: X,
                              variant: 'danger',
                              onClick: () => handleRemoveGame(game),
                            },
                          ] : []}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        eyebrow="Collection"
        title="Delete this collection?"
        body={`"${name}" and its list of games will be removed. The games themselves stay in your library.`}
      />
    </div>
  );
}
