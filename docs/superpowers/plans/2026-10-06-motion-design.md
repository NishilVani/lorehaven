# Motion Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every animation in LoreHaven with the page- and element-level motion language in `docs/superpowers/specs/2026-10-06-motion-design.md`.

**Architecture:** A transition director runs every route change through the View Transitions API, classifies it (carry, sideways, deeper, back, carry-back), names exactly one shared-art pair, and lets CSS choreograph clear, carry and reveal from personality tokens. Pages render preludes from data the card hands over so shared art always has a landing spot. Route chunks are prefetched and fall back to page-shaped skeletons.

**Tech Stack:** React 19, react-router-dom 7 (declarative BrowserRouter), Tailwind v4, View Transitions API, Web Animations API, Tauri haptics plugin (Android).

## Global Constraints

- Animate only opacity, translate, scale, clip-path. Never animate `transform` in keyframes (Dialog, sheets and the library lift write it inline).
- No animation library. Director, preludes and choreography CSS add at most 12KB gzipped.
- Cinematic tokens: clear 160ms cubic-bezier(0.4,0,1,1); carry 420ms cubic-bezier(0.2,0,0,1); reveal 320ms cubic-bezier(0,0,0.2,1) delay 200ms (120ms sideways); stagger 40ms max 6; micro 120/220ms; overlay 280/180ms; travel 8/12/24px; overshoot 0.
- Never two pages of content visible at once.
- Reduced: one 120ms cross-fade for pages; overlays fade 150/100ms; no travel, no shimmer, no count-up.
- The view transition update never waits on data; at most 300ms on a route chunk.
- Zero emoji anywhere (CLAUDE.md gate). Haptics per spec 2.5.
- Frame p95 at or under 20ms during transitions on the throttled phone profile.

---

### Task 1: Transition classification and shared pairs (pure)

**Files:**
- Create: `src/motion/classify.js`
- Test: `tests/motion.test.mjs` (rewritten)

**Interfaces:**
- Produces: `classifyTransition({ from, to, navigationType, pair })` returns `'carry' | 'carry-back' | 'sideways' | 'deeper' | 'back'`; `siblingDirection(from, to)` returns `'left' | 'right' | null`; `SIBLING_GROUPS` (arrays of path patterns); `parseShared(value)` returns `{ kind, id } | null`; `sharedKey({kind,id})` returns `'kind:id'`; `migrateMotionChoice(v)` returns `'system' | 'reduced'`.

- [ ] Write tests: library shelf pairs are sideways with direction from `TABS` order (Playing, Backlog, Wishlist, Beaten, Dropped, Unreleased); browse taxonomies sideways; a pair on PUSH is carry, on POP carry-back; POP without pair is back; anything else deeper; same pathname returns null; `parseShared('poster:1942')`; `migrateMotionChoice('expressive') === 'system'`.
- [ ] Run `node tests/motion.test.mjs`, see it fail.
- [ ] Implement `classify.js`.
- [ ] Run, see it pass. Commit.

### Task 2: Engine: director, chrome names, tokens, prefetch, skeleton fallbacks

**Files:**
- Rewrite: `src/motion/TransitionLocation.jsx` (the director)
- Create: `src/motion/shared.js` (click capture, pair naming, back memory)
- Create: `src/motion/choreography.css` (tokens + view-transition rules)
- Create: `src/motion/routes.js` (lazy route registry with `preload`, idle prefetch, link-intent prefetch)
- Create: `src/components/ui/RouteSkeleton.jsx` (page-shaped fallbacks: `grid`, `detail`, `list`)
- Modify: `src/App.jsx` (use `routes.js` lazies, per-route skeleton fallback, remove `RouteFallback` text), `src/main.jsx` (import choreography.css, init), `src/components/layout/Navbar.jsx` (stable names `lh-rail`, `lh-topbar`, `lh-marker` on the active rail row)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `beginShared(el)` (called from the click capture), `nameTransition(type, dir)`; `<html data-vt>` and `data-vt-dir`; elements carrying `data-shared="kind:id"` participate; `data-vt-keep` on elements that must stay still (named per element id); `preloadRoute(pathname)`.

