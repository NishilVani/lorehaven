// Pure-logic self-check for the IGDB cache. Run: node src/services/igdbCache.test.mjs
import assert from 'node:assert';
// Minimal localStorage so the KV cache + withCache can run under node.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const { partitionByCache, mergeIntoCache, GAMES_CACHE_TTL, withCache, TTL } = await import('./igdbCache.js');

const now = 1_000_000_000_000;
const cache = {
  '1': { data: { id: 1, name: 'Fresh' }, ts: now - 1000 },              // fresh
  '2': { data: { id: 2, name: 'Stale' }, ts: now - GAMES_CACHE_TTL - 1 }, // past TTL
};

// id 1 fresh → cached only; id 2 stale → cached AND flagged for refresh; id 3 unseen → missing
const { cachedData, missing, stale } = partitionByCache([1, 2, 3], cache, now, GAMES_CACHE_TTL);
assert.deepStrictEqual(cachedData.map(g => g.id).sort(), [1, 2], 'fresh+stale served from cache');
assert.deepStrictEqual(missing, [3], 'only unseen id is fetched (blocking)');
assert.deepStrictEqual(stale, [2], 'only past-TTL id is refreshed (background)');

// number vs string ids resolve to the same cache slot
assert.strictEqual(partitionByCache(['1'], cache, now, GAMES_CACHE_TTL).missing.length, 0, 'string id hits numeric key');

// merge stamps new entries and overwrites old ones
const merged = mergeIntoCache({ ...cache }, [{ id: 3, name: 'New' }, { id: 1, name: 'Updated' }], now + 5);
assert.strictEqual(merged['3'].ts, now + 5, 'new entry stamped');
assert.strictEqual(merged['1'].data.name, 'Updated', 'existing entry overwritten');
mergeIntoCache(merged, [null, {}], now); // null / id-less games ignored, no throw

// ── withCache: second call for the same args serves from cache (fn not re-run) ──
let calls = 0;
const fetchThing = withCache('thing', TTL.DAY, async (id) => { calls++; return { id, v: calls }; });
const a = await fetchThing(42);
const b = await fetchThing(42);
assert.strictEqual(calls, 1, 'withCache: underlying fn called once for repeated args');
assert.deepStrictEqual(b, a, 'withCache: second call returns the cached value');
const c = await fetchThing(99);
assert.strictEqual(calls, 2, 'withCache: different args miss the cache and fetch');

// empty/null results are not cached, so a transient failure never sticks
let emptyCalls = 0;
const fetchEmpty = withCache('empty', TTL.DAY, async () => { emptyCalls++; return []; });
await fetchEmpty(); await fetchEmpty();
assert.strictEqual(emptyCalls, 2, 'withCache: empty results are not cached');

console.log('igdbCache: all assertions passed');
