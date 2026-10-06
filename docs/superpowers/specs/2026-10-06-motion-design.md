# Motion design: page and element choreography

Date: 2026-10-06. Status: approved in brainstorming, ready to plan.
Branch: `feature/motion` (stacked on `feature/android-tier1`).

## Goal

Replace every animation in LoreHaven, the original minimal layer and the
generic Standard/Expressive system alike, with one motion language designed
per page and per element. The headline is shared-element page transitions: a
game card's poster becomes the game page's poster while the old page clears
and the new one reveals, never overlapping. Also remove the "Loading..." text
pages show on a first visit.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What is replaced | Everything: the Standard/Expressive layer and all original animations (dialogs, menus, toasts, Pick For Me, chart draw-ins, wallpaper enters, skeleton pulse, fade-ins) |
| Levels | One motion language for everyone, plus Reduced |
| Character | Cinematic now. Springy and game-like may come later as alternative personalities, so all timing lives in swappable tokens |
| Data gap on the game page | Prelude layout: the card hands over what it knows, the page renders its final geometry on the first frame |
| Engine | View Transitions API with named shared elements |

## 1. Architecture

### 1.1 Transition director
Replaces `src/motion/TransitionLocation.jsx`. Every route change goes through
`document.startViewTransition`, holding the old location while the browser
captures it (the existing `UNSAFE_LocationContext` technique, kept).

Before starting, it classifies the change and writes `<html data-vt="type">`:

| Type | When |
|---|---|
| `carry` | A shared-element pair exists for this navigation |
| `sideways` | Sibling routes: `/library/:a` to `/library/:b`, browse taxonomies, award years, import steps |
| `deeper` | Any other PUSH or REPLACE |
| `back` | POP without a shared pair |
| `carry-back` | POP with a shared pair (art flies home) |

and `<html data-vt-dir="left|right">` for sideways (from the index of the
source and destination in their sibling list).

The update callback never waits on data. It may wait at most 300ms for a
route's code chunk (1.4), and nothing else.

### 1.2 Shared elements
Elements opt in with `data-shared="<kind>:<id>"`, for example
`data-shared="poster:1942"`. Kinds: `poster`, `hero`, `franchise-title`,
`mosaic`, `event-art`, `ceremony-title`, `wallpaper`, `media`.

On a click, the director finds the clicked element's `[data-shared]` (the
element itself or inside the clicked card) and records `{kind, id}`. When the
destination renders, the director names exactly two elements
`view-transition-name: shared` (source in the old snapshot, destination in
the new), and nothing else carries that name, so a duplicate can never abort
the transition. Names are set inline for the one transition and removed when
it finishes.

Back: the destination page remembers the pair it arrived by; on POP the
director looks for the matching `[data-shared]` in the restored page. If it is
in the viewport, the type is `carry-back`; otherwise `back`.

The stable chrome carries stable names so it never animates: `lh-rail`,
`lh-topbar`, and on library routes `lh-library-head` (heading, controls row,
tab row). The rail's and tabs' active marker carries `lh-marker` so it slides.

### 1.3 Preludes
A card navigates with `state.prelude = { id, name, cover, year, hero? }`
(only data the card already shows). The destination page renders a prelude
on its first frame from that state:

- Game page: the poster in its final spot (the same masthead geometry as the
  loaded page), the title and year set, the hero area filled with a wash of
  the poster (the cover image scaled up, very low opacity on the paper colour,
  no CSS blur). The loaded page replaces the prelude in place; its skeleton
  slots have the loaded sizes, so nothing shifts.
- Franchise, collection, event and award pages: the title (and art where the
  card had it) from the prelude, the body as a skeleton. This removes their
  "Loading" titles.
- Direct loads (a typed URL, a reload, a deep link) have no prelude: they show
  the page-shaped skeleton (1.4) and no carry.

