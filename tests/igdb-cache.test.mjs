/**
 * Regression test for the "Authorization Failure" crash.
 *
 * When IGDB rejects a request it responds 401 with a JSON *object*
 * ({ message: "Authorization Failure..." }), not an array. Two bugs compounded:
 *
 *   1. Six withCache-wrapped fetchers returned `await response.json()` unguarded,
 *      so that object reached callers doing `rows.map(...)` -> TypeError. Callers'
 *      `.catch(() => [])` never fired because the promise RESOLVED, not rejected.
 *   2. isCacheable() accepted it (non-null, not an empty array), so the poisoned
 *      value was cached for 6h-1 month and the crash outlived the auth problem.
 *
 * Run: node tests/igdb-cache.test.mjs
 */
import assert from 'node:assert/strict';

// Minimal localStorage stub — igdbCache.js is browser code.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const { withCache, TTL } = await import('../src/services/igdbCache.js');

const AUTH_ERROR = { message: 'Authorization Failure. Have you tried:' };
let calls = 0;

// A fetcher that fails auth on the first call, then recovers — exactly the real
// scenario: token expires, request fails, token refreshes.
const flaky = withCache('test:flaky', TTL.SIXH, async () => {
  calls += 1;
  return calls === 1 ? AUTH_ERROR : [{ id: 1, name: 'Recovered' }];
});

const first = await flaky();
const second = await flaky();

// 1. A failure must never be cached, so the retry must actually re-run the fetcher.
assert.equal(calls, 2,
  `failure was cached: fetcher ran ${calls}x, so the poisoned entry was served instead of retrying`);

// 2. Once auth recovers the caller must get real data.
assert.ok(Array.isArray(second), `expected an array after recovery, got ${JSON.stringify(second)}`);
assert.equal(second[0].name, 'Recovered');

// 3. Whatever a failure returns, it must never explode a caller doing .map().
assert.doesNotThrow(() => (Array.isArray(first) ? first : []).map(x => x),
  'callers must be able to treat the result as a list');

// 4. Heal caches that were ALREADY poisoned before this fix shipped. Those entries
//    carry TTLs up to a month, so without a read-side guard existing users stay
//    broken long after auth recovers.
const { KV_CACHE_KEY } = await import('../src/services/igdbCache.js');
store.clear();
localStorage.setItem(KV_CACHE_KEY, JSON.stringify({
  'test:poisoned:[]': { data: AUTH_ERROR, ts: Date.now(), ttl: TTL.MONTH },
}));

let poisonedCalls = 0;
const poisoned = withCache('test:poisoned', TTL.MONTH, async () => {
  poisonedCalls += 1;
  return [{ id: 2, name: 'Healed' }];
});
const healed = await poisoned();

assert.equal(poisonedCalls, 1,
  'a pre-existing poisoned entry was served instead of being discarded and re-fetched');
assert.ok(Array.isArray(healed) && healed[0].name === 'Healed',
  `expected healed array, got ${JSON.stringify(healed)}`);

// 6. A version bump must drop the whole store, so a future bad shape self-clears
//    instead of waiting out TTLs of up to a month.
store.clear();
localStorage.setItem(KV_CACHE_KEY, JSON.stringify({
  'stale:shape:[]': { data: [{ old: true }], ts: Date.now(), ttl: TTL.MONTH },
}));
localStorage.setItem('moctale_igdb_kv_v', '1');           // pretend an older version wrote it

// The version check runs once per module load (cheap, and correct for a real page
// load). Import a FRESH instance so that once-per-load check actually runs here —
// the earlier tests in this file already tripped it on the first instance.
const fresh = await import('../src/services/igdbCache.js?fresh=1');

let versionedCalls = 0;
const versioned = fresh.withCache('stale:shape', TTL.MONTH, async () => {
  versionedCalls += 1;
  return [{ old: false }];
});
await versioned();
assert.equal(versionedCalls, 1,
  'an entry written by an older cache version was served instead of being dropped');

// NOTE: asRows()/igdbErrorMessage() in src/services/igdb.js are deliberately NOT
// imported here — that module does `import ... from './igdbCache'` (extensionless),
// which Vite resolves but plain node ESM cannot. Their behaviour is covered by the
// browser check in the same change rather than by modifying working source just to
// make it node-loadable.

console.log('igdb-cache: all assertions passed');

