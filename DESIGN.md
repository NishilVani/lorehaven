---
name: Lorehaven
description: Curated digital museum and high-end editorial archive for video games.
colors:
  pitch-black: "#000000"
  stark-white: "#ffffff"
  # Sheet surface: near-black, deliberately NOT pitch-black so a mobile bottom
  # sheet reads as a layer above the #000000 page. The only sanctioned
  # off-black; see "Elevation & Depth".
  sheet-surface: "rgba(8,8,8,0.97)"
  # Default body text is NOT stark white. --text is the resting colour; --text-h
  # is the promoted/heading colour. Missing from every earlier revision.
  text-resting: "#a3a3a3"
  text-heading: "#ffffff"
  border-muted: "rgba(255,255,255,0.15)"
  # The status ramp as it exists in the CSS token layer -- monochrome, for dense
  # list views. Distinct from the colored `status-*` set below; see "Colors".
  status-mono-playing: "#ffffff"
  status-mono-beaten: "#e5e5e5"
  status-mono-backlog: "#d4d4d4"
  status-mono-wishlist: "#a3a3a3"
  status-mono-dropped: "#757575"
  status-playing: "#34d399"
  status-backlog: "#60a5fa"
  status-wishlist: "#a78bfa"
  status-beaten: "#fcd34d"
  status-dropped: "#f87171"
  priority-next-up: "#84CC16"
  priority-soon: "#FB923C"
  priority-maybe: "#0EA5E9"
  priority-someday: "#94A3B8"
  feel-perfection: "#B048FF"
  feel-go-for-it: "#00d391"
  feel-timepass: "#fcb700"
  feel-skip: "#fe647e"
  # Perfection is the one feel whose text reads lighter than its dot.
  feel-perfection-text: "#e2b4ff"
  # Shown for an unrated / unprioritised item — deliberately colourless rather
  # than borrowing a real scale value.
  state-none: "rgba(255,255,255,0.3)"
  destructive: "#f87171"
  destructive-hover: "#ef4444"
  warning: "#fcd34d"
  # The two grey stops of the award-shine gradient. Raised from #808080/#707070,
  # which floored the label at 4.43:1 over artwork; these floor it at 7.46:1.
  shine-mid: "#b0b0b0"
  shine-dark: "#9a9a9a"
typography:
  # Full px ramp. Enumerated here (not only in prose) so the design-system detector
  # treats these as declared steps rather than drift. See "Label Size — One Step,
  # 11px" and "Title & Display Ramp" below for what each step is for.
  #
  # The title-* pairs are the two responsive steps of the shared <Heading>
  # primitive, not four independent sizes.
  scale:
    # label is the only small step the system actually uses: .lh-label renders every
    # label at 11px and, being unlayered, overrides any font-size utility next to it.
    # micro-dense/base/emphasis are NOT a ramp. Each survives at one or a few sites
    # that do not carry .lh-label (award-poster stickers, an event date, a status
    # badge, a chart tick) and none of them rendered in a 12-route sample. Kept
    # here because they are still reachable, not because they are steps to pick from.
    micro-dense: "8px"
    micro-base: "9px"
    micro-emphasis: "10px"
    label: "11px"
    body-sm: "13px"
    body-base: "15px"
    title-sm: "20px"
    title-sm-wide: "28px"
    title-base: "24px"
    title-base-wide: "36px"
    display-sm: "30px"
    display-base: "34px"
    # The sidebar wordmark is 32px Bytesized, not display-base. It is a brand
    # size set by the mark it stands beside, not a step on this ramp.
    brand-wordmark: "32px"
    display-lg: "64px"
    display-hero: "80px"
    # Base element defaults in src/index.css, separate from the <Heading>
    # component's title-* pairs. These are what a bare <h1>/<h2> renders at.
    heading-1: "56px"
    heading-1-compact: "32px"
    heading-2-compact: "22px"
  # Families, weights and tracking below are the COMPUTED values sampled from the
  # running app, not the intent. An earlier revision of this file claimed
  # system-ui / 900 / -0.04em for display and 700 / 0.15em for label; none of
  # those were what shipped, and an agent reading it would have generated the
  # wrong type. See ".lh-display", ".lh-label", ".lh-brand" in src/index.css.
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 4.5rem)"
    fontWeight: 700
    letterSpacing: "-0.02em"
    textTransform: "uppercase"
  body:
    fontFamily: "Space Grotesk, system-ui, Segoe UI, sans-serif"
    fontSize: "16px"
    lineHeight: "1.45"
    letterSpacing: "0.18px"
  label:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.18em"
    textTransform: "uppercase"
  label-accent:
    fontFamily: "Courbe Sans, Space Grotesk, system-ui, sans-serif"
    fontWeight: 500
    letterSpacing: "0.18em"
    textTransform: "uppercase"
  brand:
    fontFamily: "Bytesized, Space Grotesk, system-ui, sans-serif"
    fontWeight: 400
    # 0, not the -0.01em Bungee took. A pixel face's sidebearings are whole
    # pixels; tracking it by a fraction of an em pushes every glyph off grid.
    letterSpacing: "0"
    textTransform: "uppercase"
  brand-sub:
    fontFamily: "Press Start 2P, Space Grotesk, system-ui, sans-serif"
    fontSize: "8px"
    fontWeight: 400
    letterSpacing: "1px"
    textTransform: "uppercase"
  # Retained, not in use. Kicaps and then Bungee were the wordmark before
  # Bytesized, and Courbe Sans then Bungee Hairline were the tagline; Kicaps and
  # Courbe Sans still have an @font-face in
  # src/index.css. Declared here so the file describes what the codebase actually
  # contains -- an undeclared face in the CSS reads as drift, and this is a
  # deliberate keep. Do not reach for either without a decision to bring it back.
  brand-legacy:
    fontFamily: "Kicaps, Space Grotesk, system-ui, sans-serif"
    fontWeight: 400
    letterSpacing: "-0.01em"
    textTransform: "uppercase"
