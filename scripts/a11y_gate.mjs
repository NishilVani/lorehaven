#!/usr/bin/env node
/**
 * Live accessibility gate. Runs axe-core (WCAG 2.0/2.1/2.2 A+AA) plus a target-size
 * measurement across THREE shells, because each renders different chrome:
 *
 *   desktop 1280  — the left rail
 *   mobile  375   — the top bar, hamburger and drawer  (touch + isMobile)
 *   tauri   1280  — the custom title bar and window controls, gated on
 *                   window.__TAURI_INTERNALS__, which must be stubbed BEFORE load
 *
 * A desktop-only run once reported button-name=0 while mobile had 3 unnamed buttons
 * on every page — the gap was invisible precisely because the gate looked green.
 *
 * Each route is also re-checked with its first text input populated, since clear
 * buttons and result controls only exist in that state.
 *
 * Two things stop this from rubber-stamping a page it never actually saw:
 *   1. it waits for the interactive-element count to SETTLE rather than for a
 *      fixed duration, so async content is measured instead of missed;
 *   2. it asserts a per-route floor on that count, so a route that rendered
 *      nothing fails loudly instead of reporting CLEAN.
 * Both exist because a flat 4s wait let /game/1942 pass while 27 under-24px
 * award links were present in a real browser.
 *
 * Usage: node scripts/a11y_gate.mjs [route ...]      (default: a broad set)
 * Requires the dev server on :5173. Exits 1 on any violation.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AXE = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const BASE = process.env.A11Y_BASE || 'http://localhost:5173';
/* /game/:id needs a concrete id. The Witcher 3 is a stable IGDB entry with
   cover, artwork, videos, awards and every metadata row populated, so it
   exercises more of the detail page than a sparser game would. */
const GAME_ROUTE = '/game/1942';

/* /games/:type/:id and /explore/:section are whole route CLASSES that had no
   coverage at all — both are async grids, the same shape that hid 27 under-24px
   links on the game page. One representative of each. */
const CATEGORY_ROUTE = '/games/genre/12';   // Role-playing (RPG)
const EXPLORE_ROUTE = '/explore/trending';

/* The year the seeded library's completions fall in, so the route renders a
   populated year rather than "nothing finished". These must stay one constant:
   they were two, and the gate audited an empty year page for as long as the
   library it ran against was empty too. */
const SEED_YEAR = 2025;
const YEAR_ROUTE = `/profile/year/${SEED_YEAR}`;

/* A concrete event. /events was audited and /event/:id never was, which is the
   half with the game grid, the library crossover and the broadcast table on it.
   State of Play 2026-9-3 carries 34 games, so the route renders its populated
   shape rather than an empty slate. */
const EVENT_ROUTE = '/event/1170';

const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/', '/schedule', '/collections', '/awards', '/events', '/wallpapers',
  /* '/keywords' was here and is gone with the page. It had no <Route> left in
     App.jsx after the browse refactor gave each taxonomy its own index, so the
     gate was loading a URL that matched nothing, auditing an empty <main>, and
     reporting a COVERAGE failure against a floor calibrated at 297 elements
     when the page still existed. Its taxonomy lives at /browse/keywords now,
     which /browse already covers. */
  '/platforms', '/browse', '/library/backlog', '/import', '/feedback', '/profile', YEAR_ROUTE,
  GAME_ROUTE, CATEGORY_ROUTE, EXPLORE_ROUTE, EVENT_ROUTE,
];

/**
 * Minimum interactive elements a route must render before it is allowed to pass.
 *
 * A gate that measures an empty page reports CLEAN, which is worse than useless —
 * it certifies. `/game/1942` passed for exactly that reason: the awards table is
 * an async fetch that landed after the old flat 4s wait, so 27 under-24px links
 * were invisible to the gate while being plainly present in a real browser.
 *
 * Floors are set below the counts observed on a warm run, so they catch "nothing
 * rendered" without going brittle on content churn. The default covers the app
 * shell (rail + chrome), so any route that renders no content of its own fails.
 */
