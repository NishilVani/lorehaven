import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { closeSearch } from './searchHistory';
import { withPrelude } from '../../motion/prelude';
import { useFlip } from '../../motion/flip';
import { X, Layers, Gamepad2, Library, HeartPlus, Building2, CircleCheck, BookmarkPlus, BookmarkMinus } from 'lucide-react';
import { searchGamesRanked, searchFranchises, searchIgdbCollections, searchCompanies } from '../../services/igdb';
import { loadLocal, deviceDocs } from '../../services/search/localIndex';
import { search as searchLocal, completion, suggest, correct } from '../../services/search/engine';
import { mergeGames, mergeFranchises, mergeCompanies } from '../../services/search/merge';
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

/* One shared empty list, so a memo that depends on the local documents does
   not recompute every render before the index has loaded. */
const NO_DOCS = [];

/* The user agent cannot change while the tab is open, so this is a module
   constant, not state. It used to be seeded by a mount effect, which meant the
   first render of every page always assumed desktop and then corrected itself. */
const IS_MOBILE_DEVICE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export default function SearchOverlay() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();

    const isOpen = searchParams.get('search') === 'true';
    const urlQuery = searchParams.get('q') || '';
    
    const [inputValue, setInputValue] = useState(urlQuery);
    const query = searchParams.get('q') || '';

    const [activeTab, setActiveTab] = useState('Games');
    /* What IGDB returned for the current query. The lists the tabs show are
       derived further down, by merging these with the local index. */
    const [igdbGames, setIgdbGames] = useState([]);
    /* Results re-rank as you type: cards glide to their new places rather
       than the grid blinking (motion/flip.js). */
    const resultsRef = useRef(null);
    const [igdbFranchises, setIgdbFranchises] = useState([]);
    const [collections, setCollections] = useState([]);
    const [igdbCompanies, setIgdbCompanies] = useState([]);
    const [loading, setLoading] = useState(false);

    /* The on-device index (services/search). Loaded the first time search
       opens, as its own chunk, then kept for the session. Until it lands the
       overlay works exactly as before, on IGDB alone. */
    const [local, setLocal] = useState(null);
    /* The suggestion list under the input: which row the arrow keys are on, and
       whether it has been dismissed (Escape, Enter) since the last keystroke. */
    const [activeIndex, setActiveIndex] = useState(-1);
    const [suggestHidden, setSuggestHidden] = useState(false);
    /* "Search instead for X": the query the person insisted on, exactly as
       typed, so autocorrect stays out of it. */
    const [exactQuery, setExactQuery] = useState(null);
    
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

    /* ── Local search: instant, typo-tolerant, ranked ──────────────────────
       Your library and the games you have opened join the shipped index as
       documents of their own, so what you have looked at is always findable. */
    const device = useMemo(() => deviceDocs([...libraryMap.values()], recentGames), [libraryMap, recentGames]);
    const pool = useMemo(() => (local ? [...device, ...local.docs] : device), [device, local]);

    /* Suggestions follow every keystroke; they never wait for the debounce. */
    const typed = inputValue.trim();
    const instant = useMemo(() => (typed ? searchLocal(pool, typed, { limit: 6 }) : []), [pool, typed]);
    /* Ghost text only when the caret would sit at the end of what was typed:
       a trailing space means the word is finished, so nothing is completed. */
    const ghost = !inputValue.endsWith(' ') ? completion(inputValue, instant[0]) : '';

    /* Autocorrect for the committed query. A suggestion checked against what
       it finds is applied, with "search instead" to undo it; a spelling-only
       guess is offered as "did you mean" but not applied. */
    const correction = useMemo(() => {
        const q = query.trim();
        if (!local || !q || exactQuery === q) return null;
        const s = suggest(pool, q, local.dict);
        if (s) return { query: s.query, auto: true };
        if (searchLocal(pool, q, { limit: 1 }).length > 0) return null;
        const spelled = correct(q, local.dict);
        return spelled ? { query: spelled, auto: false } : null;
    }, [pool, local, query, exactQuery]);
    const effective = correction?.auto ? correction.query : query.trim();

    /* The tabs: local and IGDB, merged and ranked as one list each. */
    const localDocs = local?.docs || NO_DOCS;
    const games = useMemo(() => (effective ? mergeGames({ device, local: localDocs, igdb: igdbGames, query: effective }) : []), [device, localDocs, igdbGames, effective]);
    useFlip(resultsRef, games.map(g => g.id).join(','));
    const franchises = useMemo(() => (effective ? mergeFranchises({ local: localDocs, igdb: igdbFranchises, query: effective }) : []), [localDocs, igdbFranchises, effective]);
    const companies = useMemo(() => (effective ? mergeCompanies({ local: localDocs, igdb: igdbCompanies, query: effective }) : []), [localDocs, igdbCompanies, effective]);

    /* Before anything is typed: what you are playing, and the most-rated games
       you have not shelved, as one-tap starting points. The empty box used to
       offer nothing on first use. */
    const playingNow = useMemo(() => [...libraryMap.values()].filter(g => g.status === 'Playing' && g.name).slice(0, 6), [libraryMap]);
    const popular = useMemo(() => (local ? local.docs
        .filter(d => d.kind === 'game' && !libraryMap.has(String(d.id)))
        .sort((a, b) => (b.pop || 0) - (a.pop || 0))
        .slice(0, 8) : []), [local, libraryMap]);

    // Searching and result counts previously changed with no announcement.
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const showSuggest = !!typed && instant.length > 0 && !suggestHidden && typed !== query;
    useAnnounce(!isOpen ? null
        : showSuggest ? plural(instant.length, 'suggestion', 'suggestions')
        : loading && games.length === 0 ? 'Searching'
        : query.trim() ? [plural(games.length, 'game', 'games'), plural(franchises.length, 'franchise', 'franchises'),
            plural(collections.length, 'collection', 'collections'), plural(companies.length, 'company', 'companies')].join(', ')
        : null);
    const [savedFranchiseIds, setSavedFranchiseIds] = useState(new Set());
    const [savedCollectionIds, setSavedCollectionIds] = useState(new Set());
    const overlayRef = useRef(null);
    const inputRef = useRef(null);

    const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
    const isMobileDevice = IS_MOBILE_DEVICE;
    const isTauri = !!window.__TAURI_INTERNALS__;

    // Track window resize and mobile device detection
    useEffect(() => {
        const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isTauriDesktop = isTauri && !isMobileDevice;
    const titlebarHeight = isTauriDesktop ? (isDesktop ? 32 : 40) : 0;
    const mobileNavHeight = isDesktop ? 0 : (isTauriDesktop ? 0 : 56);
    const topOffset = mobileNavHeight + titlebarHeight;

    /* Both of these are declared here rather than further down the component
       because the effects below call them. A `const` arrow used above its own
       declaration only works by accident of effects running after render; move
       one call into render and it is a TDZ crash. useCallback so each can be an
       honest dependency instead of re-subscribing the listener every keystroke. */
    const handleClose = useCallback(() => {
        const params = new URLSearchParams(location.search);
        params.delete('search');
        params.delete('q');
        const paramsStr = params.toString();
        closeSearch(navigate, `${location.pathname}${paramsStr ? '?' + paramsStr : ''}`);
    }, [location.search, location.pathname, navigate]);

    /* A pure updater, so it is safe for React to call twice, and stable, so the
       500ms debounce below is not restarted every time the list changes.
       Persistence is not its job — see the effect further down, which is the one
       place the list reaches disk. */
    /* Formerly an eslint-disable for react-hooks/preserve-manual-memoization:
       The compiler bails on this whole component ("Compilation Skipped") because
       of the adjust-state-during-render blocks above, which it does not model,
       and then reports that it could not preserve this useCallback. There is no
       runtime consequence: the React Compiler is not in this build (see
       vite.config.js, and the note in README.md), so nothing was going to be
       auto-memoised either way. The callback below is correct on its own terms —
       pure updater, empty deps, genuinely stable. */
    const saveRecentSearch = useCallback((q) => {
        if (!q.trim()) return;
        setRecentSearches(prev => [q, ...prev.filter(s => s !== q)].slice(0, 5));
    }, []);

    // Escape key to close
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleClose]);

    // Handle scroll lock and body offsets when overlay is open
    /* Opening and closing changes state that the very next paint depends on:
       which games are shelved, which franchises and collections are saved. Read
       during render, the overlay opens with its badges already right. Through an
       effect it opened unbadged and corrected itself a frame later, which is
       exactly when the user is looking at it. All three are synchronous
       localStorage reads. */
    /* Starts false, not isOpen: a page loaded with ?search=true is already open
       on its first render, and seeding this with isOpen skipped the branch below
       entirely, so search opened from a link or a reload showed no library
       badges and could not find your own games. */
    const [openFor, setOpenFor] = useState(false);
    if (openFor !== isOpen) {
        setOpenFor(isOpen);
        if (isOpen) {
            const map = new Map();
            getLibrary().forEach(g => map.set(String(g.id), g));
            setLibraryMap(map);
            setSavedFranchiseIds(new Set(getSavedFranchises().map(f => String(f.id))));
            setSavedCollectionIds(new Set(getSavedIgdbCollections().map(id => String(id))));
        } else {
            setInputValue('');
            setIgdbGames([]); setIgdbFranchises([]); setCollections([]); setIgdbCompanies([]);
            setActiveIndex(-1); setSuggestHidden(false); setExactQuery(null);
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!isOpen || local) return;
        let alive = true;
        loadLocal().then(l => { if (alive) setLocal(l); }).catch(err => console.warn('[search] local index unavailable, using IGDB alone', err));
        return () => { alive = false; };
    }, [isOpen, local]);

    /* What is left in this effect is only DOM: the scroll lock, the
       scrollbar-width compensation, and the deferred focus. No state. */
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
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.paddingRight = '0px';
            if (navbar) navbar.style.paddingRight = '0px';
        }
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.paddingRight = '0px';
            if (navbar) navbar.style.paddingRight = '0px';
        };
    }, [isOpen]);

    /* Raised during render, so the spinner and the request begin together
       rather than the previous query's results painting once more first. An
       empty box needs no reset here: the close branch above already clears the
       four lists, and an empty query never reaches the fetch. */
    const [searchFor, setSearchFor] = useState('');
    if (effective.length > 0 && searchFor !== effective) {
        setSearchFor(effective);
        setLoading(true);
    }

    /* IGDB, for everything the local index does not hold. It is asked the
       corrected query (IGDB returns nothing for one wrong letter) and, for
       games, a prefix query on what was typed (it returns nothing for an
       unfinished word either). */
    useEffect(() => {
        if (effective.length === 0) return;
        let alive = true;
        const fetchResults = async () => {
            try {
                const [gameResults, franchiseResults, igdbCollectionResults, companyResults] = await Promise.all([
                    searchGamesRanked(effective, query.trim()),
                    searchFranchises(effective),
                    searchIgdbCollections(effective, 10),
                    searchCompanies(effective),
                ]);
                if (!alive) return;
                const own = getCollections() || [];
                const ownMatches = own.filter(c => c?.name?.toLowerCase().includes(effective.toLowerCase())).map(c => ({...c, isLocal: true}));
                setIgdbGames(gameResults);
                setIgdbFranchises(franchiseResults);
                setCollections([...ownMatches, ...igdbCollectionResults]);
                setIgdbCompanies(companyResults);
            } catch (error) {
                console.error("Search error:", error);
            } finally {
                if (alive) setLoading(false);
            }
        };
        fetchResults();
        return () => { alive = false; };
    }, [effective, query]);

    // Sync input from URL only on EXTERNAL changes (recent-search click, back/fwd).
    // Guarding on the trim avoids echoing our own trimmed value back over the
    // user's in-progress text — which was eating spaces as they typed.
    /* Keyed on the previous query rather than run as an effect, because the
       guard must fire on a change of `query` only. Evaluated on every render it
       would echo the trimmed URL value back over text the user is still typing,
       which is the space-eating bug the comment above describes. */
    const [urlQuerySeen, setUrlQuerySeen] = useState(query);
    if (urlQuerySeen !== query) {
        setUrlQuerySeen(query);
        if (query !== inputValue.trim()) setInputValue(query);
    }

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
    }, [inputValue, query, setSearchParams, location.search, saveRecentSearch]);

    const handleSearchClick = (q) => { 
        setInputValue(q); 
        const params = new URLSearchParams(location.search);
        params.set('q', q);
        setSearchParams(params, { replace: true }); 
        saveRecentSearch(q); 
    };

    /* One place writes the recent-search list to disk, so add, remove and clear
       all persist the same way and no caller can forget. Three call sites used to
       do it by hand, and clearHistory used removeItem where the others used
       setItem. */
    useEffect(() => {
        localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
    }, [recentSearches]);

    const removeRecentSearch = (e, q) => {
        e.stopPropagation();
        setRecentSearches(prev => prev.filter(s => s !== q));
    };

    const clearHistory = () => {
        setRecentSearches([]);
        setRecentGames([]);
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

    /* Commit a query now, without waiting for the debounce: Enter, a "did you
       mean", or "search instead". */
    const commitQuery = (q, { exact = false } = {}) => {
        const v = q.trim();
        setInputValue(v);
        setSuggestHidden(true);
        setActiveIndex(-1);
        setExactQuery(exact ? v : null);
        const params = new URLSearchParams(location.search);
        if (v) params.set('q', v); else params.delete('q');
        setSearchParams(params, { replace: true });
        if (v) saveRecentSearch(v);
    };

    const hrefFor = (doc) => (doc.kind === 'franchise' ? `/franchise/${doc.id}`
        : doc.kind === 'company' ? `/games/company/${doc.id}`
        : `/game/${doc.id}`);

    /* Open a suggestion: its page, and the search is remembered the way a
       clicked result is. */
    const openSuggestion = (doc) => {
        if (doc.kind === 'game') saveRecentGame({ id: doc.id, name: doc.name, cover_id: doc.cover, release_year: doc.year });
        if (typed) saveRecentSearch(typed);
        /* A game opens on its prelude, and its thumbnail flies to the poster. */
        navigate(hrefFor(doc), doc.kind === 'game'
            ? withPrelude({ id: doc.id, name: doc.name, cover_id: doc.cover, release_year: doc.year })
            : undefined);
    };

    /* The combobox keys (WAI-ARIA 1.2 combobox, list autocomplete):
       ArrowDown/Up move through the suggestions, Enter opens the one marked or
       commits the query, Tab or ArrowRight at the end accepts the ghost text,
       and the first Escape closes the list rather than the whole search. */
    const onInputKeyDown = (e) => {
        if (e.key === 'ArrowDown' && showSuggest) {
            e.preventDefault();
            setActiveIndex(i => Math.min(instant.length - 1, i + 1));
        } else if (e.key === 'ArrowUp' && showSuggest) {
            e.preventDefault();
            setActiveIndex(i => Math.max(-1, i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (showSuggest && activeIndex >= 0 && instant[activeIndex]) openSuggestion(instant[activeIndex].doc);
            else commitQuery(inputValue);
        } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === inputValue.length)) {
            if (ghost) {
                e.preventDefault();
                setInputValue(inputValue + ghost);
                setActiveIndex(-1);
            }
        } else if (e.key === 'Escape' && showSuggest) {
            e.preventDefault();
            e.stopPropagation();
            setSuggestHidden(true);
            setActiveIndex(-1);
        }
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
                        {/* Ghost text: the rest of the top suggestion, drawn behind the
                            input in the same type, so Tab or ArrowRight completes it. The
                            typed part is transparent and only holds the position. */}
                        {ghost && (
                            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-b border-transparent pb-4 pr-16 sm:pr-24 text-4xl sm:text-6xl md:text-[80px] leading-[1.15] font-black uppercase whitespace-pre overflow-hidden pointer-events-none">
                                <span className="text-transparent">{inputValue}</span><span className="text-white/30">{ghost}</span>
                            </div>
                        )}
                        <input
                            aria-label="Search index"
                            ref={inputRef}
                            type="text"
                            role="combobox"
                            aria-autocomplete="both"
                            aria-expanded={showSuggest}
                            aria-controls="search-suggestions"
                            aria-activedescendant={showSuggest && activeIndex >= 0 ? `search-suggestion-${activeIndex}` : undefined}
                            aria-describedby={ghost ? 'search-ghost-hint' : undefined}
                            autoComplete="off"
                            spellCheck={false}
                            value={inputValue}
                            onChange={(e) => { setInputValue(e.target.value); setSuggestHidden(false); setActiveIndex(-1); setExactQuery(null); }}
                            onKeyDown={onInputKeyDown}
                            placeholder="SEARCH INDEX..."
                            className="relative w-full bg-transparent border-b border-white/40 pb-4 pr-16 sm:pr-24 text-4xl sm:text-6xl md:text-[80px] leading-[1.15] font-black uppercase text-white placeholder:text-white/50 focus:outline-none focus:border-white transition-colors duration-300"
                        />
                        {ghost && <span id="search-ghost-hint" className="sr-only">Press Tab to complete: {inputValue + ghost}</span>}
                        {inputValue && (
                            <button
                                aria-label="Clear search"
                                onClick={() => {
                                    setInputValue('');
                                    const params = new URLSearchParams(location.search);
                                    params.delete('q');
                                    setSearchParams(params, { replace: true });
                                }} 
                                className="absolute right-0 bottom-4 sm:bottom-6 text-white/50 hover:text-white transition-colors cursor-pointer bg-black pl-4"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 sm:w-12 sm:h-12" viewBox="0 -960 960 960" fill="currentColor">
                                    <path d="M256-213.85 213.85-256l224-224-224-224L256-746.15l224 224 224-224L746.15-704l-224 224 224 224L704-213.85l-224-224-224 224Z"/>
                                </svg>
                            </button>
                        )}
                        </div>

                        {/* Suggestions, while typing: instant, from this device. */}
                        <ul
                            id="search-suggestions"
                            role="listbox"
                            aria-label="Suggestions"
                            className={`-mt-8 mb-10 border border-white/15 m-0 p-0 list-none ${showSuggest ? '' : 'hidden'}`}
                        >
                            {instant.map((r, i) => {
                                const d = r.doc;
                                const lib = d.kind === 'game' ? libraryMap.get(String(d.id)) : null;
                                return (
                                    <li
                                        key={`${d.kind}-${d.id}`}
                                        id={`search-suggestion-${i}`}
                                        role="option"
                                        aria-selected={i === activeIndex}
                                        onMouseDown={(e) => { e.preventDefault(); openSuggestion(d); }}
                                        onMouseEnter={() => setActiveIndex(i)}
                                        className={`flex items-center gap-4 px-4 py-2.5 cursor-pointer border-t first:border-t-0 border-white/10 ${i === activeIndex ? 'bg-white text-black' : 'text-white'}`}
                                    >
                                        <span className="w-8 h-10 shrink-0 bg-white/5 overflow-hidden flex items-center justify-center">
                                            {d.cover
                                                ? <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${d.cover}.jpg`} alt="" data-shared={d.kind === 'game' ? `poster:${d.id}` : undefined} className="w-full h-full object-cover" />
                                                : d.kind === 'franchise' ? <Layers aria-hidden="true" className="w-4 h-4 opacity-60" />
                                                : d.kind === 'company' ? <Building2 aria-hidden="true" className="w-4 h-4 opacity-60" />
                                                : <Gamepad2 aria-hidden="true" className="w-4 h-4 opacity-60" />}
                                        </span>
                                        <span className="min-w-0 flex-1 text-[15px] truncate">{d.name}</span>
                                        <span className={`lh-label shrink-0 ${i === activeIndex ? 'text-current/70' : 'text-white/60'}`}>
                                            {lib ? `In library · ${lib.status}` : d.kind === 'game' ? (d.year || 'Game') : d.kind === 'franchise' ? 'Franchise' : 'Studio'}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>

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
                        <div className="m-drop-in mb-12">
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

                    {/* Starting points, before anything is typed. */}
                    {!query && !typed && (playingNow.length > 0 || popular.length > 0) && (
                        <div className="mb-12 flex flex-col gap-8">
                            {[['Playing Now', playingNow.map(g => ({ id: g.id, name: g.name }))], ['Popular', popular.map(d => ({ id: d.id, name: d.name }))]]
                                .filter(([, list]) => list.length > 0)
                                .map(([label, list]) => (
                                    <div key={label}>
                                        <h3 className="lh-label text-white/50 tracking-widest mb-4">{label}</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {list.map(g => (
                                                <Link
                                                    key={g.id}
                                                    to={`/game/${g.id}`}
                                                    onClick={() => saveRecentGame({ id: g.id, name: g.name })}
                                                    className="lh-label px-4 py-2 border border-white/15 text-white hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors"
                                                >
                                                    {g.name}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}

                    {/* Results Section */}
                    {query && (
                        <div className="m-reveal">
                            {correction && (
                                <p className="text-[15px] text-white/70 mb-6 m-0">
                                    {correction.auto ? (
                                        <>
                                            Showing results for <strong className="text-white font-semibold">{correction.query}</strong>.{' '}
                                            <button type="button" onClick={() => commitQuery(query, { exact: true })} className="inline-block py-1 -my-1 underline decoration-white/30 underline-offset-4 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer">
                                                Search instead for {query}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            Did you mean{' '}
                                            <button type="button" onClick={() => commitQuery(correction.query)} className="inline-block py-1 -my-1 text-white underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer">
                                                {correction.query}
                                            </button>?
                                        </>
                                    )}
                                </p>
                            )}
                            {/* Tabs */}
                            <div className="flex items-center gap-8 border-b border-white/10 pb-4 mb-8 overflow-x-auto no-scrollbar">
                                {TABS.map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        aria-pressed={activeTab === tab}
                                        className={`relative lh-label whitespace-nowrap py-2 -my-2 transition-colors duration-200 cursor-pointer flex items-center gap-2 ${activeTab === tab ? 'text-white' : 'text-white/60 hover:text-white/80'}`}
                                    >
                                        {tab.toUpperCase()}
                                        {!loading && tabCount[tab] > 0 && (
                                            <span className={`text-[10px] ${activeTab === tab ? 'text-white' : 'text-white/50'}`}>
                                                ({tabCount[tab]})
                                            </span>
                                        )}
                                        {/* py-2 -my-2 lifts each tab from an 11px line to a 27px target (WCAG
                                            2.5.8) without moving the row; the marker moves down by the same 8px. */}
                                        {activeTab === tab && <div className="absolute -bottom-[9px] left-0 right-0 h-[2px] bg-white" />}
                                    </button>
                                ))}
                            </div>

                            {/* ── Games ── */}
                            {activeTab === 'Games' && (
                                <div ref={resultsRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                    {loading && games.length === 0 ? (
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
                                                        game={{ ...game, priority: libGame?.priority }}
                                                        menuOptions={buildGameMenu(game)}
                                                    />
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full">
                                          <EmptyPlate icon={Gamepad2} title="No games found"
                                            body={`Nothing matches "${effective}". Try fewer words.`} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Franchises ── */}
                            {activeTab === 'Franchises' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {loading && franchises.length === 0 ? (
                                        [...Array(5)].map((_, i) => <CollectionSkeleton key={i} />)
                                    ) : franchises.length > 0 ? (
                                        franchises.map(f => {
                                            const coverId = getFranchiseCover(f);
                                            const gameCount = f.games?.length || 0;
                                            return (
                                                <div key={f.id}>
                                                    <CollectionCard
                                                        game={{ id: f.id, name: f.name, cover_id: coverId, release_year: gameCount > 0 ? `${gameCount} game${gameCount !== 1 ? 's' : ''}` : 'Franchise' }}
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
                                    {loading && companies.length === 0 ? (
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
