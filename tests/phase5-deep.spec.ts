/**
 * Deep QA — phase 5 of the qa/2026-09-05-deep run.
 * Routes under test: /schedule, /events, /event/:id, /awards, /awards/:awardQid,
 * plus the shared Firestore award_cache tier behind the two awards screens.
 *
 * Every test DRIVES a control and asserts the state it changed. A test that
 * only asserts a route renders belongs in tests/routes.spec.ts, not here.
 *
 * Cases marked `FINDING n` assert the WRONG behaviour on purpose, so the suite
 * stays green and the defect cannot be quietly lost between this run and the
 * fix phase. The numbers here are discovery order; qa/2026-09-05-deep/phase5.md
 * ranks by severity and carries the mapping table.
 *
 * DATA SAFETY. Two rules hold in every test in this file:
 *   1. `blockCloud()` aborts every request to *.googleapis.com, so the Firestore
 *      tier in src/services/wikidata/awards.js can neither read nor WRITE. The
 *      award_cache collection is world-writable (firestore.rules:46-50) and
 *      awards.js:283 calls fireSet() on any successful Wikidata fetch, so this
 *      is not optional hygiene — it is what keeps the run read-only.
 *   2. `blockWikidata()` aborts /wdqs/**. With no Wikidata answer, cached()
 *      never reaches the fireSet() line at all. Both awards screens still render
 *      in full because awards.js serves the shipped corpus
 *      (src/services/wikidata/awardsCorpus.json) as `baseline`.
 *
 * Run it the way phases 2-4 were run:
 *   npx playwright test tests/phase5-deep.spec.ts --project=chromium --project="Mobile Chrome"
 */
import { test, expect, type Page, type ConsoleMessage, type Route } from '@playwright/test';
import { KEYS, SEED_LIBRARY, KNOWN_NOISE, realErrors } from './fixtures';

/* ── seed(), but ONCE ──────────────────────────────────────────────────────
   Same sentinel guard phase 4 shipped: fixtures.ts's seed() is addInitScript,
   so it re-runs on every navigation and overwrites anything the app wrote. */
async function seedOnce(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((payload: Record<string, string>) => {
    if (window.localStorage.getItem('__qa_phase5_seeded')) return;
    for (const [k, v] of Object.entries(payload)) window.localStorage.setItem(k, v);
    window.localStorage.setItem('__qa_phase5_seeded', '1');
  }, Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
}

/** igdb.js reads these two with a bare getItem — they must NOT be JSON. */
async function seedCreds(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('igdb_client_id', 'qa-phase5-client');
    window.localStorage.setItem('igdb_access_token', 'qa-phase5-token');
  });
}

/* ── Console watch (same contract as phases 2-4) ───────────────────────────── */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/* ── The two safety blocks ─────────────────────────────────────────────────── */
async function blockCloud(page: Page) {
  await page.route(/googleapis\.com|firebaseio\.com|firebaseinstallations/, (r: Route) => r.abort());
}
async function blockWikidata(page: Page) {
  await page.route('**/wdqs/**', (r: Route) => r.abort());
}
/** Everything an awards test needs: no cloud, no Wikidata, corpus only. */
async function awardsOffline(page: Page) {
  await blockCloud(page);
  await blockWikidata(page);
}

/* ── IGDB stub ─────────────────────────────────────────────────────────────
   /schedule, /events and /event/:id are all live POSTs to /api/*. Stubbing
   them is what makes a date edge, an empty case and a failure case
   deterministic, and keeps ~70 cases off IGDB's 4 req/s budget. */
type IgdbOpts = {
  releaseDates?: (offset: number) => unknown[];
  events?: (offset: number, query: string, tab: 'upcoming' | 'past') => unknown[];
  eventById?: (id: string) => unknown[];
  games?: unknown[];
  status?: number;
};
type Captured = { path: string; body: string };

async function stubIgdb(page: Page, opts: IgdbOpts = {}): Promise<Captured[]> {
  const seen: Captured[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() || '';
    seen.push({ path, body });

    if (opts.status && opts.status >= 400) {
      await route.fulfill({ status: opts.status, contentType: 'text/plain', body: 'stubbed upstream failure' });
      return;
    }

    const offset = Number(/offset (\d+)/.exec(body)?.[1] ?? 0);
    let payload: unknown[] = [];

    if (path.endsWith('/release_dates')) {
      payload = opts.releaseDates ? opts.releaseDates(offset) : [];
    } else if (path.endsWith('/events')) {
      const byId = /where id = (\d+)/.exec(body);
      if (byId) payload = opts.eventById ? opts.eventById(byId[1]) : [];
      else if (/where games = \(/.test(body)) payload = [];   // getAnnouncedGames' second call
      else {
        const q = /name ~ \*"([^"]*)"\*/.exec(body)?.[1] ?? '';
        const tab = /start_time <= /.test(body) ? 'past' : 'upcoming';
        payload = opts.events ? opts.events(offset, q, tab) : [];
      }
    } else if (path.endsWith('/games')) {
      payload = opts.games ?? [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  return seen;
}

/* ── Fixtures ──────────────────────────────────────────────────────────────── */
const HOUR = 3600;
const nowSec = () => Math.floor(Date.now() / 1000);

/** A release_dates row in IGDB's shape. `human` omitted unless given. */
const rd = (id: number, name: string, date: number, extra: Record<string, unknown> = {}) => ({
  id: id * 10, date,
  game: { id, name, cover: { image_id: 'co1wyy' }, game_type: 0, total_rating: 80 },
  platform: { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
  ...extra,
});

const ev = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name,
  start_time: nowSec() + 7 * 24 * HOUR,
  event_logo: { image_id: 'ev1' },
  games: [1942, 1020, 555555],
  ...extra,
});

/** The detail shape: games are expanded objects, not ids. */
const evDetail = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, name,
  start_time: nowSec() - 30 * 24 * HOUR,
  end_time: nowSec() - 30 * 24 * HOUR + 2 * HOUR,
  live_stream_url: 'https://example.invalid/stream',
  description: 'Stubbed organiser copy for the QA run.',
  event_logo: { image_id: 'ev1' },
  games: [
    { id: 1942, name: 'The Witcher 3: Wild Hunt', cover: { image_id: 'co1wyy' }, first_release_date: 1431993600, total_rating: 93 },
    { id: 8801, name: 'Stub Shipped Game', cover: { image_id: 'co2lbd' }, first_release_date: 1500940800, total_rating: 70 },
    { id: 8802, name: 'Stub Unshipped Game', cover: { image_id: 'co2ekt' } },
  ],
  ...extra,
});

/** Wait until a page has stopped painting skeletons. */
async function settled(page: Page, heading: RegExp | string) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator('.animate-pulse, [class*="skeleton"]').count(), { timeout: 20_000 })
    .toBe(0);
}

/** The one of the two shells (desktop grid / mobile accordion) that is on screen. */
const shown = (loc: ReturnType<Page['getByText']>) => loc.filter({ visible: true }).first();

const lsGet = (page: Page, key: string) => page.evaluate(k => window.localStorage.getItem(k), key);