/* Calibrated against measured counts, not guessed. The first version of this map
   used 14 for most routes — BELOW the ~15 the app shell renders on its own — so
   those routes could render zero content and still pass.

   Re-measured with the seeded library above, which is what changed most of these.
   The previous table mixed two different worlds: /wallpapers was read at 187/27
   from a browser that HAD a library, while the gate itself ran with none and saw
   the empty print room, so that route failed its own floor by construction.
   /profile, /profile/year and /library/backlog were floored at their empty-library
   counts instead, which is the same mismatch resolved the other way — the floor
   was lowered until the empty state fit under it. Both are gone now: one library,
   seeded, and every floor read from it.

   One floor serves all three shells, so it is calibrated to the SMALLEST reading
   across them. Counts below are `[resting]` from the seeded run:

     route              1280    375    floor   why the floor sits there
     /                    95     95      40    stable feed
     /schedule           127     81      40    calendar size varies by month
     /collections        126     84      40    seeded shelves + discover strip
     /awards              58     58      30    committed seed, stable
     /events              18     18      17    ONE event on the calendar today;
                                               was 23 when floored at 21, which
                                               is what failed. The floor is the
                                               chrome that always renders (two
                                               tabs + search), so a genuinely
                                               empty Upcoming tab still passes
                                               and a blank page still fails.
     /event/1170          86     85      45    34 game cards + broadcast table
     /wallpapers         187    187      60    seeded and deterministic; the
                                               search-active pass filters to 107,
                                               so the floor must clear that too
     /platforms           27     27      22    was 26 — one platform's worth of
                                               margin, which is not margin
     /browse              38     38      30    23 genres, a fixed IGDB taxonomy.
                                               Was 60, set when /browse was a hub
                                               listing 52 links; it redirects to
                                               /browse/genres now
     /library/backlog     39     30      25    15 seeded games
     /import              21     21      21    static wizard, no churn to absorb
     /feedback            16     16      16    static, same
     /profile             42     42      32    seeded: charts, shelf legend, year
                                               navigation and the taste band, none
                                               of which the empty-library floor of
                                               21 ever reached
     /profile/year/2025   24     24      20    six seeded completions, all dated
     /game/1942          110    110      60
     /games/genre/12     175    175      40
     /explore/trending   112    112      40

   Floors sit below the smallest reading so API result-count variation cannot flake
   the gate, and above what the shell alone renders so an empty page still fails. */
const MIN_INTERACTIVE = {
  '/': 40,
  '/awards': 30,
  /* The tabs and the search field always render, whatever the calendar holds, so
     that is the honest floor. Measured 18 with one upcoming event; an empty
     Upcoming tab is a legitimate state and would sit just under it. */
  '/events': 17,
  '/collections': 40,
  '/schedule': 40,
  '/library/backlog': 25,
  '/wallpapers': 60,
  '/platforms': 22,
  '/browse': 30,
  '/feedback': 16,
  '/profile': 32,
  [YEAR_ROUTE]: 20,
  '/import': 21,
  [GAME_ROUTE]: 60,
  /* 34 game cards plus the shell and the broadcast table; measured below that. */
  [EVENT_ROUTE]: 45,
  [CATEGORY_ROUTE]: 40,
  [EXPLORE_ROUTE]: 40,
};
const MIN_INTERACTIVE_DEFAULT = 12;

/**
 * Settle budget. Deliberately not generous — a long budget hides slowness.
 *
 * This used to carry a 60s override for /awards, whose Wikidata aggregate took
 * 27.5s cold and left the route passing as an 18-element shell. The route now
 * first-paints from a committed seed in ~0.8s, so the override is gone and the
 * whole suite is faster for it. Restore a per-route map here only if some future
 * route genuinely cannot paint inside the default.
 */
const SETTLE_MS_DEFAULT = 25000;

/**
 * Routes whose content comes from a third party we do not control.
 *
 * If the upstream is down or throttling, the page correctly renders its error
 * state and the content floor becomes unmeetable through no fault of the code.
 * Failing there would train people to ignore the gate; passing silently is the
 * rubber stamp this whole change exists to remove. So the run says plainly which
 * routes it could NOT verify, and the summary carries that count separately.
 *
 * `signal` is the app's own documented failure copy.
 */
const UPSTREAM = {
  '/awards': { name: 'Wikidata SPARQL', signal: /Wikidata Unreachable/i },
};

/**
 * A library, seeded before the app boots.
 *
 * The gate used to run against an empty one, which quietly excused itself from a
 * large share of the app. /wallpapers derives every plate from the library, so it
 * rendered "The print room is bare" and failed a floor calibrated at 187 elements
 * — and the 40 unnamed 22x22 buttons that floor was written to catch existed only
 * in the state the gate never reached. /profile and /profile/year/:year carried
 * deliberately low floors and a comment listing what they therefore did NOT cover:
 * every chart, the year navigation, the shelf legend and the whole taste band.
 *
 * Lowering those floors to the empty-state counts would have made all of it pass
 * — and passing on a page with no content is the exact thing this file's header
 * calls worse than useless. So the fix is to give the gate a library rather than
 * to lower the bar to the one it had.
 *
 * Real IGDB ids, each verified to resolve with cover art, because a plate needs a
 * cover and a made-up id draws nothing. Six are Beaten WITH completion dates, so
 * the year route finally renders a populated year instead of "nothing finished".
 */
