# Game Page Platforms and Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the game page's "Available On" chips and "Where do you own it?" picker with brand-filled ownership pills and a combined, linkable "Stores and subscriptions" list.

**Architecture:** A measured brand palette (`BRAND_SWATCHES`) becomes the single source for every platform mark in the app. A pure service (`gameLinks.js`) turns IGDB `websites` and `external_games` plus the user's platforms into pills, rows and "other" entries; `PlatformSection.jsx` only renders that. External links go through one shared opener that works inside Tauri.

**Tech Stack:** React 19, Vite, Tailwind v4, lucide-react, plain-node `assert` unit tests, Playwright e2e.

## Global Constraints

- Work only in the worktree `E:\Moctale Games\moctale-games-platforms`, branch `feature/game-page-platforms`. Do not commit unless the user asks; the harness rule is "Commit or push only when the user asks."
- Zero emoji anywhere (UI, code, comments, docs). Icons are lucide components.
- Selected state = brand fill + solid white 1px border + "Yours" tag. The tag has no border: a solid block in the swatch's ink with the inverse ink as text. Colour is never the only carrier.
- Unselected = black ground, `border-white/15`, `text-white/60` label.
- Label on a fill uses the swatch `ink`: white where white passes 4.5:1, otherwise black. Every pair is tested.
- Store names must equal `DEFAULT_CUSTOM_PLATFORMS` in `src/services/db.js` exactly: `Steam`, `GOG`, `Epic Games Store`, `PlayStation Store`, `Microsoft Store`, `Nintendo eShop`, `App Store`, `Google Play Store`. Ownership is keyed on them.
- A store row is two sibling controls: a name button (`aria-pressed`, toggles ownership) and an arrow link (opens the store). Never nest them (DESIGN.md: Two Actions, Two Buttons).
- Subscriptions and stores without a link render as rows with no arrow.
- Keep the aria-label pattern `Mark <name> as yours` / `Unmark <name> as yours` and the `Linked <name>` / `Unlinked <name>` toasts: `tests/phase3-deep.spec.ts:492-512` depends on them.
- Targets: at least 24px on pointer devices, 44px on coarse pointers (`tap-block`).
- Labels use `lh-label` (11px). Secondary text on black uses `text-white/60`, never `/40`.
- Relative imports inside files a plain-node test loads (`gameLinks.js`, `platformLogoUtils.js`) carry the `.js` extension.

### Final brand palette (measured 2026-09-12, WCAG relative luminance)

| Key (logo file stem) | Fill | Ink | Ink on fill |
|---|---|---|---|
| steam | #171d25 | white | 16.95:1 |
| steamdeck | #1a9fff | black | 7.45:1 |
| gogdotcom | #1c0c24 | white | 18.63:1 |
| epicgames | #2a2a2a | white | 14.35:1 |
| ea | #ff4747 | black | 6.24:1 |
| ubisoft | #006ef5 | white | 4.62:1 |
| windows 11 | #0078d4 | white | 4.53:1 |
| apple (Mac) | #6f7679 | white | 4.62:1 |
| linux | #fcc624 | black | 13.24:1 |
| playstation, playstation2-5, playstationportable, playstationvita | #4073cf | white | 4.59:1 |
| xbox | #107c10 | white | 5.37:1 |
| nintendo-switch | #e60012 | white | 4.80:1 |
| appstore | #007aff | black | 5.23:1 |
| ios | #e5e5ea | black | 16.73:1 |
| applearcade | #fa243c | black | 5.38:1 |
| google-play | #08865e | white | 4.58:1 |
| meta | #0081fb | black | 5.53:1 |
| oculus | #262626 | white | 15.13:1 |
| stadia | #ff5c35 | black | 6.83:1 |
| itch (no logo file) | #d73a3f | white | 4.60:1 |

---

### Task 1: Brand swatches as the single palette

**Files:**
- Modify: `src/components/platforms/platformLogoUtils.js` (replace `getPlatformBrandColor` and its `BRAND_COLORS` map)
- Modify: `src/components/platforms/PlatformLogo.jsx` (fill and glyph ink from the swatch)
- Create: `tests/brand-palette.test.mjs`
- Modify: `package.json` (add `test:brands`, chain into `test`)

**Interfaces:**
- Produces: `BRAND_SWATCHES: Record<string, {fill: string, ink: '#ffffff'|'#000000'}>`, `FALLBACK_SWATCH`, `getBrandSwatch(keyOrUrl: string|null) => {fill, ink}`, `inverseInk(ink) => '#000000'|'#ffffff'`, `inkFilter(ink) => string` (CSS filter), `getPlatformBrandColor(filename) => string` (kept, returns fill).

- [ ] **Step 1: Write the failing test** `tests/brand-palette.test.mjs`

