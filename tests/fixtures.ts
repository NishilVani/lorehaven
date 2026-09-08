import type { Page } from '@playwright/test';

/**
 * Seeded state for the routes that render nothing without it.
 *
 * ALL OF IT IS localStorage. Nothing here touches Firestore, and nothing here
 * needs a signed-in user: `src/services/db.js` keeps the library, collections,
 * saved franchises, saved IGDB collections, preferences and recommendation
 * feedback in `moctale_*` localStorage keys, and only mirrors them to the cloud
 * once Firebase auth reports a user. Signed out, the app is complete and local
 * — which is what makes an unattended QA run safe here.
 *
 * Every helper uses `page.addInitScript`, so the write lands BEFORE the app's
 * first render. Seeding after `goto` is a race: `Library.jsx` reads
 * `getLibrary()` in a mount effect, so a late write shows an empty shelf until
 * something else re-renders it.
 *
 * Call the helper, THEN goto:
 *     await seedLibrary(page);
 *     await page.goto('/library/backlog');
 */

/** localStorage keys, from src/services/db.js:320-963. */
export const KEYS = {
  library: 'moctale_library',
  profile: 'moctale_user_profile',
  franchises: 'moctale_franchises',
  collections: 'moctale_collections',
  savedIgdbCollections: 'moctale_saved_igdb_collections',
  prefs: 'moctale_prefs',
  recFeedback: 'moctale_rec_feedback',
  tabSettings: 'moctale_tab_settings',
  recentSearches: 'recentSearches',
  recentGames: 'recentGames',
} as const;

/**
 * One game per shelf, so every shelf tab has content and every sort and
 * group-by axis has something to reorder.
 *
 * The ids are real IGDB rows so `/game/:id` from a card resolves, but the
 * library grid itself renders from these stored fields alone — `Library.jsx`
 * reads localStorage, not IGDB — so a shelf is testable with the network down.
 *
 * `feel` only ever belongs on Beaten (the card suppresses a priority there),
 * `dateCompleted` likewise; the Beaten row carries both so the Completion Year
 * grouping and the Completed sorts have a value to work with.
 */
export const SEED_LIBRARY = [
  {
    id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Beaten', is_custom: false,
    cover_id: 'coaarl', release_year: 2015, first_release_date: 1431993600,
    total_rating: 93, cover_width: 264, cover_height: 374,
    feel: 'Perfection', dateCompleted: '2024-03-14',
    notes: 'Seeded by tests/fixtures.ts',
  },
  {
    id: 1020, name: 'Grand Theft Auto V', status: 'Playing', is_custom: false,
    cover_id: 'co2lbd', release_year: 2013, first_release_date: 1379376000,
    total_rating: 91, cover_width: 264, cover_height: 374, priority: 'Next Up',
  },
  {
    id: 1905, name: 'Fortnite', status: 'Backlog', is_custom: false,
    cover_id: 'cocqrm', release_year: 2017, first_release_date: 1500940800,
    total_rating: 74, cover_width: 264, cover_height: 374, priority: 'Someday',
  },
  {
    id: 119171, name: 'Baldur’s Gate 3', status: 'Wishlist', is_custom: false,
    cover_id: 'co670h', release_year: 2023, first_release_date: 1691020800,
    total_rating: 95, cover_width: 264, cover_height: 374, priority: 'Soon',
  },
  {
    id: 472, name: 'The Elder Scrolls V: Skyrim', status: 'Dropped', is_custom: false,
    cover_id: 'cocs1l', release_year: 2004, first_release_date: 1100476800,
    total_rating: 92, cover_width: 264, cover_height: 374,
  },
  {
    /* Custom + Unreleased on purpose. The Unreleased shelf rejects a move for
       anything that is neither (Library.jsx:979-982), so a shelf seeded with an
       ordinary IGDB row could not exercise that guard at all. */
    id: 'custom-seed-1', name: 'A Seeded Custom Entry', status: 'Unreleased',
    is_custom: true, cover_id: null, release_year: 2027,
    first_release_date: Math.floor(Date.UTC(2027, 5, 1) / 1000),
    cover_width: 264, cover_height: 374, priority: 'Maybe',
  },
];

/** A local collection. `/collection/:id` needs one of these to render anything. */
export const SEED_COLLECTIONS = [
  {
    id: 'seed-collection-1',
    name: 'Seeded Collection',
    description: 'Created by tests/fixtures.ts for route coverage.',
    games: [1942, 1020],
    createdAt: 1700000000000,
  },
];

/** Marks that make /feedback non-empty — one of each verdict. */
export const SEED_REC_FEEDBACK = [
  { id: 1905, name: 'Fortnite', cover_id: 'co2ekt', verdict: 'not_interested' },
  { id: 472, name: 'The Elder Scrolls V: Skyrim', cover_id: 'cocs1l', verdict: 'interested' },
];

/** Write arbitrary localStorage keys before the app boots. */
export async function seed(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((payload: Record<string, string>) => {
    for (const [k, v] of Object.entries(payload)) window.localStorage.setItem(k, v);
  }, Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
}

/** Six games, one per shelf. */
export async function seedLibrary(page: Page, games = SEED_LIBRARY) {
  await seed(page, { [KEYS.library]: games });
}

/** A local collection, for /collections > Saved and /collection/:id. */
export async function seedCollections(page: Page, collections = SEED_COLLECTIONS) {
  await seed(page, { [KEYS.collections]: collections });
}

/** Interested / Not Interested marks, for /feedback. */
export async function seedFeedback(page: Page, items = SEED_REC_FEEDBACK) {
  await seed(page, { [KEYS.recFeedback]: items });
}

/** Everything at once — the state a "returning user" phase should start from. */
export async function seedAll(page: Page) {
  await seed(page, {
    [KEYS.library]: SEED_LIBRARY,
    [KEYS.collections]: SEED_COLLECTIONS,
    [KEYS.recFeedback]: SEED_REC_FEEDBACK,
    [KEYS.franchises]: [{ id: 24, name: 'The Witcher' }],
    [KEYS.savedIgdbCollections]: [],
    [KEYS.profile]: { name: 'QA Seed', platforms: [], custom_platforms: [] },
  });
}

/** The id of the seeded local collection, for building /collection/:id. */
export const SEED_COLLECTION_ID = SEED_COLLECTIONS[0].id;

/** Console lines that are environment, not product. One copy for every spec:
 *  five copies drifted and only matched Chromium's spelling of a blocked
 *  request, so Firefox ("Cross-Origin Request Blocked") and WebKit ("due to
 *  access control checks") reported product errors that were the filter. */
export const KNOWN_NOISE =
  /favicon|net::ERR_|Failed to load resource|Download the React DevTools|IGDB Error|Too Many Requests|429|@firebase|images\.igdb\.com|img\.youtube\.com|googleapis|Failed to fetch IGDB keys from Firebase|client is offline|FirebaseError|installations|Could not reach Cloud Firestore|A network error \(such as timeout|Cross-Origin Request Blocked|access control checks|NetworkError when attempting to fetch|Load failed|IGDB credentials or token unavailable/i;
export const realErrors = (errs: string[]) => errs.filter(e => !KNOWN_NOISE.test(e));