const SEED_LIBRARY = [
  { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Beaten', feel: 'Perfection', month: 1 },
  { id: 7346, name: 'The Legend of Zelda: Breath of the Wild', status: 'Beaten', feel: 'Perfection', month: 3 },
  { id: 11208, name: 'NieR: Automata', status: 'Beaten', feel: 'Go For It', month: 3 },
  { id: 19560, name: 'God of War', status: 'Beaten', feel: 'Go For It', month: 6 },
  { id: 17000, name: 'Stardew Valley', status: 'Beaten', feel: 'Timepass', month: 9 },
  { id: 9927, name: 'Persona 5', status: 'Beaten', feel: 'Go For It', month: 11 },
  { id: 119171, name: "Baldur's Gate III", status: 'Playing' },
  { id: 25076, name: 'Red Dead Redemption 2', status: 'Playing' },
  { id: 1877, name: 'Cyberpunk 2077', status: 'Backlog', priority: 'Next Up' },
  { id: 472, name: 'The Elder Scrolls V: Skyrim', status: 'Backlog', priority: 'Soon' },
  { id: 96437, name: 'Starfield', status: 'Backlog', priority: 'Someday' },
  { id: 26192, name: 'The Last of Us Part II', status: 'Wishlist' },
  { id: 1020, name: 'Grand Theft Auto V', status: 'Wishlist' },
  { id: 2903, name: 'Warframe', status: 'Dropped' },
  { id: 1905, name: 'Fortnite', status: 'Dropped' },
  /* Three titles from EVENT_ROUTE's slate, so /event/:id renders BOTH of its
     bands. Without an overlap the page only ever shows "What it showed", and the
     "From your shelves" band — the whole point of the redesign — would go
     unaudited on every run. */
  { id: 404709, name: 'Monster Hunter Wilds: Ascendance', status: 'Wishlist' },
  { id: 413275, name: 'Ghost of Yotei: Complete Edition', status: 'Backlog' },
  { id: 168667, name: "Marvel's Wolverine", status: 'Backlog', priority: 'Next Up' },
].map(({ month, ...g }, i) => ({
  ...g,
  is_custom: false,
  cover_width: 264,
  cover_height: 374,
  addedAt: Date.UTC(2024, 0, 1) + i * 86400000,
  /* Local midnight, the way the app stores a date picked off a calendar — the
     same reason tests/profile-stats.test.mjs does not use toISOString().slice(). */
  ...(month ? { dateCompleted: new Date(SEED_YEAR, month, 12).toISOString() } : {}),
}));

const INTERACTIVE_SEL = 'button,a[href],input,select,[role="button"],[role="link"]';

/**
 * Run a page call that a navigation may interrupt, and retry it once on the far
 * side of that navigation.
 *
 * The `search-active` pass types into the first text input on the route, and on
 * at least one route that commits a navigation. Every `page.evaluate` after it
 * then throws "Execution context was destroyed", which is an uncaught rejection
 * that takes the whole process down — the last run died partway through and the
 * tauri shell, a third of the coverage, never executed at all. A gate that can be
 * killed by the app behaving normally reports nothing rather than a failure, so
 * this has to be survivable rather than fatal.
 */
async function withNav(page, fn) {
  try { return await fn(); }
  catch (e) {
    if (!/Execution context was destroyed|frame was detached|Target closed/i.test(e?.message || '')) throw e;
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(600);
    return fn();
  }
}

/**
 * Wait until the route has BOTH reached its floor and stopped moving.
 *
 * Stability alone is not enough and that mistake is worth recording: a first
 * attempt returned as soon as the count held steady for a second, and it settled
 * /game/1942 at 16 elements — the "Not Found" shell — because the count is
 * perfectly quiet while a fetch is in flight. Given 12s the same page reaches 99.
 * Quiet is not the same as done, so the floor is the wait condition, not just the
 * assertion: keep polling until the content that must exist actually exists.
 */
async function settle(page, floor, { quietMs = 1000, timeoutMs = SETTLE_MS_DEFAULT, pollMs = 250 } = {}) {
  const started = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, INTERACTIVE_SEL)
      .catch(() => last);
    if (n !== last) { last = n; stableSince = Date.now(); }
    else if (n >= floor && Date.now() - stableSince >= quietMs) return { count: n, ok: true };
    await page.waitForTimeout(pollMs);
  }
  return { count: last, ok: false };
}