```js
/**
 * Every brand fill carries readable ink.
 *
 * The game page fills a platform, store or subscription you own with its brand
 * colour and sets the label and glyph in that swatch's ink. A fill added without
 * measuring would ship an unreadable label, so every pair is checked here.
 *
 * Run: node tests/brand-palette.test.mjs
 */
import assert from 'node:assert/strict';
import {
  BRAND_SWATCHES, FALLBACK_SWATCH, getBrandSwatch, getPlatformBrandColor, inverseInk, inkFilter,
} from '../src/components/platforms/platformLogoUtils.js';

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const [key, swatch] of Object.entries({ ...BRAND_SWATCHES, fallback: FALLBACK_SWATCH })) {
  assert.match(swatch.fill, /^#[0-9a-f]{6}$/, `${key}: fill is a lowercase 6-digit hex`);
  assert.ok(swatch.ink === '#ffffff' || swatch.ink === '#000000', `${key}: ink is white or black`);
  const ratio = contrast(swatch.ink, swatch.fill);
  assert.ok(ratio >= 4.5, `${key}: ink on fill is ${ratio.toFixed(2)}:1, needs 4.5:1`);
}

/* Black ink is the exception: it is used only where white fails. */
for (const [key, swatch] of Object.entries(BRAND_SWATCHES)) {
  if (swatch.ink === '#000000') {
    assert.ok(contrast('#ffffff', swatch.fill) < 4.5, `${key}: white passes on this fill, so ink should be white`);
  }
}

assert.equal(getBrandSwatch('/platform-icons/steam.svg'), BRAND_SWATCHES.steam, 'resolves a logo URL');
assert.equal(getBrandSwatch('/platform-icons/Windows 11.svg'), BRAND_SWATCHES['windows 11'], 'resolves a file name with a space');
assert.equal(getBrandSwatch('itch'), BRAND_SWATCHES.itch, 'resolves a bare key');
assert.equal(getBrandSwatch('/platform-icons/other/game-console.svg'), FALLBACK_SWATCH, 'unknown marks fall back');
assert.equal(getBrandSwatch(null), FALLBACK_SWATCH, 'no key falls back');
assert.equal(getPlatformBrandColor('xbox.svg'), '#107c10', 'getPlatformBrandColor still returns the fill');
assert.equal(inverseInk('#ffffff'), '#000000');
assert.equal(inverseInk('#000000'), '#ffffff');
assert.equal(inkFilter('#ffffff'), 'brightness(0) invert(1)');
assert.equal(inkFilter('#000000'), 'brightness(0)');

console.log(`brand-palette: ${Object.keys(BRAND_SWATCHES).length} swatches, every ink passes 4.5:1`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/brand-palette.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'BRAND_SWATCHES'`

- [ ] **Step 3: Replace `getPlatformBrandColor` in `platformLogoUtils.js`** (the whole function from `export function getPlatformBrandColor(filename) {` to the end of the file) with:

```js
/* Brand swatches: the colour of every platform, store and subscription mark, and
 * the fill a game page control takes once you own the game there.
 *
 * `fill` is the brand colour, chosen with the user on 2026-09-12 to stay
 * recognisable. `ink` is the label and glyph colour on that fill: white wherever
 * white reaches 4.5:1, black otherwise. tests/brand-palette.test.mjs measures
 * every pair, so a fill cannot land here with unreadable text on it.
 *
 * Keyed by logo file stem, lowercased, as getPlatformLogoUrl returns it. `itch`
 * has no logo file; the store row asks for it by name. */
const PLAYSTATION = { fill: '#4073cf', ink: '#ffffff' };
export const BRAND_SWATCHES = {
  steam: { fill: '#171d25', ink: '#ffffff' },
  steamdeck: { fill: '#1a9fff', ink: '#000000' },
  playstation: PLAYSTATION,
  playstation2: PLAYSTATION,
  playstation3: PLAYSTATION,
  playstation4: PLAYSTATION,
  playstation5: PLAYSTATION,
  playstationportable: PLAYSTATION,
  playstationvita: PLAYSTATION,
  xbox: { fill: '#107c10', ink: '#ffffff' },
  'nintendo-switch': { fill: '#e60012', ink: '#ffffff' },
  'windows 11': { fill: '#0078d4', ink: '#ffffff' },
  apple: { fill: '#6f7679', ink: '#ffffff' },
  applearcade: { fill: '#fa243c', ink: '#000000' },
  appstore: { fill: '#007aff', ink: '#000000' },
  'google-play': { fill: '#08865e', ink: '#ffffff' },
  ios: { fill: '#e5e5ea', ink: '#000000' },
  linux: { fill: '#fcc624', ink: '#000000' },
  meta: { fill: '#0081fb', ink: '#000000' },
  oculus: { fill: '#262626', ink: '#ffffff' },
  stadia: { fill: '#ff5c35', ink: '#000000' },
  epicgames: { fill: '#2a2a2a', ink: '#ffffff' },
  gogdotcom: { fill: '#1c0c24', ink: '#ffffff' },
  ubisoft: { fill: '#006ef5', ink: '#ffffff' },
  ea: { fill: '#ff4747', ink: '#000000' },
  itch: { fill: '#d73a3f', ink: '#ffffff' },
};

/* Unbranded marks: a colourless near-black with white ink. */
export const FALLBACK_SWATCH = { fill: '#18181b', ink: '#ffffff' };

/** A logo URL, file name or bare key -> its swatch. */
export function getBrandSwatch(keyOrUrl) {
  if (!keyOrUrl) return FALLBACK_SWATCH;
  const stem = String(keyOrUrl).split('/').pop().replace(/\.svg$/i, '').toLowerCase();
  return BRAND_SWATCHES[stem] || FALLBACK_SWATCH;
}

/** The other ink: text on a block painted in `ink`. */
export const inverseInk = (ink) => (ink === '#ffffff' ? '#000000' : '#ffffff');

/** The CSS filter that turns a logo SVG into the swatch's ink. */
export const inkFilter = (ink) => (ink === '#ffffff' ? 'brightness(0) invert(1)' : 'brightness(0)');

export function getPlatformBrandColor(filename) {
  return getBrandSwatch(filename).fill;
}
```

