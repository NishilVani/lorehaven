import { useState, useEffect, useRef } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { Plus, Search, X, Bookmark, BookmarkCheck, Trash2, SearchX } from 'lucide-react';
import CollectionTile from '../../components/collections/CollectionTile';
import { toast } from '../../components/ui/toastBus';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import {
  getCollections, saveCollection, deleteCollection,
  getSavedIgdbCollections, saveIgdbCollection, removeIgdbCollection,
  getSavedFranchises, saveFranchise, removeFranchise,
} from '../../services/db';
import { getCollectionsByIds, searchIgdbCollections, searchFranchises, getFranchises, getGamesByIds, getFranchiseMetadataByIds } from '../../services/igdb';
import useAnnounce from '../../components/ui/useAnnounce';
import PageHeader from '../../components/ui/PageHeader';

const FEED_HALF = 9; // per-kind page size — 18 tiles per feed page

/* ── Small editorial primitives ── */
function SectionHeader({ children, right = null }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">{children}</h2>
      <div className="flex-1 h-px bg-white/15" />
      {right}
    </div>
  );
}

/* Alternate two lists into one mixed stream */
const interleave = (a, b) => {
  const out = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
};

export default function Collections() {
  const [pageTab, setPageTab] = useState('discover');

  /* ── Saved state ── */
  /* All three of these come from localStorage, synchronously. Seeding them
     through a mount effect meant the page always rendered empty once before
     showing shelves the browser already had on disk. */
  const [localCollections, setLocalCollections] = useState(getCollections);
  const [localGameMeta, setLocalGameMeta] = useState({});   // gameId -> { name, cover }
  const [savedIgdb, setSavedIgdb] = useState([]);            // hydrated IGDB collections
  const [savedIds, setSavedIds] = useState(getSavedIgdbCollections);
  const [savedFranchises, setSavedFranchises] = useState(
    () => getSavedFranchises().map(f => ({ ...f, games: [], count: 0 })));

  // Create flow
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  /* ── Discover: mixed search ── */
  const [query, setQuery] = useState('');
  /* Results carry the query they answer, so "searching" is a comparison rather
     than a flag an effect has to raise and lower. That is what removes the two
     synchronous setState calls this effect used to open with. */
  const [search, setSearch] = useState({ for: '', items: [] });
  const searchTimer = useRef(null);
  const trimmedQuery = query.trim();
  const results = search.for === trimmedQuery ? search.items : [];
  const searching = trimmedQuery !== '' && search.for !== trimmedQuery;

  /* ── Discover: mixed infinite feed — fresh offsets every visit ── */
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedDone, setFeedDone] = useState(false);
  const [feedError, setFeedError] = useState(null);
  const feedState = useRef(null); // { cOff, fOff, cDone, fDone, busy }
  const sentinelRef = useRef(null);

  /* ── Load local collections + hydrate their covers in one batch ── */
  useEffect(() => {
    const coverIds = [...new Set(localCollections.flatMap(c => (c.games || []).slice(0, 14)))];
    if (coverIds.length > 0) {
      getGamesByIds(coverIds).then(games => {
        const map = {};
        (games || []).forEach(g => { map[String(g.id)] = { name: g.name, cover: g.cover?.image_id || null }; });
        setLocalGameMeta(map);
      }).catch(() => {});
    }
  }, []);

  /* ── Load saved IGDB collections ── */
  useEffect(() => {
    if (savedIds.length > 0) {
      getCollectionsByIds(savedIds).then(cols => setSavedIgdb(cols || [])).catch(() => {});
    }
    // Hydrated once on mount, exactly as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Load saved franchises (names locally, covers hydrated from IGDB) ── */
  useEffect(() => {
    const frs = getSavedFranchises();
    if (frs.length === 0) return;
    getFranchiseMetadataByIds(frs.map(f => f.id)).then(metas => {
      setSavedFranchises(frs.map(f => {
        const meta = (metas || []).find(m => Number(m.id) === Number(f.id));
        return {
          ...f,
          games: (meta?.games || []).map(g => ({ name: g.name, cover: g.cover?.image_id || null })).slice(0, 14),
          count: meta?.games?.length || 0,
        };
      }));
    }).catch(() => {});
  }, []);

  /* ── Feed loader — pulls half collections, half franchises, interleaved ── */
  const loadFeedPage = async () => {
    const s = feedState.current;
    if (!s || s.busy || (s.cDone && s.fDone)) return;
    s.busy = true;
    setFeedLoading(true);
    try {
      const [cols, frs] = await Promise.all([
        s.cDone ? [] : searchIgdbCollections('', FEED_HALF, s.cOff).catch(err => { setFeedError(err); return []; }),
        s.fDone ? [] : getFranchises(FEED_HALF, s.fOff).catch(err => { setFeedError(err); return []; }),
      ]);
      if (!s.cDone) { s.cOff += FEED_HALF; if ((cols || []).length < FEED_HALF) s.cDone = true; }
      if (!s.fDone) { s.fOff += FEED_HALF; if ((frs || []).length < FEED_HALF) s.fDone = true; }

      const tagged = interleave(
        (cols || []).map(c => ({ ...c, kind: 'collection' })),
        (frs || []).map(f => ({ ...f, kind: 'franchise' })),
      );
      setFeed(prev => {
        const seen = new Set(prev.map(x => `${x.kind}-${x.id}`));
        return [...prev, ...tagged.filter(x => !seen.has(`${x.kind}-${x.id}`))];
      });
      if (s.cDone && s.fDone) setFeedDone(true);
    } finally {
      s.busy = false;
      setFeedLoading(false);
    }
  };

  /* Fresh feed on every mount — random starting offsets keep the stream new */
  useEffect(() => {
    feedState.current = {
      cOff: Math.floor(Math.random() * 300),
      fOff: Math.floor(Math.random() * 200),
      cDone: false,
      fDone: false,
      busy: false,
    };
    /* No setFeed([]) / setFeedDone(false) here: this effect runs once, on
       mount, when both already hold exactly those values. */
    loadFeedPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Infinite scroll — sentinel + scroll fallback (some webviews throttle observers) */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadFeedPage(); },
      { rootMargin: '800px' }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab, query, feed.length]);

  useEffect(() => {
    /* Coalesced to one check per frame -- see Discover.jsx. The listener stays
       because the observer above is the primary path and this is the fallback
       for webviews that throttle observers. */
    let ticking = false;
    const onScroll = () => {
      if (pageTab !== 'discover' || query.trim() || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 900) loadFeedPage();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab, query]);

  /* ── Mixed search — collections and franchises in one stream ── */
  useEffect(() => {
    const q = query.trim();
    /* Nothing to clear on an empty query: results are keyed by the query they
       answer, so a stale set stops matching the moment the box empties. */
    if (!q) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const [cols, frs] = await Promise.all([
          searchIgdbCollections(q, 10).catch(() => []),
          searchFranchises(q).catch(() => []),
        ]);
        const merged = [
          ...(cols || []).map(c => ({ ...c, kind: 'collection' })),
          ...(frs || []).map(f => ({ ...f, kind: 'franchise' })),
        ].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setSearch({ for: q, items: merged });
      } catch {
        /* Still record the query, or `searching` never goes false. */
        setSearch({ for: q, items: [] });
      }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  /* ── Save toggles + shelf management ── */
  const isItemSaved = (item) => item.kind === 'collection'
    ? savedIds.map(Number).includes(Number(item.id))
    : savedFranchises.some(f => Number(f.id) === Number(item.id));

  const toggleSaved = (col) => {
    const isSaved = savedIds.map(Number).includes(Number(col.id));
    if (isSaved) {
      removeIgdbCollection(col.id);
      setSavedIgdb(prev => prev.filter(c => Number(c.id) !== Number(col.id)));
      toast(`Removed "${col.name}"`);
    } else {
      saveIgdbCollection(col.id);
      setSavedIgdb(prev => [...prev, col]);
      toast(`Saved "${col.name}"`);
    }
    setSavedIds(getSavedIgdbCollections());
  };

  const toggleSavedFranchise = (fr) => {
    const isSaved = savedFranchises.some(f => Number(f.id) === Number(fr.id));
    if (isSaved) {
      removeFranchise(fr.id);
      setSavedFranchises(prev => prev.filter(f => Number(f.id) !== Number(fr.id)));
      toast(`Removed "${fr.name}"`);
    } else {
      saveFranchise({ id: fr.id, name: fr.name });
      setSavedFranchises(prev => [...prev, {
        id: fr.id,
        name: fr.name,
        games: (fr.games || []).map(g => ({ name: g.name, cover: g.cover?.image_id || null })).slice(0, 14),
        count: fr.games?.length || 0,
      }]);
      toast(`Saved "${fr.name}"`);
    }
  };

  const toggleItem = (item) => item.kind === 'collection' ? toggleSaved(item) : toggleSavedFranchise(item);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) { toast('Enter a name for the collection'); return; }
    if (localCollections.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast(`"${name}" already exists`);
      return;
    }
    saveCollection({ name, games: [] });
    setLocalCollections(getCollections());
    setNewName('');
    setCreating(false);
    toast(`Created "${name}"`);
  };

  const [pendingDelete, setPendingDelete] = useState(null);
  const handleDeleteCollection = (col) => setPendingDelete(col);
  const confirmDeleteCollection = () => {
    const col = pendingDelete;
    if (!col) return;
    deleteCollection(col.id);
    setLocalCollections(getCollections());
    toast(`Deleted "${col.name}"`);
  };

  const handleRemoveShelf = (shelf) => {
    if (shelf.key.startsWith('igdb-')) {
      removeIgdbCollection(shelf.id);
      setSavedIgdb(prev => prev.filter(c => Number(c.id) !== Number(shelf.id)));
      setSavedIds(getSavedIgdbCollections());
    } else {
      removeFranchise(shelf.id);
      setSavedFranchises(prev => prev.filter(f => Number(f.id) !== Number(shelf.id)));
    }
    toast(`Removed "${shelf.name}"`);
  };

  const igdbGames = (col) =>
    (col.games || []).map(g => ({ name: g.name, cover: g.cover?.image_id || null })).slice(0, 14);

  const savedCount = localCollections.length + savedIgdb.length + savedFranchises.length;

  /* Tile for a feed / search item */
  const discoverTile = (item) => {
    const isCollection = item.kind === 'collection';
    const saved = isItemSaved(item);
    return (
      <CollectionTile
        key={`${item.kind}-${item.id}`}
        to={isCollection ? `/collection/igdb/${item.id}` : `/franchise/${item.id}`}
        name={item.name}
        count={(item.games || []).length}
        games={(item.games || []).map(g => ({ name: g.name, cover: g.cover?.image_id || null })).slice(0, 14)}
        meta={isCollection ? (item.type?.name || 'Collection') : 'Franchise'}
        mutedMeta={!isCollection}
        menuOptions={[
          {
            label: saved ? 'Remove from Shelves' : 'Save to Shelves',
            icon: saved ? BookmarkCheck : Bookmark,
            onClick: () => toggleItem(item),
          },
        ]}
      />
    );
  };

  // Search state and result count were only visible, never announced. 4.1.3.
  useAnnounce(searching ? 'Searching'
    : query.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
    : feedLoading ? 'Loading collections' : null);

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        {/* ── Header — editorial index ── */}
        <PageHeader
          className="mb-6"
          title="Collections"
          count={`${savedCount} ${savedCount === 1 ? 'Shelf' : 'Shelves'}`}
        />

        {/* ── Page tabs ── */}
        <div className="flex border border-white/15 w-max mb-8">
          {[{ key: 'discover', label: 'Discover' }, { key: 'saved', label: 'Saved' }].map(tab => (
            <button
              key={tab.key}
              onClick={() => setPageTab(tab.key)}
              aria-pressed={pageTab === tab.key}
              className={`lh-label px-5 py-2.5 whitespace-nowrap border-r last:border-r-0 border-white/10 transition-colors cursor-pointer ${pageTab === tab.key
                ? 'bg-white text-black'
                : 'text-white/50 hover:text-white'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════════════ DISCOVER ════════════════ */}
        {pageTab === 'discover' && (
          <section>
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
              <input
                aria-label="Search collections and franchises"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SEARCH COLLECTIONS & FRANCHISES"
                className="w-full h-10 pl-10 pr-9 bg-black border border-white/40 focus:border-white/70 lh-label text-white placeholder:text-white/50 outline-none transition-colors"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {query.trim() ? (
              /* Search results — same tiles, mixed types */
              searching ? (
                <div className="lh-label text-white/60 py-6 text-center border border-white/15">Searching…</div>
              ) : results.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                  {results.map(discoverTile)}
                </div>
              ) : (
                <EmptyPlate icon={SearchX} title="Nothing found" body={`No collection or franchise on IGDB matches "${query.trim()}". Try a shorter or differently spelled term.`} />
              )
            ) : (
              /* The feed — mixed infinite scroll */
              feedError && feed.length === 0 ? (
                <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
              ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                  {feed.map(discoverTile)}
                </div>
                <div ref={sentinelRef} className="h-px" />
                {feedLoading && (
                  <div className="lh-label text-white/60 py-6 text-center border border-white/15 mt-6">Loading…</div>
                )}
                {feedDone && feed.length > 0 && (
                  <div className="lh-label text-white/50 py-6 text-center mt-6">— End of the Index —</div>
                )}
              </>
              )
            )}
          </section>
        )}

        {/* ════════════════ SAVED ════════════════ */}
        {pageTab === 'saved' && (
          <>
            {/* Your Collections */}
            <section className="mb-12">
              <SectionHeader
                right={
                  <button
                    onClick={() => setCreating(v => !v)}
                    className="lh-label flex items-center gap-1.5 px-3 py-2 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer"
                  >
                    {creating ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {creating ? 'Cancel' : 'New Collection'}
                  </button>
                }
              >
                Your Collections
              </SectionHeader>

              {creating && (
                <div className="flex mb-4 border border-white/20">
                  <input
                aria-label="New collection name"
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    placeholder="COLLECTION NAME"
                    className="flex-1 h-10 px-3 bg-black lh-label text-white placeholder:text-white/50 outline-none min-w-0"
                  />
                  <button
                    onClick={handleCreate}
                    className="lh-label px-4 border-l border-white/20 bg-white text-black hover:bg-neutral-200 transition-colors cursor-pointer"
                  >
                    Create
                  </button>
                </div>
              )}

              {/* Not gated on the create form any more: opening it used to delete the
                  page's only instructions, so pressing Create on an empty name left
                  less on screen than before. */}
              {localCollections.length === 0 ? (
                <EmptyPlate
                  icon={Plus}
                  title="No collections yet"
                  body="A collection is a shelf you name yourself: a series, a genre binge, a backlog you want kept separate."
                  action={creating ? null : <button onClick={() => setCreating(true)} className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer">Create your first collection</button>}
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                  {localCollections.map(col => (
                    <CollectionTile
                      key={col.id}
                      to={`/collection/${col.id}`}
                      name={col.name}
                      count={col.games?.length || 0}
                      games={(col.games || []).slice(0, 14).map(id => localGameMeta[String(id)]).filter(Boolean)}
                      meta="Custom"
                      menuOptions={[
                        {
                          label: 'Delete Collection',
                          icon: Trash2,
                          variant: 'danger',
                          onClick: () => handleDeleteCollection(col),
                        },
                      ]}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Saved Shelves — bookmarked collections + franchises */}
            {(() => {
              const savedShelves = [
                ...savedIgdb.map(col => ({
                  key: `igdb-${col.id}`,
                  id: col.id,
                  to: `/collection/igdb/${col.id}`,
                  name: col.name,
                  count: col.games?.length || 0,
                  games: igdbGames(col),
                  meta: col.type?.name || 'IGDB',
                  muted: false,
                })),
                ...savedFranchises.map(fr => ({
                  key: `fr-${fr.id}`,
                  id: fr.id,
                  to: `/franchise/${fr.id}`,
                  name: fr.name,
                  count: fr.count,
                  games: fr.games || [],
                  meta: 'Franchise',
                  muted: true,
                })),
              ].sort((a, b) => a.name.localeCompare(b.name));

              if (savedShelves.length === 0) return null;
              return (
                <section>
                  <SectionHeader>Saved Shelves</SectionHeader>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
                    {savedShelves.map(shelf => (
                      <CollectionTile
                        key={shelf.key}
                        to={shelf.to}
                        name={shelf.name}
                        count={shelf.count}
                        games={shelf.games}
                        meta={shelf.meta}
                        mutedMeta={shelf.muted}
                        menuOptions={[
                          {
                            label: 'Remove from Shelves',
                            icon: X,
                            variant: 'danger',
                            onClick: () => handleRemoveShelf(shelf),
                          },
                        ]}
                      />
                    ))}
                  </div>
                </section>
              );
            })()}
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDeleteCollection}
        eyebrow="Collections"
        title="Delete this collection?"
        body={pendingDelete ? `"${pendingDelete.name}" and its list of games will be removed. The games themselves stay in your library.` : ''}
      />
    </div>
  );
}