/* `chromeOnly` marks a shell that cannot load IGDB-backed content, so per-route
   content floors do not apply to it. In the tauri shell `services/igdb.js` routes
   every request through @tauri-apps/plugin-http, which needs a real Tauri IPC host;
   the stub below cannot service it, so game/award/event data never arrives. That
   shell exists to exercise the custom title bar and window controls, and it is now
   asserted against exactly that (CHROME_FLOOR + the window-control check) instead
   of being handed a content floor it can never meet. */
const SHELLS = [
  { name: 'desktop', viewport: { width: 1280, height: 900 }, tauri: false },
  { name: 'mobile', viewport: { width: 375, height: 812 }, tauri: false, touch: true },
  { name: 'tauri', viewport: { width: 1280, height: 900 }, tauri: true, chromeOnly: true },
];

const CHROME_FLOOR = 18;   // rail + title bar + window controls, no route content

const AXE_OPTS = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } };

const browser = await chromium.launch();
const failures = [];
const unverified = [];
let checks = 0;

/**
 * Confirm the dev server is actually up before trusting a shell's results.
 *
 * Three headless shells hammering Vite for a long run killed it mid-suite once,
 * and every route afterwards reported "0 interactive / 0 window controls" — 89
 * failures that were entirely an artifact of a dead server. Wrong findings cost
 * more than no findings, so a downed server aborts loudly instead of producing a
 * page of fiction.
 */
