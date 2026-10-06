import { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

// App shell — always on screen, so it stays in the main chunk.
import Navbar from './components/layout/Navbar';
import ScrollToTop from './components/layout/ScrollToTop';
import AppLinks from './components/layout/AppLinks';
import NativeBridge from './components/layout/NativeBridge';
import TransitionLocation from './motion/TransitionLocation';
import { lazyRoute } from './motion/routes';
import RouteSkeleton from './components/ui/RouteSkeleton';
import { ToastContainer } from './components/ui/Toast';
import ApiErrorBanner from './components/ui/ApiErrorBanner';
import useBootConfirmed from './ota/useBootConfirmed';

// Routes are code-split: each becomes its own chunk. lazyRoute (motion/routes.js)
// prefetches them in idle time after the first paint and on link intent, and
// tells the transition director which are loaded, so a page change never shows
// a fallback. Each pattern says which pathnames need the chunk.
const Discover = lazyRoute(/^\/$/, () => import('./pages/discover/Discover'));
const NotFound = lazyRoute(/^$/, () => import('./pages/NotFound'));
const ExploreList = lazyRoute(/^\/explore\//, () => import('./pages/discover/ExploreList'));
const Feedback = lazyRoute(/^\/feedback/, () => import('./pages/discover/Feedback'));
const Profile = lazyRoute(/^\/profile\/?$/, () => import('./pages/profile/Profile'));
const YearInReview = lazyRoute(/^\/profile\/year\//, () => import('./pages/profile/YearInReview'));
const GameDetail = lazyRoute(/^\/game\/[^/]+\/?$/, () => import('./pages/games/GameDetail'));
const Library = lazyRoute(/^\/library\/(?!duplicates)/, () => import('./pages/library/Library'));
const Duplicates = lazyRoute(/^\/library\/duplicates/, () => import('./pages/library/Duplicates'));
const ImportWizardV2 = lazyRoute(/^\/import\/?$/, () => import('./pages/ImportWizard/ImportWizard'));
const SteamImport = lazyRoute(/^\/import\/steam/, () => import('./pages/ImportWizard/SteamImport'));
const XboxImport = lazyRoute(/^\/import\/xbox/, () => import('./pages/ImportWizard/XboxImport'));
const SteamAuth = lazyRoute(/^\/auth\/steam/, () => import('./pages/auth/SteamAuth'));
const XboxAuth = lazyRoute(/^\/auth\/xbox/, () => import('./pages/auth/XboxAuth'));
const FranchisePage = lazyRoute(/^\/franchise\//, () => import('./pages/franchises/FranchisePage'));
const Collections = lazyRoute(/^\/collections/, () => import('./pages/collections/Collections'));
const CollectionDetail = lazyRoute(/^\/collection\//, () => import('./pages/collections/CollectionDetail'));
const GameCollections = lazyRoute(/^\/game\/[^/]+\/collections/, () => import('./pages/collections/GameCollections'));
const ManagePlatforms = lazyRoute(/^\/platforms/, () => import('./pages/platforms/ManagePlatforms'));
const TaxonomyIndex = lazyRoute(/^\/browse\//, () => import('./pages/browse/TaxonomyIndex'));
const AllEvents = lazyRoute(/^\/events/, () => import('./pages/events/AllEvents'));
const Schedule = lazyRoute(/^\/schedule/, () => import('./pages/schedule/Schedule'));
const EventDetail = lazyRoute(/^\/event\//, () => import('./pages/events/EventDetail'));
const Wallpapers = lazyRoute(/^\/wallpapers/, () => import('./pages/wallpapers/Wallpapers'));
const CategoryPage = lazyRoute(/^\/games\//, () => import('./pages/category/CategoryPage'));
const AwardsIndex = lazyRoute(/^\/awards\/?$/, () => import('./pages/awards/AwardsIndex'));
const AwardCeremony = lazyRoute(/^\/awards\/[^/]+/, () => import('./pages/awards/AwardCeremony'));


/* Route params are identity, not merely data. When the id in the URL changes,
   the page is showing a different thing and every piece of state describing the
   old one is wrong. Keying by the params makes React throw that state away.

   These pages each used to do it by hand, in an effect whose body pushed state
   back to the values its useState calls already start with — a remount written
   out longhand, arriving a render late, with a frame of the previous thing's
   filters or rows still on screen in between. */
function KeyedRoute({ component: Component }) {
  /* Keyed on the pathname rather than the params. Two routes can produce the
     same param values — /collection/5 and /collection/igdb/5 both yield id 5,
     and both render CollectionDetail — so a param key would hand a community
     collection the state of a local one with the same number. */
  const { pathname } = useLocation();
  return <Component key={pathname} />;
}


function App() {
  /* Mounting is what proves an OTA bundle works; see src/ota/bootstrap.js. */
  useBootConfirmed();
  const [syncKey, setSyncKey] = useState(0);

  useEffect(() => {
    /* Routes that refresh themselves and must not be remounted. The wizard holds
       an in-progress import; Explore holds however many recommendation pages the
       reader has scrolled through, and remounting it measured as 57 cards
       becoming 10 and the scroll position jumping from 2239px to 1612px at a
       1000-game library.
       Explore listens for this event and refetches the two things a sync can
       change, its recommendations and its shelves, in Discover.jsx.
       ponytail: still blunt for every other route. Each one that grows state
       worth keeping should refresh itself and join this list.

       /auth is here for a different reason: a sign-in is not state worth
       keeping, it is a step that cannot be taken twice. Signing in pulls the
       account's data, which fires this event, which would remount the sign-in
       page mid-sign-in and send the store a code or an assertion it has already
       spent -- and the person would watch a sign-in that worked turn into a
       failure. */
    const SELF_REFRESHING = ['/import', '/auth', '/'];

    const handleSync = () => {
      const path = window.location.pathname;
      if (SELF_REFRESHING.some(p => (p === '/' ? path === '/' : path.startsWith(p)))) return;
      setSyncKey(prev => prev + 1);
    };
    window.addEventListener('moctale_sync_update', handleSync);
    return () => window.removeEventListener('moctale_sync_update', handleSync);
  }, []);

  /* There was a credential gate here, and before that a Firestore read that put
     the IGDB client secret in every browser and every shipped binary.
     functions/proxy.js holds the secret now and the client asks for game data
     instead of for credentials, so there was nothing left to wait for and the
     gate was settling on mount into an awaiter that no longer existed. Both it
     and services/igdbCredentials.js are gone. */

  /* This used to be `if (loading) return null`, which blanked the WHOLE app --
     nav, skeletons and all -- until a Firebase dynamic import (259 kB, ~2.5s) and
     a Firestore round trip finished. That single line was most of the ~6s
     time-to-content on every route. The shell renders immediately now; IGDB calls
     wait on the credential gate instead of the user waiting on a blank screen. */

  return (
    <BrowserRouter>
      {/* Page transitions: everything inside reads the page's location, held
          while the browser captures the old page (motion/TransitionLocation). */}
      <TransitionLocation>
      <ScrollToTop />
      <AppLinks />
      <NativeBridge />
      <ToastContainer />
      <div className="min-h-screen text-white flex flex-col">
        {/* Skip link — visually hidden until focused, then pinned top-left ABOVE the rail.
            z-[10000], not z-[9999]: the nav <aside> also carries z-[9999], and equal
            z-index in one stacking context resolves by DOM order, so the rail (later in
            the tree) painted over it. Computed style said the link was visible — white
            background, correct position — while focused and blurred screenshots of its
            exact rect came back byte-identical, because an opaque 220px rail sat on top.
            Desktop only; below lg the rail is translated off-screen, which is why this
            survived. It is the first control a keyboard user meets. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10000] focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:lh-label focus:outline-none focus:ring-1 focus:ring-black"
        >
          Skip to content
        </a>

        <Navbar />

        {/* Mobile: clear the fixed top bar + optional Tauri title bar. Desktop: clear the left rail + optional title bar. */}
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 outline-none pb-[calc(env(safe-area-inset-bottom,0px)+32px)] lg:pb-0 pt-[calc(var(--mobile-nav-h,56px)+env(safe-area-inset-top,0px)+var(--titlebar-h,0px))] lg:pt-[calc(2rem+var(--titlebar-h,0px))] lg:pl-[220px]"
        >
          {/* One integration point for every screen: data failures announce via
              `moctale_api_error` rather than each page plumbing its own error state. */}
          <ApiErrorBanner />

          <Suspense fallback={<RouteSkeleton />}>
          <Routes key={syncKey}>
            <Route path="/" element={<Discover />} />
            <Route path="/explore/:section" element={<KeyedRoute component={ExploreList} />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/year/:year" element={<YearInReview />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/game/:id" element={<KeyedRoute component={GameDetail} />} />
            <Route path="/library" element={<Navigate to="/library/backlog" replace />} />
            {/* A static segment outranks :status in React Router's ranking, so
                this is never read as a shelf called "duplicates". */}
            <Route path="/library/duplicates" element={<Duplicates />} />
            <Route path="/library/:status" element={<Library />} />
            <Route path="/import" element={<ImportWizardV2 />} />
            <Route path="/import/steam" element={<SteamImport />} />
            <Route path="/import/xbox" element={<XboxImport />} />
            {/* Where Steam returns every sign-in; see services/steamAuth.js. */}
            <Route path="/auth/steam" element={<SteamAuth />} />
            <Route path="/auth/xbox" element={<XboxAuth />} />
            <Route path="/franchise/:franchiseId" element={<KeyedRoute component={FranchisePage} />} />
            <Route path="/collections" element={<Collections />} />
            {/* The hub page is gone: the sidebar submenu is the way in now, and
                each taxonomy has its own index. The bare path stays so old links
                and bookmarks land somewhere real. */}
            <Route path="/browse" element={<Navigate to="/browse/genres" replace />} />
            <Route path="/browse/:taxonomy" element={<KeyedRoute component={TaxonomyIndex} />} />
            <Route path="/collection/:id" element={<KeyedRoute component={CollectionDetail} />} />
            <Route path="/collection/igdb/:id" element={<KeyedRoute component={CollectionDetail} />} />
            <Route path="/game/:id/collections" element={<GameCollections />} />
            <Route path="/platforms" element={<ManagePlatforms />} />
            <Route path="/events" element={<AllEvents />} />
            <Route path="/event/:id" element={<KeyedRoute component={EventDetail} />} />
            <Route path="/wallpapers" element={<Wallpapers />} />
            <Route path="/games/:type/:id" element={<KeyedRoute component={CategoryPage} />} />
            <Route path="/awards" element={<AwardsIndex />} />
            <Route path="/awards/:awardQid" element={<KeyedRoute component={AwardCeremony} />} />
            {/* Last, and it must stay last: a catch-all above any of these would swallow them. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      </TransitionLocation>
    </BrowserRouter>
  );
}

export default App;