rounded:
  none: "0px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.stark-white}"
    textColor: "{colors.pitch-black}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.pitch-black}"
    textColor: "{colors.stark-white}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
---

# Design System: Lorehaven

## Overview

**Creative North Star: "The Curated Digital Museum"**

Lorehaven is not an "app"—it is a curated digital museum and high-end editorial magazine for video games. The design is raw, minimalist, handcrafted, and unapologetic. It prioritizes extreme negative space and structure over decoration.

The system relies on absolute monochrome palette fundamentals: pure pitch black background (`#000000`) and stark pure white typography (`#FFFFFF`). Pure game cover posters and media artwork act as the sole source of visual color on screen. UI elements recede into high-contrast architectural framing.

**Key Characteristics:**
- Absolute pitch-black and white monochrome baseline.
- Zero decorative UI colors, gradients, soft shadows, or glassmorphism.
- Raw, sharp geometry (`rounded-none` everywhere).
- Typography as architecture (heavy display weights, uppercase labels, wide tracking).
- Art-first visual hierarchy.

## Colors

The palette character is strictly monochrome, where game art provides all emotional visual color.

### Primary
- **Stark White** (`#FFFFFF`): Primary typography, active control highlights, and stark 1px structural borders.

### Neutral
- **Pitch Black** (`#000000`): Universal page surface, control background, and deep negative space.
- **Muted Border** (`rgba(255, 255, 255, 0.15)`): Structural container lines and table grid dividers.

### Sanctioned Exceptions
- **Status / Priority / Rating Scale**: Controlled semantic badges (Playing `#34d399`, Backlog `#60a5fa`, Wishlist `#a78bfa`, Beaten `#fcd34d`, Dropped `#f87171`, Perfection `#B048FF`).
- **Destructive Actions**: Subtle red highlight (`text-red-400/70 hover:bg-red-500 hover:text-black`) for library removal and deletion actions.
- **Platform Brand Marks and Fills**: A platform's, store's or subscription's own logo and brand colour, from `BRAND_SWATCHES` in `src/components/platforms/platformLogoUtils.js`. See The One Voice Rule below.

### The three coloured state scales

Status, priority and feel are the sanctioned exception to The One Voice Rule.
All three live in `src/index.css` and are read **only** through
`src/constants/stateColors.js`. Never inline one of these hexes: they were
previously object literals copied into ten (status), nine (priority) and three
(feel) files, and the copies had drifted apart.

| Scale | Tokens | Helpers |
| :--- | :--- | :--- |
| Status | `--status-solid-*` | `statusColor`, `statusBadge` |
| Priority | `--priority-*` | `priorityColor`, `priorityBadge`, `PRIORITY_MENU` |
| Feel | `--feel-*` | `feelColor`, `feelTextColor`, `feelBadge`, `FEEL_MENU` |

**Fill versus text.** Feel carries two values. The dot/fill uses the saturated
`--feel-perfection` (5.22:1 on black); text alongside it uses the lighter
`--feel-perfection-text` (12.21:1). The other three feels use one value for both.
Pick by what you are painting: GameCard's sticker fills with the saturated value,
CollectionCard sets actual text and wants the lighter one. Getting this backwards
washes the sticker out.

**Unknown values** resolve to `state-none`, a colourless grey. Do not fall back to
a real scale value — the old code read an unrecognised rating as Timepass amber.

### Two status treatments

Status has **two** palettes, for two densities, and both are live:

| Treatment | Values | Where | Source |
| :--- | :--- | :--- | :--- |
| **Solid** | Playing `#34d399`, Backlog `#60a5fa`, Wishlist `#a78bfa`, Beaten `#fcd34d`, Dropped `#f87171`, Unreleased `#22d3ee` | Anywhere a status is *named or chosen*: poster stickers, game-detail state rows, library tabs, and every status row in a dropdown menu — the sanctioned exception under The One Voice Rule | `--status-solid-*` in `src/index.css`, read only by `src/constants/stateColors.js` |
| **Monochrome** | Playing `#ffffff`, Beaten `#e5e5e5`, Backlog `#d4d4d4`, Wishlist `#a3a3a3`, Dropped `#757575` | Dot-and-text status *annotations* on cards in a dense grid, where the status is incidental to the item and the colour would compete with cover art | `--status-*` in `src/index.css` |