// ─────────────────────────────────────────────────────────────────────────────
// Negative caching for ids IGDB has no record of.
//
// An id that came back empty was never written to the cache, so it fell into
// `missing` on every call and cost a blocking round trip forever. Measured in a
// real browser before the fix: three consecutive calls for 120 unknown ids took
// 1147ms, 1614ms and 1134ms, each issuing the same two requests and learning the
// same nothing. A delisted game, a merged IGDB entry or one bad import row was
// enough to put that on every page that reads the library.
// ─────────────────────────────────────────────────────────────────────────────
const { partitionByCache, mergeIntoCache, markAbsent, absentFrom, GAMES_CACHE_TTL, GAMES_ABSENT_TTL }
  = await import('../src/services/igdbCache.js');

const NOW = 1_700_000_000_000;
const game = (id) => ({ id, name: `Game ${id}` });

// absentFrom is the "what did we not get back" primitive.
assert.deepEqual(absentFrom([1, 2, 3], [game(2)]), [1, 3]);
assert.deepEqual(absentFrom([1, 2], [game(1), game(2)]), []);
assert.deepEqual(absentFrom(['7'], [game(7)]), [], 'ids compare as strings, not by type');

// A tombstoned id is answered from cache, contributes no data, and blocks nobody.
{
  const cache = markAbsent(mergeIntoCache({}, [game(1)], NOW), [2], NOW);
  const p = partitionByCache([1, 2], cache, NOW, GAMES_CACHE_TTL);
  assert.deepEqual(p.cachedData, [game(1)], 'a tombstone must not surface as a null game');
  assert.deepEqual(p.missing, [], 'a known-absent id must never be re-requested as blocking work');
  assert.deepEqual(p.stale, []);
}

// It expires on its own, shorter clock — absence is the less durable fact.
{
  const cache = markAbsent({}, [2], NOW);
  const justBefore = partitionByCache([2], cache, NOW + GAMES_ABSENT_TTL - 1, GAMES_CACHE_TTL);
  assert.deepEqual(justBefore.stale, [], 'still believed inside its TTL');

  const after = partitionByCache([2], cache, NOW + GAMES_ABSENT_TTL + 1, GAMES_CACHE_TTL);
  assert.deepEqual(after.stale, [2], 'past its TTL it is re-checked');
  assert.deepEqual(after.missing, [],
    'and re-checked in the BACKGROUND — blocking a caller on an id known to return nothing helps nobody');
  assert.deepEqual(after.cachedData, []);
}

assert.ok(GAMES_ABSENT_TTL < GAMES_CACHE_TTL,
  'absence must be re-checked sooner than data is refreshed: IGDB adds games and merges duplicate ids');

// A game that later appears overwrites its own tombstone.
{
  const cache = markAbsent({}, [2], NOW);
  mergeIntoCache(cache, [game(2)], NOW + 1);
  const p = partitionByCache([2], cache, NOW + 2, GAMES_CACHE_TTL);
  assert.deepEqual(p.cachedData, [game(2)], 'a tombstone must not outlive the game arriving');
  assert.deepEqual(p.stale, []);
}

// Real data keeps its own TTL, unaffected by the absent clock.
{
  const cache = mergeIntoCache({}, [game(1)], NOW);
  const mid = partitionByCache([1], cache, NOW + GAMES_ABSENT_TTL + 1, GAMES_CACHE_TTL);
  assert.deepEqual(mid.stale, [], 'a real game is not stale merely because a tombstone would be');
  const old = partitionByCache([1], cache, NOW + GAMES_CACHE_TTL + 1, GAMES_CACHE_TTL);
  assert.deepEqual(old.stale, [1]);
  assert.deepEqual(old.cachedData, [game(1)], 'stale data is still served while it refreshes');
}

console.log('igdb-cache: negative-caching assertions passed');

// ─────────────────────────────────────────────────────────────────────────────
// The games cache must stay inside its share of the origin's storage budget.
//
// It did not. GAMES_CACHE_MAX capped it at 3000 entries — a guess, never
// measured — while localStorage gives the whole origin about 5MB. A large
// library filled the cache, and then saveToLibrary threw QuotaExceededError out
// of a click handler because a cache that can be refetched had taken the room
// the library needs. Reported as: "Setting the value of 'moctale_library'
// exceeded the quota".
// ─────────────────────────────────────────────────────────────────────────────
const { fitGamesCache, GAMES_CACHE_MAX_CHARS: MAX_CHARS, GAMES_CACHE_MAX: MAX_N, writeGamesCache }
  = await import('../src/services/igdbCache.js');