async function assertServerUp(stage) {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\nFATAL: dev server at ${BASE} is not responding ${stage} (${e.message}).`);
    console.error('Every result after this point would be an artifact of the dead server, not a finding.');
    await browser.close();
    process.exit(2);
  }
}

await assertServerUp('before the run');

for (const shell of SHELLS) {
  await assertServerUp(`before the ${shell.name} shell`);
  const ctx = await browser.newContext({
    viewport: shell.viewport,
    hasTouch: !!shell.touch,
    isMobile: !!shell.touch,
  });
  /* Before the app boots, same as the tauri stub below: the library is read on
     first render, so a page-level write would land after the pages that depend
     on it had already painted their empty states. */
  await ctx.addInitScript(([json, now]) => {
    localStorage.setItem('moctale_library', json);
    localStorage.setItem('moctale_library_mt', String(now));
  }, [JSON.stringify(SEED_LIBRARY), Date.now()]);

  /* Tauri chrome is gated on this global and must exist before the app boots.
     The stub has to satisfy @tauri-apps/api, not just the app's truthiness check:
     getCurrentWindow() reads `__TAURI_INTERNALS__.metadata.currentWindow.label`
     (window.js:85) and invoke() reads `.invoke` / `.transformCallback` (core.js).
     A bare `{__mock:true}` threw "Cannot read properties of undefined (reading
     'currentWindow')" during render, so the tauri shell rendered a BLANK PAGE and
     axe dutifully found nothing wrong with it — a third of every run was green
     because it was empty. Shape mirrors mockWindows() in @tauri-apps/api/mocks.js. */
  if (shell.tauri) {
    await ctx.addInitScript(() => {
      const callbacks = {};
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' },
        },
        invoke: () => Promise.resolve(null),
        transformCallback: (cb) => { const id = Math.random(); callbacks[id] = cb; return id; },
        unregisterCallback: (id) => { delete callbacks[id]; },
        convertFileSrc: (p) => p,
        plugins: {},
      };
    });
  }
  const page = await ctx.newPage();
  console.log(`\n=== ${shell.name} (${shell.viewport.width}px${shell.tauri ? ', tauri shell' : ''}) ===`);

  for (const route of ROUTES) {
    for (const state of ['resting', 'search-active']) {
      try { await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch { /* SPA keeps sockets open */ }
      const floor = shell.chromeOnly
        ? CHROME_FLOOR
        : (MIN_INTERACTIVE[route] ?? MIN_INTERACTIVE_DEFAULT);
      const settled = await settle(page, floor);

      /* Coverage assertion, checked once per route in the resting state. Without
         it a route that failed to load its content reports CLEAN and the gate
         becomes a rubber stamp. */
      if (state === 'resting') {
        if (!settled.ok) {
          const up = UPSTREAM[route];
          const upstreamDown = up && await page.evaluate(
            (src) => new RegExp(src, 'i').test(document.body.innerText), up.signal.source);
          if (upstreamDown) {
            unverified.push(`${shell.name} ${route} (${up.name} unavailable)`);
            console.log(`  ${route.padEnd(22)} UNVERIFIED — ${up.name} unavailable, content coverage not asserted`);
          } else {
            failures.push(`${shell.name} ${route} coverage :: only ${settled.count} interactive elements, expected >= ${floor}`);
            console.log(`  ${route.padEnd(22)} COVERAGE FAIL — ${settled.count} interactive, expected >= ${floor}`);
          }
        }
        /* The tauri shell's whole reason to exist. If the title bar is absent the
           shell booted as a plain web page and its pass means nothing. */
        if (shell.chromeOnly) {
          const controls = await page.evaluate(() => {
            const titles = [...document.querySelectorAll('button[title]')].map(b => b.getAttribute('title'));
            // Maximize is dynamic — 'Restore Down' once the window is maximized.
            return [['Minimize'], ['Maximize', 'Restore Down'], ['Close']]
              .filter(group => group.some(t => titles.includes(t))).length;
          });
          if (controls < 3) {
            failures.push(`${shell.name} ${route} coverage :: title-bar window controls missing (${controls}/3) — tauri chrome did not render`);
            console.log(`  ${route.padEnd(22)} TAURI CHROME FAIL — ${controls}/3 window controls`);
          }
        }
      }

      if (state === 'search-active') {
        const typed = await withNav(page, () => page.evaluate(() => {
          const i = [...document.querySelectorAll('input[type="text"],input:not([type])')].find(e => e.offsetParent);
          if (!i) return false;
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(i, 'a'); i.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }));
        if (!typed) continue;          // nothing to type into on this route
        await page.waitForTimeout(1200);
      }

      await withNav(page, () => page.evaluate(AXE));
      const res = await page.evaluate(async (opts) => {
        const out = await window.axe.run(document, opts);

        /* No WCAG 2.5.8 inline exemption here on purpose. Adding /game/:id surfaced
           16 under-24px inline metadata links, and the tempting fix was to teach this
           check the "target is in a sentence" exception. Padding the links instead
           (py-1 -my-1, which grows an inline hit box without moving the line box)
           cleared all of them, so the exemption bought nothing and the rule stays
           strict. Revisit only for a target that genuinely cannot be padded. */
        const small = [];
        for (const el of document.querySelectorAll('button,a[href],input,select,[role="button"],[role="link"]')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          // sr-only controls (skip link, visually-hidden file input) are 1x1 by the
          // standard clip technique and become usable on focus — not target-size defects.
          if (r.width <= 1 && r.height <= 1) continue;
          if (r.width < 24 || r.height < 24) {
            small.push(`${r.width.toFixed(0)}x${r.height.toFixed(0)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22)}"`);
          }
        }
        return {
          violations: out.violations.map(v => ({ id: v.id, n: v.nodes.length, sample: v.nodes[0]?.html.slice(0, 90).replace(/\s+/g, ' ') })),
          small: [...new Set(small)],
        };
      }, AXE_OPTS);

      checks++;
      const label = `${route} [${state}]`;
      if (res.violations.length === 0 && res.small.length === 0) {
        console.log(`  ${label.padEnd(34)} CLEAN  (${settled.count} interactive, floor ${floor})`);
      } else {
        console.log(`  ${label.padEnd(34)} ${res.violations.map(v => `${v.id}=${v.n}`).join(' ') || ''}`);
        for (const v of res.violations) {
          failures.push(`${shell.name} ${label} ${v.id} (${v.n}) :: ${v.sample}`);
          console.log(`      ${v.id}: ${v.sample}`);
        }
        for (const s of res.small) {
          failures.push(`${shell.name} ${label} target-size :: ${s}`);
          console.log(`      under-24px: ${s}`);
        }
      }
    }
  }
  await ctx.close();
}
await browser.close();

console.log(`\n${checks} checks across ${SHELLS.length} shells`);
/* Printed before the verdict, and never folded into it. "CLEAN" has to mean
   "I checked and it was clean", not "I could not check". */
if (unverified.length) {
  console.log(`${unverified.length} route/shell pair(s) UNVERIFIED — upstream unavailable, content not asserted:`);
  for (const u of unverified) console.log(`  - ${u}`);
}
if (failures.length === 0) {
  console.log(unverified.length ? 'a11y gate: CLEAN (with unverified routes above)' : 'a11y gate: CLEAN');
  process.exit(0);
}
console.error(`a11y gate: ${failures.length} failure(s)`);
process.exit(1);