The split is by **role, not density**. It used to be phrased as a density rule
("dense list views take the grey ramp"), which was the wrong cut: the library
tabs and the status rows in the ⋯ menu are dense *and* are the primary way you
pick a status, so they were rendering colourless while the same status rendered
mint on the card two inches away. Ask instead: is this control *about* the
status, or does it merely *mention* one? Picking, filtering by, or moving to a
status takes the solid ramp. A badge annotating a card that is really about the
game keeps the grey ramp.

**The three shapes the solid ramp takes.** Reuse one of these rather than
inventing a fourth:

| Shape | Rest | Selected | Used by |
| :--- | :--- | :--- | :--- |
| **State row / cell** | 8px swatch in the status colour, label at `white/60` | Cell fills with the status colour, label and swatch flip to `#000` | `StateRow` and `StripCell` on game detail, library tabs |
| **Menu row** | Icon and left strip in the status colour, label stays `white/70` | Strip at full opacity | `DropdownMenu` via the `color` option field |
| **Sticker** | Dot and text both in the status colour | — | `statusBadge()` on cards |

Black-on-status measures 7.59:1 (Dropped) to 14.56:1 (Beaten), and each colour
is ≥7.5:1 against black — AAA in both directions, so a filled cell and a swatch
are both safe. The label always names the status, so **colour is never the only
carrier of meaning** (1.4.1).

**Never inline a status hex.** The solid values were a `STATUS_COLORS` object
literal copied into ten files, and the copies had drifted — three import-flow
files were missing `Unreleased`, so an unreleased game rendered colourless there
and violet everywhere else. The rating scale had drifted the same way inside
`Library.jsx`, where `#c084fc / #4ade80 / #fbbf24 / #f87171` sat in place of
`#B048FF / #00d391 / #fcb700 / #fe647e` — the same rating showed one colour in
the ⋯ menu and another on the card. Import `statusColor(status)`,
`statusBadge(status)`, `PRIORITY_MENU` or `FEEL_MENU` from
`src/constants/stateColors.js`; all return `var(--…)`, so the theme stays
switchable from the token layer.

**Colouring a menu row.** `DropdownMenu` options take an optional `color`. It
tints the icon and the left strip and deliberately **not** the label, so text
contrast is whatever the variant already guaranteed. Only rows that *are* a
state get one — `Transfer Data` and `Clear Priority` stay neutral, and
destructive rows keep `variant: 'danger'` so the danger role is never confused
with the Dropped status that shares its hex.

### Feedback roles

Separate from the state scales even where a hue repeats. `--destructive` shares a
hex with `--status-solid-dropped`, but one means "this control destroys data" and
the other means "you abandoned this game"; retokenising one must never move the
other. There are no Tailwind red utilities left in `src/` — `text-red-400` and
friends were the danger role in disguise.

| Token | Value | Measured | Use |
| :--- | :--- | :--- | :--- |
| `--destructive` | `#f87171` | 7.59:1 on `#000` | Label and border of any control that destroys data. |
| `--destructive-hover` | `#ef4444` | black label on it = 5.58:1 | The fill it inverts to. |
| `--destructive-border` | `rgba(248,113,113,0.65)` | **3.58:1** | Control edge. Written at 0.65, not the habitual 0.4 — 0.4 composites to `rgb(99,45,45)` = 1.95:1, under 1.4.11. |
| `--destructive-wash` | `rgba(248,113,113,0.1)` | 1.10:1 | Hover row tint only. Decorative; never carries meaning alone. |
| `--warning` | `#fcd34d` | 14.56:1 | A recoverable problem worth looking at. Import conflicts are the only current use. |
| `--warning-border` | `rgba(252,211,77,0.55)` | 4.63:1 | As above, raised from 0.4 (2.85:1) for the same reason. |

**The One Voice Rule.** UI chrome remains strictly black and white. Colour enters
from exactly four places and nowhere else: game poster and media art, the three
state scales, the feedback roles, and platform brand marks.

Platform marks are the newest of the four and the only one that is not the
app's own paint. `PlatformLogo` renders a platform in its own brand colour --
PlayStation blue, Xbox green, Switch red -- in the library's platform group
headings, in every platform filter menu, and in the game page's platforms area.
It earns the exception the same way cover art does: the colour *is* the identity,
and two white silhouettes at 16px are far harder to tell apart than two coloured
ones. A platform name always sits beside the mark, so the colour is never the
only carrier (1.4.1).

