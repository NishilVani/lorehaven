import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useRef } from 'react';
import useAnnounce from '../../components/ui/useAnnounce';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate } from 'react-router-dom';
import GameCard from '../../components/games/GameCard';
import { GameCardSkeleton } from '../../components/ui/Skeleton';
import UpdateCountBadge from './UpdateCountBadge';
import { getStoredUpdates, updatesToCards, getAnnounced, getTrending, clearLibraryUpdates, UPDATE_TAG } from '../../services/discover';

const CONFIG = {
  updates: { title: 'Library Updates', paged: false },
  announced: { title: 'Recently Announced', paged: true, fetch: getAnnounced },
  trending: { title: 'Trending', paged: true, fetch: getTrending },
};

const PAGE = 24;

/** See-All page for an Explore section: /explore/:section */
export default function ExploreList() {
  const { section } = useParams();
  const navigate = useNavigate();
  const cfg = CONFIG[section];

  const [items, setItems] = useState([]);   // paged sections: raw games; updates: update cards
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const headingRef = useRef(null);

  useAnnounce(loading ? 'Loading' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`);
  const doneRef = useRef(false);   // scroll listener holds a stale closure — read done via ref
  const offset = useRef(0);
  const busy = useRef(false);
  const sentinelRef = useRef(null);

  // Non-paged (updates) — read once from localStorage
  useEffect(() => {
    if (!cfg || cfg.paged) return;
    const loadUpdates = () => setItems(updatesToCards(getStoredUpdates()));
    loadUpdates();
    setLoading(false);
    window.addEventListener('moctale_lib_update', loadUpdates);
    window.addEventListener('moctale_sync_update', loadUpdates);
    return () => {
      window.removeEventListener('moctale_lib_update', loadUpdates);
      window.removeEventListener('moctale_sync_update', loadUpdates);
    };
  }, [cfg, section]);

  // Paged (announced / trending) — first page
  const loadPage = async () => {
    if (busy.current || doneRef.current) return;
    busy.current = true;
    const batch = await cfg.fetch({ limit: PAGE, offset: offset.current });
    offset.current += PAGE;
    if (!batch || batch.length < PAGE) { doneRef.current = true; setDone(true); }
    setItems(prev => {
      const seen = new Set(prev.map(g => g.id));
      return [...prev, ...(batch || []).filter(g => !seen.has(g.id))];
    });
    setLoading(false);
    busy.current = false;
  };

  useEffect(() => {
    if (!cfg || !cfg.paged) return;
    setItems([]); setDone(false); setLoading(true);
    doneRef.current = false; offset.current = 0; busy.current = false;
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useEffect(() => {
    if (!cfg?.paged) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadPage(); }, { rootMargin: '700px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, items.length]);

  useEffect(() => {
    if (!cfg?.paged) return;
    /* Coalesced to one check per frame -- see Discover.jsx. The listener stays
       because the observer above is the primary path and this is the fallback
       for webviews that throttle observers. */
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 800) loadPage();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  if (!cfg) {
    return (
      <div className="content-container py-24 text-center">
        <h1 className="lh-display text-xl text-white/60 mb-2">Unknown Section</h1>
        <button onClick={() => navigate('/')} className="lh-label px-4 py-2.5 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer mt-4">
          Back to Explore
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <PageHeader
          back={{ label: 'Explore', onClick: () => navigate('/') }}
          title={cfg.title}
          titleRef={headingRef}
          count={`${items.length}${cfg.paged && !done ? '+' : ''} ${items.length === 1 ? 'Title' : 'Titles'}`}
          actions={
            /* Clearing removes this very button, so focus has to be handed to the
               heading — otherwise it falls to <body> and the user is dumped to the top
               with no indication anything happened. WCAG 2.4.3. */
            section === 'updates' && items.length > 0 && (
              <button
                onClick={() => { clearLibraryUpdates(); setItems([]); headingRef.current?.focus(); }}
                className="lh-label px-3 py-1.5 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer"
              >
                Clear All
              </button>
            )
          }
        />

        {/* GameCard titles are h3 and this page's h1 is the section name, so the
            outline jumped h1 -> h3. Visually hidden: the grid IS the page here, so
            there is no visible section title to hang the level on. */}
        <h2 className="sr-only">Games</h2>

        {loading ? (
          <div className="game-grid">{Array.from({ length: 12 }).map((_, i) => <GameCardSkeleton key={i} />)}</div>
        ) : items.length === 0 ? (
          <EmptyPlate title="Nothing Here" body={section === 'updates' ? 'No tracked changes yet — check back after your games update' : 'Nothing to show right now'} />
        ) : section === 'updates' ? (
          <div className="game-grid">
            {items.map(u => (
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
        ) : (
          <>
            <div className="game-grid">
              {items.map(g => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
            <div ref={sentinelRef} className="h-px" />
            {done && <div className="lh-label text-white/50 py-8 text-center">— End —</div>}
          </>
        )}
      </div>
    </div>
  );
}