- [ ] Director: on pathname change, find the pair (`shared.js`), classify, set `data-vt`/`data-vt-dir`, name the source in the old DOM, start the transition; inside the update `flushSync`, then name the destination `[data-shared="<same key>"]` if present (else drop to deeper/back); await `preloadRoute` for at most 300ms before the flushSync when the chunk is not loaded.
- [ ] CSS: tokens on `:root`; `::view-transition-old(lh-page)` clear and `::view-transition-new(lh-page)` reveal per type and direction; `::view-transition-group(shared)` carry; chrome groups `animation: none`; reduced overrides.
- [ ] Unit-test the pure parts (already in Task 1); run lint, `npm test`, build; Playwright `tests/smoke.spec.ts`.
- [ ] Commit.

### Task 3: Card to game, back, and the game prelude

**Files:**
- Modify: `src/components/games/GameCard.jsx` (`data-shared="poster:<id>"` on the cover, navigate with `state.prelude`), `src/components/layout/SearchOverlay.jsx` (thumbnail `data-shared`, prelude state), `src/pages/discover/Discover.jsx` (hero art `data-shared="hero:<id>"`, cover `poster:<id>`, prelude), `src/pages/games/GameDetail.jsx` (prelude render while loading; `data-shared` on masthead cover and hero; reveal order)
- Create: `src/motion/prelude.js` (`preludeFromCard(game)`, `readPrelude(location, id)`)
- Test: `tests/motion.test.mjs` (prelude cases), new Playwright `tests/motion.spec.ts`

- [ ] Prelude render uses the same masthead geometry as the loaded page (hero stage present, cover pulled up), hero area a scaled cover wash at low opacity.
- [ ] Playwright: card click names `poster:<id>` on the destination during the transition and `ready` resolves; Back restores the card.
- [ ] Commit.

### Task 4: Library sideways, marker, in-shelf moves, swipe follow

**Files:**
- Modify: `src/pages/library/Library.jsx` (stable names on heading/controls/tab row; `lh-marker` on the active tab; grid `data-vt-content`; swipe drag follows the finger; FLIP on sort/group/filter), create `src/motion/flip.js` (`useFlip(containerRef, deps)`)

- [ ] Commit after Playwright sideways spec and existing library specs pass (except baseline failures N7, S2, S5).

### Task 5: Other pages and "Loading" titles

**Files:** `FranchisePage.jsx`, `CollectionDetail.jsx`, `CollectionTile.jsx`, `AllEvents.jsx`, `EventDetail.jsx`, `AwardsIndex.jsx`, `AwardCeremony.jsx`, `CategoryPage.jsx`, `TaxonomyIndex.jsx`, `GameDetail.jsx` (franchise link `franchise-title`), plus every page root that uses `animate-in fade-in` (remove: the director reveals pages).

- [ ] Shared kinds `franchise-title`, `mosaic`, `event-art`, `ceremony-title`; preludes for their titles; skeleton bars instead of the word "Loading".

### Task 6: Overlays and controls

**Files:** `Dialog.jsx`, `DropdownMenu.jsx`, `Toast.jsx`, `Tooltip.jsx`, `Navbar.jsx` (drawer), `SearchOverlay.jsx`, `DialGroup.jsx`, `SetWallpaperSheet.jsx`, `src/motion/press.js` (size-aware press), `src/motion/elements.css`.

- [ ] Dialog desktop rise/scale, sheet rise on phones with fling dismiss; menu clip unfold; toast rise/sink; tooltip delay; dial fill slide; press feedback; focus underline.

### Task 7: Content

**Files:** `src/motion/elements.css`, `Skeleton.jsx`, `PickNextDialog.jsx`, `MediaStrip.jsx` + media modal, `Wallpapers.jsx` (tile to viewer carry), `LibraryNumbers.jsx`, `YearInReview.jsx`, `Figure.jsx`, `Profile.jsx` (count-up once per session), `ApiErrorBanner.jsx`, `Schedule.jsx`.

### Task 8: Remove the old layer, settings, docs, measurement

**Files:** delete-by-replacement of `src/motion/motion.css` and `motion.js` contents (keep `motion.js` as the level module: `getMotionChoice`, `setMotionChoice`, `motionLevel`, `initMotion`), `src/index.css` (remove keyframes listed in spec 1.6), `AppearanceDialog.jsx` (Match System / Reduced), `docs/MOTION.md` rewrite, `scripts/motion_perf.mjs` (budget lines), `STATUS.md`.

- [ ] Gates: lint, `npm test`, build, emoji gate, Playwright smoke + phase3 + phase7 + search + motion on chromium and Mobile Chrome; perf script; Android emulator pass.
- [ ] Commit, push, update PR.