**The Brand Fill Rule.** Every platform, store and subscription is drawn by one
component, `PlatformPill`, on the game page, Manage Platforms and the import
wizard alike. A pill you own fills with its brand colour. Each colour is a
swatch in `BRAND_SWATCHES`: a `fill` chosen to stay recognisable, and an `ink`
for the label and glyph, white wherever white reaches 4.5:1 on the fill and
black otherwise. `tests/brand-palette.test.mjs` measures every pair. Some fills
sit within 1.5:1 of the black page (Steam, GOG, Epic, Oculus). An owned pill is
marked by that fill, with `aria-pressed` for assistive tech; a white border
appears only on hover, on owned and unowned pills alike. This is a deliberate
trade-off, chosen over a resting border or a mark: on those four near-black
brands an owned pill differs from an unowned one by little more than its fill,
so the state is subtle there. There is no separate owned mark; a check read as a
checkbox. The pill stays one line; text that does not fit ellipsises and scrolls
on hover. It carries no tooltip, because its name is already on it.

This does not open the door further. A platform mark is licensed artwork
standing for a real product, exactly like a cover; it is not a decorative accent,
and the ban on those is unchanged. Brand fills appear only on a control that
records ownership.

## Typography

**Display Font:** Space Grotesk (`.lh-display` — 700 weight, `-0.02em`, uppercase)
**Body Font:** Space Grotesk (root `16px/145%`, `0.18px` tracking; prose sets `text-[15px]`)
**Label Font:** Space Grotesk (`.lh-label` — 500 weight, `0.18em`, uppercase, 11px). Courbe Sans is **opt-in** via `.font-label` and reserved for special places.
**Brand Font:** Bytesized (`.lh-brand` — 400 weight, `0` tracking, uppercase). The LoreHaven wordmark and special moments only; never body or UI.
**Brand Sub Font:** Press Start 2P (`.lh-brand-sub` — 400 weight, 8px, `1px`, uppercase). The "A Game Index" tagline under the wordmark, and nothing else.

Both are single-weight pixel faces, so neither has a second cut to ask for and
neither requests a weight axis. Both are pinned to 400: a request for any other
weight against a single-weight face is answered by SYNTHESISING one, which smears
the glyphs.

**The Pixel Grid Rule.** A pixel face is drawn on a fixed cell, and it is only
crisp at sizes where one glyph pixel lands on a whole device pixel. Press Start 2P
is an 8x8 face, so it is set at **8px** — one glyph pixel to one device pixel. At
the 7px it was first drafted at, a glyph pixel measured 0.875px and every edge
softened. Bytesized at 32px runs a 4px cell, an exact 4x of the tagline's, which
is what makes the two faces read as one system rather than two pixel fonts that
happen to be adjacent. Do not set either face at a size off its cell, and do not
track them in `em`.

Bytesized's cap height is **16px at a 32px font size** — half an em, far shorter
than the ratio most faces carry. Measured, not assumed: the two-line wordmark
therefore stands only 34px of ink tall, which is what the sidebar lockup's mark
height is matched to.

**The tagline is not a `.lh-label`.** It cannot be: `.lh-label` sets
`font-size: 0.6875rem` unlayered, which beats every utility (see "Label Size"),
and the tagline needs 8px. It follows that section's own escape hatch — drop the
class and declare family, weight, tracking and size directly. `.lh-brand-sub` is
that declaration, and the only place in the app that takes it.

*The Hairline Ink Rule is retired.* It governed Bungee Hairline, whose thin
strokes laid down half the ink their contrast ratio implied and so needed
`text-white/90` to read at all. Press Start 2P is solid blocks; it needs no such
compensation and the tagline sits at the ordinary secondary value. The lesson the
rule taught still stands — check a face by rendering it, not by computing it —
but the compensation it mandated would now simply be a too-bright tagline.

Kicaps and Courbe Sans are no longer referenced by anything. Their `@font-face`
blocks and `--label` remain because a face the brand may still want should not be
deleted by a font swap, and an unused `@font-face` downloads nothing.

There is no separate heading family — display and body are the same typeface at
different weights and tracking. The mono stack (`--mono`) is declared but unused.

### Hierarchy
- **Display** (700 weight, `clamp(2.25rem, 6vw, 4.5rem)`, ~0.95 line-height, uppercase): Page primary title headers.
- **Headline** (700 weight, 20–24px, 1.2 line-height): Section headers and index categories.
- **Body** (400 weight, 16px root / 15px prose, 1.45 line-height, max 65–75ch): Overview paragraphs and review notes. Resting colour is `text-resting` (`#a3a3a3`), not stark white.
- **Label** (500 weight, 11px, `0.18em`, uppercase): Navigation links, table row headers, and metadata tags.
- **Brand** (400 weight, 34px, `-0.01em`, uppercase): Wordmark only.

> Every weight and tracking value above was sampled from the running app. The
> previous revision asserted 900 / `-0.04em` display and 700 / `0.15em` label
> against a `system-ui` stack — none of which shipped.

### Label Size — One Step, 11px

**Labels have exactly one size: 11px.** `.lh-label` sets `font-size: 0.6875rem` and nothing overrides it. There is no micro ramp.