- [ ] **Step 4: Update `PlatformLogo.jsx`**

Change the import on line 1 to:

```js
import { getPlatformLogoUrl, getBrandSwatch, inkFilter } from './platformLogoUtils';
```

Replace the body of `PlatformLogo` from `const url = getPlatformLogoUrl(platform);` through the closing `);` of `logoContent` with:

```jsx
  const url = getPlatformLogoUrl(platform);
  if (!url) return null;

  const swatch = getBrandSwatch(url);
  const containerClass = className ? className : 'w-8 h-8 p-1.5';

  const logoContent = (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden ${containerClass}`}
      style={{
        backgroundColor: swatch.fill,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        ...style,
      }}
    >
      <img
        src={url}
        alt={platform.name || (typeof platform === 'string' ? platform : '')}
        className="w-full h-full object-contain block shrink-0"
        /* The glyph takes the swatch's ink: white on dark fills, black on light
           ones such as Linux yellow, where a white glyph would vanish. */
        style={{ filter: inkFilter(swatch.ink) }}
      />
    </div>
  );
```

- [ ] **Step 5: Add the npm script** in `package.json`: add `"test:brands": "node tests/brand-palette.test.mjs",` after `"test:platforms"`, and append ` && npm run test:brands` to the end of the `"test"` chain.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/brand-palette.test.mjs`
Expected: `brand-palette: 26 swatches, every ink passes 4.5:1`

### Task 2: One external-link opener that works in Tauri

**Files:**
- Create: `src/services/openExternal.js`
- Create: `src/components/ui/ExternalLink.jsx`
- Modify: `src/pages/wallpapers/Wallpapers.jsx:151-166` (remove local `openExternally`), `:241` (call site)
- Modify: `src/pages/events/EventDetail.jsx:281-288` and `:386-395` (two stream links)
- Modify: `src/pages/awards/AwardCeremony.jsx:36` (`Anchor` external branch)

**Interfaces:**
- Produces: `isTauri() => boolean`, `openExternal(url: string) => Promise<void>`, default export `ExternalLink({ href, onClick?, children, ...anchorProps })`.

- [ ] **Step 1: Create `src/services/openExternal.js`**

```js
/**
 * Hands a URL to the host OS: the Tauri shell plugin inside the app, a new tab
 * on the web.
 *
 * `window.open` and `target="_blank"` are not substitutes inside Tauri. The
 * webview has no popup handling, so on Android a plain external link silently
 * does nothing. The shell plugin is already allowed for `^https?://.+` in
 * src-tauri/capabilities/default.json.
 */
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export async function openExternal(url) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
```

- [ ] **Step 2: Create `src/components/ui/ExternalLink.jsx`**

```jsx
import { isTauri, openExternal } from '../../services/openExternal';

/* An ordinary link on the web, so middle-click, copy link and the status bar all
   behave. Inside Tauri the click goes to the shell plugin instead, because the
   webview ignores target="_blank". */
