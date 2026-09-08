import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// App shell — always on screen, so it stays in the main chunk.
import Navbar from './components/layout/Navbar';
import ScrollToTop from './components/layout/ScrollToTop';
import { ToastContainer } from './components/ui/Toast';
import ApiErrorBanner from './components/ui/ApiErrorBanner';

// Routes are code-split: each becomes its own chunk fetched on first navigation,
// so visiting the home page no longer downloads the Import Wizard, the Award
// ceremony, Wallpapers and every other screen up front.
const Discover = lazy(() => import('./pages/discover/Discover'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ExploreList = lazy(() => import('./pages/discover/ExploreList'));
const Feedback = lazy(() => import('./pages/discover/Feedback'));
const Profile = lazy(() => import('./pages/profile/Profile'));
const YearInReview = lazy(() => import('./pages/profile/YearInReview'));
const GameDetail = lazy(() => import('./pages/games/GameDetail'));
const Library = lazy(() => import('./pages/library/Library'));
const ImportWizardV2 = lazy(() => import('./pages/ImportWizard/ImportWizard'));
const FranchisePage = lazy(() => import('./pages/franchises/FranchisePage'));
const Collections = lazy(() => import('./pages/collections/Collections'));
const CollectionDetail = lazy(() => import('./pages/collections/CollectionDetail'));
const GameCollections = lazy(() => import('./pages/collections/GameCollections'));
const ManagePlatforms = lazy(() => import('./pages/platforms/ManagePlatforms'));
const TaxonomyIndex = lazy(() => import('./pages/browse/TaxonomyIndex'));
const AllEvents = lazy(() => import('./pages/events/AllEvents'));
const Schedule = lazy(() => import('./pages/schedule/Schedule'));
const EventDetail = lazy(() => import('./pages/events/EventDetail'));
const Wallpapers = lazy(() => import('./pages/wallpapers/Wallpapers'));
const CategoryPage = lazy(() => import('./pages/category/CategoryPage'));
const AwardsIndex = lazy(() => import('./pages/awards/AwardsIndex'));
const AwardCeremony = lazy(() => import('./pages/awards/AwardCeremony'));

/* Route-transition fallback. Deliberately minimal: chunks are small enough that a
   full skeleton would flash in and out. aria-busy + a live region so the swap is
   not silent to assistive tech. */
function RouteFallback() {
  return (
    <div className="px-6 lg:px-10 py-10" aria-busy="true" aria-live="polite">
      <span className="lh-label text-white/60">Loading…</span>
    </div>
  );
}

function App() {
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
       worth keeping should refresh itself and join this list. */
    const SELF_REFRESHING = ['/import', '/'];

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
      <ScrollToTop />
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

          <Suspense fallback={<RouteFallback />}>
          <Routes key={syncKey}>
            <Route path="/" element={<Discover />} />
            <Route path="/explore/:section" element={<ExploreList />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/year/:year" element={<YearInReview />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/game/:id" element={<GameDetail />} />
            <Route path="/library" element={<Navigate to="/library/backlog" replace />} />
            <Route path="/library/:status" element={<Library />} />
            <Route path="/import" element={<ImportWizardV2 />} />
            <Route path="/franchise/:franchiseId" element={<FranchisePage />} />
            <Route path="/collections" element={<Collections />} />
            {/* The hub page is gone: the sidebar submenu is the way in now, and
                each taxonomy has its own index. The bare path stays so old links
                and bookmarks land somewhere real. */}
            <Route path="/browse" element={<Navigate to="/browse/genres" replace />} />
            <Route path="/browse/:taxonomy" element={<TaxonomyIndex />} />
            <Route path="/collection/:id" element={<CollectionDetail />} />
            <Route path="/collection/igdb/:id" element={<CollectionDetail />} />
            <Route path="/game/:id/collections" element={<GameCollections />} />
            <Route path="/platforms" element={<ManagePlatforms />} />
            <Route path="/events" element={<AllEvents />} />
            <Route path="/event/:id" element={<EventDetail />} />
            <Route path="/wallpapers" element={<Wallpapers />} />
            <Route path="/games/:type/:id" element={<CategoryPage />} />
            <Route path="/awards" element={<AwardsIndex />} />
            <Route path="/awards/:awardQid" element={<AwardCeremony />} />
            {/* Last, and it must stay last: a catch-all above any of these would swallow them. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;