A previous revision of this file documented a four-step 8/9/10/11px scale below the Label, with per-step usage counts, `text-[9px]` named "the workhorse" and `text-[8px]` named "the floor". None of it ever rendered. The utilities were written in the JSX and the ramp was written down, but the browser resolved every one of them to 11px, from the first commit that used them.

**Cause.** `.lh-label` is declared in `src/index.css` **outside every `@layer`** (`@layer base` closes just above it). Unlayered CSS beats anything inside a cascade layer, and Tailwind puts `text-[8px]`, `text-xs`, `lg:text-[11px]` and the rest into `@layer utilities`. Layer order is decided before specificity is even consulted, so the utility never had a chance — no `!important` fight, no specificity tie, just a rule that loses by construction. This is easy to miss because the CSS reads as if it should work and DevTools shows the utility present on the element, merely struck through.

**Measured, 2026-08-14, headless Chromium against the running app:**

| Class | Elements sampled | Utility honoured | Rendered sizes |
| :--- | ---: | ---: | :--- |
| `.lh-label` | 545 (with a size utility) / 457 (all) | 0 | 11px, every one |
| `.lh-display` | 144 | 144 | 14–60px, as declared |
| `.lh-brand` | 24 | 24 | 20px / 34px, as declared |

Twelve routes, viewports 414px and 1280px. Responsive variants lose too: at 1280px with `lg` active, `lh-label text-[9px] lg:text-[10px]` measured 11px, while the same pair without `lh-label` measured 10px. `.lh-display` and `.lh-brand` are also unlayered but set no `font-size`, so their paired utilities render normally — they are not affected.

**Resolution.** The 67 dead utilities were deleted rather than rescued. Wrapping `.lh-label` in a layer would have made the documented ramp switch on all at once and shrunk 545 elements to 8–10px in one step — and 8px on a 16px-wide card spine was never legible in the first place, at any contrast. The accidental 11px is the size the app has always shipped and the size it keeps. `scripts/lint_label_size.mjs` (`npm run lint:label`) fails the build if a font-size utility is written next to `.lh-label` again.

**If a label genuinely needs a different size,** drop `.lh-label` and set family, weight, tracking and size directly. Do not add `!` — that hides the layer problem instead of stating it.

**Contrast floor.** Still applies, and applies harder at a single small size than it did at an imagined ramp: 11px carries no WCAG size exemption, so 4.5:1 is required exactly as at 15px. On the `#000000` page `text-white/50` (5.32:1) is the dimmest permitted value and `text-white/60` (7.37:1) is preferred. Never stack an `opacity-*` utility on an already-alpha text colour — the two multiply. Guarded by `scripts/lint_contrast_tiers.mjs`. See `plan/a11y_audit_findings.md`.

**What survives below 11px.** A few sites set a small size *without* `.lh-label`, so they do render: `text-[10px]` at 17 sites (status badge on `GameCard`, event date on `EventCard`, transfer dialog rows, the medium award-poster sticker, the chart tick rows on the profile), and `text-[8px]` at 1 (the small award-poster sticker, `AwardCeremony.jsx:65`). These are conditional one-offs, not steps — none of them appeared in the 12-route sample at all. Treat a new sub-11px size as a defect to be argued for, not a step to be picked off a ramp.

The tagline is the one sub-11px size that *has* been argued for. `.lh-brand-sub` sets 8px because Press Start 2P is an 8x8 pixel face and only lands on whole device pixels there — the argument is in "The Pixel Grid Rule" above. It sets the size in CSS rather than as a utility, and drops `.lh-label` entirely, so `lint_label_size` has nothing to catch and the unlayered font-size never fights it.

`text-[9px]` no longer renders anywhere. Its one site was the keyword count in `Keywords.jsx`, and that page is gone — the browse refactor gave each taxonomy its own index and nothing routed to it afterwards. The only `text-[9px]` left in `src/` sits next to `.lh-label` on `GameDetail.jsx:837`, so it is one of the dead utilities described above and renders at 11px like the rest.

`text-[12px]` and `text-[14px]` are **not** steps. Their only sites were the legacy `GamePage.jsx` (`/game-v1`) and `_archive/GamePageV2.jsx` (`/game-v2`), both deleted along with their routes; between them they held every colour and font-size violation in the codebase. Nothing in `src/` sets either size today, and nothing should.

### Title & Display Ramp

Above `body-base` the ramp is deliberately sparse — the system's hierarchy comes from the jump between Display and the 11px Label (80px to 11px, a little over 7x), not from many intermediate steps.

