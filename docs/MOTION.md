# Motion

How LoreHaven moves, on the web, the desktop app and Android. One system,
three levels, chosen per device under **Appearance > Motion**.

| Level | Who gets it | What moves |
|---|---|---|
| Match System (default) | Everyone | Standard, or Reduced when the device asks for reduced motion |
| Reduced | Chosen, or the system asks | Page changes cross-fade in 100ms. Nothing slides, scales or tilts. |
| Standard | Everyone else | Page transitions, cards that rise in, controls that press, the predictive back peek (menus keep their own entrance) |
| Expressive (experimental) | Chosen | Standard, plus: the card's cover flies to the game page, the game hero drifts with the scroll, sections rise as they scroll in, cards tilt toward the pointer or finger with a glare, a burst when a game is marked Beaten, haptic detents on snapping rows |

The choice is device-local (`localStorage['lorehaven_motion']`), never
synced: a desktop and a phone handle Expressive differently.

## Where it lives

| Piece | File | How |
|---|---|---|
| Tokens, keyframes, levels | `src/motion/motion.css` | Durations and curves from `tokens/motion.json`. Every keyframe moves `translate`, `scale` or `opacity`, never `transform`, so it cannot fight Dialog's drag-to-dismiss or the library's lift, which write `transform` inline. Entrances fill `backwards`, so nothing is held after they end. |
| Level, press, tilt, flight, burst, detents | `src/motion/motion.js` | One listener per event type on `document`. Per-frame work only on the one element under the finger or pointer. |
| Page transitions | `src/motion/TransitionLocation.jsx` | View Transitions API with the declarative router: holds the page on its old location while the browser captures it, then swaps inside `startViewTransition`. Only pathname changes transition; query changes (search, filters) apply at once. Only `<main>` animates; the rail and bars stay still. Back navigations run in the other direction. |
| Card entrance | `.lh-card-enter` on GameCard | First twelve in a container stagger 28ms apart; later ones (an appended page) arrive together. |
| Press feedback | `motion.js` | Web Animations on `scale`, sized so a wide row moves about as many pixels as an icon button. |
| Predictive back peek | `src/services/native/back.js`, `index.css` | Android. The top overlay follows the back gesture. |
| Haptics | `src/services/native/haptics.js` | Status changes, lift, shelf swipe, back closing an overlay, Beaten (success), and in Expressive, snap detents. |

## Rules it keeps

- Nothing runs while the user is not doing something: no idle loops, no
  scroll listeners doing layout, no animation on a timer.
- Standard is compositor-only (opacity, translate, scale). Expressive adds
  scroll-driven animations (also compositor-run where supported), a 3D
  transform on one card, and one short-lived canvas.
- The view transition's update never waits on anything. Rendering is frozen
  until it returns, so waiting there froze the screen. The cover flight is a
  FLIP animation that starts whenever the game page's cover arrives (within
  1.5s of the tap), not a view-transition morph.
- `<main>` carries its transition name only while a transition runs. A
  standing name would make it a stacking context and change how a page's own
  fixed layers stack against the rail.
- Under 500ms everywhere. System reduced motion turns off parallax, reveals
  and tilt even if Expressive was forced.

## Measured

`node scripts/motion_perf.mjs <url> <level>`: phone-sized Chromium, CPU throttled
4x, card tap to game page, dev build (2026-10-06):

| Level | Transition ready | Finished | Frame p50 / p95 | Frames over 50ms |
|---|---|---|---|---|
| Standard | 130ms | 462ms | 17 / 17ms | 2 |
| Expressive | 102ms | 437ms | 17 / 17ms | 2 |

The two long frames are the game page mounting; they are there in every
level, Reduced included. `scripts/motion_cover.mjs` checks the cover flight lands
(it did: cover in 710ms on a network fetch, 520ms flight).
`scripts/motion_frames.mjs` saves mid-motion screenshots for a look.

## Try it on a device

1. Appearance > Motion > Expressive.
2. Tap a game card: the cover should fly into place on the game page.
3. Scroll a game page: the banner drifts and zooms out, sections rise in.
4. Desktop: move the pointer over a card; it leans toward it with a glare.
   Phone: press and hold a card; it leans toward the finger.
5. Mark a game Beaten: a burst from the menu, and a firm buzz on Android.
6. Android: fling the media strip on a game page; it ticks as it settles.
7. If anything stutters, set Standard and note which step. Expressive is the
   one to judge per device before it is shipped anywhere by default.
