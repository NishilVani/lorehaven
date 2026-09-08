import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { X, Layers, Gamepad2, Library, HeartPlus, Building2, CircleCheck, BookmarkPlus, BookmarkMinus } from 'lucide-react';
import { searchGames, searchFranchises, searchIgdbCollections, searchCompanies } from '../../services/igdb';
import { 
    getCollections, getLibrary, saveToLibrary,
    getSavedFranchises, saveFranchise, removeFranchise,
    getSavedIgdbCollections, saveIgdbCollection, removeIgdbCollection
} from '../../services/db';
import { toast } from '../ui/toastBus';
import GameCard from '../games/GameCard';
import { GameCardSkeleton, CollectionSkeleton } from '../ui/Skeleton';
import { useFocusTrap } from '../ui/useFocusTrap';
import CollectionCard from '../collections/CollectionCard';
import EmptyPlate from '../ui/EmptyPlate';
import useAnnounce from '../ui/useAnnounce';
import { PRIORITY_MENU } from '../../constants/stateColors';

const IGDB_CATEGORIES = {
  0: 'Game', 1: 'DLC Addon', 2: 'Expansion', 3: 'Bundle',
  4: 'Standalone Expansion', 5: 'Mod', 6: 'Episode', 7: 'Season',
  8: 'Remake', 9: 'Remaster', 10: 'Expanded Game', 11: 'Port',
  12: 'Fork', 13: 'Pack', 14: 'Update'
};

const getFranchiseCover = (franchise) => {
    if (!franchise.games || franchise.games.length === 0) return null;
    for (const game of franchise.games) {
        if (game.cover?.image_id) return game.cover.image_id;
    }
    return null;
};

const getCollectionCover = (collection) => {
    if (!collection.games || collection.games.length === 0) return null;
    for (const game of collection.games) {
        if (game.screenshots?.[0]?.image_id) return game.screenshots[0].image_id;
        if (game.artworks?.[0]?.image_id) return game.artworks[0].image_id;
        if (game.cover?.image_id) return game.cover.image_id;
    }
    return null;
};

const TABS = ['Games', 'Franchises', 'Collections', 'Companies'];

