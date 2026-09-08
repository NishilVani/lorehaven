import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, Search, Library, User, GalleryVerticalEnd, LogOut, MoreVertical, Calendar, LogIn, Minus, Square, Copy, X, Menu, Image as ImageIcon, Trophy, Tag, SlidersHorizontal, Drama, Users2, ChevronRight } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from '../ui/toastBus';
import DropdownMenu from '../ui/DropdownMenu';
import { useFocusTrap } from '../ui/useFocusTrap';
import PreferencesDialog from '../ui/PreferencesDialog';
import { auth } from '../../services/firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import AuthModal from '../ui/AuthModal';
import LogoMark from '../ui/LogoMark';
import SearchOverlay from './SearchOverlay';

/* Standalone so the compiler lint does not read this as mutating the ref the
   element was reached through — it is a DOM node, not React state. */
const setStyleTop = (el, v) => { el.style.top = v; };

export default function Navbar() {
    const location = useLocation();
    const navigate = useNavigate();
    const isSearchOpen = new URLSearchParams(location.search).get('search') === 'true';
    const getSearchLink = () => {
        const params = new URLSearchParams(location.search);
        params.set('search', 'true');
        return `${location.pathname}?${params.toString()}`;
    };
    const getCloseLink = () => {
        const params = new URLSearchParams(location.search);
        params.delete('search');
        params.delete('q');
        const paramsStr = params.toString();
        return `${location.pathname}${paramsStr ? '?' + paramsStr : ''}`;
    };
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [user, setUser] = useState(null);
    const [isMaximized, setIsMaximized] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
    const [isMobileDevice, setIsMobileDevice] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [browseOpen, setBrowseOpen] = useState(false);
    const browseRef = useRef(null);
    const lastScrollY = useRef(0);
    /* The drawer's manners, the way Dialog already has them: Escape closes it,
       and focus returns to whatever opened it (the hamburger) instead of
       dropping to <body>. Guarded against first mount: nothing was captured. */
    const drawerOpener = useRef(null);
    useEffect(() => {
        if (isMobileSidebarOpen) {
            drawerOpener.current = document.activeElement;
            const onKey = (e) => { if (e.key === 'Escape') setIsMobileSidebarOpen(false); };
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
        }
        /* iOS Safari does not focus a button when it is clicked, so on WebKit the
           captured opener is <body>. The drawer can only be opened from the
           hamburger, so that is the honest restore target either way. */
        const captured = drawerOpener.current;
        drawerOpener.current = null;
        const opener = (captured && captured !== document.body && captured.isConnected)
            ? captured
            : document.querySelector('[aria-label="Open navigation menu"]');
        if (!opener) return;
        /* The Close control lives inside the drawer, so it still holds focus here
           and for a frame or two after: the removal that drops focus to <body>
           has not happened yet. Watch a few frames and restore the moment nothing
           live holds it; if something live still does, leave it alone. */
        const restore = (tries) => requestAnimationFrame(() => {
            const a = document.activeElement;
            if (a && a !== document.body && a.isConnected) {
                if (tries > 0) restore(tries - 1);
                return;
            }
            if (opener.isConnected) opener.focus({ preventScroll: true });
        });
        restore(3);
    }, [isMobileSidebarOpen]);
    const isTauri = !!window.__TAURI_INTERNALS__;
    const TITLE_BAR_H = 32; // px — Tauri custom title bar height
    const isTauriDesktopSmall = isTauri && !isMobileDevice && !isDesktop;

    // Track window resize and mobile device detection
    useEffect(() => {
        const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        setIsMobileDevice(mobile);
        
        const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Update layout CSS variables dynamically based on layout type
    useEffect(() => {
        const isTauriDesktop = isTauri && !isMobileDevice;
        const currentTitlebarH = isTauriDesktop ? (isDesktop ? 32 : 40) : 0;
        const currentMobileNavH = isDesktop ? 0 : (isTauriDesktop ? 0 : 56);

        document.documentElement.style.setProperty('--titlebar-h', `${currentTitlebarH}px`);
        document.documentElement.style.setProperty('--mobile-nav-h', `${currentMobileNavH}px`);

        /* Two variables, because the header means two different things.
           --mobile-nav-h is the space it RESERVES in layout: App.jsx pads the
           main region by it, so it must stay constant or the whole page would
           jump 56px every time the scroll direction changed.
           --mobile-nav-offset is where its bottom edge ACTUALLY is right now.
           Anything sticky that pins itself below the header wants this one:
           while the header was translated away, they went on holding a 56px gap
           and a live band of scrolling content showed through it. Same condition
           as the header's own transform, so the two can never disagree.

           The safe-area inset belongs IN this number, not beside it. The header
           starts at env(safe-area-inset-top), so its bottom edge is the inset
           plus its height — but this variable reported the height alone, leaving
           every consumer to remember the inset separately. Two of the three
           forgot: on a phone with a 40px notch the library's status strip and
           the API error banner pinned 40px above the header they sit under, and
           when the header hid they slid under the notification bar itself.
           Measured on a Pixel 7 with a 40px inset: header bottom 96, strip top
           56. Carrying the inset here makes the variable mean what it says. */
        document.documentElement.style.setProperty(
            '--mobile-nav-offset',
            `calc(${(isVisible || isDesktop) ? currentMobileNavH : 0}px + env(safe-area-inset-top, 0px))`,
        );
    }, [isDesktop, isTauri, isMobileDevice, isVisible]);

    /* Close the mobile drawer whenever the route changes.
       Closing was bolted onto each <Link> individually — six separate handlers —
       so anything that navigated by another route simply never closed it. The
       account menu at the foot of the rail calls navigate() from its option
       handlers, so Manage Platforms, Import Library, Find Wallpapers and
       Recommendation Feedback all left the drawer sitting open over the page
       they had just opened. Reacting to the destination instead of decorating
       every departure covers those, and anything added later.

       The per-link handlers stay: tapping a link to the page you are already on
       does not change the pathname, and that should still close the drawer.

       Adjusted during render rather than in an effect. An effect would close it
       one render after the new page had already drawn, which is a visible flash
       of the drawer over the destination — and it cascades a render every time.
       Same pattern the library grid uses to reset its paint budget. */
    const [lastPath, setLastPath] = useState(location.pathname);
    if (location.pathname !== lastPath) {
        setLastPath(location.pathname);
        setIsMobileSidebarOpen(false);
    }

    // Hide navbar on scroll down, show on scroll up
    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            
            if (currentScrollY > lastScrollY.current && currentScrollY > 60) {
                setIsVisible(false);
            } else if (currentScrollY < lastScrollY.current) {
                setIsVisible(true);
            }
            
            lastScrollY.current = currentScrollY;
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Track window maximize state
    useEffect(() => {
        if (!isTauri) return;
        const appWindow = getCurrentWindow();
        appWindow.isMaximized().then(setIsMaximized);
        const unlisten = appWindow.onResized(() => {
            appWindow.isMaximized().then(setIsMaximized);
        });
        return () => { unlisten.then(fn => fn()); };
    }, []);



    const handleLogin = () => {
        setIsAuthModalOpen(true);
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            toast('Logged out successfully!');
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    /* The library count is read on click, not on render: this menu rebuilds on
       every route change and parsing the whole library each time to decide
       whether to grey out one row is not worth it. */
    /* Menu rows that open something in place — Sign In, Recommendation Settings,
       Clear Library, My Profile — never change the route, so the route watcher
       above cannot see them and the drawer stayed open behind the modal. Rather
       than adding a close to each handler (which is exactly the per-call-site
       habit that caused the original bug), the drawer's own menus close it on
       any selection. Harmless on the desktop rail, where it is already closed. */
    const closesDrawer = (options) => options.map(o => ({
        ...o,
        onClick: (e) => { setIsMobileSidebarOpen(false); o.onClick?.(e); },
    }));

    /* Manage Platforms, Import Library and Clear Library moved to the profile's
       Your Data band, and Log out to its Account band. This menu had grown into
       the app's junk drawer — eight rows deep, mixing a content surface, two
       settings, a whole three-tab page and the one irreversible action in the
       app, none of them with room to say what they cost. Clear Library sat one
       row above Log out, close enough to reach by accident.

       They are not duplicated here. Two homes for one action means the profile
       reads as a shortcut rather than the place those things live, and the row
       that stays behind is the one people keep using.

       Recommendation Feedback went the same way when the taste band landed: it
       is a page, and it belongs beside the dials that consume it.

       Two rows stay, and the reason is the same both times — neither is a
       destination the profile can own. Recommendation Settings is a global
       setting you tune while looking at the results it changes, so making you
       leave Explore to adjust it and come back would be worse than having two
       entry points; the profile band and this dialog render the same DialGroup
       from the same constants, so they cannot drift. Log out is the escape
       hatch for being signed in as the wrong person, and it is reversible,
       which none of the things that moved are.

       Eight rows down to four. */
    const userMenuOptions = [
        {
            label: 'My Profile',
            icon: User,
            onClick: () => navigate('/profile')
        },
        {
            label: 'Find Wallpapers',
            icon: ImageIcon,
            onClick: () => navigate('/wallpapers')
        },
        {
            label: 'Recommendation Settings',
            icon: SlidersHorizontal,
            onClick: () => setPrefsOpen(true)
        },
        {
            label: 'Log out',
            icon: LogOut,
            variant: 'danger',
            dividerAbove: true,
            onClick: handleLogout
        }
    ];

    const unauthedMenuOptions = [
        /* Also offered signed out. The page reports on a library that fills up
           perfectly well without an account, and it is where sign-in is
           explained as the thing that makes that library outlive this device.
           That is also what carries Clear Library now: gating the only way to
           empty the library behind sign-in would strand exactly the users who
           never signed in, and the profile is reachable either way. */
        {
            label: 'My Profile',
            icon: User,
            onClick: () => navigate('/profile')
        },
        {
            label: 'Find Wallpapers',
            icon: ImageIcon,
            onClick: () => navigate('/wallpapers')
        },
        {
            label: 'Recommendation Settings',
            icon: SlidersHorizontal,
            onClick: () => setPrefsOpen(true)
        },
        {
            label: 'Sign In',
            icon: LogIn,
            dividerAbove: true,
            onClick: handleLogin
        }
    ];



    // Listen to Firebase auth state
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });

        return () => unsubscribe();
    }, []);

    // Define our navigation links
    const navItems = [
        { path: '/', label: 'Explore', icon: Compass },
        { path: '/library', label: 'My Library', icon: Library },
        { path: '/schedule', label: 'Schedule', icon: Calendar },
        /* `at` widens the active test to the section's other prefixes. A bare
           startsWith cannot do it here: the detail route is singular, and adding
           prefixes blindly would light Explore for every path. */
        { path: '/collections', label: 'Collections', icon: GalleryVerticalEnd, at: ['/collections', '/collection/'] },
        /* Browse is the only rail item that does not navigate. Events, Awards
           and Wallpapers used to sit here as siblings of My Library, which put
           four ways of reading the catalogue at the same level as the one place
           that holds your own games. They are all ways IN to the archive, so
           they live behind one door now and the rail states five things instead
           of eight. */
        { key: 'browse', label: 'Browse', icon: Tag }
    ];

    /* The submenu. Every tile opens an index that lists its own members, and
       every one of those lists leads to a single thing — the same two steps
       whether you came for a genre or a ceremony. */
    /* `at` is every route the tile owns, not just the one it links to. An index
       hands you off to /games/:type/:id, and without the second prefix the tile
       you had just used went dark the moment it worked — you reopen the menu
       from a genre page and nothing is marked, so the panel reads as if you had
       arrived from nowhere. The rail row above has always claimed those routes
       (browseActive); the tiles inside it were the ones telling a different
       story. */
    const BROWSE_TILES = [
        { path: '/browse/genres', label: 'Genres', icon: Tag, at: ['/browse/genres', '/games/genre/'] },
        { path: '/browse/themes', label: 'Themes', icon: Drama, at: ['/browse/themes', '/games/theme/'] },
        { path: '/browse/modes', label: 'Modes', icon: Users2, at: ['/browse/modes', '/games/mode/'] },
        { path: '/awards', label: 'Awards', icon: Trophy },
        { path: '/events', label: 'Events', icon: Calendar },
        { path: '/wallpapers', label: 'Wallpapers', icon: ImageIcon },
    ];
    const browseActive = ['/browse', '/awards', '/events', '/wallpapers', '/games/']
        .some(p => location.pathname.startsWith(p));

    /* The panel is two things, and it needs two sets of manners.

       Beside the rail it is a FLYOUT: 360px of menu with the app still visible
       and clickable around it, so modal:false is right — trapping Tab there
       would give keyboard users strictly less than a mouse, which is the reason
       Dialog.jsx offers the option at all.

       Below lg it is a TAKEOVER: measured at 900x700 the panel rendered 889px
       wide and 700 tall, and elementFromPoint at the top-right corner and at the
       bottom edge both returned the panel. Nothing else on the screen exists.
       A takeover that leaves the page behind live is lying: the document went on
       scrolling under an opaque full-window panel, #root stayed un-inert so a
       screen reader walked straight into the page it was covering, and Tab left
       the panel for controls no one could see. So the same breakpoint that
       changes the geometry changes the behaviour. Same pattern as the wallpaper
       viewer's `modal: !wide`. */
    const browsePanelRef = useRef(null);
    /* The trap inerts every sibling of what it is given, and the backdrop is a
       sibling of the panel — handed the panel alone it would inert the one
       surface a thumb reaches for. Dialog.jsx calls this out and provides
       `boundaryRef` for exactly it: inert everything outside the pair, keep both
       halves live. */
    const browseBoundaryRef = useRef(null);
    const browseIsTakeover = browseOpen && !isDesktop;
    useFocusTrap({
        active: browseOpen,
        containerRef: browsePanelRef,
        boundaryRef: browseBoundaryRef,
        onClose: () => setBrowseOpen(false),
        modal: browseIsTakeover,
        lockScroll: browseIsTakeover,
    });
    /* Beside the rail the flyout hangs off `lg:top-0`, which put its middle
       roughly 200px above the row that opened it — the panel and its trigger
       read as two unrelated things stuck to the same edge. Centre on the
       trigger and the pair reads as one gesture: the row opens, the panel comes
       out of it. It also stops touching the top of the window, which is why
       the flyout gains a top hairline: a black panel on a black page has no
       edge of its own until a rule draws one.

       Measured rather than constant. The row's offset is whatever the wordmark,
       the search row and the four rows above it happen to add up to, so a
       hardcoded top is a number that silently goes wrong the next time the rail
       gains or loses a line.

       Written to the node in a layout effect rather than held in state: this
       runs before paint so there is no frame at the old position, and it keeps
       a measurement that React does not otherwise depend on out of the render
       cycle. Clamped to the viewport with a margin, because a tall panel in a
       short window would otherwise centre itself off the top of the screen. */
    const FLYOUT_MARGIN = 16;
    useLayoutEffect(() => {
        const panel = browsePanelRef.current;
        if (!panel) return;
        if (!browseOpen || !isDesktop) { setStyleTop(panel, ''); return; }

        const place = () => {
            const btn = browseRef.current;
            if (!btn || !browsePanelRef.current) return;
            const b = btn.getBoundingClientRect();
            const h = browsePanelRef.current.offsetHeight;
            const lo = FLYOUT_MARGIN;
            const hi = Math.max(lo, window.innerHeight - h - FLYOUT_MARGIN);
            setStyleTop(browsePanelRef.current, `${Math.round(Math.min(Math.max(b.top + b.height / 2 - h / 2, lo), hi))}px`);
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [browseOpen, isDesktop]);

    /* A route change means the submenu did its job. Adjusted during render
       rather than in an effect — the same pattern the library strip uses, and
       an effect here cascades a render on every navigation. Tiles and rail
       links already close it on click; this catches the browser's own back and
       forward, which would otherwise leave the panel open over a new page. */
    const [browsePath, setBrowsePath] = useState(location.pathname);
    if (browsePath !== location.pathname) {
        setBrowsePath(location.pathname);
        if (browseOpen) setBrowseOpen(false);
    }

    return (
        <>
            {/* ── Tauri Title Bar — always visible, full-width drag region ── */}
            {isTauri && !isMobileDevice && (
                <div
                    className="fixed top-0 left-0 right-0 z-[9998] flex items-center justify-between bg-black border-b border-white/[0.08] select-none"
                    style={{ height: 'var(--titlebar-h)' }}
                    onPointerDown={(e) => {
                        if (!e.target.closest('button, a, input, [data-tauri-drag-region="false"]')) {
                            getCurrentWindow().startDragging();
                        }
                    }}
                >
                    {/* Left: App controls or name */}
                    {!isDesktop ? (
                        <div className="flex items-center h-full pl-2 select-none" data-tauri-drag-region="false">
                            <button
                                onClick={() => setIsMobileSidebarOpen(true)}
                                aria-label="Open navigation menu"
                                aria-expanded={isMobileSidebarOpen}
                                className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white cursor-pointer hover:bg-white/[0.08] transition-colors"
                                data-tauri-drag-region="false"
                            >
                                <Menu className="w-[18px] h-[18px]" />
                            </button>
                            <Link to="/" className="flex items-center gap-2 group ml-1.5" data-tauri-drag-region="false">
                                <LogoMark className="w-4 h-4 flex-shrink-0 text-white/90 group-hover:text-white transition-colors" />
                                <span className="lh-brand text-[24px] leading-none text-white tracking-wide">LoreHaven</span>
                            </Link>
                        </div>
                    ) : (
                        <div className={`flex items-center pl-4 h-full pointer-events-none transition-opacity duration-300 ${!isDesktop && !isVisible ? 'opacity-100' : 'opacity-0'}`}>
                            <span className="lh-label text-white/50">LoreHaven</span>
                        </div>
                    )}

                    {/* Right: Window controls — native Windows sizing */}
                    <div className="flex items-stretch h-full" data-tauri-drag-region="false">
                        {!isDesktop && (
                            <div className="flex items-center pr-2 gap-0.5 border-r border-white/[0.08] mr-1" data-tauri-drag-region="false">
                                <Link
                                    to={isSearchOpen ? getCloseLink() : getSearchLink()}
                                    className={`w-8 h-8 flex items-center justify-center transition-colors duration-150 cursor-pointer hover:bg-white/[0.08] ${isSearchOpen ? 'text-white' : 'text-white/50 hover:text-white'}`}
                                    data-tauri-drag-region="false"
                                    title={isSearchOpen ? 'Close Search' : 'Search'}
                                >
                                    {isSearchOpen ? <X className="w-[16px] h-[16px]" /> : <Search className="w-[16px] h-[16px]" />}
                                </Link>

                                {user ? (
                                    <DropdownMenu options={userMenuOptions} align="right">
                                        <button className="w-8 h-8 flex items-center justify-center hover:bg-white/[0.08] cursor-pointer" data-tauri-drag-region="false">
                                            <div className="w-5 h-5 overflow-hidden border border-white/30">
                                                {user.photoURL
  ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
  /* An email/password account has no photoURL. The initial replaces a round trip to ui-avatars.com that showed a broken-image glyph offline. */
  : <span role="img" aria-label="Profile" className="w-full h-full flex items-center justify-center lh-label text-white/80">{(user.displayName || user.email || "?").trim().charAt(0).toUpperCase()}</span>}
                                            </div>
                                        </button>
                                    </DropdownMenu>
                                ) : (
                                    <DropdownMenu options={unauthedMenuOptions} align="right">
                                        <button aria-label="Account and app options" className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer" data-tauri-drag-region="false">
                                            <MoreVertical className="w-[16px] h-[16px]" />
                                        </button>
                                    </DropdownMenu>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => getCurrentWindow().minimize()}
                            className="w-[46px] h-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors duration-100 cursor-pointer"
                            title="Minimize"
                        >
                            <Minus className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => getCurrentWindow().toggleMaximize()}
                            className="w-[46px] h-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors duration-100 cursor-pointer"
                            title={isMaximized ? 'Restore Down' : 'Maximize'}
                        >
                            {isMaximized
                                ? <Copy className="w-3 h-3" strokeWidth={1.5} />
                                : <Square className="w-3 h-3" strokeWidth={1.5} />
                            }
                        </button>
                        <button
                            onClick={() => getCurrentWindow().close()}
                            className="w-[46px] h-full flex items-center justify-center text-white/60 hover:text-white hover:bg-[#c42b1c] transition-colors duration-100 cursor-pointer"
                            title="Close"
                        >
                            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                    </div>
                </div>
            )}
            {/* ── Mobile Sidebar Backdrop ── */}
            {isMobileSidebarOpen && (
                <div
                    /* cursor-pointer is what makes Safari synthesise a click on a bare div */
                    className="lg:hidden fixed inset-0 z-[9997] bg-black/60 transition-opacity cursor-pointer"
                    onClick={() => setIsMobileSidebarOpen(false)}
                />
            )}

            {/* ── Desktop Left Rail & Mobile Drawer ── */}
            <aside
                className={`fixed left-0 top-0 bottom-0 z-[9999] w-[220px] flex flex-col bg-black border-r border-white/15 select-none transition-transform duration-300 ease-in-out lg:translate-x-0 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
                /* Below lg the rail is only translated off-screen, so its links stay in
                   the tab order until it is made inert. isDesktop mirrors the lg: query. */
                inert={!isDesktop && !isMobileSidebarOpen}
            >
                {/* Close button for mobile */}
                <button
                    onClick={() => setIsMobileSidebarOpen(false)}
                    aria-label="Close navigation menu"
                    className="lg:hidden absolute top-[calc(env(safe-area-inset-top,0px)+1.5rem)] right-4 w-8 h-8 flex items-center justify-center text-white/50 hover:text-white cursor-pointer"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Wordmark. Two pixel faces, so the whole lockup is set on a
                    pixel grid rather than an em one.

                    The mark and the name share a row, and `items-center` is what
                    puts them on one cap line -- not a coincidence. leading-[0.56]
                    makes the two-line wordmark box 35.84px tall around 34px of
                    ink, so the ink is inset 0.92px top and bottom; a 34px mark
                    centred in that same box is inset by the identical 0.92px.
                    Centring therefore lands the mark's top on the cap line and
                    its foot on the baseline at once, with no offset to maintain.

                    The lockup is centred in the rail, which is the one place it
                    deliberately breaks the rail's own grid: every nav row below
                    starts at the px-6 edge, and this does not. That is the comp's
                    composition -- the tagline reads as a caption under the whole
                    unit rather than a note attached to the name -- and it only
                    works centred.

                    The rules either side of the tagline carry
                    --status-solid-beaten. That is the same value the middle book
                    of the mark takes in the brand artwork, where it means a game
                    you have beaten; the colour is not decoration picked for
                    warmth. NOTE: while the shipped mark is still monochrome, this
                    is the only place that value appears, so it has no companion
                    on screen.

                    Width against the rail's 172px of inner content: the name row
                    is 34 + 8 + 80 = 122, and the tagline row 16 + 10 + 99 + 10 +
                    16 = 151. Both clear. */}
                <Link to="/" onClick={() => setIsMobileSidebarOpen(false)} className="flex flex-col items-center px-6 pt-16 pb-8 lg:pt-8 group">
                    {/* Both gaps come from one unit, so they read as a rhythm
                        rather than two unrelated numbers. Bytesized is drawn on an
                        8-unit em, so at 40px one glyph pixel is 5px: the gap between
                        mark and wordmark is 4 of those (20px) and the gap down to the
                        tagline is 2 (10px optical). Exactly 2:1, both on the grid the
                        wordmark itself is built from.

                        The horizontal gap used to be 21px, which was not a decision --
                        it was whatever `justify-between` had left over after stretching
                        the row to the tagline's width. Fixing the gap and letting the
                        DASHES take up the slack instead keeps the two rows the same
                        width without the spacing being an accident. They land at 15.5px
                        against the 16 they were, which is the same rule at this scale.

                        mt-[9px] renders as 10.2px of air, not 9: the wordmark's ink sits
                        inside its line box at this size and Press Start 2P's sits inside
                        its own, and the two insets total 1.2px. Measured, not derived --
                        an 8px margin came out at 9.2.

                        40px is not an arbitrary size. Only multiples of 8 keep one glyph
                        pixel on one device pixel; 32 could not reach the dashes and 48
                        overruns the rail's 172px. The mark follows the wordmark's
                        two-line ink height -- 42.4px -- and a 43px square box letterboxes
                        the 76:75 artwork to exactly that. -mr-[4px] pulls the wordmark's
                        trailing advance off the row so its ink, not its box, sets the
                        right edge. */}
                    <div className="w-fit">
                        <div className="flex items-center gap-5">
                            <LogoMark className="w-[43px] h-[43px] flex-shrink-0 text-white/90 group-hover:text-white transition-colors" />
                            <span className="lh-brand block text-[40px] leading-[0.56] text-white -mr-[4px]">
                                Lore<br />Haven
                            </span>
                        </div>
                        <div className="flex items-center gap-2.5 mt-[9px]">
                            <span aria-hidden="true" className="h-0.5 flex-1 bg-white/50" />
                            <span className="lh-brand-sub flex-shrink-0 text-white/50 group-hover:text-white/80 transition-colors">
                                A Game Index
                            </span>
                            <span aria-hidden="true" className="h-0.5 flex-1 bg-white/50" />
                        </div>
                    </div>
                </Link>

                <nav className="flex-1 flex flex-col overflow-y-auto no-scrollbar">
                    {/* Separate Search Action */}
                    <Link
                        to={isSearchOpen ? getCloseLink() : getSearchLink()}
                        onClick={() => setIsMobileSidebarOpen(false)}
                        className={`w-full flex items-center gap-4 px-6 py-3.5 min-h-[44px] border-t border-white/10 transition-colors duration-150 cursor-pointer text-left ${isSearchOpen ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}
                    >
                        {isSearchOpen ? (
                            <>
                                <X className={`w-3.5 h-3.5 flex-shrink-0 ${isSearchOpen ? 'text-black opacity-100' : 'opacity-60'}`} strokeWidth={2.5} />
                                <span className="lh-label">Close Search</span>
                            </>
                        ) : (
                            <>
                                <Search className={`w-3.5 h-3.5 flex-shrink-0 ${isSearchOpen ? 'text-black opacity-100' : 'opacity-60'}`} strokeWidth={2.5} />
                                <span className="lh-label">Search</span>
                            </>
                        )}
                    </Link>

                    {/* Numbered Index */}
                    {navItems.map((item, i) => {
                        const no = String(i + 1).padStart(2, '0');
                        /* min-h-[44px], because py-3.5 alone let the content decide the
                           height and the content is not the same in every row. The rows
                           that carry an icon -- Search, and Browse with its chevron --
                           measured 43px against 40px for the numbered links, so an index
                           that is meant to read as one repeating step was striped 43 / 40
                           / 40 / 40 / 40 / 43. 44 is also the touch floor these rows were
                           sitting under: they carry no .tap, so on a coarse pointer they
                           were 40px targets. One value fixes the rhythm and the target. */
                        const rowClass = (on) => `flex items-baseline gap-4 px-6 py-3.5 min-h-[44px] border-t border-white/10 transition-colors duration-150 ${on ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`;

                        /* Browse opens rather than goes. It keeps the numbered
                           row so the rail still reads as one index, and marks
                           itself active for every destination behind it — a door
                           that looks shut while you are standing inside the room
                           is worse than no marking at all. */
                        if (item.key === 'browse') {
                            const on = !isSearchOpen && (browseOpen || browseActive);
                            return (
                                <button
                                    key="browse"
                                    ref={browseRef}
                                    onClick={() => setBrowseOpen(v => !v)}
                                    aria-expanded={browseOpen}
                                    aria-controls="browse-submenu"
                                    className={`${rowClass(on)} w-full text-left cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white`}
                                >
                                    <span className="lh-label">{no}</span>
                                    <span className="lh-label">{item.label}</span>
                                    <span className="flex-1" />
                                    <ChevronRight
                                        aria-hidden="true"
                                        className={`w-3.5 h-3.5 self-center transition-transform duration-200 ${browseOpen ? 'rotate-90' : ''}`}
                                    />
                                </button>
                            );
                        }

                        const isActive = !isSearchOpen && (location.pathname === item.path ||
                            (item.at || []).some(p => location.pathname.startsWith(p)) ||
                            (item.path !== '/' && location.pathname.startsWith(item.path)));
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                aria-current={isActive ? 'page' : undefined}
                                onClick={() => { setIsMobileSidebarOpen(false); setBrowseOpen(false); }}
                                className={rowClass(isActive)}
                            >
                                <span className="lh-label">{no}</span>
                                <span className="lh-label">{item.label}</span>
                            </Link>
                        );
                    })}
                    <div className="flex-1 border-t border-white/10" />
                </nav>

                {/* Bottom: account */}
                <div className="border-t border-white/15">
                    {user ? (
                        <div className="flex items-center justify-between px-6 py-3.5 w-full">
                            <DropdownMenu options={closesDrawer(userMenuOptions)} align="right" fullWidth>
                                <button className="flex items-center gap-3 text-white/60 hover:text-white transition-colors cursor-pointer flex-1 text-left min-w-0">
                                    <div className="w-6 h-6 flex-shrink-0 overflow-hidden border border-white/30">
                                        {user.photoURL
  ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
  /* An email/password account has no photoURL. The initial replaces a round trip to ui-avatars.com that showed a broken-image glyph offline. */
  : <span role="img" aria-label="Profile" className="w-full h-full flex items-center justify-center lh-label text-white/80">{(user.displayName || user.email || "?").trim().charAt(0).toUpperCase()}</span>}
                                    </div>
                                    <span className="lh-label truncate max-w-[100px]">{user.displayName || "User"}</span>
                                </button>
                            </DropdownMenu>
                            <button onClick={() => { setIsMobileSidebarOpen(false); handleLogout(); }} className="text-white/60 hover:text-[#c42b1c] transition-colors ml-4 flex-shrink-0 cursor-pointer" title="Log out">
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        /* Signed out, this rail was a bare Sign In button with no
                           menu behind it, so a signed-out desktop user had no
                           route to any account-level action. That was survivable
                           while they were all account actions; Clear Library is
                           not one — the library is local and fills up without an
                           account. Same shape as the signed-in row: primary
                           control, then an overflow. */
                        <div className="flex items-stretch border-t border-white/15">
                            <button
                                onClick={() => { setIsMobileSidebarOpen(false); handleLogin(); }}
                                className="flex-1 min-w-0 flex items-center justify-between px-6 py-4 lh-label text-white/60 hover:bg-white hover:text-black transition-colors duration-150 cursor-pointer"
                            >
                                <span>Sign In</span>
                                <LogIn className="w-3.5 h-3.5" />
                            </button>
                            <DropdownMenu options={closesDrawer(unauthedMenuOptions)} align="right">
                                <button
                                    aria-label="Library and account options"
                                    className="px-4 border-l border-white/15 text-white/60 hover:text-white transition-colors cursor-pointer"
                                >
                                    <MoreVertical className="w-4 h-4" />
                                </button>
                            </DropdownMenu>
                        </div>
                    )}
                </div>
            </aside>

            {/* ── Browse submenu ──
                Rendered OUTSIDE the aside on purpose. The aside carries a
                transform on mobile (it slides off-canvas), and a transformed
                ancestor becomes the containing block for `fixed` descendants —
                nested in there this panel would have slid away with the drawer
                instead of covering it.
                A flyout beside the rail on a desktop, a full panel over the
                drawer on a phone. Tiles rather than another list of rows:
                six destinations of equal weight read faster as a grid, and
                the rail above is already a column of rows.

                Square, hairline, black, inverting on hover — the reference
                for this pattern came with soft rounded cards, which would
                have been the only rounded surfaces in the app. */}
            {browseOpen && (
                <div ref={browseBoundaryRef}>
                <div
                    onClick={() => setBrowseOpen(false)}
                    aria-hidden="true"
                    /* Beside the rail: 9998, under the rail, undimmed. Clicking
                       a different rail item goes straight there instead of being
                       eaten by a dismiss, and dimming the whole app for a menu
                       overstates it.

                       Below lg: 9999, so it dims the drawer too. The drawer sits
                       at 9999 and the sheet leaves the lower two thirds of it
                       showing; under the old 9998 that strip stayed at full
                       brightness beside a dimmed page — and it is inert while
                       the sheet is open, so it was advertising a column of
                       controls that no longer answered. Equal z, later in the
                       DOM, so the tie goes to the backdrop and the panel's
                       10000 still clears both. */
                    className="fixed inset-0 z-[9999] bg-black/60 lg:z-[9998] lg:bg-transparent"
                />
                <div
                    ref={browsePanelRef}
                    id="browse-submenu"
                    /* A flyout beside the rail is a group of links and the page
                       around it stays live. Below lg the same element covers the
                       whole window, and markup that still called itself a group
                       was promising assistive tech a page it had already buried.
                       The role follows the behaviour, and aria-modal is only ever
                       set when the focus trap is actually modal — Dialog.jsx is
                       explicit that claiming it without trapping is worse than
                       claiming nothing. */
                    role={browseIsTakeover ? 'dialog' : 'group'}
                    aria-modal={browseIsTakeover ? 'true' : undefined}
                    aria-label="Browse the archive"
                    /* z above the rail's 9999, because on a phone this panel
                       covers the drawer rather than sitting beside it — at 9998
                       the drawer's own 220px painted straight over it. On a
                       desktop the two never overlap, so the rail stays lit and
                       clickable next to an open submenu.

                       Full height on a phone, content height beside the rail:
                       six tiles under a full-height column left 600px of black
                       void that read as an unfinished panel. */
                    /* Below lg this is a SHEET, not a page. It used to be
                       `inset-y-0` — full window — and six tiles do not fill a
                       window: on a 390x844 phone they ended at 485px and left
                       359px of black, and on a 900x700 tablet a 420px column of
                       them sat marooned in the middle of an otherwise empty
                       screen. Same "unfinished panel" the desktop flyout was
                       already sized against; the phone had simply not been held
                       to it. Anchored to the top and only as tall as it needs,
                       it reads as a layer over the page — and the dimmed strip
                       it no longer covers is a second way out, which is the one
                       a thumb reaches for first.

                       max-h/overflow because the tile list is data, not a fixed
                       six: a seventh row must scroll inside the sheet rather
                       than run off the bottom of the screen. */
                    className="fixed top-0 left-0 right-0 max-h-[85dvh] lg:top-0 lg:left-[220px] lg:right-auto lg:w-[360px] lg:max-h-[calc(100dvh-32px)] z-[10000] bg-black border-b border-white/15 lg:border-t lg:border-r flex flex-col animate-in slide-in-from-bottom-4 motion-reduce:animate-none"
                    style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
                >
                    {/* Only the takeover gets a header, and it gets one because
                        it has no other way out. Beside the rail you dismiss this
                        by clicking the page, pressing Escape or picking a tile;
                        full-window there is no page to click and no keyboard to
                        press Escape on, so the panel had exactly six exits and
                        every one of them navigated somewhere. Measured before
                        the fix: zero buttons inside the panel at 375px and at
                        900px, with the backdrop sealed underneath it.

                        Not rendered at all beside the rail, rather than hidden
                        with lg:hidden. The trap focuses the panel's first
                        focusable, querySelector does not care about display, and
                        focus() on a display:none button silently no-ops — so a
                        hidden close button left desktop keyboard users pressing
                        Enter on Browse and staying exactly where they were. */}
                    {browseIsTakeover && (
                        <div className="flex items-center justify-between gap-4 pl-6 pr-2 py-3 border-b border-white/15 shrink-0">
                            <span className="lh-label text-white">Browse</span>
                            <button
                                onClick={() => setBrowseOpen(false)}
                                aria-label="Close browse menu"
                                className="w-11 h-11 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                            >
                                <X className="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                        {/* Columns track the sheet's width instead of the tiles
                            tracking it. Two columns at 900px meant tiles of
                            422x317 each and 1900px of scroll — six billboards
                            for an 11px word. Three columns from 640px up keeps
                            every tile the size of a control and the whole set
                            one glance. Beside the rail the panel is a fixed
                            360px, so it goes back to two. */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-3">
                            {BROWSE_TILES.map(t => {
                                const Icon = t.icon;
                                const on = (t.at || [t.path]).some(prefix => location.pathname.startsWith(prefix));
                                return (
                                    <Link
                                        key={t.path}
                                        to={t.path}
                                        onClick={() => { setBrowseOpen(false); setIsMobileSidebarOpen(false); }}
                                        aria-current={on ? 'page' : undefined}
                                        className={`group aspect-[4/3] border flex flex-col items-center justify-center gap-3 px-2 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white ${
                                            on ? 'bg-white text-black border-white' : 'border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white'
                                        }`}
                                    >
                                        <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                        <span className="lh-label text-center min-w-0">{t.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </div>
                </div>
            )}

            {/* ── Mobile Header — editorial strip ── */}
            {!isTauriDesktopSmall && (
                <>
                    <div
                        className="lg:hidden fixed left-0 right-0 z-[80] pointer-events-none bg-black transition-transform duration-300 ease-in-out"
                        style={{
                            top: '-200px',
                            /* The bar's own height, and nothing more. /schedule used to
                               add 46px here to mask a sticky filter row it no longer
                               has -- Schedule.jsx now contains no fixed or sticky
                               element at all -- so the extension masked nothing and
                               painted opaque black over the page title instead:
                               measured at 375, the backdrop reached y=102 while the
                               "Schedule" heading spanned 72 to 112. */
                            height: `calc(200px + env(safe-area-inset-top, 0px) + 56px${isTauri && !isMobileDevice ? ` + ${TITLE_BAR_H}px` : ''})`,
                            transform: (isVisible || isDesktop) ? 'translateY(0)' : 'translateY(-56px)'
                        }}
                    />
                    <nav
                        className="lg:hidden w-full fixed left-0 right-0 z-[130] bg-black border-b h-14 select-none transition-transform duration-300 ease-in-out border-white/15"
                        onPointerDown={(e) => {
                            if (isTauri) {
                                if (!e.target.closest('button, a, input, span, img, [data-tauri-drag-region="false"]')) {
                                    getCurrentWindow().startDragging();
                                }
                            }
                        }}
                        style={{
                            top: isTauri && !isMobileDevice 
                                ? `calc(env(safe-area-inset-top, 0px) + ${TITLE_BAR_H}px)` 
                                : 'env(safe-area-inset-top, 0px)',
                            transform: (isVisible || isDesktop) ? 'translateY(0)' : 'translateY(-56px)'
                        }}
                    >

                        <div
                            className={`w-full h-full flex justify-between items-center px-4 sm:px-5 transition-opacity duration-300 ${(!isVisible && !isDesktop) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                            inert={!isVisible && !isDesktop}
                        >

                            {/* Left: Wordmark & Menu */}
                            {/* Shrinkable: at 280 a fixed-width wordmark pushed the account
                                control to x=265..305 in a 280px viewport, and the document was
                                narrower than the viewport so it could not even be scrolled to. */}
                            <div className="flex items-center h-full min-w-0">
                                <button
                                    onClick={() => setIsMobileSidebarOpen(true)}
                                    aria-label="Open navigation menu"
                                    aria-expanded={isMobileSidebarOpen}
                                    className="mr-3 w-8 h-8 flex items-center justify-center text-white/50 hover:text-white cursor-pointer"
                                >
                                    <Menu className="w-[18px] h-[18px]" />
                                </button>
                                <Link to="/" className="flex items-center gap-2 group py-1 min-w-0">
                                    <LogoMark className="w-5 h-5 flex-shrink-0 text-white/90 group-hover:text-white transition-colors" />
                                    <span className="lh-brand text-xl leading-none text-white truncate">LoreHaven</span>
                                </Link>
                            </div>

                            {/* Right: Search + Profile/Menu */}
                            <div className="flex items-center h-full gap-1 shrink-0">
                                <Link
                                    to={isSearchOpen ? getCloseLink() : getSearchLink()}
                                    className={`w-10 h-10 flex items-center justify-center transition-colors duration-150 cursor-pointer ${isSearchOpen ? 'text-white' : 'text-white/50 hover:text-white'}`}
                                    title={isSearchOpen ? 'Close Search' : 'Search'}
                                >
                                    {isSearchOpen ? <X className="w-[18px] h-[18px]" /> : <Search className="w-[18px] h-[18px]" />}
                                </Link>

                                {user ? (
                                    <DropdownMenu options={userMenuOptions} align="right">
                                        <button className="w-10 h-10 flex items-center justify-center cursor-pointer">
                                            <div className="w-6 h-6 overflow-hidden border border-white/30">
                                                {user.photoURL
  ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
  /* An email/password account has no photoURL. The initial replaces a round trip to ui-avatars.com that showed a broken-image glyph offline. */
  : <span role="img" aria-label="Profile" className="w-full h-full flex items-center justify-center lh-label text-white/80">{(user.displayName || user.email || "?").trim().charAt(0).toUpperCase()}</span>}
                                            </div>
                                        </button>
                                    </DropdownMenu>
                                ) : (
                                    <DropdownMenu options={unauthedMenuOptions} align="right">
                                        <button aria-label="Account and app options" className="w-10 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer">
                                            <MoreVertical className="w-[18px] h-[18px]" />
                                        </button>
                                    </DropdownMenu>
                                )}
                            </div>

                        </div>
                    </nav>
                </>
            )}

            {/* Search Overlay */}
            <SearchOverlay />

            {/* Auth Modal */}
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

        </>
    );
}