// Mirrors the field list _fetchGamesByIds actually asks IGDB for — no summary,
// but screenshots, artworks, platforms and companies, which is where the bulk is.
const fatGame = (id) => ({
  data: {
    id, name: `A Fairly Long Game Title ${id}`, game_type: 0,
    cover: { image_id: `co1a2b3${id}`, width: 264, height: 374 },
    screenshots: Array.from({ length: 8 }, (_, i) => ({ image_id: `sc9x8y${id}_${i}` })),
    artworks: Array.from({ length: 4 }, (_, i) => ({ image_id: `ar4k5j${id}_${i}` })),
    first_release_date: 1600000000 + id, total_rating: 84.2, rating: 83.1, follows: 412, hypes: 9,
    involved_companies: [
      { company: { name: `Studio Number ${id}` }, developer: true, publisher: false },
      { company: { name: `Publisher Number ${id}` }, developer: false, publisher: true },
    ],
    platforms: [
      { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC', platform_logo: { image_id: 'plim13' } },
      { id: 48, name: 'PlayStation 4', abbreviation: 'PS4', platform_logo: { image_id: 'plcv' } },
    ],
    franchises: [{ name: `Franchise ${id}` }], collections: [{ name: `Series ${id}` }],
  },
  ts: NOW + id,
});

{
  const big = Object.fromEntries(Array.from({ length: MAX_N }, (_, i) => [String(i), fatGame(i)]));
  const { entries, json } = fitGamesCache(big);

  assert.ok(json.length <= MAX_CHARS,
    `cache serialized to ${json.length} chars, over its ${MAX_CHARS} budget — this is what squeezes the library out`);
  assert.ok(entries.length > 0, 'the budget must still leave a usable cache, not trim to nothing');
  assert.ok(entries.length < MAX_N,
    'this fixture is meant to exceed the budget; it no longer does, so the test proves nothing');

  // Freshest survive: ts ascends with id, so the highest ids must be the keepers.
  const kept = entries.map(([k]) => Number(k));
  assert.equal(Math.min(...kept), MAX_N - kept.length,
    'trimming must drop the oldest entries, not an arbitrary slice');
}

// Under budget, nothing is dropped.
{
  const small = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), fatGame(i)]));
  assert.equal(fitGamesCache(small).entries.length, 5, 'a cache that fits must be written whole');
}

// The whole point: a full cache plus the user data it shares the origin with must
// stay inside the budget. localStorage is 5MB, and the pessimistic reading of that
// is 2.5M UTF-16 chars, so that is what this holds the total to.
{
  const ORIGIN_CHARS = 2.5 * 1024 * 1024;
  const LIBRARY_CHARS = 2100 * 300;   // the reported library, at a curated entry each
  const SNAPSHOT_CHARS = LIBRARY_CHARS; // lh_lib_snapshot is a second copy of it
  store.clear();
  writeGamesCache(Object.fromEntries(Array.from({ length: MAX_N }, (_, i) => [String(i), fatGame(i)])));
  const cacheChars = [...store.values()].reduce((n, v) => n + v.length, 0);
  assert.ok(cacheChars + LIBRARY_CHARS + SNAPSHOT_CHARS < ORIGIN_CHARS,
    `cache took ${cacheChars} chars; the library (${LIBRARY_CHARS}) and its snapshot must still fit beside it in ${ORIGIN_CHARS}`);
}

console.log('igdb-cache: storage-budget assertions passed');

// ─────────────────────────────────────────────────────────────────────────────
// A user-initiated reload must reach the network.
//
// Wallpapers' Reload button called the same withCache-wrapped fetcher as the
// mount, and that entry lives for a week, so the press re-read the cache and
// issued no request at all. A reload that fails at IGDB therefore went on
// showing the old plates, and one that would succeed showed nothing new.
// Caught by tests/phase6-deep.spec.ts cases 28 and 41.
// ─────────────────────────────────────────────────────────────────────────────
{
  store.clear();
  let requests = 0;
  const view = withCache('test:reload', TTL.WEEK, async (id) => {
    requests += 1;
    return [{ id, answer: requests }];
  });

  await view(7);
  await view(7);
  assert.equal(requests, 1, 'precondition: a second read inside the TTL is served from cache');

  assert.equal(typeof view.fresh, 'function', 'a cached fetcher must offer a way to bypass its cache');
  const reloaded = await view.fresh(7);
  assert.equal(requests, 2, 'fresh() must issue a request even while the cached copy is inside its TTL');
  assert.equal(reloaded[0].answer, 2);

  const next = await view(7);
  assert.equal(requests, 2, 'the refetch is written back, so the next ordinary read is a cache hit');
  assert.equal(next[0].answer, 2, 'and that hit is the refetched copy, not the one it replaced');
}

console.log('igdb-cache: reload-bypass assertions passed');