/* ══════════════════════════════════════════════════════════════════════════
   /schedule — Schedule.jsx
   ══════════════════════════════════════════════════════════════════════════ */
test.describe('/schedule', () => {
  const THREE = [
    rd(9001, 'Alpha Stub Release', Math.floor(Date.UTC(2026, 5, 10) / 1000)),
    rd(9002, 'Beta Stub Release', Math.floor(Date.UTC(2026, 5, 10) / 1000)),
    rd(9003, 'Gamma Stub Release', Math.floor(Date.UTC(2026, 6, 4) / 1000)),
  ];
  const page1 = (offset: number) => (offset === 0 ? THREE : []);

  async function open(page: Page, url = '/schedule', opts: IgdbOpts = { releaseDates: page1 }) {
    await seedCreds(page);
    await blockCloud(page);
    const seen = await stubIgdb(page, opts);
    await page.goto(url);
    return seen;
  }

  test('1 default state: Upcoming and All are the pressed filters, count matches the grid', async ({ page }) => {
    const errs = watchConsole(page);
    await open(page);
    await settled(page, 'Schedule');
    await expect(page.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Any Year' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Any Month' })).toBeVisible();
    // The header count is the loaded row count, and it agrees with the DOM.
    // GameCard.jsx:451-456 is a role="link" div, NOT an <a href> — deliberate, so a
    // drag does not hit the native anchor URL-drag path.
    await expect(page.locator('[role="link"]')).toHaveCount(3);
    await expect(page.getByText(/^3 Titles$/i)).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('2 Recent flips aria-pressed, writes ?when=released and inverts the query window', async ({ page }) => {
    const seen = await open(page);
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Recent' }).click();
    await expect(page).toHaveURL(/\?when=released/);
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => seen.filter(s => s.path.endsWith('/release_dates')).length).toBeGreaterThan(1);
    const last = seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body;
    expect(last).toMatch(/date <= \d+/);
    expect(last).toMatch(/sort date desc/);
  });

  test('3 Announced switches endpoint to /api/games and drops the date dropdowns', async ({ page }) => {
    const seen = await open(page, '/schedule', {
      releaseDates: page1,
      games: [{ id: 9101, name: 'Announced Stub', cover: { image_id: 'co1wyy' }, hypes: 40, platforms: [] }],
    });
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Announced' }).click();
    await expect(page).toHaveURL(/\?when=announced/);
    await expect(page.getByRole('button', { name: 'Any Year' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Any Month' })).toHaveCount(0);
    await expect.poll(() => seen.some(s => s.path.endsWith('/games') && /first_release_date = null/.test(s.body))).toBe(true);
    await expect(page.getByText('Announced Stub')).toBeVisible();
  });

  test('4 returning to Upcoming deletes the param rather than writing when=upcoming', async ({ page }) => {
    await open(page);
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Recent' }).click();
    await expect(page).toHaveURL(/when=released/);
    await page.getByRole('button', { name: 'Upcoming' }).click();
    await expect(page).toHaveURL(/\/schedule$/);
  });

  test('5 Base and DLC reach the query — FINDING 1: the type filter is the one control not in the URL', async ({ page }) => {
    const seen = await open(page);
    await settled(page, 'Schedule');

    await page.getByRole('button', { name: 'Base', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body)
      .toMatch(/game\.game_type = 0/);

    await page.getByRole('button', { name: 'DLC', exact: true }).click();
    await expect.poll(() => seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body)
      .toMatch(/game\.game_type != 0/);

    // FINDING 1 — when / year / month all round-trip through the URL; gameType is
    // useState only (Schedule.jsx:92), so it is neither shareable nor survives a
    // reload, while its three neighbours in the same toolbar are both.
    await expect(page).toHaveURL(/\/schedule$/);
    await page.reload();
    await settled(page, 'Schedule');
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DLC', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('6 when + year + month all survive a reload', async ({ page }) => {
    await open(page, '/schedule?when=released&year=2024&month=3');
    await settled(page, 'Schedule');
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '2024', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mar', exact: true })).toBeVisible();
    await page.reload();
    await settled(page, 'Schedule');
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '2024', exact: true })).toBeVisible();
  });

  test('7 the Year dropdown opens, offers Any Year + 4 years, and a pick narrows the query', async ({ page }) => {
    const seen = await open(page);
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Any Year' }).click();
    const menu = page.locator('[role="menu"], [role="listbox"]').first();
    // Every option here passes isActive, so DropdownMenu.jsx:417 renders them as
    // role="menuitemradio" rather than menuitem.
    const items = menu.getByRole('menuitemradio');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBe(5);          // Any Year + 4
    const year = String(new Date().getFullYear() + 1);
    await menu.getByRole('menuitemradio', { name: year, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`year=${year}`));
    await expect(page.getByRole('button', { name: year, exact: true })).toBeVisible();
    await expect.poll(() => seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body)
      .toMatch(/date >= \d+ & date < \d+/);
  });

  test('8 a month with no year pins the current year, and Any Year clears both', async ({ page }) => {
    await open(page);
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Any Month' }).click();
    await page.getByRole('menuitemradio', { name: 'Aug', exact: true }).click();
    const cy = new Date().getFullYear();
    await expect(page).toHaveURL(new RegExp(`month=8`));
    await expect(page).toHaveURL(new RegExp(`year=${cy}`));
    await expect(page.getByRole('button', { name: 'Aug', exact: true })).toBeVisible();

    await page.getByRole('button', { name: String(cy), exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Any Year' }).click();
    await expect(page).not.toHaveURL(/year=/);
    await expect(page).not.toHaveURL(/month=/);
    await expect(page.getByRole('button', { name: 'Any Month' })).toBeVisible();
  });

  test('9 Any Month clears the month and keeps the year', async ({ page }) => {
    await open(page, '/schedule?year=2026&month=5');
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'May', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Any Month' }).click();
    await expect(page).not.toHaveURL(/month=/);
    await expect(page).toHaveURL(/year=2026/);
  });

  test('10 an empty result draws the Nothing Scheduled plate', async ({ page }) => {
    await open(page, '/schedule', { releaseDates: () => [] });
    await settled(page, 'Schedule');
    await expect(page.getByText('Nothing Scheduled')).toBeVisible();
    await expect(page.getByText('No releases match the current filters')).toBeVisible();
    await expect(page.getByText(/^0 Titles$/i)).toBeVisible();
  });

  test('11 an IGDB failure on the schedule reads as a failure with a retry', async ({ page }) => {
    await open(page, '/schedule', { status: 500 });
    await settled(page, 'Schedule');
    await expect(page.getByText(/did not answer|could not reach/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /try again|retry/i }).first()).toBeVisible();
    await expect(page.getByText('No releases match the current filters')).toHaveCount(0);
  });  test('12 FINDING 3: switching to Announced strands ?year in the URL with no control to clear it', async ({ page }) => {
    await open(page, '/schedule?year=2027', {
      releaseDates: page1,
      games: [{ id: 9101, name: 'Announced Stub', cover: { image_id: 'co1wyy' }, hypes: 40, platforms: [] }],
    });
    await settled(page, 'Schedule');
    await page.getByRole('button', { name: 'Announced' }).click();
    await expect(page).toHaveURL(/when=announced/);
    // Still there, and now unreachable: the dropdown that owns it is unmounted.
    await expect(page).toHaveURL(/year=2027/);
    await expect(page.getByRole('button', { name: '2027', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Any Year' })).toHaveCount(0);
    // And it silently reapplies on the way back.
    await page.getByRole('button', { name: 'Upcoming' }).click();
    await expect(page.getByRole('button', { name: '2027', exact: true })).toBeVisible();
  });

  test('13 the infinite-scroll sentinel fetches one page until the user scrolls', async ({ page }) => {
    const full = (offset: number) =>
      offset >= 150 ? [] : Array.from({ length: 50 }, (_, i) =>
        rd(offset + i + 1, `Bulk ${offset + i + 1}`, Math.floor(Date.UTC(2026, 5, 10) / 1000)));
    const seen = await open(page, '/schedule', { releaseDates: full });
    await settled(page, 'Schedule');
    // rootMargin used to be 2500px, which kept the sentinel intersecting on a
    // page shorter than the margin, so pages 2, 3 and 4 all loaded with the
    // viewport still parked at the top. Count paged requests (offset > 0): the
    // dev server runs StrictMode, which repeats the mount fetch at offset 0.
    await page.waitForTimeout(4000);
    const dates = seen.filter(s => s.path.endsWith('/release_dates'));
    expect(dates.length).toBeGreaterThanOrEqual(1);
    expect(dates.filter(s => /offset [1-9]/.test(s.body)).length).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // And the sentinel still works once the user does scroll.
    await page.mouse.wheel(0, 20_000);
    await expect.poll(() => seen.filter(s => s.path.endsWith('/release_dates') && /offset 50/.test(s.body)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  });

  test('14 the no-date case: Announced rows render with no group header and no year', async ({ page }) => {
    await open(page, '/schedule?when=announced', {
      games: [
        { id: 9201, name: 'Undated Stub One', cover: { image_id: 'co1wyy' }, hypes: 90, platforms: [] },
        { id: 9202, name: 'Undated Stub Two', cover: { image_id: 'co2lbd' }, hypes: 80, platforms: [] },
      ],
    });
    await settled(page, 'Schedule');
    await expect(page.getByText('Undated Stub One')).toBeVisible();
    // groups collapses to a single label-less bucket, so no GroupHeader is drawn
    // and no row claims a date it does not have.
    await expect(page.getByText(/^\w{3} \d{2}, \d{4}$/)).toHaveCount(0);
    // The card's own year slot reads TBA rather than leaving an empty band that
    // looks like a value that failed to render.
    await expect(page.getByText('TBA').first()).toBeVisible();
  });

  test('15 a very long release title does not overflow the page horizontally', async ({ page }) => {
    const long = 'A'.repeat(40) + ' ' + 'Extremely-Long-Unbroken-Release-Title-'.repeat(4);
    await open(page, '/schedule', {
      releaseDates: (o) => (o === 0 ? [rd(9301, long, Math.floor(Date.UTC(2026, 5, 10) / 1000))] : []),
    });
    await settled(page, 'Schedule');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* ── The timezone edges, driven as two separate contexts ──────────────────── */
test.describe('/schedule — timezone edges', () => {
  /* A release date is a calendar date, not an instant. Both halves of the app
     treat it as an instant in the VIEWER's zone, so the same IGDB row lands in a
     different month depending on where you are sitting. */
  const UTC_NEW_YEAR = Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);

  async function open(page: Page, url: string) {
    await seedCreds(page);
    await blockCloud(page);
    const seen = await stubIgdb(page, {
      releaseDates: (o) => (o === 0 ? [rd(9401, 'New Year Stub', UTC_NEW_YEAR)] : []),
    });
    await page.goto(url);
    return seen;
  }

  test.describe('Asia/Kolkata (UTC+5:30)', () => {
    test.use({ timezoneId: 'Asia/Kolkata' });
    test('16a the January window and the group label, east of UTC', async ({ page }) => {
      const seen = await open(page, '/schedule?when=released&year=2026&month=1');
      await settled(page, 'Schedule');
      const body = seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body;
      const from = Number(/date >= (\d+)/.exec(body)![1]);
      // The window is built in UTC, so it opens exactly at the month, not 5h30 before it.
      expect(new Date(from * 1000).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      await expect(page.getByText('Jan 01, 2026')).toBeVisible();
    });
  });

  test.describe('America/Los_Angeles (UTC-8)', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });
    test('16b west of UTC the same filter opens at UTC midnight and the row stays in January', async ({ page }) => {
      const seen = await open(page, '/schedule?when=released&year=2026&month=1');
      await settled(page, 'Schedule');
      const body = seen.filter(s => s.path.endsWith('/release_dates')).at(-1)!.body;
      const from = Number(/date >= (\d+)/.exec(body)![1]);
      // The query bound is UTC midnight, so the row dated exactly then is inside
      // its own month, and the display half labels the same instant in UTC.
      expect(new Date(from * 1000).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(from).toBe(UTC_NEW_YEAR);
      await expect(page.getByText('Jan 01, 2026')).toBeVisible();
      await expect(page.getByText('Dec 31, 2025')).toHaveCount(0);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /events — AllEvents.jsx
   ══════════════════════════════════════════════════════════════════════════ */
test.describe('/events', () => {
  const LIST = [
    ev(6001, 'Stub Showcase Alpha'),
    ev(6002, 'Stub Direct Beta', { start_time: nowSec() + 14 * 24 * HOUR }),
    ev(6003, 'Stub Roundup Gamma', { start_time: nowSec() + 21 * 24 * HOUR, games: [] }),
  ];

  async function open(page: Page, url = '/events', opts: IgdbOpts = {}) {
    await seedCreds(page);
    await blockCloud(page);
    await seedOnce(page, { [KEYS.library]: SEED_LIBRARY });
    const seen = await stubIgdb(page, {
      events: (o, q) => {
        if (o > 0) return [];
        if (q) return LIST.filter(e => e.name.toLowerCase().includes(q.toLowerCase()));
        return LIST;
      },
      ...opts,
    });
    await page.goto(url);
    return seen;
  }

  test('17 default state: Upcoming pressed, hero spotlight, index rows, count', async ({ page }) => {
    const errs = watchConsole(page);
    await open(page);
    await settled(page, 'Events');
    await expect(page.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Next up')).toBeVisible();
    await expect(page.getByText('Stub Showcase Alpha')).toBeVisible();
    await expect(page.getByText(/^3 Entries$/i)).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('18 Past flips the tab, inverts the query and drops the hero', async ({ page }) => {
    const seen = await open(page);
    await settled(page, 'Events');
    await page.getByRole('button', { name: 'Past' }).click();
    await expect(page.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => seen.filter(s => s.path.endsWith('/events')).at(-1)!.body)
      .toMatch(/start_time <= \d+/);
    expect(seen.filter(s => s.path.endsWith('/events')).at(-1)!.body).toMatch(/sort start_time desc/);
    await expect(page.getByText('Next up')).toHaveCount(0);
  });

  test('19 search debounces to ONE request and narrows the list', async ({ page }) => {
    const seen = await open(page);
    await settled(page, 'Events');
    const before = seen.filter(s => s.path.endsWith('/events')).length;
    await page.getByRole('textbox', { name: 'Search events' }).pressSequentially('Direct', { delay: 40 });
    await expect(page.getByText('Stub Direct Beta')).toBeVisible();
    await expect(page.getByText('Stub Showcase Alpha')).toHaveCount(0);
    const after = seen.filter(s => s.path.endsWith('/events')).length;
    expect(after - before).toBe(1);            // 6 keystrokes, 1 request
    expect(seen.at(-1)!.body).toMatch(/name ~ \*"Direct"\*/);
  });

  test('20 a search that matches nothing draws the search-specific empty plate', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    await page.getByRole('textbox', { name: 'Search events' }).fill('zzzznotanevent');
    await expect(page.getByText('No Events')).toBeVisible();
    await expect(page.getByText('Nothing matches that search')).toBeVisible();
  });

  test('21 Clear search restores the list and removes itself', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    const box = page.getByRole('textbox', { name: 'Search events' });
    await box.fill('Direct');
    await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(box).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);
    await expect(page.getByText('Stub Showcase Alpha')).toBeVisible();
  });

  test('22 searching suppresses the hero spotlight', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    await expect(page.getByText('Next up')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search events' }).fill('Stub');
    await expect(page.getByText('Next up')).toHaveCount(0);
  });

  test('23 the hero and an index row both navigate to their event', async ({ page }) => {
    await open(page, '/events', { eventById: (id) => [evDetail(Number(id), `Detail For ${id}`)] });
    await settled(page, 'Events');
    await page.getByRole('button', { name: /Next up/ }).click();
    await expect(page).toHaveURL(/\/event\/6001/);
    await page.goBack();
    await settled(page, 'Events');
    await page.getByRole('button', { name: /Stub Direct Beta/ }).click();
    await expect(page).toHaveURL(/\/event\/6002/);
  });

  test('24 FINDING 6: every event row is a button, so a 24-entry index has no link in it', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    const row = page.getByRole('button', { name: /Stub Direct Beta/ });
    // The accessible name IS computed — from the row's own contents, not an
    // aria-label. This corrects qa/2026-09-05-deep/phase1.md, which recorded these
    // rows as having "no accessible name".
    const name = await row.evaluate(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
    expect(name.toLowerCase()).toContain('stub direct beta');   // CSS uppercases lh-*
    expect(name.length).toBeGreaterThan(10);
    // What is actually missing is the href. AllEvents.jsx:194,262 navigate with
    // useNavigate, so no row can be middle-clicked, opened in a new tab, copied
    // as a link, or crawled — while /awards on the same shell uses real <Link>s.
    await expect(page.locator('a[href^="/event/"]')).toHaveCount(0);
    expect(await row.evaluate(el => el.tagName)).toBe('BUTTON');
  });

  test('25 Load More de-duplicates the overlap between pages', async ({ page }) => {
    const pageOf = (o: number) =>
      o === 0 ? Array.from({ length: 24 }, (_, i) => ev(7000 + i, `Bulk Event ${i}`))
        : o === 24 ? [ev(7023, 'Bulk Event 23'), ev(8000, 'Fresh After Overlap')]   // 7023 already shown
          : [];
    const errs = watchConsole(page);
    await open(page, '/events', { events: (o) => pageOf(o) });
    await settled(page, 'Events');
    await expect(page.getByRole('button', { name: 'Load More' })).toBeVisible();
    await page.getByRole('button', { name: 'Load More' }).click();
    await expect(page.getByText('Fresh After Overlap')).toBeVisible();
    // An appended page is de-duplicated by id, the way Schedule does it.
    await expect(page.getByText('Bulk Event 23', { exact: true })).toHaveCount(1);
    expect(errs.join('\n')).not.toMatch(/two children with the same key|Encountered two children/i);
  });

  test('26 Load More is aria-disabled while a page is in flight', async ({ page }) => {
    await seedCreds(page);
    await blockCloud(page);
    let hold: (() => void) | null = null;
    await page.route('**/api/events', async (route) => {
      const o = Number(/offset (\d+)/.exec(route.request().postData() || '')?.[1] ?? 0);
      if (o > 0) await new Promise<void>(r => { hold = r; });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(o === 0 ? Array.from({ length: 24 }, (_, i) => ev(7100 + i, `Held Event ${i}`)) : []),
      });
    });
    await page.goto('/events');
    await settled(page, 'Events');
    const more = page.getByRole('button', { name: 'Load More' });
    await more.click();
    await expect(page.getByRole('button', { name: 'Loading…' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Loading…' }).click({ force: true });   // must be a no-op; force, or the disabled path is never exercised
    hold?.();
    await expect(page.getByRole('button', { name: 'Load More' })).toHaveCount(0);   // page 2 was empty
  });

  test('27 a library crossover is counted on the row it belongs to', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    // SEED_LIBRARY holds 1942 and 1020; ev() lists both plus one unowned id.
    await expect(page.getByRole('button', { name: /Stub Direct Beta.*2 yours/s })).toBeVisible();
    // The row with no games carries neither figure.
    const gamma = await page.getByRole('button', { name: /Stub Roundup Gamma/ })
      .evaluate(el => (el as HTMLElement).innerText);
    expect(gamma).not.toMatch(/yours/i);
    expect(gamma).not.toMatch(/games/i);
  });

  test('28 an IGDB failure on the events list reads as a failure with a retry', async ({ page }) => {
    await open(page, '/events', { status: 500 });
    await settled(page, 'Events');
    await expect(page.getByText(/did not answer|could not reach/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /try again|retry/i }).first()).toBeVisible();
    await expect(page.getByText('IGDB lists nothing for this tab')).toHaveCount(0);
  });  test('29 an event with no start_time reads Date TBA and carries no countdown', async ({ page }) => {
    await open(page, '/events', {
      events: (o) => (o === 0 ? [ev(6101, 'Undated Stub Event', { start_time: undefined, games: [] })] : []),
    });
    await settled(page, 'Events');
    const hero = page.getByRole('button', { name: /Undated Stub Event/ });
    const txt = await hero.evaluate(el => (el as HTMLElement).innerText);
    expect(txt).toMatch(/Date TBA/i);
    expect(txt).not.toMatch(/NaN|Invalid|Starts in/i);
  });

  test('30 the Award ceremonies link is the door to /awards', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    await awardsOffline(page);
    await page.getByRole('link', { name: /Award ceremonies/ }).click();
    await expect(page).toHaveURL(/\/awards$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Awards' })).toBeVisible();
  });

  test('31 a 200-character event name does not overflow the viewport', async ({ page }) => {
    await open(page, '/events', {
      events: (o) => (o === 0 ? [ev(6201, 'Nonbreaking'.repeat(18))] : []),
    });
    await settled(page, 'Events');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('32 the live region reports the result count after a tab change', async ({ page }) => {
    await open(page);
    await settled(page, 'Events');
    await expect(page.locator('#app-live-region')).toContainText(/3 events/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /event/:id — EventDetail.jsx
   ══════════════════════════════════════════════════════════════════════════ */
test.describe('/event/:id', () => {
  async function open(page: Page, id: number, opts: IgdbOpts = {}) {
    await seedCreds(page);
    await blockCloud(page);
    await seedOnce(page, { [KEYS.library]: SEED_LIBRARY });
    const seen = await stubIgdb(page, {
      eventById: (eid) => [evDetail(Number(eid), 'Stub Archive Event')],
      ...opts,
    });
    await page.goto(`/event/${id}`);
    return seen;
  }

  test('33 the archive shape: name as h1, a past date with an "ago" reading', async ({ page }) => {
    const errs = watchConsole(page);
    await open(page, 6001);
    await settled(page, 'Stub Archive Event');
    await expect(page.getByText(/months? ago|days ago|last month/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The broadcast' })).toBeVisible();
    await expect(page.getByText('As the organisers described it')).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('34 the four tallies partition the slate exactly', async ({ page }) => {
    await open(page, 6001);
    await settled(page, 'Stub Archive Event');
    const num = async (label: string) =>
      Number(await page.locator('div', { hasText: new RegExp(`^${label}$`) }).first()
        .evaluate(el => el.previousElementSibling?.textContent?.trim() ?? '-1'));
    const shown = await num('Games shown');
    const out = await num('Out now');
    const still = await num('Still to come');
    const mine = await num('On your shelves');
    expect(shown).toBe(3);
    expect(out + still).toBe(shown);        // the pair partitions the slate
    expect(mine).toBe(1);                   // 1942 is in SEED_LIBRARY
    expect(mine).toBeLessThanOrEqual(shown);
  });

  test('35 the slate splits into "From your shelves" and "Everything else shown"', async ({ page }) => {
    await open(page, 6001);
    await settled(page, 'Stub Archive Event');
    await expect(page.getByRole('heading', { name: 'From your shelves' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Everything else shown' })).toBeVisible();
    const yours = page.locator('section[aria-labelledby="slate-yours"]');
    await expect(yours.locator('[role="link"]')).toHaveCount(1);
    await expect(yours.getByText('The Witcher 3: Wild Hunt')).toBeVisible();
  });

  test('36 with nothing owned the second slate is renamed "What it showed"', async ({ page }) => {
    await seedCreds(page);
    await blockCloud(page);
    await seedOnce(page, { [KEYS.library]: [] });
    await stubIgdb(page, { eventById: (eid) => [evDetail(Number(eid), 'Stub Archive Event')] });
    await page.goto('/event/6001');
    await settled(page, 'Stub Archive Event');
    await expect(page.getByRole('heading', { name: 'What it showed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'From your shelves' })).toHaveCount(0);
  });

  test('37 a slate card navigates to the game', async ({ page }) => {
    await open(page, 6001);
    await settled(page, 'Stub Archive Event');
    await page.locator('[role="link"][aria-label="The Witcher 3: Wild Hunt"]').first().click();
    await expect(page).toHaveURL(/\/game\/1942/);
  });

  test('38 Back returns to the previous route', async ({ page }) => {
    await seedCreds(page);
    await blockCloud(page);
    await stubIgdb(page, {
      events: (o) => (o === 0 ? [ev(6001, 'Stub Showcase Alpha')] : []),
      eventById: (eid) => [evDetail(Number(eid), 'Stub Archive Event')],
    });
    await page.goto('/events');
    await settled(page, 'Events');
    await page.getByRole('button', { name: /Next up/ }).click();
    await settled(page, 'Stub Archive Event');
    // CSS uppercases lh-label, and Chrome applies text-transform to the
    // accessible name, so the button announces as "BACK".
    await page.getByRole('button', { name: /back/i }).first().click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('40 an IGDB failure on an event says the index did not answer, not that the id is unknown', async ({ page }) => {
    await open(page, 6001, { status: 500 });
    await expect(page.getByText(/did not answer|could not reach/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /try again|retry/i }).first()).toBeVisible();
    await expect(page.getByText('IGDB has no record for this id')).toHaveCount(0);
  });  test('41 an event with no date: no meta line, no NaN, "Not recorded" in the broadcast table', async ({ page }) => {
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'Undated Stub Event', { start_time: undefined, end_time: undefined })],
    });
    await settled(page, 'Undated Stub Event');
    await expect(page.getByText('Not recorded')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/NaN|Invalid Date|undefined/);
    await expect(page.getByText(/Starts in|Live now/)).toHaveCount(0);
  });

  test('42 an event with no games drops the tally strip and explains the gap', async ({ page }) => {
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'Empty Stub Event', { games: [] })],
    });
    await settled(page, 'Empty Stub Event');
    await expect(page.getByText(/IGDB lists no games for this event/)).toBeVisible();
    await expect(page.getByText('Games shown')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /From your shelves|What it showed/ })).toHaveCount(0);
  });

  test('43 the live window: badge, "Ends in", and the stream link opens safely', async ({ page }) => {
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'Live Stub Event', {
        start_time: nowSec() - 600, end_time: nowSec() + 3600,
      })],
    });
    await settled(page, 'Live Stub Event');
    await expect(page.getByText('Live now')).toBeVisible();
    await expect(page.getByText(/Ends in \d+[HM]/)).toBeVisible();
    const stream = page.getByRole('link', { name: /Watch the stream/ });
    await expect(stream).toHaveAttribute('target', '_blank');
    await expect(stream).toHaveAttribute('rel', /noopener/);
  });

  test('44 an upcoming event shows a countdown rather than a date', async ({ page }) => {
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'Future Stub Event', {
        start_time: nowSec() + 2 * HOUR + 300, end_time: nowSec() + 5 * HOUR,
      })],
    });
    await settled(page, 'Future Stub Event');
    await expect(page.getByText(/Starts in \d+H \d+M/)).toBeVisible();
    await expect(page.getByText(/ago/)).toHaveCount(0);
  });

  test('45 an event whose name IS a ceremony links across to the award archive', async ({ page }) => {
    await awardsOffline(page);
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'The Game Awards 2024')],
    });
    await settled(page, 'The Game Awards 2024');
    const link = page.getByRole('link', { name: /Every winner and nominee/ });
    await expect(link).toHaveAttribute('href', '/awards/Q18642757');
    await link.click();
    await expect(page).toHaveURL(/\/awards\/Q18642757/);
    await expect(page.getByRole('heading', { level: 1, name: 'The Game Awards' })).toBeVisible();
  });

  test('46 an ordinary showcase gets no ceremony link (exact match only)', async ({ page }) => {
    await open(page, 6001, {
      eventById: (eid) => [evDetail(Number(eid), 'Cozy Game Awards 2026')],
    });
    await settled(page, 'Cozy Game Awards 2026');
    await expect(page.getByRole('link', { name: /Every winner and nominee/ })).toHaveCount(0);
  });

  test('47 a card menu on the event page shelves the game', async ({ page }) => {
    await open(page, 6001);
    await settled(page, 'Stub Archive Event');
    const card = page.locator('[role="link"][aria-label="Stub Unshipped Game"]').first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);            // DropdownMenu.jsx:142 closes on scroll
    await page.getByRole('button', { name: 'More options for Stub Unshipped Game' }).click();
    // An unshelved card offers exactly one shelf action (useLibraryCards.jsx:35).
    await page.getByRole('menuitem', { name: 'Add to Wishlist' }).click();
    await expect.poll(async () => JSON.parse((await lsGet(page, KEYS.library)) || '[]')
      .find((g: { id: number }) => String(g.id) === '8802')?.status).toBe('Wishlist');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /awards — AwardsIndex.jsx   (corpus only; no cloud, no Wikidata)
   ══════════════════════════════════════════════════════════════════════════ */
test.describe('/awards', () => {
  async function open(page: Page, url = '/awards') {
    await seedCreds(page);
    await awardsOffline(page);
    await page.goto(url);
    await settled(page, 'Awards');
  }

  test('48 the index renders in full from the shipped corpus with the network cut', async ({ page }) => {
    const errs = watchConsole(page);
    const wdqs: string[] = [];
    await page.on('request', r => { if (/wdqs/.test(r.url())) wdqs.push(r.url()); });
    await open(page);
    const rows = page.locator('a[href^="/awards/Q"]');
    await expect.poll(() => rows.count()).toBeGreaterThan(20);
    const n = await rows.count();
    await expect(page.getByText(new RegExp(`^${n} Ceremonies$`, 'i'))).toBeVisible();
    await expect(page.getByText('Sourced from Wikidata')).toBeVisible();
    await expect(page.getByText('Querying Wikidata…')).toHaveCount(0);
    await expect(page.getByText('Wikidata Unreachable')).toHaveCount(0);
    expect(realErrors(errs)).toEqual([]);
  });

  test('49 rows are numbered links carrying a game count', async ({ page }) => {
    await open(page);
    const first = page.locator('a[href^="/awards/Q"]').first();
    await expect(first).toContainText('01');
    await expect(first).toContainText(/\d+ Games?/);
    await first.click();
    await expect(page).toHaveURL(/\/awards\/Q\d+/);
  });

  test('50 search narrows the index and the live region reports the new count', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: 'Search ceremonies' }).fill('game awards');
    const rows = page.locator('a[href^="/awards/Q"]');
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    const n = await rows.count();
    expect(n).toBeLessThan(42);
    await expect(page.locator('#app-live-region')).toContainText(new RegExp(`${n} ceremon`, 'i'));
  });

  test('51 FINDING 10: a search with no hits says "No ceremonies match" — and so does a genuinely empty index', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: 'Search ceremonies' }).fill('zzzznotaceremony');
    await expect(page.getByText('No ceremonies match')).toBeVisible();
    // AwardsIndex.jsx:111 gates the plate on `filtered.length === 0` with no
    // reference to `query`, so the same sentence covers "your search found
    // nothing" and "Wikidata returned an empty index". The header contradicts it:
    await expect(page.getByText(/\d+ Ceremonies/i)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect.poll(() => page.locator('a[href^="/awards/Q"]').count()).toBeGreaterThan(20);
  });

  test('52 Reload survives with both tiers unreachable — the cached copy is served, not an error', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByText('Wikidata Unreachable')).toHaveCount(0);
    await expect.poll(() => page.locator('a[href^="/awards/Q"]').count()).toBeGreaterThan(20);
  });

  test('53 FINDING 11: Reload on the index expires EVERY awards cache key, not the index', async ({ page }) => {
    await open(page);
    // Warm a ceremony and the game projection first.
    await page.goto('/awards/Q18642757');
    await settled(page, 'The Game Awards');
    await page.goto('/awards');
    await settled(page, 'Awards');
    const before = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('lh_awards_')));
    expect(before.some(k => k.startsWith('lh_awards_ceremony4_'))).toBe(true);

    await page.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => page.locator('a[href^="/awards/Q"]').count()).toBeGreaterThan(20);
    // awards.js:645-654 walks every key with the CACHE_PREFIX and stamps at: 0.
    // One button on the index throws away the per-ceremony caches and the
    // ~2,500-game projection that the ceremony pages are built on.
    const stamps = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.startsWith('lh_awards_'))
        .map(k => [k, JSON.parse(localStorage.getItem(k)!).at] as [string, number]));
    const expired = stamps.filter(([, at]) => at === 0).map(([k]) => k);
    expect(expired.some(k => k.startsWith('lh_awards_ceremony4_'))).toBe(true);
  });

  test('54 FINDING 12: Reload has no busy state, so N clicks are N reload storms', async ({ page }) => {
    await open(page);
    const btn = page.getByRole('button', { name: 'Reload' });
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    await expect(btn).not.toHaveAttribute('aria-busy', 'true');
    expect(await btn.isDisabled()).toBe(false);
    await btn.click(); await btn.click(); await btn.click();
    // Still enabled, still unlabelled, list intact — nothing tells the user the
    // three clicks did anything, and nothing stops the fourth.
    await expect(btn).toBeEnabled();
    await expect.poll(() => page.locator('a[href^="/awards/Q"]').count()).toBeGreaterThan(20);
  });

  test('55 the index does not overflow at its own narrowest', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   /awards/:awardQid — AwardCeremony.jsx
   ══════════════════════════════════════════════════════════════════════════ */
test.describe('/awards/:awardQid', () => {
  const TGA = 'Q18642757';

  async function open(page: Page, url: string, heading: RegExp | string = 'The Game Awards') {
    await seedCreds(page);
    await awardsOffline(page);
    /* getGamesByIds decides whether a winner has an IGDB id, and AwardCeremony.jsx:269
       drops the id when IGDB does not answer — which removes the winner's link AND
       its ⋯ menu. Echo the requested ids back with no `name`, so every winner
       resolves while the title still comes from Wikidata. */
    await page.route('**/api/games', async (route) => {
      const ids = /where id = \(([^)]*)\)/.exec(route.request().postData() || '')?.[1] ?? '';
      const rows = ids.split(',').map(x => Number(x.trim())).filter(Boolean)
        .map(id => ({ id, cover: { image_id: 'co1wyy' } }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    await page.goto(url);
    await settled(page, heading);
  }

  test('56 the ceremony renders from the corpus: year strip, GOTY hero, category index', async ({ page }) => {
    const errs = watchConsole(page);
    await open(page, `/awards/${TGA}`);
    await expect(page.getByRole('group', { name: 'Ceremony year' })).toBeVisible();
    await expect(page.getByText(/Ceremony · \d{4}–\d{4} · \d+ Years/)).toBeVisible();
    // Both shells are in the DOM at once (hidden by CSS), so every plain-text
    // query on this page is a strict-mode violation without .first().
    await expect(shown(page.getByText(/More Categories/))).toBeVisible();
    await expect(shown(page.getByText('Game of the Year'))).toBeVisible();
    expect(realErrors(errs)).toEqual([]);
  });

  test('57 picking a year writes ?year, moves aria-current and swaps the content', async ({ page }) => {
    await open(page, `/awards/${TGA}`);
    const strip = page.getByRole('group', { name: 'Ceremony year' });
    await expect(strip.getByRole('button', { name: '2025' })).toHaveAttribute('aria-current', 'true');
    const heroBefore = await page.locator('h1').innerText();
    await strip.getByRole('button', { name: '2019' }).click();
    await expect(page).toHaveURL(/\?year=2019/);
    await expect(strip.getByRole('button', { name: '2019' })).toHaveAttribute('aria-current', 'true');
    await expect(strip.getByRole('button', { name: '2025' })).not.toHaveAttribute('aria-current', 'true');
    expect(await page.locator('h1').innerText()).toBe(heroBefore);   // the ceremony name does not change
    await expect(page.getByText('2019', { exact: true }).first()).toBeVisible();
  });

  test('58 a year click leaves a history entry, so Back returns to the ceremony', async ({ page }) => {
    await open(page, `/awards/${TGA}`);
    await page.getByRole('group', { name: 'Ceremony year' }).getByRole('button', { name: '2019' }).click();
    await expect(page).toHaveURL(/year=2019/);
    await page.goBack();
    // The year click pushed a history entry: Back returns to the ceremony as it
    // was before the click.
    await expect(page).toHaveURL(/\/awards\/Q/);
    await expect(page).not.toHaveURL(/year=2019/);
  });

  test('59 the Earlier/Later nudges scroll the year strip on a desktop shell', async ({ page, isMobile }) => {
    await open(page, `/awards/${TGA}`);
    const later = page.getByRole('button', { name: 'Later years' });
    if (isMobile) {
      // `hidden sm:flex` — a phone gets the swipeable strip instead.
      await expect(later).not.toBeVisible();
      return;
    }
    const strip = page.getByRole('group', { name: 'Ceremony year' });
    await page.getByRole('button', { name: 'Earlier years' }).click();
    await page.waitForTimeout(500);
    const left = await strip.evaluate(el => el.scrollLeft);
    await later.click();
    await page.waitForTimeout(500);
    expect(await strip.evaluate(el => el.scrollLeft)).toBeGreaterThanOrEqual(left);
  });

  test('60 the desktop category index selects and swaps the detail pane', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the 300px index is `hidden lg:grid` — the phone gets the accordion, case 61');
    await open(page, `/awards/${TGA}`);
    const index = page.locator('div.border-r').first();
    const rows = index.getByRole('button');
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    const firstLabel = (await rows.first().innerText()).split('\n')[0];
    await rows.nth(3).click();
    await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');
    await expect(rows.first()).not.toHaveAttribute('aria-current', 'true');
    const detailHeading = await page.locator('.award-shine').last().innerText();
    expect(detailHeading).not.toBe(firstLabel);
    await expect(shown(page.getByText('Winner', { exact: true }))).toBeVisible();
  });

  test('61 the mobile accordion expands, exposes nominees, and is inert while closed', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the accordion is `lg:hidden`');
    await open(page, `/awards/${TGA}`);
    /* DropdownMenu.jsx:168 stamps aria-expanded onto every ⋯ trigger too, and the
       desktop grid is in the DOM alongside the accordion, and the phone nav drawer
       carries its own aria-expanded "Browse" button. The accordion headers are the
       visible aria-expanded buttons with neither aria-label nor aria-controls. */
    const rows = page.locator('button[aria-expanded]:not([aria-label]):not([aria-controls])').filter({ visible: true });
    const first = rows.first();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    const panel = first.locator('xpath=following-sibling::div[1]');
    expect(await panel.getAttribute('inert')).not.toBeNull();
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(await panel.getAttribute('inert')).toBeNull();
    await expect(panel.getByText('Winner')).toBeVisible();
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(await panel.getAttribute('inert')).not.toBeNull();
  });

  test('62 only one accordion row is open at a time', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the accordion is `lg:hidden`');
    await open(page, `/awards/${TGA}`);
    const rows = page.locator('button[aria-expanded]:not([aria-label]):not([aria-controls])').filter({ visible: true });
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await rows.nth(2).click();
    await expect(rows.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'false');
  });

  test('63 with ?cat= set, the category you click stays selected', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the desktop index is the surface with a persistent selection');
    // Q104117241 = "Best Action/Adventure", rest[1] of The Game Awards 2025.
    await open(page, `/awards/${TGA}?year=2025&cat=Q104117241`);
    const rows = page.locator('div.border-r').first().getByRole('button');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    // A click supersedes the deep link: the clicked row stays selected and
    // ?cat is dropped from the URL so nothing can re-apply it.
    await rows.nth(5).click();
    await page.waitForTimeout(600);
    await expect(rows.nth(5)).toHaveAttribute('aria-current', 'true');
    await expect(rows.nth(1)).not.toHaveAttribute('aria-current', 'true');
    await expect(page).not.toHaveURL(/cat=/);
  });

  test('64 an unknown ?year falls back to the newest year', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=1800`);
    // A year the ceremony does not have falls back to the newest one: a year is
    // current in the strip and the body has content.
    await expect(page.getByText('0 More Categories')).toHaveCount(0);
    await expect(page.getByText('Winner', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Ceremony year' })
      .locator('[aria-current="true"]')).toHaveCount(1);
  });

  test('65 ?year=abc falls back to the newest year', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=abc`);
    // NaN is validated against the data, so the newest year renders.
    await expect(page.getByText('0 More Categories')).toHaveCount(0);
    await expect(page.getByText('Winner', { exact: true }).first()).toBeVisible();
  });

  test('66 FINDING 17: a category with nominees but no winner is dropped from the page entirely', async ({ page }) => {
    // Q546692 / 2023: "Best Game" carries 7 nominees and 0 winners in the shipped
    // corpus (qa/2026-09-05-deep/p5-probe-corpus.log). It sorts first (isGoty), so
    // it becomes `hero` — whose block is gated on heroWinner (AwardCeremony.jsx:430)
    // — and `rest = categories.slice(1)` has already excluded it. 25 ceremony-years
    // in the corpus hit this.
    await open(page, '/awards/Q546692?year=2023', 'British Academy Games Awards');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/best game/i);          // CSS uppercases lh-label
    // The rest of the year renders normally, so nothing signals the omission.
    await expect(shown(page.getByText(/More Categories/))).toBeVisible();
    expect(Number(/(\d+) More Categories/i.exec(body)![1])).toBeGreaterThan(0);
  });

  test('68 a well-formed QID with the network down still says Wikidata is unreachable', async ({ page }) => {
    await seedCreds(page);
    await awardsOffline(page);
    await page.goto('/awards/Q999999999');
    await expect(page.getByText('Wikidata Unreachable')).toBeVisible({ timeout: 40_000 });
    expect((await page.locator('h1').innerText()).trim()).not.toBe('…');
  });  test('69 a winner can be shelved and unshelved from the ⋯ menu, with a confirm on remove', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=2025`);
    const menu = page.getByRole('button', { name: /^Options for / }).first();
    const winner = (await menu.getAttribute('aria-label'))!.replace('Options for ', '');
    await menu.click();
    await page.getByRole('menuitem', { name: /Add to Backlog/ }).click();
    await expect(page.getByText(/Added to Backlog/)).toBeVisible();
    const lib = JSON.parse((await lsGet(page, KEYS.library)) || '[]');
    expect(lib.length).toBe(1);
    expect(lib[0].status).toBe('Backlog');
    expect(lib[0].name).toBe(winner);

    // The sticker appears on the poster without a reload.
    await expect(page.getByText('Backlog', { exact: true }).first()).toBeVisible();

    // Remove is confirmed, and Cancel keeps the row.
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('menuitem', { name: 'Remove from Library' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/There is no undo/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(JSON.parse((await lsGet(page, KEYS.library)) || '[]').length).toBe(1);

    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('menuitem', { name: 'Remove from Library' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(async () => JSON.parse((await lsGet(page, KEYS.library)) || '[]').length).toBe(0);
  });

  test('70 the remove confirm uses the danger variant', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=2025`);
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('menuitem', { name: /Add to Backlog/ }).click();
    await page.getByRole('button', { name: /^Options for / }).first().click();
    await page.getByRole('menuitem', { name: 'Remove from Library' }).click();
    // ConfirmDialog.jsx:113 renders the destructive variant as --destructive text
    // on a --destructive-border outline, not a filled button, so the colour to
    // read is the border and the label — not the background.
    const btn = page.getByRole('dialog').getByRole('button', { name: 'Remove' });
    const s = await btn.evaluate(el => {
      const c = getComputedStyle(el);
      return { color: c.color, border: c.borderTopColor, bg: c.backgroundColor };
    });
    const cancel = await page.getByRole('dialog').getByRole('button', { name: 'Cancel' })
      .evaluate(el => getComputedStyle(el).color);
    expect(s.color).not.toBe(cancel);          // visually distinct from the neutral sibling
    expect(s.color).not.toMatch(/rgba?\(255, 255, 255/);
    expect(s.border).not.toMatch(/rgba?\(255, 255, 255/);
    expect(s.bg).toBe('rgba(0, 0, 0, 0)');     // outline variant, recorded for the report
  });

  test('71 a nominee with no IGDB id falls back to an external Wikidata link', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=2025`);
    const noIgdb = page.getByText('NO IGDB').first();
    if (await noIgdb.count() === 0) test.skip(true, 'this ceremony-year resolved every entry to IGDB');
    const link = noIgdb.locator('xpath=ancestor::a[1]');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('href', /wikidata\.org|https?:/);
  });

  test('72 a winner name links to its game page', async ({ page }) => {
    await open(page, `/awards/${TGA}?year=2025`);
    const link = page.locator('a[href^="/game/"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/game\/\d+$/);
  });

  test('73 the nominee tooltip is revealed by keyboard focus, not only by hover', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hover/focus tooltip is a pointer-and-keyboard surface');
    await open(page, `/awards/${TGA}?year=2025`);
    const tip = page.locator('.group\\/tip').first();
    await expect(tip).toHaveAttribute('title', /.+/);
    const bubble = tip.locator('xpath=./span[last()]');
    expect(await bubble.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
    await tip.locator('a, [role="link"]').first().focus();
    // duration-100 on opacity; poll rather than sleep so a slow frame is not a fail.
    await expect.poll(async () => Number(await bubble.evaluate(el => getComputedStyle(el).opacity)),
      { timeout: 5000 }).toBeGreaterThan(0);
  });

  test('73b shelving a winner by keyboard keeps focus on the page', async ({ page }) => {
    /* eslint flags AwardCeremony.jsx:456 and :535 with "Cannot create components
       during render" — WinnerMenu is declared inside the component body (:253), so
       shelving re-renders the page with a NEW component type and React unmounts
       the trigger the menu would have returned focus to. Measured, not assumed;
       case 73c shows a module-level ⋯ menu doing the same job correctly. */
    await open(page, `/awards/${TGA}?year=2025`);
    const menu = page.getByRole('button', { name: /^Options for / }).first();
    await menu.focus();
    await page.keyboard.press('Enter');
    // DropdownMenu.jsx:176 moves focus to the FIRST item, which is Add to Wishlist.
    await expect(page.getByRole('menuitem', { name: /Add to Wishlist/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Added to Wishlist/)).toBeVisible();
    const landed = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { tag: a?.tagName ?? 'NONE', label: a?.getAttribute('aria-label') ?? '' };
    });
    // WCAG 2.4.3. WinnerMenu is module-level now, so the trigger survives the
    // re-render and DropdownMenu's next-frame re-query finds it.
    expect(landed.tag).not.toBe('BODY');
  });

  test('73c a module-level ⋯ menu keeps focus on both close paths', async ({ page }) => {
    /* Narrows 73b. DropdownMenu.jsx:173-197 does have a restore path, and closing
       with Escape proves it works. What defeats it is the re-render the selected
       action causes — so this is a DropdownMenu-wide defect, not an AwardCeremony
       one, and the in-render WinnerMenu is not the cause. */
    await seedCreds(page);
    await blockCloud(page);
    await seedOnce(page, { [KEYS.library]: [] });
    await stubIgdb(page, { eventById: (eid) => [evDetail(Number(eid), 'Focus Control Event')] });
    await page.goto('/event/6001');
    await settled(page, 'Focus Control Event');
    const trigger = page.getByRole('button', { name: 'More options for Stub Unshipped Game' });
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await trigger.focus();

    // Control 1 — close with Escape. Nothing re-renders, and focus comes back.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Add to Wishlist' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    // Control 2 — close by activating the item. The action re-renders the page;
    // the restore re-queries the trigger on the next frame and finds it.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Add to Wishlist' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => JSON.parse((await lsGet(page, KEYS.library)) || '[]').length).toBe(1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'NONE')).not.toBe('BODY');
  });

  test('74 "← Awards" returns to the index', async ({ page }) => {
    await open(page, `/awards/${TGA}`);
    await page.getByRole('button', { name: '← Awards' }).click();
    await expect(page).toHaveURL(/\/awards$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Awards' })).toBeVisible();
  });

  test('75 the ceremony does not overflow horizontally', async ({ page }) => {
    await open(page, `/awards/${TGA}`);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('76 the award_cache tier is contacted for reads only, and nothing is written', async ({ page }) => {
    // Evidence for the report: with Wikidata blocked, cached() never reaches the
    // fireSet() call at awards.js:283, so this whole phase is read-only against
    // Firestore by construction. Recorded here so the claim is measured.
    const cloud: { method: string; url: string }[] = [];
    page.on('request', r => {
      if (/googleapis\.com|firestore/.test(r.url())) cloud.push({ method: r.method(), url: r.url() });
    });
    await open(page, `/awards/${TGA}`);
    await expect(page.getByText('Game of the Year')).toBeVisible();
    // Every cloud request was aborted by blockCloud(); none of them carried a
    // Firestore commit.
    expect(cloud.filter(c => /\/Commit|\/Write/.test(c.url))).toEqual([]);
  });
});