| Step | px | Uses | Role |
| :--- | :--- | :--- | :--- |
| `body-sm` | 13 | 16 | Secondary body copy — helper text under a control, wizard prose, dense metadata rows. |
| `body-base` | 15 | 5 | Default reading size. |
| `title-sm` / `title-sm-wide` | 20 / 28 | 2 | The small `<Heading>` variant, one responsive pair (`text-[20px] lg:text-[28px]`). |
| `title-base` / `title-base-wide` | 24 / 36 | 3 | The default `<Heading>`, one responsive pair (`text-[24px] lg:text-[36px]`). This is the section-title size for most pages. |
| `display-sm` | 30 | 1 | AwardCeremony category winner. |
| `display-base` | 34 | 1 | The AwardCeremony category title. The navbar wordmark left this step on 2026-09-07 for 32px Bytesized — see "Brand Font". |
| `display-lg` | 64 | 1 | Ceiling of the AwardCeremony winner-title clamp. |
| `display-hero` | 80 | 1 | Top of the SearchOverlay input chain (`text-4xl sm:text-6xl md:text-[80px]`). |

**Bare element defaults.** `src/index.css` styles `h1` and `h2` directly inside
`@layer base`, which is a separate ramp from the `<Heading>` component's `title-*`
pairs — a page that writes `<h1>` with no size utility gets these:

> The layer matters. These rules used to sit unlayered, and unlayered CSS beats
> every layered rule regardless of specificity, so they overrode Tailwind's
> `@layer utilities` outright: `h1.text-sm` computed 56px and `p.mb-6` computed 0.
> Thirty-three heading size utilities and fifteen paragraph margins were dead
> code. **Never write a bare element rule outside `@layer base`** — it silently
> disables every utility for that element across the app.

| Element | Desktop | ≤1024px |
| :--- | :--- | :--- |
| `h1` | `heading-1` (56px), `-0.03em`, 0.95 line-height | `heading-1-compact` (32px) |
| `h2` | 28px (same value as `title-sm-wide`), `-0.01em` | `heading-2-compact` (22px) |

**Two fluid headings.** The ceremony page runs the only inline `clamp()` type in the app:

| Site | Clamp | Why |
| :--- | :--- | :--- |
| [AwardCeremony.jsx:325](src/pages/awards/AwardCeremony.jsx:325) | `clamp(36px, 6vw, 72px)` | The `display` token verbatim — the page `h1`. |
| [AwardCeremony.jsx:404](src/pages/awards/AwardCeremony.jsx:404) | `clamp(28px, 5vw, 64px)` | The Game-of-the-Year winner title. Starts a step lower and rises slower than the token because award-winner names are long and wrap badly at the token's floor. |

Icon sizes (lucide `size=` / `w-*` `h-*`) are a separate axis and are **not** part of this ramp — see `components/icon-system.md`.

**Adding a step.** Do not introduce a new px value without adding it here first. If the new size is within 2px of an existing step, use the existing step — the ramp is coarse on purpose, and a 13/14/15px cluster reads as drift, not hierarchy.

**The Architecture Rule.** Text elements serve as visual layout architecture. Headers carry their own weight without decorative icons or rounded badges.

## Logo mark

`LogoMark` (`src/components/ui/LogoMark.jsx`) — three cartridge spines on a
shelf, the third pulled out. From the "4c / The Shelf" variant of the LoreHaven
logo design project. It sits beside the wordmark in every lockup, the side rail
included; the wordmark itself stays type, set in Bytesized.

In the rail the mark **shares the wordmark's cap line and baseline**, and gets
there without an offset to maintain. `leading-[0.56]` makes the two-line wordmark
box 35.84px tall around 34px of ink, so the ink is inset 0.92px top and bottom; a
34px mark centred in that same box is inset by the identical 0.92px. `items-center`
therefore lands both edges at once — measured at 0.17px on each.

Sizing comes from the rail's 172px of inner width: mark 34, gap 8, and "Haven" —
the wider wordmark line — 78px of ink at 32px Bytesized. The mark stacked *above*
the wordmark until 2026-09-07, which cost 61px of rail before the first nav row;
the current lockup is 114.8px tall against that arrangement's 200.2px.

The mark is one path with `fill-rule="evenodd"`, so the label notches are holes
rather than black fills and the whole shape inherits `currentColor`. That is
what lets it invert: white on the app's black chrome, black on a white tile,
from the same file. Never give it a literal colour — size it with `w-*`/`h-*`
and let the text colour drive it.

Its `viewBox` is cropped to the artwork's bounds (`12 20 76 75`), not the
100x100 field it was drawn in, so it fills the box it is given. The padded
100x100 version lives at `public/lorehaven-mark.svg` for favicon and share-image
use, where the surrounding air is wanted.

## Layout

Desktop navigation relies on a stark vertical left-rail table of contents (`<VerticalIndexNav>`). Page content uses tight column alignment (`lg:grid-cols-[minmax(0,1fr)_340px]`), structured 1px table grids, generous section separation, and full-bleed hero media sections without soft vignette overlays.

### Target size

**24px is the floor, 44px is the touch floor.** WCAG 2.5.8 sets 24×24 for every
pointer; Apple and Android ask for 44. Both apply, and they apply to different
devices, so the system carries `.tap` and `.tap-block` in `src/index.css` and
gates them on `@media (pointer: coarse)`.

**The Input Device Rule.** Screen width is the wrong question. A 1280px laptop
can have a touchscreen and a tablet can carry a trackpad, so the media query asks
what is pointing, not how wide the viewport is. A pointer layout keeps its
editorial rhythm at 24px; only a touch device pays the extra height.