export default function SearchOverlay() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();

    const isOpen = searchParams.get('search') === 'true';
    const urlQuery = searchParams.get('q') || '';
    
    const [inputValue, setInputValue] = useState(urlQuery);
    const query = searchParams.get('q') || '';

    const [activeTab, setActiveTab] = useState('Games');
    const [games, setGames] = useState([]);
    const [franchises, setFranchises] = useState([]);
    const [collections, setCollections] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(false);
    
    // try/catch: corrupt localStorage must not crash the render (no error boundary above us)
    const [recentSearches, setRecentSearches] = useState(() => {
        try { return JSON.parse(localStorage.getItem('recentSearches')) || []; }
        catch { return []; }
    });

    const [recentGames, setRecentGames] = useState(() => {
        try { return JSON.parse(localStorage.getItem('recentGames')) || []; }
        catch { return []; }
    });

    const [libraryMap, setLibraryMap] = useState(new Map());

    // Searching and result counts previously changed with no announcement.
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    useAnnounce(!isOpen ? null : loading ? 'Searching' :
        query.trim() ? [plural(games.length, 'game', 'games'), plural(franchises.length, 'franchise', 'franchises'),
            plural(collections.length, 'collection', 'collections'), plural(companies.length, 'company', 'companies')].join(', ')
        : null);
    const [savedFranchiseIds, setSavedFranchiseIds] = useState(new Set());
    const [savedCollectionIds, setSavedCollectionIds] = useState(new Set());
    const overlayRef = useRef(null);
    const inputRef = useRef(null);

    const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
    const [isMobileDevice, setIsMobileDevice] = useState(false);
    const isTauri = !!window.__TAURI_INTERNALS__;

    // Track window resize and mobile device detection
    useEffect(() => {
        const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        setIsMobileDevice(mobile);

        const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isTauriDesktop = isTauri && !isMobileDevice;
    const titlebarHeight = isTauriDesktop ? (isDesktop ? 32 : 40) : 0;
    const mobileNavHeight = isDesktop ? 0 : (isTauriDesktop ? 0 : 56);
    const topOffset = mobileNavHeight + titlebarHeight;

    // Escape key to close
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Handle scroll lock and body offsets when overlay is open
    useEffect(() => {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        const navbar = document.querySelector('nav');
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            if (scrollbarWidth > 0) {
                document.body.style.paddingRight = `${scrollbarWidth}px`;
                if (navbar) navbar.style.paddingRight = `${scrollbarWidth}px`;
            }
            
            const lib = getLibrary();
            const map = new Map();
            lib.forEach(g => map.set(String(g.id), g));
            setLibraryMap(map);
            const franks = getSavedFranchises();
            setSavedFranchiseIds(new Set(franks.map(f => String(f.id))));
            const colls = getSavedIgdbCollections();
            setSavedCollectionIds(new Set(colls.map(id => String(id))));
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.paddingRight = '0px';
            if (navbar) navbar.style.paddingRight = '0px';
            setInputValue('');
            setGames([]); setFranchises([]); setCollections([]); setCompanies([]);
            setLoading(false);
        }
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.paddingRight = '0px';
            if (navbar) navbar.style.paddingRight = '0px';
        };
    }, [isOpen]);

    // Fetch results on query changes
    useEffect(() => {
        if (query.trim().length === 0) {
            setGames([]); setFranchises([]); setCollections([]); setCompanies([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        const fetchResults = async () => {
            try {
                const [gameResults, franchiseResults, igdbCollectionResults, companyResults] = await Promise.all([
                    searchGames(query),
                    searchFranchises(query),
                    searchIgdbCollections(query, 10),
                    searchCompanies(query),
                ]);
                const local = getCollections() || [];
                const localMatches = local.filter(c => c?.name?.toLowerCase().includes(query.toLowerCase())).map(c => ({...c, isLocal: true}));
                setGames(gameResults);
                setFranchises(franchiseResults);
                setCollections([...localMatches, ...igdbCollectionResults]);
                setCompanies(companyResults);
            } catch (error) {
                console.error("Search error:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchResults();
    }, [query]);

    // Sync input from URL only on EXTERNAL changes (recent-search click, back/fwd).
    // Guarding on the trim avoids echoing our own trimmed value back over the
    // user's in-progress text — which was eating spaces as they typed.
    useEffect(() => {
        if (query !== inputValue.trim()) setInputValue(query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    // Debounce syncing of input state to URL search parameters
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (inputValue !== query) {
                const params = new URLSearchParams(location.search);
                if (inputValue.trim() !== '') {
                    params.set('q', inputValue.trim());
                    setSearchParams(params, { replace: true });
                    saveRecentSearch(inputValue.trim());
                } else {
                    params.delete('q');
                    setSearchParams(params, { replace: true });
                }
            }
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [inputValue, query, setSearchParams, location.search]);

    const handleSearchClick = (q) => { 
        setInputValue(q); 
        const params = new URLSearchParams(location.search);
        params.set('q', q);
        setSearchParams(params, { replace: true }); 
        saveRecentSearch(q); 
    };

    const saveRecentSearch = (q) => {
        if (!q.trim()) return;
        const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
        setRecentSearches(updated);
        localStorage.setItem('recentSearches', JSON.stringify(updated));
    };

    const removeRecentSearch = (e, q) => {
        e.stopPropagation();
        const updated = recentSearches.filter(s => s !== q);
        setRecentSearches(updated);
        localStorage.setItem('recentSearches', JSON.stringify(updated));
    };

    const clearHistory = () => { 
        setRecentSearches([]); 
        setRecentGames([]);
        localStorage.removeItem('recentSearches'); 
        localStorage.removeItem('recentGames');
    };

    const saveRecentGame = (game) => {
        const gameData = {
            id: game.id, name: game.name,
            cover_id: game.cover?.image_id || game.cover_id || null,
            release_year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : game.release_year,
            game_type_label: game.game_type !== undefined ? IGDB_CATEGORIES[game.game_type] : game.game_type_label,
        };
        const updated = [gameData, ...recentGames.filter(g => g.id !== game.id)].slice(0, 12);
        setRecentGames(updated);
        localStorage.setItem('recentGames', JSON.stringify(updated));
    };

    const handleAddToWishlist = (e, game) => {
        e.preventDefault(); e.stopPropagation();
        const gameData = {
            id: game.id, name: game.name, status: 'Wishlist', is_custom: false,
            cover_width: game.cover_width || null, cover_height: game.cover_height || null,
            cover_id: game.cover?.image_id || game.cover_id || null
        };
        saveToLibrary(gameData);
        setLibraryMap(prev => { const next = new Map(prev); next.set(String(game.id), gameData); return next; });
        toast(`Added ${game.name} to Wishlist`);
    };

    const handlePriorityGame = (game, priority) => {
        const libGame = libraryMap.get(String(game.id));
        if (!libGame) return;
        const updated = { ...libGame, priority };
        saveToLibrary(updated);
        setLibraryMap(prev => { const next = new Map(prev); next.set(String(game.id), updated); return next; });
        toast(priority ? `Priority: ${priority}` : 'Priority cleared');
    };

    // Shared game-card menu — used by both search results and recent games
    const buildGameMenu = (game) => {
        const libStatus = libraryMap.get(String(game.id))?.status;
        return [
            ...(libStatus && libStatus !== 'Beaten' ? [
                ...PRIORITY_MENU.map((p, i) => ({
                    label: p.label,
                    icon: () => <div className="w-2.5 h-2.5" style={{ backgroundColor: p.color }} />,
                    variant: 'default',
                    dividerAbove: i === 0,
                    onClick: (e) => { e?.stopPropagation?.(); handlePriorityGame(game, p.label); }
                })),
                { label: 'Clear Priority', icon: X, variant: 'default', onClick: (e) => { e?.stopPropagation?.(); handlePriorityGame(game, null); } }
            ] : []),
            ...(libStatus
                ? [{ icon: CircleCheck, label: 'In Library', dividerAbove: true, onClick: (e) => e?.stopPropagation?.() }]
                : [{ icon: HeartPlus, label: 'Add to Wishlist', onClick: (e) => handleAddToWishlist(e, game) }]
            )
        ];
    };

    const handleToggleFranchise = (e, f) => {
        e.preventDefault(); e.stopPropagation();
        const idStr = String(f.id);
        if (savedFranchiseIds.has(idStr)) {
            removeFranchise(f.id);
            setSavedFranchiseIds(prev => { const next = new Set(prev); next.delete(idStr); return next; });
            toast(`Removed ${f.name}`);
        } else {
            saveFranchise({ id: f.id, name: f.name });
            setSavedFranchiseIds(prev => new Set([...prev, idStr]));
            toast(`Saved ${f.name}`);
        }
    };

    const handleToggleCollection = (e, c) => {
        e.preventDefault(); e.stopPropagation();
        if (c.isLocal) return;
        const idStr = String(c.id);
        if (savedCollectionIds.has(idStr)) {
            removeIgdbCollection(c.id);
            setSavedCollectionIds(prev => { const next = new Set(prev); next.delete(idStr); return next; });
            toast(`Removed ${c.name}`);
        } else {
            saveIgdbCollection(c.id);
            setSavedCollectionIds(prev => new Set([...prev, idStr]));
            toast(`Saved ${c.name}`);
        }
    };

    /* Focus moves to the input on open and back on close. closeOnEscape is false
       because this component already owns an Escape handler; lockScroll is false
       because the panel does its own scrolling.

       modal: false is the fix for "nothing outside the search area works". This
       hook defaults to modal, which walks up from the panel and inerts every
       sibling — and because the overlay is rendered inside the app tree rather
       than portalled, those siblings are the nav rail, the mobile header, the skip
       link, its OWN backdrop (so click-outside-to-close died), and in Tauri the
       title bar holding minimize/maximize/close. The backdrop already insets past
       the rail on desktop, i.e. the design always intended the rail to stay
       available; the inert walk silently contradicted that. */
    useFocusTrap({
        active: isOpen,
        containerRef: overlayRef,
        closeOnEscape: false,
        initialFocus: inputRef,
        lockScroll: false,
        modal: false,
    });

    const handleClose = () => {
        const params = new URLSearchParams(location.search);
        params.delete('search');
        params.delete('q');
        const paramsStr = params.toString();
        navigate(`${location.pathname}${paramsStr ? '?' + paramsStr : ''}`);
    };

    if (!isOpen) return null;

    const tabCount = { Games: games.length, Franchises: franchises.length, Collections: collections.length, Companies: companies.length };

    return (
        <>
            {/* No backdrop. There used to be a `bg-black/60` scrim with an
                onClick={handleClose} here, but the panel below is opaque and pinned to
                the same box — both measured 0,226,1048,720 at 1280x720 — so the scrim
                was never visible and its click-to-close could never fire from a real
                click. It only mattered as something for the inert walk to break. The
                panel itself is the surface now; Close and Escape are the ways out. */}

            {/* Overlay */}
            <div
                ref={overlayRef}
                role="dialog"
                /* No aria-modal: the rest of the app stays operable, and claiming
                   modality would tell a screen reader the page behind is
                   unavailable when it is not. A non-modal dialog is the correct
                   ARIA shape here. */
                aria-label="Search"
                className={`fixed left-0 lg:left-[220px] right-0 bg-black border-b border-white/10 z-[125] overflow-y-auto transform transition-transform duration-300 ease-out ${isOpen ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}
                style={{ 
                    top: `calc(${topOffset}px + env(safe-area-inset-top, 0px))`, 
                    height: `calc(100vh - ${topOffset}px - env(safe-area-inset-top, 0px))`,
                    willChange: 'transform, opacity' 
                }}
            >
                <div className="px-4 sm:px-8 py-8 md:py-16 content-container">

                    {/* Close comes AFTER the input in DOM order and is lifted back above
                        it with order-first.

                        The panel is deliberately non-modal so the nav rail stays
                        operable, which means Tab walks out of it rather than cycling.
                        With Close sitting first in the DOM, focus opened on the input
                        and every forward Tab left the panel immediately — measured six
                        consecutive Tabs, zero of them landing inside it, so the panel's
                        own Close button was reachable only by Shift+Tab. Visual order is
                        a presentation concern; tab order is the contract. */}
                    <div className="flex flex-col">

                        {/* Brutalist Search Input */}
                        <div className="relative mb-12 group">
                        <input
                aria-label="Search index"
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="SEARCH INDEX..."
                            className="w-full bg-transparent border-b border-white/40 pb-4 pr-16 sm:pr-24 text-4xl sm:text-6xl md:text-[80px] font-black uppercase text-white placeholder:text-white/50 focus:outline-none focus:border-white transition-colors duration-300"
                        />
                        {inputValue && (
                            <button
                                aria-label="Clear search"
                                onClick={() => {
                                    setInputValue('');
                                    const params = new URLSearchParams(location.search);
                                    params.delete('q');
                                    setSearchParams(params, { replace: true });
                                }} 
                                className="absolute right-0 bottom-4 sm:bottom-6 text-[#666666] hover:text-[#FFFFFF] transition-colors cursor-pointer bg-black pl-4"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 sm:w-12 sm:h-12" viewBox="0 -960 960 960" fill="currentColor">
                                    <path d="M256-213.85 213.85-256l224-224-224-224L256-746.15l224 224 224-224L746.15-704l-224 224 224 224L704-213.85l-224-224-224 224Z"/>
                                </svg>
                            </button>
                        )}
                        </div>

                        <div className="flex items-center justify-end gap-3 mb-6 order-first">
                            <span aria-hidden="true" className="lh-label text-white/60 hidden sm:inline">Esc</span>
                            <button
                                onClick={handleClose}
                                aria-label="Close search"
                                className="lh-label px-3 py-2 border border-white/40 text-white/70 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    {/* Recent Searches & Games */}
                    {!query && (recentSearches.length > 0 || recentGames.length > 0) && (
                        <div className="animate-in fade-in slide-in-from-top-4 duration-300 mb-12">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="lh-label text-white/50 tracking-widest flex items-center gap-2">
                                    RECENT
                                </h3>
                                <button onClick={clearHistory} className="lh-label text-white/50 hover:text-white transition-colors flex items-center gap-1 cursor-pointer">
                                    CLEAR
                                </button>
                            </div>
                            
                            {recentSearches.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-8">
                                    {recentSearches.map((s, idx) => (
                                        /* Two sibling buttons rather than a clickable row wrapping a
                                           button: the term itself was previously only reachable with a
                                           pointer, while the remove control was tabbable (WCAG 2.1.1). */
                                        <div key={idx} className="group/recent flex items-center border border-white/10 lh-label text-white hover:bg-white hover:text-black focus-within:bg-white focus-within:text-black transition-colors duration-300">
                                            <button
                                                onClick={() => handleSearchClick(s)}
                                                className="pl-4 pr-3 py-2 cursor-pointer focus-visible:outline-none focus-visible:underline"
                                            >
                                                {s}
                                            </button>
                                            <button
                                                onClick={(e) => removeRecentSearch(e, s)}
                                                aria-label={`Remove "${s}" from recent searches`}
                                                className="pr-3 py-2 text-white/60 group-hover/recent:text-black hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current transition-opacity cursor-pointer"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {recentGames.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {recentGames.map(game => {
                                        const libGame = libraryMap.get(String(game.id));
                                        return (
                                            <div
                                                key={game.id}
                                                onClick={() => saveRecentGame(game)}
                                                /* GameCard's overlay navigates on Enter without emitting a
                                                   click, so without this the recent-games list would only
                                                   ever record pointer users. */
                                                onKeyDown={(e) => { if (e.key === 'Enter') saveRecentGame(game); }}
                                            >
                                                <GameCard
                                                    game={{ ...game, priority: libGame?.priority }}
                                                    menuOptions={buildGameMenu(game)}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Results Section */}
                    {query && (
                        <div className="animate-in fade-in duration-300">
                            {/* Tabs */}
                            <div className="flex items-center gap-8 border-b border-white/10 pb-4 mb-8 overflow-x-auto no-scrollbar">
                                {TABS.map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        aria-pressed={activeTab === tab}
                                        className={`relative lh-label whitespace-nowrap transition-colors duration-200 cursor-pointer flex items-center gap-2 ${activeTab === tab ? 'text-white' : 'text-white/60 hover:text-white/80'}`}
                                    >
                                        {tab.toUpperCase()}
                                        {!loading && tabCount[tab] > 0 && (
                                            <span className={`text-[10px] ${activeTab === tab ? 'text-white' : 'text-white/50'}`}>
                                                ({tabCount[tab]})
                                            </span>
                                        )}
                                        {activeTab === tab && <div className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-white" />}
                                    </button>
                                ))}
                            </div>

                            {/* ── Games ── */}
                            {activeTab === 'Games' && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {loading ? (
                                        [...Array(6)].map((_, i) => <GameCardSkeleton key={i} />)
                                    ) : games.length > 0 ? (
                                        games.map(game => {
                                            const libGame = libraryMap.get(String(game.id));
                                            return (
                                                <div
                                                key={game.id}
                                                onClick={() => saveRecentGame(game)}
                                                /* GameCard's overlay navigates on Enter without emitting a
                                                   click, so without this the recent-games list would only
                                                   ever record pointer users. */
                                                onKeyDown={(e) => { if (e.key === 'Enter') saveRecentGame(game); }}
                                            >
                                                    <GameCard
                                                        game={{
                                                            id: game.id, name: game.name,
                                                            cover_id: game.cover?.image_id || null,
                                                            release_year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
                                                            game_type_label: game.game_type !== undefined ? IGDB_CATEGORIES[game.game_type] : null,
                                                            priority: libGame?.priority,
                                                        }}
                                                        menuOptions={buildGameMenu(game)}
                                                    />
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full">
                                          <EmptyPlate icon={Gamepad2} title="No games found"
                                            body={`IGDB has no game matching "${query.trim()}". Try fewer words, or check the spelling.`} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Franchises ── */}
                            {activeTab === 'Franchises' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {loading ? (
                                        [...Array(5)].map((_, i) => <CollectionSkeleton key={i} />)
                                    ) : franchises.length > 0 ? (
                                        franchises.map(f => {
                                            const coverId = getFranchiseCover(f);
                                            const gameCount = f.games?.length || 0;
                                            return (
                                                <div key={f.id}>
                                                    <CollectionCard
                                                        game={{ id: f.id, name: f.name, cover_id: coverId, release_year: gameCount > 0 ? `${gameCount} game${gameCount !== 1 ? 's' : ''}` : 'Unknown' }}
                                                        linkTo={`/franchise/${f.id}`}
                                                        menuOptions={[
                                                            savedFranchiseIds.has(String(f.id))
                                                                ? { icon: BookmarkMinus, label: 'Remove Franchise', onClick: (e) => handleToggleFranchise(e, f) }
                                                                : { icon: BookmarkPlus, label: 'Save Franchise', onClick: (e) => handleToggleFranchise(e, f) }
                                                        ]}
                                                    />
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full">
                                          <EmptyPlate icon={Layers} title="No franchises found"
                                            body={`IGDB has no franchise matching "${query.trim()}". Try fewer words, or check the spelling.`} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Collections ── */}
                            {activeTab === 'Collections' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {loading ? (
                                        [...Array(5)].map((_, i) => <CollectionSkeleton key={i} />)
                                    ) : collections.length > 0 ? (
                                        collections.map(c => {
                                            const coverId = getCollectionCover(c);
                                            const gameCount = c.games?.length || 0;
                                            return (
                                                <div key={`${c.isLocal ? 'local' : 'igdb'}-${c.id}`} className="relative">
                                                    <CollectionCard
                                                        game={{ id: c.id, name: c.name, cover_id: coverId, release_year: gameCount > 0 ? `${gameCount} item${gameCount !== 1 ? 's' : ''}` : 'Unknown' }}
                                                        linkTo={c.isLocal ? `/collection/${c.id}` : `/collection/igdb/${c.id}`}
                                                        topBadge={c.isLocal ? <span className="text-[10px] font-bold bg-white text-black px-2 py-0.5 uppercase tracking-wider">Local</span> : null}
                                                        menuOptions={c.isLocal ? [] : [
                                                            savedCollectionIds.has(String(c.id))
                                                                ? { icon: BookmarkMinus, label: 'Remove Collection', onClick: (e) => handleToggleCollection(e, c) }
                                                                : { icon: BookmarkPlus, label: 'Save Collection', onClick: (e) => handleToggleCollection(e, c) }
                                                        ]}
                                                    />
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full">
                                          <EmptyPlate icon={Library} title="No collections found"
                                            body={`IGDB has no collection matching "${query.trim()}". Try fewer words, or check the spelling.`} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Companies ── */}
                            {activeTab === 'Companies' && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {loading ? (
                                        [...Array(6)].map((_, i) => (
                                            <div key={i} className="animate-pulse bg-white/5 border border-white/10 aspect-[3/4]" />
                                        ))
                                    ) : companies.length > 0 ? (
                                        companies.map(co => {
                                            const gamesCount = (co.developed?.length || 0) + (co.published?.length || 0);
                                            return (
                                                <Link key={co.id} to={`/games/company/${co.id}`} className="flex flex-col items-center gap-4 p-6 bg-black border border-white/10 hover:border-white hover:bg-white/5 transition-all duration-300 cursor-pointer">
                                                    <div className="w-16 h-16 bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {co.logo?.image_id ? (
                                                            <img
                                                                src={`https://images.igdb.com/igdb/image/upload/t_logo_med/${co.logo.image_id}.png`}
                                                                alt={co.name}
                                                                className="w-full h-full object-contain p-2"
                                                            />
                                                        ) : (
                                                            /* The company's initial, not a serif italic "?". Space Grotesk is
                                                               the only family in this system, so a serif was off-system in a
                                                               way nothing else on the page is — and an initial identifies the
                                                               studio, where a question mark just says the logo is missing. */
                                                            <span aria-hidden="true" className="lh-display text-2xl text-white/60">
                                                                {(co.name || '?').trim().charAt(0).toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1 w-full min-w-0">
                                                        <span className="text-xs font-bold text-white uppercase text-center truncate w-full tracking-wider">{co.name}</span>
                                                        <span className="text-[10px] text-white/50 text-center uppercase tracking-widest">
                                                            {gamesCount > 0 ? `${gamesCount} GAMES` : 'DEV'}
                                                        </span>
                                                    </div>
                                                </Link>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full">
                                          <EmptyPlate icon={Building2} title="No companies found"
                                            body={`IGDB has no company matching "${query.trim()}". Try fewer words, or check the spelling.`} />
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