### 1.4 No more "Loading..."
- `RouteFallback` text is removed. Each lazy route gets a page-shaped skeleton
  fallback (a heading bar plus the page's body shape: grid, list or detail).
- Route chunks are prefetched: all of them during browser idle time after the
  first page has painted (`requestIdleCallback`, falling back to a 2s
  timeout), and a specific one on `pointerdown` or `pointerenter` of a link
  that targets it.
- If a transition starts before its chunk has loaded, the update callback
  awaits the chunk for at most 300ms, then renders the skeleton fallback.
- Pages that put "Loading" in their own heading show a skeleton bar instead.

### 1.5 Personality tokens
All timing is CSS custom properties on `:root[data-personality="cinematic"]`
(the only personality for now), read by both CSS and the few WAAPI calls via
`getComputedStyle`. A later personality is a new token set, not new
choreography.

### 1.6 Removed
`src/motion/motion.css` and `motion.js` from the first motion pass (Standard,
Expressive, tilt, burst, parallax, section reveals, snap detents, cover FLIP),
and from `src/index.css`: `dialog-in`, `fade-in`, `fade-in-up`,
`slide-in-right`, `drag-toast-in/out`, `toast-circle-progress`, the
`pick-*` keyframes, `wp-enter-*`, `skeleton-pulse`, `tooltip-fade-in`, the
`draw-*` chart keyframes, the predictive back peek block, and the inline
`dm-enter-up/down` menu animation. Each is replaced per section 4. The
marquee on hovered titles stays.

## 2. Motion language (Cinematic)

### 2.1 The three beats
Art leads, words follow. Never two pages of content on screen at once.

1. Clear: outgoing content fades and moves 8px away from the direction of
   travel. 160ms, ease-in.
2. Carry: the shared art travels to its new place. 420ms, long decelerate.
   Starts with Clear.
3. Reveal: incoming content fades in from 12px, starting at 200ms (after
   Clear has ended). Sections stagger 40ms top to bottom, on-screen only,
   at most 6 steps. Settled at about 520ms.

Without shared art, Carry is skipped: about 360ms total. Sideways uses a
120ms gap instead of 200ms.

### 2.2 Direction
- Deeper: old content moves up 8px as it clears; new content rises into
  place from 12px below.
- Back: old content moves down 8px as it clears; new content settles from
  12px above; art flies home.
- Sideways: content moves 24px horizontally toward the chosen sibling; the
  heading stays.

### 2.3 Tokens

| Token | Cinematic value |
|---|---|
| `--m-clear` | 160ms, cubic-bezier(0.4, 0, 1, 1) |
| `--m-carry` | 420ms, cubic-bezier(0.2, 0, 0, 1) |
| `--m-reveal` | 320ms, cubic-bezier(0, 0, 0.2, 1), delay 200ms (120ms sideways) |
| `--m-stagger` | 40ms, max 6 steps |
| `--m-micro-in` / `--m-micro-out` | 120ms / 220ms |
| `--m-overlay-in` / `--m-overlay-out` | 280ms / 180ms |
| `--m-travel-out` / `--m-travel-in` / `--m-travel-side` | 8px / 12px / 24px |
| `--m-overshoot` | 0 (exists for later personalities) |

### 2.4 Restraint
- Nothing loops or moves on its own except progress indicators and the
  hovered-title marquee.
- Scrolling never triggers animation.
- Only opacity, translate, scale and clip-path animate.
- Lists longer than 12 items reveal as one block.

### 2.5 Haptics (Android)

| Interaction | Haptic |
|---|---|
| Tab, shelf, dial change | select (tick) |
| Shared art lands after a card tap | light |
| Sheet dismissed by fling | light |
| Pick For Me lands | light |
| Lift a card | lift (firm) |
| Add a game, mark Beaten | success |
| Remove a game | warning |
| Plain navigation, menu open | none |

## 3. Page map

Chrome: the rail and top bar never animate; their active marker slides
(280ms) to the new item.

### 3.1 Shared-art pairs

| From | Kind | To |
|---|---|---|
| Any game card: Explore rows, Library grid, Explore lists, Category, Franchise, Collection, Related rows, Schedule, Year in Review | `poster` | Game page poster |
| Search result row thumbnail | `poster` | Game page poster |
| Explore featured hero artwork | `hero` | Game page hero |
| Game page "Appears In" franchise | `franchise-title` | Franchise page title (text morph) |
| Collection card | `mosaic` | Collection page header mosaic |
| Event card | `event-art` | Event page hero |
| Award ceremony tile | `ceremony-title` | Ceremony page title |
| Wallpaper tile | `wallpaper` | Viewer plate (in page, not a route) |
| Media strip thumbnail | `media` | Lightbox image (in page) |
| Game page poster on Back | `poster` | Its card, if on screen |

### 3.2 Per page
- Explore: first visit reveals sections top to bottom; rows reveal as blocks.
  Returning from a game, the poster flies home and the rest reveals around it.
- Game page: poster lands; the hero cross-dissolves from the poster wash to
  the artwork when it loads (400ms); title and meta reveal; the tracker bar
  rises from the bottom edge; Lead, Media, Details, Related reveal in order.
  Data arriving after the prelude fades into its skeleton slot.
- Library: shelf changes are sideways (detail in 3.3). A card moved to another
  shelf leaves toward that shelf's tab, then the grid closes the gap (280ms).
  Lift and drag follow the finger with the lift haptic.
- Search overlay: drops from the search icon (input slides down, results
  reveal). Typing re-orders results by moving rows (FLIP), never blinking.
  Close reverses.
- Franchise, Collection, Category, Browse: title or art lands, the grid
  reveals as a block. Taxonomy tabs and Browse genres are sideways.
- Schedule: month groups reveal; Load More appends rows rising together.
- Profile, Year in Review: figures count up once (numbers only, 600ms); charts
  grow from their baseline after the figures (bars rise, timelines unroll).
  No replay within a session.
- Wallpapers: a tile expands into the viewer (carry); swiping pages on a track
  following the finger; closing flies the plate back to its tile.
- Awards, Events: year strip is sideways; a ceremony title morphs from its
  tile.
- Import, Platforms, Feedback: plain clear and reveal; import steps sideways.
- Not Found and errors: plain clear and reveal.

### 3.3 Library shelves in detail
- Still: the "Library" heading, controls row and tab row (stable names).
- Order: the tab marker carries to the new shelf (280ms; on phones the strip's
  name and count cross-fade and its colour bar slides); the old grid clears
  24px away from the chosen tab as one block (160ms); the new grid reveals
  from 24px on the chosen side (320ms from 120ms); a select haptic when the
  marker lands.
- Phone swipe: the grid follows the finger with resistance past 40% of the
  width, previewing the next shelf's name in the strip. Released past the
  threshold, the transition starts from the dragged position (the old snapshot
  captures it) and continues off; released before, it springs back (220ms).
- Within a shelf: sort and group changes move each card to its new slot via
  FLIP (280ms), group headers fading; filtered-out cards fade (160ms) and the
  rest close the gap.
- New shelf starts at the top; the scroll jump is hidden under Clear. An empty
  shelf's plate is what reveals. A tap mid-transition skips the running one to
  its end and starts the next. Reduced: 120ms cross-fade, marker jumps.

## 4. Elements

### 4.1 Overlays
- Dialog (desktop, centred): backdrop fades 280ms; panel rises 12px from scale
  0.98, 40ms after the backdrop. Close 180ms, panel sinks 8px. No blur.
- Sheet (phone dialogs, Wallpapers sheets, tracker menus): rises from the
  bottom edge 280ms; drag follows the finger; release past 30% or a fling
  carries it out at the fling velocity, otherwise it settles back (220ms);
  close slides down 180ms. Drag-to-dismiss keeps writing `transform` inline,
  so sheet keyframes use `translate`, never `transform`.
- Menu: unfolds from its anchored edge (clip-path reveal from the trigger
  side, 200ms), items fade in 20ms apart (max 6); close fades 120ms; a checked
  indicator slides between rows on change.
- Mobile drawer: slides from the left 300ms, backdrop fades, follows the
  finger when swiped shut; items reveal 30ms apart.
- Toast: rises 12px and fades in (240ms); countdown bar drains linearly;
  leaves fading and sinking (180ms); remaining toasts move to fill the gap;
  sideways swipe dismisses.
- Tooltip: 400ms hover delay (0 when moving from one tooltip to the next),
  fades in with 4px travel away from the anchor; out 100ms.

### 4.2 Controls
- Buttons and pressable rows: press sinks to a size-aware scale (target 0.97,
  at most about 6px of change) in 120ms; release eases back in 220ms. Hover is
  colour only (120ms).
- Game card: press as above; hover brightens the poster slightly and moves the
  frame border from 20% to 70% ink (200ms); the title marquee stays.
- Tabs, segmented controls, dial groups: the selected fill slides between
  options (280ms); labels cross-fade colour.
- Toggles and checkboxes: the tick draws its stroke (160ms).
- Inputs: the focus underline grows from the centre (200ms); search ghost
  text fades in (120ms).
- Status changes (tracker bar, rating, priority): the value cross-fades with
  8px vertical travel; a status chip's colour fills left to right (280ms);
  haptic per 2.5.

### 4.3 Content
- Images: fade from their skeleton fill (300ms) once decoded; cached images
  show at once.
- Skeletons: a slow, low-contrast shimmer replaces the pulse; content replaces
  a skeleton by Reveal, never a cut.
- Growing lists: appended items rise 12px together as one block.
- Pick For Me: candidate posters riffle (60ms each, slowing), the pick lands
  on the carry curve with a light haptic, its title and reasons reveal; Pick
  Again sends the card off sideways and riffles again.
- Media strip and lightbox: a thumbnail expands into the lightbox (carry);
  swipe pages on a finger-following track; close flies back to the thumbnail.
- Count-ups and charts: per 3.2.
- Banners (API error, updates): slide down from under the top bar (240ms),
  back up on dismiss.

## 5. Reduced motion, performance, testing

### 5.1 Reduced
Appearance > Motion: Match System (default) and Reduced. Stored values
`standard` and `expressive` from the first pass map to Match System.
- Pages: one 120ms cross-fade; art does not travel; sideways does not slide.
- Overlays: fade only (150ms in, 100ms out). Sheets still follow a dragging
  finger but do not fling.
- Controls: press is a colour change; fills jump; ticks appear.
- Content: images fade 120ms; no shimmer, no count-up, charts appear whole,
  Pick For Me shows the pick directly.
- Haptics unchanged.

### 5.2 Performance budget
- Frame p95 at or under 20ms during a transition on the throttled phone
  profile (412x915, 4x CPU); no more long frames than the page mount alone.
- Tap to visible motion at or under 100ms once the chunk is loaded; the 300ms
  chunk hold is the cap otherwise.
- Animate only opacity, translate, scale, clip-path. No blur, filter,
  box-shadow or layout animation; re-ordering uses FLIP.
- Director, preludes and choreography CSS: at most 12KB gzipped added. No
  animation library.
- Shared names live only for their transition; one view transition at a time.

### 5.3 Testing
- Unit (node): transition type from a route pair; shared-pair selection
  (missing destination, duplicate avoidance); prelude from a card; Motion
  choice migration.
- Playwright:
  - card to game: the destination poster is named during the transition and
    `ready` resolves without timeout;
  - back: the poster returns to its card;
  - library shelf change: `data-vt="sideways"` is set and old and new grids are
    never both visible in a sampled frame;
  - no route ever shows "Loading..." on a cold first visit;
  - reduced: every transition ends within 150ms;
  - existing suites stay green except the three phase7 tests failing on the
    baseline (N7, S2, S5).
- `scripts/motion_perf.mjs` covers card to game, back, shelf change, search
  open and dialog open, and reports each 5.2 line as pass or fail.
- Mid-transition frames at quarter speed for every pair in 3.1, reviewed
  before done.
- Android emulator: card to game, back, shelf swipe, a sheet fling, haptic
  calls observed.
- Owner device checklist in `docs/MOTION.md`.

## Build order
1. Engine: director, shared names, chunk prefetch, skeleton fallbacks,
   preludes.
2. Card to game and back.
3. Library and the other sideways transitions.
4. The remaining pages in 3.1 and 3.2.
5. Overlays and controls (section 4.1, 4.2).
6. Content (4.3).
7. Remove the old layer (1.6) and update `docs/MOTION.md`.

One commit per step; lint, `npm test`, build and the relevant Playwright
specs pass before the next step.

## Implementation notes (2026-10-06)

Where the build differs from the text above, and why:

- Shared kinds are `poster`, `hero`, `franchise-title`, `title`, `wallpaper`,
  `media`. One generic `title` kind (keyed from the destination path by
  `titleKeyFor`) replaces `mosaic`, `event-art` and `ceremony-title`: the
  collection and event pages have no header mosaic or hero to land on, so
  their names travel instead. Words use their own transition name
  (`shared-title`) so they scale rather than crop.
- Going back, the director waits up to 250ms for the art's home to render
  (pages like Explore fill their rows a few ticks after mounting); past that,
  the transition plays without the art flying home.
- Kept rather than redesigned: Pick For Me's draw (with the landing haptic
  added), the profile chart draw-ins (already grow from the baseline), the
  wallpaper viewer's paging and the predictive back peek.
- Dial groups cross-fade colour instead of sliding the fill: a clip-path wipe
  hid the label mid-way.
- Dialog exit animations play for the dialog's own close paths (Escape,
  backdrop, drag); a caller that unmounts a dialog closes it at once.
- Measured on a production build (`scripts/motion_probe.mjs`, 412x915, 4x
  CPU): transitions ready in 57 to 222ms and finished in 539 to 778ms; frame
  p95 17ms for every step except card to game, 17 to 33ms across runs, from
  the loaded game page replacing the prelude after landing.