Use `.tap` on inline and inline-block controls — it also sets `inline-flex` and
`align-items: center`, because `min-height` alone does nothing to an inline link
and centring keeps the label optically where it was. Use `.tap-block` on controls
that are already block or flex and must keep their own `display`.

**Neither class is the whole answer.** Both live inside `@media (pointer: coarse)`
and do nothing at all on a mouse, where the 24px floor still applies. An 11px
label with `.tap` and no padding measures 11px on desktop and passes on a phone,
which is the most misleading way a target-size bug can present: the class reads as
if the target were handled. Pair it with real vertical padding — `py-2`, or
`py-2 -my-2` where the line box must not move. This was written down only after
the same slip shipped twice in one sitting, on a stream link and a cross-page
link, and was caught both times by `scripts/a11y_gate.mjs` rather than by review.

The 24px floor is not advisory: `scripts/a11y_gate.mjs` measures every control on
every audited route in three shells and fails the build on anything under it. A
baseline-aligned 11px label computes to 23px, which is the least visible way to
break this rule and the one that has actually shipped.

## Elevation & Depth

Lorehaven uses zero drop shadows (`shadow-none`). Elevation and separation are created entirely through high contrast and stark 1px borders (`border border-white/15` or solid `border-2 border-white`).

**The Flat-By-Default Rule.** Surfaces are completely flat at rest. Depth is expressed solely through sharp monochrome inversion (`bg-white text-black` on active selection or hover).

**The one sanctioned off-black.** Modal and drawer surfaces sit on `pitch-black` like everything else, with a single exception: the mobile bottom sheet uses `sheet-surface` (`rgba(8,8,8,0.97)`). (`--code-bg: #111111` also exists and is applied to `<code>` blocks in `src/index.css`; it predates this rule and is the one place a second off-black survives.) Because the sheet slides over a full-bleed `#000000` page with no shadow to separate it, an identical black would erase the boundary entirely. Three points of lightness plus the slight transparency is the least separation that still reads. Do not reach for this token elsewhere — anywhere a border can do the work, the border does the work.

## Shapes

All UI containers, chips, buttons, posters, and input fields use sharp 90-degree corners (`rounded-none`). Rounded borders (`rounded-lg`, `rounded-full`) are strictly forbidden.

## Components

### Destructive actions

Friction is **tiered to blast radius**, because friction on everything trains
people to click through it and then it protects nothing.

| Tier | Action | Friction |
| :--- | :--- | :--- |
| Trivial, re-doable | Clear rating, clear priority, clear platforms | None. |
| Scoped, lossy | Remove one game, delete one collection | `ConfirmDialog` naming the item and what is lost. |
| Total, irreversible | Clear the entire library | `ConfirmDialog` with `confirmPhrase` — the button stays inert until `CLEAR` is typed exactly. |

Three rules for any confirm:

- **Focus lands on Cancel**, never on the destructive button. A stray Enter as the dialog opens must not be the thing that confirms it.
- **Locked reads as unarmed, not disabled.** A greyed `opacity-40` label would sit at 1.95:1, and that label is what tells you what is about to be destroyed. It stays legible in neutral white and *gains* `--destructive` when the phrase matches; colour arriving is the signal.
- **Say what is lost, not just "are you sure".** "Its status, rating, priority, notes and completion date go with it. There is no undo."

`useConfirm()` makes this one line, so adding a confirm is cheaper than skipping one.

### Icons

**The One Family Rule.** Every icon in the app is lucide, drawn as an inline SVG
in `currentColor`. There is no second icon set and no icon font.

There was one until recently. `index.html` loaded the whole Material Symbols
Outlined webfont, and `DropdownMenu` accepted a string option icon that rendered
it as a glyph — five rows in the search overlay, against 29 files importing
lucide. Those five put a second family beside lucide SVGs in the same menu, at a
different stroke weight and optical size, and cost a webfont download on every
page load to do it. The font, the string branch and all five call sites are gone.

`DropdownMenu`'s `icon` option takes a component (`icon: BookmarkPlus`) or an
element (`icon: <PlatformGlyph platform={p} />`). The element form exists for an
icon that needs props bound per row; building a component inside a caller's
`.map()` creates a component during render, which this codebase's lint flags.

Platform marks are the one exception to the SVG-in-currentColor rule, and they
are not icons — see The One Voice Rule.

### Buttons
- **Shape:** Rectangular (`rounded-none`, `border border-white/15` or solid `border-2 border-white`).
- **Primary Action:** Black background, white text, inverting to white background and black text on hover (`hover:bg-white hover:text-black`).
- **Focus:** Sharp 1px white outline (`focus-visible:ring-1 focus-visible:ring-white`).

### Index & Metadata Tables
- **Style:** Multi-row grid separated by 1px subtle white dividers (`border-t border-white/10`).
- **Label:** Left-aligned uppercase muted label (`text-white/40`).
- **Value:** Right-aligned white text or underline links with hover inversion.

