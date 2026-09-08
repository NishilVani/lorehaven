import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import PageHeader from '../../components/ui/PageHeader';
import { Link } from 'react-router-dom';
import GameCard from '../../components/games/GameCard';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import CollectionTile from '../../components/collections/CollectionTile';
import UpdateCountBadge from './UpdateCountBadge';
import { Bookmark, Check, X } from 'lucide-react';
import { getLibrary, saveToLibrary, saveIgdbCollection, saveFranchise } from '../../services/db';
import { toast } from '../../components/ui/toastBus';
import {
  getRecommendations, refreshLibraryUpdates, updatesToCards,
  getAnnounced, getTrending, setRecFeedback, enrichHero, pickHero,
  getShelfRecommendations, UPDATE_TAG,
} from '../../services/discover';

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

const PICK_BEAT_MS = 300; // the "Picking Next" beat. CLAUDE.md caps motion at 500ms; this ran far past it.
/* The fewest cards a section previews before "See All". It is a floor, not the
   count: the real count rounds it up to whole rows, because .game-grid is
   auto-fill and how many cards fill a row is a function of the viewport.
   This was a flat 5, which assumed the 5 columns the grid resolves to at 1440.
   Measured across widths, that left a hole at every width where the grid
   resolves to 6 -- 1600 and up -- which is the empty slot beside the last card,
   and left one card marooned on a second row at 4 columns, around 1150. */
const PREVIEW = 5;

/* Reads the column count off a real .game-grid rather than recomputing the CSS
   in JS, so the track size and the gap stay defined in one place. auto-fill
   keeps its empty tracks, which is what makes the count readable even when the
   section renders fewer cards than fit. Every grid on the page shares the
   container width, so one measurement serves all the sections. */
function useGridColumns(hostRef) {
  const [cols, setCols] = useState(0);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => {
      const grid = host.querySelector('.game-grid');
      if (!grid) return;
      const tracks = getComputedStyle(grid).gridTemplateColumns;
      if (!tracks || tracks === 'none') return;
      setCols(tracks.split(' ').filter(Boolean).length);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, [hostRef]);
  return cols;
}

/* Whole rows, and never fewer than PREVIEW. Before the first measurement lands
   there is no grid to read, so it falls back to PREVIEW. */
const rowsOf = (cols) => (cols > 0 ? Math.ceil(PREVIEW / cols) * cols : PREVIEW);

/* Exactly as many placeholders as the section will show: GameCardSkeleton
   measures 196x279 against a real card's 196x279, so the section reserves its
   final height and nothing below it moves when the data lands. */
const SkeletonGrid = ({ count }) => (
  <div className="game-grid">
    {Array.from({ length: count }, (_, i) => <GameCardSkeleton key={i} />)}
  </div>
);
const REC_PAGE = 24;    // recommendation reveal step

function SectionHead({ children, to, showSeeAll }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">{children}</h2>
      <div className="flex-1 h-px bg-white/15" />
      {showSeeAll && to && (
        /* py-2 -my-2 grows the hit box to >=24px (WCAG 2.5.8) without moving the row. */
        <Link to={to} className="lh-label text-white/60 hover:text-white transition-colors shrink-0 py-2 -my-2">
          See All →
        </Link>
      )}
    </div>
  );
}