export default function ExternalLink({ href, onClick, children, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !isTauri()) return;
        e.preventDefault();
        openExternal(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 3: Wallpapers.jsx** — delete the JSDoc block and `async function openExternally(url) { ... }` (lines 151-166). Add `import { openExternal } from '../../services/openExternal';` with the other imports. Replace `await openExternally(url);` with `await openExternal(url);`.

- [ ] **Step 4: EventDetail.jsx** — add `import ExternalLink from '../../components/ui/ExternalLink';`. In both stream links replace the opening `<a` with `<ExternalLink`, delete the `target="_blank"` and `rel="noopener noreferrer"` lines, and replace the matching `</a>` with `</ExternalLink>`. Keep `href` and `className` as they are.

- [ ] **Step 5: AwardCeremony.jsx** — add `import ExternalLink from '../../components/ui/ExternalLink';` and replace line 36 with:

```jsx
  if (game.href) return <ExternalLink href={game.href} className={className} {...rest}>{children}</ExternalLink>;
```

- [ ] **Step 6: Verify**

Run: `npx eslint src/services/openExternal.js src/components/ui/ExternalLink.jsx src/pages/wallpapers/Wallpapers.jsx src/pages/events/EventDetail.jsx src/pages/awards/AwardCeremony.jsx`
Expected: no errors.
Run: `git grep -n 'target="_blank"' -- src`
Expected: only `src/components/ui/ExternalLink.jsx`.

### Task 3: Store links and the platforms area, as pure data

**Files:**
- Create: `src/services/gameLinks.js`
- Create: `tests/game-links.test.mjs`
- Modify: `package.json` (add `test:links`, chain into `test`)

**Interfaces:**
- Consumes: `FAMILY_BY_PLATFORM_ID`, `matchPlatformsForGame`, `normalizePlat`, `platKey` from `src/services/platformMatch.js`; `getShortPlatformName`, `getPlatformLogoUrl` from `platformLogoUtils.js`.
- Produces:
  - `STORE_DEFS: {key, name, family, brand, icon, webTypes: number[], sources: number[]}[]`
  - `buildStoreLinks(game) => {key, name, brand, iconUrl: string|null, url, covers: string[]}[]`
  - `buildPlatformArea(game, userPlatforms, selectedKeys: Set<string>) => { pills: Platform[], rows: Row[], others: Platform[] }` where `Row = {key, name, brand, iconUrl, url: string|null, covers: string[], platform}`

- [ ] **Step 1: Write the failing test** `tests/game-links.test.mjs`

```js
/**
 * Store links and the game page platforms area.
 *
 * Game shapes are trimmed from live IGDB responses read on 2026-09-12 through
 * the Lorehaven proxy.
 *
 * Run: node tests/game-links.test.mjs
 */
import assert from 'node:assert/strict';
import { buildStoreLinks, buildPlatformArea } from '../src/services/gameLinks.js';
import { normalizePlat, platKey } from '../src/services/platformMatch.js';

const witcher = {
  platforms: [
    { id: 169, name: 'Xbox Series X|S', abbreviation: 'Series X|S' },
    { id: 48, name: 'PlayStation 4', abbreviation: 'PS4' },
    { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
    { id: 167, name: 'PlayStation 5', abbreviation: 'PS5' },
    { id: 49, name: 'Xbox One', abbreviation: 'XONE' },
    { id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' },
  ],
  websites: [
    { type: 4, url: 'https://www.facebook.com/CDPROJEKTRED' },
    { type: 16, url: 'https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home' },
    { type: 22, url: 'https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD' },
    { type: 23, url: 'https://store.playstation.com/en-us/concept/204794' },
    { type: 24, url: 'https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/' },
    { type: 13, url: 'https://store.steampowered.com/app/292030' },
    { type: 17, url: 'https://www.gog.com/game/the_witcher_3_wild_hunt' },
    { type: 1, url: 'http://www.thewitcher.com' },
  ],
  external_games: [
    { external_game_source: 1, url: 'https://store.steampowered.com/app/292030' },
    { external_game_source: 20, url: 'https://amazon.com/dp/B07SH3D6HT' },
    { external_game_source: 3, url: 'https://www.giantbomb.com/games/3030-41484/' },
    { external_game_source: 5, url: 'https://www.gog.com/en/game/the_witcher_3_wild_hunt' },
  ],
};

/* ── buildStoreLinks ── */
const links = buildStoreLinks(witcher);
assert.deepEqual(links.map((l) => l.key), ['steam', 'gog', 'epic', 'playstation', 'xbox', 'nintendo'], 'every store, in store order, and nothing else');
assert.equal(links.find((l) => l.key === 'gog').url, 'https://www.gog.com/game/the_witcher_3_wild_hunt', 'websites wins over external_games');
assert.equal(links.find((l) => l.key === 'nintendo').url, 'https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/', 'eShop comes from websites; IGDB has no eShop source');
assert.ok(!links.some((l) => /amazon|giantbomb|facebook|thewitcher/.test(l.url)), 'no Amazon, GiantBomb, social or official-site links');
assert.deepEqual(links.find((l) => l.key === 'playstation').covers, ['PS4', 'PS5'], 'covers lists the family platforms the game is on');
assert.deepEqual(links.find((l) => l.key === 'xbox').covers, ['Series X|S', 'XONE']);
assert.deepEqual(links.find((l) => l.key === 'steam').covers, ['PC']);
assert.equal(links.find((l) => l.key === 'xbox').name, 'Microsoft Store', 'names match DEFAULT_CUSTOM_PLATFORMS');
assert.equal(links.find((l) => l.key === 'epic').name, 'Epic Games Store');
assert.equal(links.find((l) => l.key === 'steam').iconUrl, '/platform-icons/steam.svg');

/* The Last of Us Part II: PlayStation only; websites and external_games disagree on the URL. */
const tlou2 = {
  platforms: [{ id: 48, name: 'PlayStation 4', abbreviation: 'PS4' }],
  websites: [{ type: 23, url: 'https://store.playstation.com/en-us/product/UP9000-CUSA07820_00-THELASTOFUSPART2' }],
  external_games: [{ external_game_source: 36, url: 'https://store.playstation.com/en-us/concept/230079' }],
};
assert.deepEqual(buildStoreLinks(tlou2).map((l) => [l.key, l.url]), [['playstation', 'https://store.playstation.com/en-us/product/UP9000-CUSA07820_00-THELASTOFUSPART2']]);

/* Only http(s) links are links. */
assert.deepEqual(buildStoreLinks({ websites: [{ type: 13, url: 'javascript:alert(1)' }] }), [], 'a non-web URL is dropped');
assert.deepEqual(buildStoreLinks({}), [], 'a game with no link data has no stores');
assert.deepEqual(buildStoreLinks(null), []);

/* ── buildPlatformArea ── */
const steam = normalizePlat({ name: 'Steam', category: 'store', linkedIgdbId: 6 });
const psPlus = normalizePlat({ name: 'PlayStation Plus', category: 'subscription', linkedIgdbId: 167 });
const ubisoft = normalizePlat({ name: 'Ubisoft Connect', category: 'store', linkedIgdbId: 6 });
const ps5 = normalizePlat({ id: 167, name: 'PlayStation 5', abbreviation: 'PS5' });
const shelf = normalizePlat({ name: 'My Shelf', category: 'hardware' });
const users = [steam, psPlus, ubisoft, ps5, shelf];

const area = buildPlatformArea(witcher, users, new Set());
assert.deepEqual(area.pills.map((p) => p.name), witcher.platforms.map((p) => p.name), 'pills are the IGDB platforms, once each');
assert.deepEqual(area.rows.map((r) => r.name), [
  'Steam', 'GOG', 'Epic Games Store', 'PlayStation Store', 'Microsoft Store', 'Nintendo eShop',
  'Ubisoft Connect', 'PlayStation Plus',
], 'linked stores first, then your stores, then your subscriptions that fit');
assert.equal(platKey(area.rows[0].platform), platKey(steam), "a linked store reuses the user's own entry, so its key matches what is saved");
assert.equal(area.rows.find((r) => r.name === 'PlayStation Plus').url, null, 'a subscription has no link');
assert.equal(area.rows.find((r) => r.name === 'Ubisoft Connect').url, null, 'a fitting store IGDB does not link has no link');
assert.deepEqual(area.others.map((p) => p.name), ['My Shelf'], 'what fits nowhere is offered under other platforms');

/* Something you marked always shows, even where it does not fit the game. */
const zelda = { platforms: [{ id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' }] };
const marked = buildPlatformArea(zelda, users, new Set([platKey(ps5), platKey(ubisoft)]));
assert.ok(marked.pills.some((p) => p.name === 'PlayStation 5'), 'marked hardware IGDB does not list joins the pills');
assert.ok(marked.rows.some((r) => r.name === 'Ubisoft Connect'), 'a marked store that does not fit joins the rows');
assert.ok(!marked.others.some((p) => p.name === 'Ubisoft Connect' || p.name === 'PlayStation 5'), 'nothing appears twice');

/* A game with nothing at all. */
assert.deepEqual(buildPlatformArea({}, [], new Set()), { pills: [], rows: [], others: [] });

console.log('game-links: all checks passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/game-links.test.mjs`
Expected: FAIL with `Cannot find module ... src/services/gameLinks.js`

- [ ] **Step 3: Create `src/services/gameLinks.js`**

```js
/* Where a game can be bought, and what the game page's platforms area shows.
 *
 * IGDB carries store links in two places. `websites` has storefront URLs for
 * most stores, including the Nintendo eShop, which has no external game source
 * at all; `external_games` fills gaps. Both also carry noise nobody buys from:
 * dozens of Amazon listings per game, GiantBomb, Twitch, YouTube, social pages.
 * Only the stores below count.
 *
 * Store names match DEFAULT_CUSTOM_PLATFORMS in db.js exactly, because ownership
 * is keyed on the name: a row named "Epic Games" would never show the
 * "Epic Games Store" a user already marked.
 *
 * Pure on purpose, with .js extensions on its imports: tests/game-links.test.mjs
 * runs it under plain node.
 */
import { FAMILY_BY_PLATFORM_ID, matchPlatformsForGame, normalizePlat, platKey } from './platformMatch.js';
import { getPlatformLogoUrl, getShortPlatformName } from '../components/platforms/platformLogoUtils.js';

/* websites.type and external_game_source ids, read off live IGDB responses on
   2026-09-12. `brand` is the swatch key in BRAND_SWATCHES. */
export const STORE_DEFS = [
  { key: 'steam', name: 'Steam', family: 'pc', brand: 'steam', icon: 'steam.svg', webTypes: [13], sources: [1] },
  { key: 'gog', name: 'GOG', family: 'pc', brand: 'gogdotcom', icon: 'gogdotcom.svg', webTypes: [17], sources: [5] },
  { key: 'epic', name: 'Epic Games Store', family: 'pc', brand: 'epicgames', icon: 'epicgames.svg', webTypes: [16], sources: [26] },
  { key: 'itch', name: 'itch.io', family: 'pc', brand: 'itch', icon: null, webTypes: [15], sources: [30] },
  { key: 'playstation', name: 'PlayStation Store', family: 'playstation', brand: 'playstation', icon: 'playstation.svg', webTypes: [23], sources: [36] },
  { key: 'xbox', name: 'Microsoft Store', family: 'xbox', brand: 'xbox', icon: 'xbox.svg', webTypes: [22], sources: [11, 31] },
  { key: 'nintendo', name: 'Nintendo eShop', family: 'nintendo', brand: 'nintendo-switch', icon: 'nintendo-switch.svg', webTypes: [24], sources: [] },
  { key: 'appstore', name: 'App Store', family: 'ios', brand: 'appstore', icon: 'appstore.svg', webTypes: [10, 11], sources: [13] },
  { key: 'googleplay', name: 'Google Play Store', family: 'android', brand: 'google-play', icon: 'google-play.svg', webTypes: [12], sources: [15] },
];

/* The platform DEFAULT_CUSTOM_PLATFORMS links each family's store to. */
const LINKED_ID_BY_FAMILY = { pc: 6, playstation: 167, xbox: 169, nintendo: 130, ios: 39, android: 34 };

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/** A game -> the stores it can be bought from, each with one URL. */
export function buildStoreLinks(game) {
  const websites = game?.websites || [];
  const external = game?.external_games || [];
  const platforms = game?.platforms || [];
  const links = [];
  for (const def of STORE_DEFS) {
    const site = websites.find((w) => def.webTypes.includes(w.type) && isWebUrl(w.url));
    const ext = external.find((e) => def.sources.includes(e.external_game_source) && isWebUrl(e.url));
    const url = site?.url || ext?.url;
    if (!url) continue;
    links.push({
      key: def.key,
      name: def.name,
      brand: def.brand,
      iconUrl: def.icon ? `/platform-icons/${def.icon}` : null,
      url,
      covers: platforms.filter((p) => FAMILY_BY_PLATFORM_ID[p.id] === def.family).map((p) => getShortPlatformName(p)),
    });
  }
  return links;
}

const unlinkedRow = (platform) => {
  const iconUrl = getPlatformLogoUrl(platform);
  return { key: platKey(platform), name: platform.name, brand: iconUrl, iconUrl, url: null, covers: [], platform };
};

/**
 * Everything the platforms area shows, in order.
 *
 * pills   the platforms IGDB lists, then hardware you marked that IGDB does not.
 * rows    stores with a link for this game; then your stores and subscriptions
 *         that fit it; then any store or subscription you marked that neither
 *         covers. Only the first group has a url.
 * others  your remaining platforms, behind a disclosure, so a purchase IGDB
 *         knows nothing about can still be recorded.
 *
 * Every entry carries the platform object toggled into user_platforms. A linked
 * store reuses your own entry when you have one, so its key matches what is
 * already saved.
 */
export function buildPlatformArea(game, userPlatforms = [], selectedKeys = new Set()) {
  const users = (userPlatforms || []).map(normalizePlat);
  const shown = new Set();
  const take = (p) => { shown.add(platKey(p)); return p; };

  const pills = [];
  for (const raw of game?.platforms || []) {
    const p = normalizePlat(raw);
    if (!shown.has(platKey(p))) pills.push(take(p));
  }

  const rows = [];
  for (const link of buildStoreLinks(game)) {
    const def = STORE_DEFS.find((d) => d.key === link.key);
    const own = users.find((p) => p.category === 'store' && p.name.toLowerCase() === def.name.toLowerCase());
    const platform = own || normalizePlat({ name: def.name, category: 'store', linkedIgdbId: LINKED_ID_BY_FAMILY[def.family] ?? null });
    if (!shown.has(platKey(platform))) rows.push({ ...link, platform: take(platform) });
  }

  const { fitting, other } = matchPlatformsForGame(game, users);
  for (const p of fitting) {
    if (p.category !== 'hardware' && !shown.has(platKey(p))) rows.push(unlinkedRow(take(p)));
  }

  for (const p of users) {
    const k = platKey(p);
    if (!selectedKeys.has(k) || shown.has(k)) continue;
    if (p.category === 'hardware') pills.push(take(p));
    else rows.push(unlinkedRow(take(p)));
  }

  const others = [...fitting, ...other].filter((p) => !shown.has(platKey(p)));
  return { pills, rows, others };
}
```

- [ ] **Step 4: Add the npm script** in `package.json`: add `"test:links": "node tests/game-links.test.mjs",` after `"test:brands"`, and append ` && npm run test:links` to the `"test"` chain.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/game-links.test.mjs`
Expected: `game-links: all checks passed`

### Task 4: Fetch website links and render the new platforms area

**Files:**
- Modify: `src/services/igdb.js:307` (cache namespace) and `:315` (fields)
- Rewrite: `src/components/games/PlatformSection.jsx`

**Interfaces:**
- Consumes: `buildPlatformArea` (Task 3); `getBrandSwatch`, `inverseInk`, `inkFilter`, `getShortPlatformName`, `getPlatformLogoUrl` (Task 1); `ExternalLink` (Task 2); `PlatformLogo`.
- Produces: `PlatformSection({ game, userPlatforms, selectedKeys, onToggle })`, same props as today, so `GameDetail.jsx` needs no change.

- [ ] **Step 1: igdb.js** — change `withCache('gameById.v2', TTL.WEEK,` to `withCache('gameById.v3', TTL.WEEK,` and add a comment above it:

```js
/* v3: added websites.url and websites.type for the store links. A new namespace
   rather than a KV_CACHE_VERSION bump, so only game pages refetch, not every
   cached list. Without it a page cached before this change would show no store
   links for up to a week. */
```

In the fields string, replace `external_games.url; where id = ${id};` with `external_games.url, websites.url, websites.type; where id = ${id};`.

- [ ] **Step 2: Rewrite `src/components/games/PlatformSection.jsx`** with:

```jsx
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { PlatformLogo } from '../platforms/PlatformLogo';
import { getBrandSwatch, getPlatformLogoUrl, getShortPlatformName, inkFilter, inverseInk } from '../platforms/platformLogoUtils';
import { platKey } from '../../services/platformMatch';
import { buildPlatformArea } from '../../services/gameLinks';
import ExternalLink from '../ui/ExternalLink';

/* The platforms area of the game page: where the game runs, where it can be
 * bought, and where you own it.
 *
 * A control you own fills with its brand colour. The fill never carries that on
 * its own: Steam, GOG, Epic and Oculus sit within 1.5:1 of the black page, so an
 * owned control also takes a solid white border and the Yours tag. What goes
 * where is decided in services/gameLinks.js; this file only draws it. */

/* A solid block in the swatch's ink, not an outline: it reads on every fill. */
function YoursTag({ ink }) {
  return (
    <span
      className="lh-label shrink-0 px-1 py-0.5 pointer-events-none"
      style={{ backgroundColor: ink, color: inverseInk(ink) }}
    >
      Yours
    </span>
  );
}

function OwnershipPill({ plat, active, onToggle }) {
  const swatch = getBrandSwatch(getPlatformLogoUrl(plat));
  const name = getShortPlatformName(plat);
  return (
    <button
      type="button"
      onClick={() => onToggle(plat)}
      title={plat.name}
      aria-pressed={active}
      aria-label={`${active ? 'Unmark' : 'Mark'} ${name} as yours`}
      className={`tap-block flex items-center gap-1.5 border px-2 py-1.5 lh-label transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${active
        ? 'border-white'
        : 'border-white/15 text-white/60 hover:border-white hover:text-white'
        }`}
      style={active ? { backgroundColor: swatch.fill, color: swatch.ink } : undefined}
    >
      <PlatformLogo platform={plat} className="w-4 h-4 p-[2px]" disableTooltip />
      <span className="pointer-events-none">{name}</span>
      {active && <YoursTag ink={swatch.ink} />}
    </button>
  );
}

/* Two sibling controls in one outline: the name records ownership, the arrow
   opens the store. Never one inside the other (DESIGN.md: Two Actions, Two
   Buttons). */
function StoreRow({ row, active, onToggle }) {
  const swatch = getBrandSwatch(row.brand);
  return (
    <div
      className={`flex items-stretch border transition-colors ${active ? 'border-white' : 'border-white/15'}`}
      style={active ? { backgroundColor: swatch.fill, color: swatch.ink } : undefined}
    >
      <span aria-hidden="true" className="w-9 shrink-0 flex items-center justify-center" style={{ backgroundColor: swatch.fill }}>
        {row.iconUrl && (
          <img src={row.iconUrl} alt="" className="w-5 h-5 object-contain" style={{ filter: inkFilter(swatch.ink) }} />
        )}
      </span>
      <button
        type="button"
        onClick={() => onToggle(row.platform)}
        aria-pressed={active}
        aria-label={`${active ? 'Unmark' : 'Mark'} ${row.name} as yours`}
        className={`tap-block flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current ${active ? '' : 'text-white hover:bg-white/5'}`}
      >
        <span className="lh-label truncate">{row.name}</span>
        {active && <YoursTag ink={swatch.ink} />}
        {row.covers.length > 0 && (
          <span className={`ml-auto min-w-0 truncate text-xs ${active ? '' : 'text-white/60'}`}>{row.covers.join(', ')}</span>
        )}
      </button>
      {row.url && (
        <ExternalLink
          href={row.url}
          aria-label={`Open ${row.name} in a new tab`}
          className={`tap-block shrink-0 flex items-center justify-center min-w-11 px-3 border-l transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current ${active
            ? 'border-current hover:opacity-70'
            : 'border-white/15 text-white/60 hover:bg-white hover:text-black'
            }`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </ExternalLink>
      )}
    </div>
  );
}

export default function PlatformSection({ game, userPlatforms, selectedKeys, onToggle }) {
  const [showOther, setShowOther] = useState(false);
  /* The page mounts this twice (desktop aside and mobile strip, one hidden), so
     ids come from useId rather than a literal. */
  const otherId = useId();

  const { pills, rows, others } = useMemo(
    () => buildPlatformArea(game, userPlatforms, selectedKeys),
    [game, userPlatforms, selectedKeys]
  );

  const noIgdbPlatforms = !(game?.platforms?.length);
  const hasUserPlatforms = (userPlatforms || []).length > 0;

  /* About one IGDB game in six lists no platforms, and custom entries list none.
     The area still shows while there is anything of yours or IGDB's to offer. */
  if (pills.length === 0 && rows.length === 0 && others.length === 0 && noIgdbPlatforms) return null;

  const isOn = (p) => selectedKeys.has(platKey(p));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="lh-label text-white/60">Available On</div>
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <OwnershipPill key={platKey(p)} plat={p} active={isOn(p)} onToggle={onToggle} />
            ))}
          </div>
        )}
        {noIgdbPlatforms && <p className="lh-label lh-multiline text-white/60">IGDB lists no platforms for this game.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="lh-label text-white/60">Stores and subscriptions</div>
        {rows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <StoreRow key={row.key} row={row} active={isOn(row.platform)} onToggle={onToggle} />
            ))}
          </div>
        ) : (
          <p className="lh-label lh-multiline text-white/60">IGDB lists no stores for this game.</p>
        )}
        {!hasUserPlatforms && (
          <p className="lh-label lh-multiline text-white/60">
            <Link to="/platforms" className="underline py-2 -my-2 hover:text-white">Add your platforms</Link> to see your subscriptions here.
          </p>
        )}
      </div>

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            aria-expanded={showOther}
            aria-controls={showOther ? otherId : undefined}
            className="tap-block self-start lh-label px-2 py-1.5 border border-white/15 text-white/60 hover:border-white hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            {showOther ? 'Hide other platforms' : `Other platforms (${others.length})`}
          </button>
          {showOther && (
            <div id={otherId} className="flex flex-wrap gap-1.5">
              {others.map((p) => (
                <OwnershipPill key={platKey(p)} plat={p} active={isOn(p)} onToggle={onToggle} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx eslint src/components/games/PlatformSection.jsx src/services/gameLinks.js src/services/igdb.js && npm run build`
Expected: no lint errors; build succeeds.

### Task 5: Record the rule in DESIGN.md

**Files:**
- Modify: `DESIGN.md:187` and `DESIGN.md:284-294`

- [ ] **Step 1: Replace line 187** with:

```markdown
- **Platform Brand Marks and Fills**: A platform's, store's or subscription's own logo and brand colour, from `BRAND_SWATCHES` in `src/components/platforms/platformLogoUtils.js`. See The One Voice Rule below.
```

- [ ] **Step 2: Replace lines 284-294** (from "Platform marks are the newest" to "the ban on those is unchanged.") with:

```markdown
Platform marks are the newest of the four and the only one that is not the
app's own paint. `PlatformLogo` renders a platform in its own brand colour --
PlayStation blue, Xbox green, Switch red -- in the library's platform group
headings, in every platform filter menu, and in the game page's platforms area.
It earns the exception the same way cover art does: the colour *is* the identity,
and two white silhouettes at 16px are far harder to tell apart than two coloured
ones. A platform name always sits beside the mark, so the colour is never the
only carrier (1.4.1).

**The Brand Fill Rule.** On the game page, a platform pill or store row you own
fills with its brand colour. Each colour is a swatch in `BRAND_SWATCHES`: a
`fill` chosen to stay recognisable, and an `ink` for the label and glyph, white
wherever white reaches 4.5:1 on the fill and black otherwise.
`tests/brand-palette.test.mjs` measures every pair. Some fills sit within 1.5:1
of the black page (Steam, GOG, Epic, Oculus), so the fill never carries the
state alone: an owned control also takes a solid white border and a Yours tag,
a solid block in the swatch's ink.

This does not open the door further. A platform mark is licensed artwork
standing for a real product, exactly like a cover; it is not a decorative accent,
and the ban on those is unchanged. Brand fills appear only on a control that
records ownership.
```

### Task 6: Verify end to end

- [ ] **Step 1:** `npm run lint` — expected 0 errors.
- [ ] **Step 2:** `npm test` — expected every script passes, including `brand-palette` and `game-links`.
- [ ] **Step 3:** `npm run build` — expected success.
- [ ] **Step 4:** `npm run lint:emoji` and `npm run lint:label` — expected clean.
- [ ] **Step 5:** `npx playwright test tests/phase3-deep.spec.ts -g "platforms and collections" --project=chromium` — expected the two platform-chip cases pass.
- [ ] **Step 6: Render and look.** Start the worktree's dev server, open `/game/1942` (The Witcher 3) at desktop and at 375px. Screenshot the platforms area. Click "Mark PC as yours": the pill fills Windows blue with a white border and a Yours tag. Click the Steam row name: the row fills and shows Yours. Confirm the Steam arrow's `href` is `https://store.steampowered.com/app/292030`. Open `/game/119388` (Tears of the Kingdom) and confirm a single eShop row.