### Media Stage
- **Style:** 16:9 stage with 1px border (`border border-white/15 bg-neutral-900`).
- **Thumbnails:** Horizontal snap-scrolling strip with sharp white active border indicator.

### Figures — the stat cards on the profile

A label, a value at display size, and a 13px caption inside a 1px border. The
value carries the weight, so the value has to be true.

**The No-Zero Rule.** A figure with no basis renders an em dash, never a zero.
`0 h` and `0%` are arithmetic answers to a question nobody could yet ask, and at
72px they read as a verdict on the reader rather than an absence of data. The
dash stays at full white — it is the value slot, and greying it to `state-none`
would put the news that there is nothing to read at 2.4:1. The caption below does
the explaining and leads with what would fill the card.

The distinction is basis, not size. One finished game is a real 100%; zero
finished games is a dash. A thin sample is shown and marked thin — the taste
band's `MIN_SAMPLE` dots shrink to 9px at `0.55` opacity rather than disappear.

### Charts

Bars, dot stacks, verdict cells and shelf-proportion bars, all drawn in the three
sanctioned state scales and never in an invented palette. Every colour is
repeated in a `<Legend>` that names it, so nothing depends on seeing hue (1.4.1).

**The Change Form, Not Truth Rule.** When a chart cannot say something true at
its size, it changes form rather than keeping the form and dropping the truth.
The month row draws one dot per finished game while that is literally possible;
past the dot budget the whole row switches to proportional bars and the caption
switches with it. Capping the dots instead made April's 99 and June's nine draw
identically.

**Scroll-drawn, on a scroll timeline.** Charts animate themselves into existence
as they enter the viewport, via `animation-timeline` in `src/index.css`
(`.draw-bar`, `.draw-unroll`, `.draw-dot`, `.draw-cell`, `.draw-rise`). Each mark
moves the way its own construction implies: a bar grows out of the axis it is
measured from, a dot falls the last few pixels into its stack, a cell is dealt, a
poster rises into the row. Four constraints hold it inside the flat world:

- **`from`-only keyframes**, so the drawn state *is* the static page and there is
  no second source of truth for what a chart looks like.
- **Transform and opacity only.** No shadow, no blur, no colour shift.
- **`@supports (animation-timeline: view())`** guards the whole block. Firefox
  gets the static page, which is the page as it was; nothing here is load-bearing.
- **`prefers-reduced-motion: no-preference`** scopes it explicitly. The app's
  global reduced-motion rule clamps `animation-duration`, and a scroll-driven
  animation has no duration to clamp, so without this it would be the one thing
  on the page ignoring the preference.

Anchor every range to `cover`, never `entry`: an `entry` range is as long as the
subject's own height, so a 9px dot would draw over nine pixels of scroll and read
as already-drawn. A mark inside a horizontal scroller needs `.draw-scope` on an
ancestor outside it, because `view()` binds to the nearest scrollport and a
horizontal one never moves vertically.

### Cards that carry two actions

**The Two Actions, Two Buttons Rule.** A tile with a primary action and a
secondary one is never a `role="button"` wrapper with a real `<button>` inside
it. That nests one control in another — axe reports `nested-interactive`, 4.1.2
forbids it, and the inner control's role and pressed state stop being reliably
exposed. Make the wrapper presentational and give it two sibling buttons: one
absolutely positioned over the tile for the primary action, one layered above it
for the secondary.

The wallpaper plate is the reference implementation: a full-bleed button labelled
`Open <game> <type>` and a 24px `aria-pressed` checkbox at `z-10` labelled
`Select <game> <type>`. Enter and Space then come from the platform, which is why
the pattern needs no `onKeyDown` and no guard against the inner control's key
events bubbling into the outer one.

## Do's and Don'ts

### Do:
- **Do** maintain pure pitch-black (`#000000`) backgrounds and stark pure white (`#FFFFFF`) primary typography.
- **Do** enforce sharp 90-degree rectangular geometry (`rounded-none`) across all elements.
- **Do** allow cover art and media posters to serve as the sole source of color.
- **Do** use uppercase tracked typography (`lh-label`, `tracking-widest`) for navigation and table headers.
- **Do** render an em dash for a figure with no basis, and put the reason in the caption under it.
- **Do** give a tile with two actions two sibling buttons, never a role on the wrapper.

### Don't:
- **Don't** use soft UI rounded corners (`rounded-lg`, `rounded-full`, `rounded-2xl`).
- **Don't** use drop shadows (`shadow-md`, `shadow-xl`), glassmorphism, or background blur.
- **Don't** add decorative accent colors (amber, purple, blue) to general UI chrome.
- **Don't** print a computed zero where the input is missing rather than zero.
- **Don't** animate anything a scroll timeline drives without `@supports` and an explicit `prefers-reduced-motion: no-preference` scope; the global reduced-motion rule does not reach it.
- **Don't** wrap game grid items in padded card wrappers; let posters sit directly above stark typography.