export default function Discover() {
  /* How many cards a preview section shows: whole rows of whatever the grid
     resolves to at this width, so a section never leaves a slot empty beside
     its last card and never strands one card on a row of its own. */
  const gridHostRef = useRef(null);
  const preview = rowsOf(useGridColumns(gridHostRef));

  const [recs, setRecs] = useState(null);          // { hero, candidates, basedOn }
  const [recsLoading, setRecsLoading] = useState(true);
  const [updateCards, setUpdateCards] = useState([]);
  /* null = in flight, [] = loaded and genuinely empty. Without that distinction the
     sections rendered nothing while loading and then appeared, inserting ~1250px
     above content the user was already reading (CLS 0.32-0.58 on this route). */
  const [announced, setAnnounced] = useState(null);
  const [trending, setTrending] = useState(null);
  const [recVisible, setRecVisible] = useState(REC_PAGE);
  const [shelves, setShelves] = useState([]);
  const sentinelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getRecommendations().then(r => { if (!cancelled) { setRecs(r); setRecsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Everything else — load once
  useEffect(() => {
    let cancelled = false;
    refreshLibraryUpdates().then(r => { if (!cancelled) setUpdateCards(updatesToCards(r.events || [])); });
    getAnnounced({ limit: 18 }).then(r => { if (!cancelled) setAnnounced(r || []); }).catch(() => { if (!cancelled) setAnnounced([]); });
    getTrending({ limit: 18 }).then(r => { if (!cancelled) setTrending(r || []); }).catch(() => { if (!cancelled) setTrending([]); });
    getShelfRecommendations({ limit: 6 }).then(s => { if (!cancelled) setShelves(s); });
    return () => { cancelled = true; };
  }, []);

  // Library writes and cloud sync happen outside React. Refresh update cards
  // when either changes so additions, removals, and synced data are immediate.
  useEffect(() => {
    let cancelled = false;
    const refreshUpdates = () => {
      refreshLibraryUpdates({ force: true })
        .then(r => { if (!cancelled) setUpdateCards(updatesToCards(r.events || [])); })
        .catch(error => console.error('[discover] update refresh failed', error));
    };
    /* A cloud sync used to be handled by App remounting every route, which threw
       away the revealed recommendation pages and the scroll position with them:
       measured at a 1000-game library, 57 cards became 10 and the page jumped
       from 2239px to 1612px. This page is now exempt from that remount, so it
       has to refresh everything the remount used to. Recommendations and
       shelves are the two derived from the library; announced and trending are
       the same for everyone and do not move when your library does.

       Deliberately not on moctale_lib_update. That fires on every card toggle,
       and re-running the recommender there would reshuffle the grid under the
       hand that just clicked. recVisible is left alone either way, so the pages
       already revealed stay revealed. */
    const refreshDerived = () => {
      refreshUpdates();
      getRecommendations().then(r => { if (!cancelled) { setRecs(r); setRecsLoading(false); } })
        .catch(error => console.error('[discover] recommendation refresh failed', error));
      getShelfRecommendations({ limit: 6 }).then(sh => { if (!cancelled) setShelves(sh); })
        .catch(error => console.error('[discover] shelf refresh failed', error));
    };
    window.addEventListener('moctale_lib_update', refreshUpdates);
    window.addEventListener('moctale_sync_update', refreshDerived);
    return () => {
      cancelled = true;
      window.removeEventListener('moctale_lib_update', refreshUpdates);
      window.removeEventListener('moctale_sync_update', refreshDerived);
    };
  }, []);

  // Infinite reveal for the recommendation tail (already in memory — no fetch)
  const total = recs?.candidates?.length || 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting) setRecVisible(v => Math.min(v + REC_PAGE, total)); },
      { rootMargin: '600px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [total, recVisible]);

  useEffect(() => {
    /* Coalesced to one check per frame. A scroll listener fires many times per
       frame and this reads scrollHeight, which forces layout, so the unthrottled
       version was a forced reflow per event on exactly the pages carrying the
       most DOM. The listener itself stays: the observer above is the primary
       path, and this is the fallback for webviews that throttle observers. */
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700) {
          setRecVisible(v => Math.min(v + REC_PAGE, total));
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [total]);

  const RecGrid = useCallback(({ games, cardExtras }) => (
    <div className="game-grid">
      {games.map(g => (
        <GameCard key={g.id} game={g} {...(cardExtras || {})} />
      ))}
    </div>
  ), []);

  // ── Rec feedback + smooth removal (no page remount) ──
  const removeRec = useCallback((id) => {
    setRecs(prev => prev ? { ...prev, candidates: prev.candidates.filter(c => c.id !== id) } : prev);
  }, []);

  const handleFeedback = useCallback((game, verdict) => {
    setRecFeedback(verdict ? game : game.id, verdict);
    if (verdict === 'not_interested') {
      removeRec(game.id);
      toast("Noted — you won't see this again");
    } else if (verdict === 'interested') {
      toast('Noted — more like this');
    } else {
      toast('Feedback cleared');
    }
  }, [removeRec]);

  const hero = recs?.hero;

  const [heroSaved, setHeroSaved] = useState(false);
  useEffect(() => {
    setHeroSaved(!!(hero && getLibrary().some(g => String(g.id) === String(hero.id))));
  }, [hero?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Advance to the next top pick after a short "Picking next…" beat — long
     enough to read the confirmation, short enough not to feel stuck.

     The beat is skipped entirely under prefers-reduced-motion. The CSS rule in
     index.css collapses animation and transition durations, but it cannot touch a
     JS setTimeout — so with motion off you sat through the whole beat watching a progress bar
     that had already snapped to full. A manufactured wait IS motion; when someone
     has asked for less of it, the honest answer is to advance immediately. */
  const [picking, setPicking] = useState(false);
  const advanceHero = async () => {
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!instant) setPicking(true);
    const next = pickHero(recs.candidates);
    const enriched = next ? await enrichHero(next) : null;
    const commit = () => {
      setRecs(prev => ({ ...prev, hero: enriched, candidates: prev.candidates.filter(c => c.id !== next?.id) }));
      setPicking(false);
    };
    if (instant) commit(); else setTimeout(commit, PICK_BEAT_MS);
  };

  const wishlistHero = () => {
    saveToLibrary({
      id: hero.id, name: hero.name, status: 'Wishlist', is_custom: false,
      cover_id: hero.cover_id || null, release_year: hero.release_year || null,
      total_rating: hero.total_rating || null, cover_width: 264, cover_height: 374,
    });
    window.dispatchEvent(new Event('moctale_lib_update'));
    setHeroSaved(true);
    toast('Added to Wishlist');
    if (recs.basedOn === 'library') advanceHero();
  };

  const dismissHero = () => {
    setRecFeedback(hero, 'not_interested');
    advanceHero();
  };

  const saveShelf = (s) => {
    if (s.kind === 'collection') saveIgdbCollection(s.id);
    else saveFranchise({ id: s.id, name: s.name });
    setShelves(prev => prev.filter(x => !(x.kind === s.kind && x.id === s.id)));
    toast('Saved to Shelves');
  };
  const heroMeta = hero && [hero.release_year, hero.game_type_label, hero.total_rating && `${Math.round(hero.total_rating)}/100`].filter(Boolean).join(' · ');

  /* Wishlisting or dismissing every card empties `candidates`, and advanceHero
     then leaves `hero` null. Both used to render as nothing at all — a heading
     with a blank space under it, which reads as broken rather than finished. */
  const recsExhausted = !recsLoading && (recs?.candidates || []).length === 0;
  const emptyRecs = (
    <div className="border border-white/15 text-center py-12 px-4">
      <div className="lh-display text-xl text-white/60 mb-2">You&rsquo;re All Caught Up</div>
      <p className="text-[15px] leading-relaxed text-white/60 max-w-prose mx-auto">
        You have been through every pick we can match to your library. Shelve or rate more games
        to widen the net, or clear a Not Interested mark to bring one back.
      </p>
      <Link to="/feedback" className="lh-label inline-block mt-5 px-4 py-2 border border-white/40 text-white hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors">
        Review Your Feedback →
      </Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4" ref={gridHostRef}>

        <PageHeader className="mb-6" title="Explore" />

        {/* ── Hero / Top Pick ── */}
        {recsLoading ? (
          /* The body block is h-[213px], not h-24: the loaded hero measures
             460 (art) + 213 (cover, title, meta, actions) = 675, and a 96px
             placeholder made the hero grow 117px the moment data arrived. */
          <div aria-hidden="true" className="border border-white/15 mb-12">
            <div className="h-[36vh] md:h-[46vh] bg-neutral-900 animate-pulse" />
            <div className="h-[213px] border-t border-white/15" />
          </div>
        ) : !hero ? (
          <div className="mb-12">{emptyRecs}</div>
        ) : (
          <div className="border border-white/20 mb-12">
            {hero.artwork_id && (
              <Link to={`/game/${hero.id}`} className="block group">
                <img src={img(hero.artwork_id, '1080p')} alt={hero.name} className="w-full h-[36vh] md:h-[46vh] object-cover block border-b border-white/20 group-hover:opacity-90 transition-opacity" />
              </Link>
            )}
            <div className="flex gap-4 md:gap-6 p-4 md:p-6">
              {hero.cover_id && (
                /* Decorative twin of the title link below: same destination, empty alt.
                   Hidden from AT and taken out of the tab order so it is not an
                   unnamed duplicate stop (WCAG 2.4.4 / 4.1.2). */
                <Link
                  to={`/game/${hero.id}`}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="hidden sm:block w-20 md:w-28 shrink-0 self-start border border-white/15 overflow-hidden"
                >
                  <img src={img(hero.cover_id, 'cover_big')} alt="" className="w-full aspect-[3/4] object-cover block" />
                </Link>
              )}
              <div className="min-w-0 flex-1">
                <div className="lh-label text-white/60 mb-1.5">
                  {recs.basedOn === 'library' ? 'Top Pick — Tuned To You' : 'Featured'}
                </div>
                <Link to={`/game/${hero.id}`} className="lh-display text-2xl md:text-4xl text-white leading-none hover:underline underline-offset-4 break-words">
                  {hero.name}
                </Link>
                {heroMeta && <div className="lh-label text-white/60 mt-2">{heroMeta}</div>}
                {hero.summary && <p className="text-sm text-white/60 mt-2 line-clamp-2 max-w-prose">{hero.summary}</p>}
                {picking ? (
                  <div className="mt-4 max-w-xs">
                    <div className="lh-label text-white/60 mb-2">Picking Next…</div>
                    <div className="h-0.5 bg-white/15 relative overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-white" style={{ animation: `lh-fill ${PICK_BEAT_MS}ms linear forwards` }} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <Link to={`/game/${hero.id}`} className="inline-block lh-label px-4 py-2 bg-white text-black hover:bg-neutral-200 transition-colors">
                      View Game →
                    </Link>
                    {/* One button in both states rather than swapping a <button> for a
                        <span>: the swap unmounts the focused element and drops focus to
                        <body> the instant you wishlist. WCAG 2.4.3. */}
                    <button
                      onClick={() => { if (!heroSaved) wishlistHero(); }}
                      aria-disabled={heroSaved}
                      className={`lh-label px-4 py-2 border transition-colors flex items-center gap-1.5 ${heroSaved
                        ? 'border-white/20 text-white/60 cursor-default'
                        : 'border-white/40 text-white hover:border-[var(--status-solid-wishlist)] hover:bg-[var(--status-solid-wishlist)] hover:text-black cursor-pointer'}`}
                    >
                      {heroSaved ? <><Check aria-hidden="true" className="w-3.5 h-3.5" />In Library</> : '+ Wishlist'}
                    </button>
                    {recs.basedOn === 'library' && !heroSaved && (
                      <button onClick={dismissHero} title="Never suggest this game again and pick another" className="lh-label px-3 py-2 text-white/60 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5">
                        Not Interested
                        <X aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── In Your Library (updates) ── */}
        {updateCards.length > 0 && (
          <section className="mb-12">
            <SectionHead to="/explore/updates" showSeeAll={updateCards.length > preview}>In Your Library</SectionHead>
            <div className="game-grid">
              {updateCards.slice(0, preview).map(u => (
                <GameCard
                  key={u.card.id}
                  game={u.card}
                  statusBadge={{ dot: '#ffffff', text: '#ffffff', label: UPDATE_TAG[u.primary.type] || 'Update' }}
                  topBadge={u.extra > 0 ? (
                    <UpdateCountBadge events={u.events} primary={u.primary} />
                  ) : null}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Recently Announced ── */}
        {(announced === null || announced.length > 0) && (
          <section className="mb-12">
            <SectionHead to="/explore/announced" showSeeAll={!!announced && announced.length > preview}>Recently Announced</SectionHead>
            {announced === null
              ? <SkeletonGrid count={preview} />
              : <RecGrid games={announced.slice(0, preview)} />}
          </section>
        )}

        {/* ── Trending ── */}
        {(trending === null || trending.length > 0) && (
          <section className="mb-12">
            <SectionHead to="/explore/trending" showSeeAll={!!trending && trending.length > preview}>Trending</SectionHead>
            {trending === null
              ? <SkeletonGrid count={preview} />
              : <RecGrid games={trending.slice(0, preview)} />}
          </section>
        )}

        {/* ── Shelves For You (collections / franchises you mostly own) ── */}
        {shelves.length > 0 && (
          <section className="mb-12">
            <SectionHead>Shelves For You</SectionHead>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shelves.map(s => (
                <CollectionTile
                  key={`${s.kind}-${s.id}`}
                  to={s.kind === 'collection' ? `/collection/igdb/${s.id}` : `/franchise/${s.id}`}
                  name={s.name}
                  count={s.total}
                  games={(s.games || []).map(g => ({ name: g.name, cover: g.cover?.image_id || null })).slice(0, 14)}
                  meta={`${s.owned}/${s.total} In Library`}
                  mutedMeta={s.kind === 'franchise'}
                  menuOptions={[{ label: 'Save to Shelves', icon: Bookmark, onClick: () => saveShelf(s) }]}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Recommendations (infinite) ── */}
        <section>
          <SectionHead>{recs?.basedOn === 'library' ? 'Recommended For You' : 'More To Explore'}</SectionHead>
          {recs?.basedOn === 'trending' && (
            <p className="lh-label text-white/50 -mt-2 mb-4">Shelve & rate games to unlock personalized picks</p>
          )}
          {recs?.basedOn === 'exhausted' && !recsExhausted && (
            <p className="lh-label text-white/50 -mt-2 mb-4">Out of tuned picks — showing what&rsquo;s trending instead</p>
          )}
          {recsLoading ? (
            <div className="game-grid">{Array.from({ length: 12 }).map((_, i) => <GameCardSkeleton key={i} />)}</div>
          ) : recsExhausted ? (
            emptyRecs
          ) : (
            <>
              <RecGrid
                games={(recs?.candidates || []).slice(0, recVisible)}
                cardExtras={{ onLibraryChange: removeRec, onFeedback: handleFeedback }}
              />
              <div ref={sentinelRef} className="h-px" />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
