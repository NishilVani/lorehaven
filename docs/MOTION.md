# Motion

How LoreHaven moves, on the web, the desktop app and Android. The design is
`docs/superpowers/specs/2026-10-06-motion-design.md`; this page is the map of
what was built and how to check it.

One motion language for everyone, Cinematic, plus Reduced. Appearance > Motion
offers Match System (the default: Reduced when the device asks for it) and
Reduced. The choice is kept on the device, never synced.

## The idea

Art leads, words follow. A page change runs in three beats, and two pages of
content are never on screen at once:

| Beat | What | Timing |
|---|---|---|
| Clear | The old page fades and moves away | 160ms, ease-in |
| Carry | Shared art travels to its new place | 420ms, long decelerate, from 0 |
| Reveal | The new page fades in | 320ms, from 200ms (120ms sideways) |

Going deeper, content rises; going back, it settles from above and the art
flies home; between siblings (library shelves, browse tabs) it slides toward
the chosen tab while the tabs themselves hold still.

## What travels

| From | To |
|---|---|
| Any game card's poster (Explore, Library, lists, search suggestions) | The game page's framed poster, and home again on Back |
| Explore's featured artwork | The game page's hero |
| A franchise, collection, event or award name (tiles, rows, links on the game page) | That page's heading |
| A wallpaper tile | The viewer's plate, and back into the tile on close |
| The rail's active item, a library tab | Their new place (markers) |

## Where it lives

| Piece | File |
|---|---|
| Level and personality | `src/motion/motion.js` (`data-motion`, `data-personality` on `<html>`) |
| Classifying a navigation | `src/motion/classify.js` (pure, unit-tested) |
| The director | `src/motion/TransitionLocation.jsx` (View Transitions; holds the old location while it is captured; waits at most 300ms for a route chunk) |
| Shared art, Back memory, in-page swaps | `src/motion/shared.js` (`data-shared="kind:id"`, `data-shared-scope`, `sharedSwap`) |
| Preludes and titles | `src/motion/prelude.js` (what a card hands to the page it opens) |
| Route prefetch, skeleton fallback | `src/motion/routes.js`, `src/components/ui/RouteSkeleton.jsx` |
| Page choreography, tokens | `src/motion/motion.css` |
| Element motion | `src/motion/elements.css`, `src/motion/elements.js` (press, image fade) |
| Re-ordering lists | `src/motion/flip.js` (library sort/group/filter, search re-ranking) |
| Count-ups | `src/motion/CountUp.jsx` (Profile) |

Kept from before, because they are already designed for their element: the
wallpaper viewer's paging (`wp-enter-*`), Pick For Me's draw (`pick-*`, now with
a light haptic on landing), the profile charts' draw-ins (`draw-*`), the
hovered-title marquee, and the Android predictive back peek.

## Rules

- Only opacity, translate, scale and clip-path animate. Keyframes never move
  `transform` (Dialog drag, sheets and the library lift write it inline);
  entrances fill `backwards`.
- A view transition's update never waits on data (rendering is frozen while
  it does). Pages that get data mid-flight hold the swap until the art lands
  (`transitionSettled`).
- Names exist only while a transition runs, and only one shared pair at a
  time, so a duplicate can never abort one.
- The page content animates as the document's root snapshot, which is always
  exactly the viewport at its current scroll. Naming <main> captured the
  whole page; Firefox drew a 3,777px shelf squashed into one screen for the
  length of the transition, then snapped.
- Check Firefox in a visible window (`HEADED=1 node scripts/motion_video.mjs
  ... firefox`): headless Firefox records black frames even for transitions
  that render correctly.
- Nothing loops except progress and live indicators and the sheen on
  skeletons.

## Check it

- `node tests/motion.test.mjs` (in `npm test`).
- `node scripts/motion_probe.mjs` with the dev server running: the type and
  animating groups for card to game, Back, collection to page and shelf
  changes, and frame timings on a 4x-throttled phone. Judge the frame budget on
  a production build (`npm run build && npm run preview`, then pass its URL).
- `node scripts/motion_frames.mjs [url] [dir]`: mid-transition screenshots at
  quarter speed.

## On your devices

1. Tap a game card: old page clears, the poster flies, the game page builds
   around it. Back: the poster flies home into its card.
2. Explore's featured game: the artwork becomes the game page's banner.
3. Library: change shelf; the tabs stay put, the marker slides, the shelf
   slides. On a phone, drag the shelf sideways and let go.
4. Sort or group a shelf: cards glide to their new places.
5. Game page > Part of a franchise, or a collection tile: the name grows into
   the heading.
6. Wallpapers: tap a tile, close the viewer.
7. Open a menu, a dialog (Escape or tap outside to close), a toast.
8. Appearance > Motion > Reduced: everything becomes a quick cross-fade.
