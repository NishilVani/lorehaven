// IGDB game-metadata cache (localStorage).
//
// Covers, developer, release date, ratings and platforms barely change once a
// game ships, so we serve them from localStorage and only hit the network for
// games we've never seen. Stale entries are served instantly and refreshed in
// the background (stale-while-revalidate). First load fills the cache; every
// load after is instant.
//
// ponytail: 7-day TTL + drop-oldest on quota; move to per-game TTL only if a
// game's metadata ever needs to refresh faster than that.

export const GAMES_CACHE_KEY = 'moctale_igdb_games_cache';
export const GAMES_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const GAMES_CACHE_MAX = 3000;                    // ~ a few MB of localStorage

/* This cache's share of the origin's localStorage budget, in UTF-16 code units
   (what `.length` counts, and what browsers meter the quota in).
   GAMES_CACHE_MAX alone was a guess — "3000 entries, a few MB" — that nothing
   ever measured against the ~5MB the whole origin gets. A full library fills it,
   and the next write to ask for room is the user's own library, which throws
   because a rebuildable cache already took the space. A cache does not get to
   evict the one thing here that cannot be refetched.

   1M chars is ~2MB in UTF-16, under half of the pessimistic reading of the
   budget, and holds on the order of a thousand games. What it leaves behind is
   the point: the library, its update snapshot (a second copy of the library),
   the shelves and the awards cache all have to live in the same 5MB. */
export const GAMES_CACHE_MAX_CHARS = 1024 * 1024;

/** Read the cache map { [id]: { data, ts } }. Never throws. */
export const readGamesCache = () => {
  try { return JSON.parse(localStorage.getItem(GAMES_CACHE_KEY)) || {}; }
  catch { return {}; }
};

/** The freshest entries that fit both ceilings, newest first. PURE — no I/O. */
export const fitGamesCache = (cache) => {
  let entries = Object.entries(cache).sort((a, b) => b[1].ts - a[1].ts);
  if (entries.length > GAMES_CACHE_MAX) entries = entries.slice(0, GAMES_CACHE_MAX);

  /* Trim proportionally rather than one entry at a time: entries are near-uniform
     in size, so the first guess lands within a few percent and this converges in
     one or two passes over a list that is only stringified on a cache write. */
  let json = JSON.stringify(Object.fromEntries(entries));
  while (json.length > GAMES_CACHE_MAX_CHARS && entries.length > 1) {
    const guess = Math.floor(entries.length * GAMES_CACHE_MAX_CHARS / json.length);
    entries = entries.slice(0, Math.max(1, Math.min(guess, entries.length - 1)));
    json = JSON.stringify(Object.fromEntries(entries));
  }
  return { entries, json };
};

/** Persist the cache, bounded to what fits its share of the budget. Never throws. */
export const writeGamesCache = (cache) => {
  const { entries, json } = fitGamesCache(cache);
  try {
    localStorage.setItem(GAMES_CACHE_KEY, json);
  } catch {
    // Something else on the origin took the room. Keep the freshest half and
    // retry once; give up quietly rather than fail a user action over a cache.
    const half = Object.fromEntries(entries.slice(0, Math.floor(entries.length / 2)));
    try { localStorage.setItem(GAMES_CACHE_KEY, JSON.stringify(half)); }
    catch { try { localStorage.removeItem(GAMES_CACHE_KEY); } catch { /* nothing left to do */ } }
  }
};

/**
 * How long "IGDB has no such game" is believed before asking again.
 *
 * Shorter than GAMES_CACHE_TTL because absence is the less durable fact of the
 * two: IGDB adds games, and merges duplicate entries so a retired id can start
 * resolving to its survivor. A day is long enough that a library full of dead
 * ids costs one request rather than one per page view, and short enough that a
 * game which appears tomorrow is picked up tomorrow.
 */
export const GAMES_ABSENT_TTL = 24 * 60 * 60 * 1000; // 1 day

/** A cache entry recording that IGDB returned nothing for this id. */
const isAbsent = (hit) => hit.data === null;

/**
 * Split requested ids against the cache. PURE — no I/O.
 * @returns {{ cachedData: object[], missing: (number|string)[], stale: (number|string)[] }}
 *   cachedData — game objects to return immediately (fresh OR stale)
 *   missing    — never cached; must be fetched before returning (blocking)
 *   stale      — cached but past its TTL; refresh in the background
 *
 * An id IGDB has no record of is cached as a tombstone rather than left out. It
 * used to fall into `missing` on every single call, so a library holding one
 * delisted or mis-imported id paid a blocking network round trip for it on every
 * page that asks — measured: three consecutive calls for 120 unknown ids cost
 * 1147ms, 1614ms and 1134ms, each making the same two requests and learning the
 * same nothing. A tombstone answers instantly and re-checks once a day.
 *
 * A stale tombstone goes to `stale`, never to `missing`: we already know there is
 * nothing to return for it, so blocking the caller on that re-check buys nobody
 * anything. The background pass corrects it if the game has since appeared.
 */
export const partitionByCache = (ids, cache, now, ttl) => {
  const cachedData = [], missing = [], stale = [];
  for (const id of ids) {
    const hit = cache[String(id)];
    if (!hit) { missing.push(id); continue; }
    if (isAbsent(hit)) {
      if (now - hit.ts > GAMES_ABSENT_TTL) stale.push(id);
      continue;
    }
    cachedData.push(hit.data);
    if (now - hit.ts > ttl) stale.push(id);
  }
  return { cachedData, missing, stale };
};

/** Merge freshly fetched games into a cache object, stamping each with `now`. Returns the cache. */
export const mergeIntoCache = (cache, games, now) => {
  games.forEach(g => { if (g && g.id != null) cache[String(g.id)] = { data: g, ts: now }; });
  return cache;
};

/**
 * Record that IGDB returned nothing for these ids. Returns the cache.
 *
 * Only ever called after a request that actually SUCCEEDED and simply did not
 * include them. Tombstoning on a failed request would be the same bug pointed
 * the other way: one offline moment would hide real games for a day.
 */
export const markAbsent = (cache, ids, now) => {
  ids.forEach(id => { if (id != null) cache[String(id)] = { data: null, ts: now }; });
  return cache;
};

/** The ids that were asked for and did not come back. PURE. */
export const absentFrom = (asked, got) => {
  const found = new Set(got.map(g => String(g?.id)));
  return asked.filter(id => !found.has(String(id)));
};

// ─────────────────────────────────────────────────────────────────────────────
// Generic keyed cache — for any IGDB response (game details, franchises, genres,
// release calendars…). Whole-result cache keyed by (namespace + args), with the
// same stale-while-revalidate contract as the per-game cache above.
// ─────────────────────────────────────────────────────────────────────────────

export const KV_CACHE_KEY = 'moctale_igdb_kv';
export const KV_CACHE_MAX = 600; // distinct cached views; drop-oldest beyond this

/* A byte ceiling as well as an entry count, for the reason spelled out above
   GAMES_CACHE_MAX_CHARS: entries are the wrong unit. A measured sample of this
   store held 6 views in 92 KB, so 600 entries is somewhere around 9 MB of intent
   against a ~5 MB origin budget -- it could only ever be enforced by
   localStorage throwing, at which point writeKv halves the store and it grows
   back. A sawtooth, with every page paying the parse.

   512K chars is ~1 MB in UTF-16. The games cache next door has already claimed
   1M chars, a 1000-game library is 310K, and lh_lib_snapshot is another copy of
   it; this is what is left over with room to spare. */
export const KV_CACHE_MAX_CHARS = 512 * 1024;

/**
 * Bump when a cached shape changes or a bug lets bad data in — the whole store is
 * dropped on the next read instead of waiting out TTLs of up to a month.
 *
 * v2: entries written before error payloads were rejected could hold
 * `{ message: "Authorization Failure..." }`, which crashed callers doing .map().
 *
 * v3: the hero artwork picker needs artworks.alpha_channel and
 * artworks.artwork_type, which the discovery, trending and hero queries did not
 * used to ask for. Cached rows are keyed by the call, not by the field list, so
 * without this bump a browser would keep serving artwork-blind rows for up to a
 * week and the fix would look like it had not worked.
 */
export const KV_CACHE_VERSION = 3;
const KV_VERSION_KEY = 'moctale_igdb_kv_v';

/** TTL presets — how long a view stays fresh before a background refresh. */
export const TTL = {
  HOUR:  60 * 60 * 1000,
  SIXH:  6 * 60 * 60 * 1000,
  DAY:   24 * 60 * 60 * 1000,
  WEEK:  7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
};

/* Drop the whole store once if it was written by an older cache version. */
let versionChecked = false;
const ensureKvVersion = () => {
  if (versionChecked) return;
  versionChecked = true;
  try {
    if (Number(localStorage.getItem(KV_VERSION_KEY)) !== KV_CACHE_VERSION) {
      localStorage.removeItem(KV_CACHE_KEY);
      localStorage.setItem(KV_VERSION_KEY, String(KV_CACHE_VERSION));
      kvMemo = { raw: undefined, store: null };
    }
  } catch { /* storage unavailable — behave as an empty cache */ }
};

/* The parsed store, held here so a page does not re-parse it per cached call.
 *
 * withCache goes through kvGet on every call and kvSet on every miss, and both
 * used to round-trip the whole store through JSON. Measured at 92 KB that was
 * 0.36ms to parse and 0.17ms to serialise, per call -- about 4ms per megabyte,
 * against a store with no byte ceiling until now.
 *
 * `raw` is the string this was parsed from. Reading a string out of
 * localStorage is cheap; parsing it is not, so every call still reads and
 * compares, and only a store that actually changed is parsed again. That is
 * also what keeps a second tab's writes visible. Writes update the memo with
 * the object and the string they just produced, so the app's own writes never
 * cause a re-parse. */
let kvMemo = { raw: undefined, store: null };

const readKv = () => {
  ensureKvVersion();
  const raw = localStorage.getItem(KV_CACHE_KEY);
  if (kvMemo.store && raw === kvMemo.raw) return kvMemo.store;
  try {
    const store = JSON.parse(raw) || {};
    kvMemo = { raw, store };
    return store;
  } catch { return {}; }
};

/** The freshest entries that fit both ceilings. PURE — no I/O. */
export const fitKv = (kv) => {
  let entries = Object.entries(kv).sort((a, b) => b[1].ts - a[1].ts);
  if (entries.length > KV_CACHE_MAX) entries = entries.slice(0, KV_CACHE_MAX);
  /* Same proportional trim as fitGamesCache: cached views vary in size far more
     than game rows do, so this converges in a few passes rather than one, but it
     still beats dropping one entry at a time and re-serialising each time. */
  let json = JSON.stringify(Object.fromEntries(entries));
  while (json.length > KV_CACHE_MAX_CHARS && entries.length > 1) {
    const guess = Math.floor(entries.length * KV_CACHE_MAX_CHARS / json.length);
    entries = entries.slice(0, Math.max(1, Math.min(guess, entries.length - 1)));
    json = JSON.stringify(Object.fromEntries(entries));
  }
  return { entries, json };
};

const writeKv = (kv) => {
  const { entries, json } = fitKv(kv);
  const store = entries.length === Object.keys(kv).length ? kv : Object.fromEntries(entries);
  try {
    localStorage.setItem(KV_CACHE_KEY, json);
    kvMemo = { raw: json, store };
  } catch {
    const half = Object.fromEntries(entries.slice(0, Math.floor(entries.length / 2)));
    try {
      const halfJson = JSON.stringify(half);
      localStorage.setItem(KV_CACHE_KEY, halfJson);
      kvMemo = { raw: halfJson, store: half };
    } catch {
      try { localStorage.removeItem(KV_CACHE_KEY); } catch { /* nothing more to do */ }
      kvMemo = { raw: undefined, store: null };
    }
  }
};

/** Look up a cached view. Returns { data, stale } or undefined on a miss. */
export const kvGet = (key, now) => {
  const hit = readKv()[key];
  if (!hit) return undefined;
  return { data: hit.data, stale: now - hit.ts > hit.ttl };
};

/** Store a cached view with its own TTL. */
export const kvSet = (key, data, ttl, now) => {
  const kv = readKv();
  kv[key] = { data, ts: now, ttl };
  writeKv(kv);
};

/** Drop a single cached view — used to evict entries poisoned by a failed response. */
export const kvDelete = (key) => {
  const kv = readKv();
  if (key in kv) {
    delete kv[key];
    writeKv(kv);
  }
};

/**
 * IGDB signals failure with a JSON *object* carrying a message — e.g. a 401 returns
 * { message: "Authorization Failure..." }. It is neither null nor an empty array, so
 * without this check it passed isCacheable() and a transient auth blip got pinned in
 * the cache for its full TTL (up to a month), long outliving the actual problem.
 * No legitimate cached payload (game rows, hero objects) carries a `message`.
 */
const isErrorRow = (x) => x != null && typeof x === 'object' && !Array.isArray(x)
  && (typeof x.message === 'string' || (typeof x.status === 'number' && x.status >= 400 && typeof x.title === 'string'));
/* { message } or IGDB's 4xx body, [{ title, status, cause }]. */
const isIgdbError = (data) =>
  Array.isArray(data) ? (data.length > 0 && data.every(isErrorRow)) : isErrorRow(data);

/** A result worth caching — not null/undefined, not an error, and not an empty array. */
const isCacheable = (data) =>
  data != null && !isIgdbError(data) && !(Array.isArray(data) && data.length === 0);

/* One fetch per cache key at a time.
 *
 * A cache only helps once something has been cached. Two callers that miss the
 * same key in the same tick both used to fetch, and a page whose components
 * mount together does exactly that -- measured on the production build, Explore
 * made three requests for two distinct queries and Collections four for three.
 * A run of stale hits was worse: every one of them started its own background
 * refresh of the same key.
 *
 * The same single-flight shape as getToken in functions/proxy.js, for the same
 * reason. The map holds the promise, so late callers await the request already
 * running instead of starting another, and the entry is deleted whether it
 * settles or throws. */
const inFlight = new Map();

const shared = (key, run) => {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
};

/**
 * Wrap an async fetch fn with stale-while-revalidate KV caching.
 * Cache key = `${ns}:${JSON.stringify(args)}`. A cached result returns instantly
 * (even if stale) and stale entries refresh in the background so the next call is
 * fresh. Empty/null results are never cached, so a transient failure never sticks.
 * Concurrent callers of the same key share one request.
 *
 * `.fresh(...args)` skips the read and keeps the write, for an action a person
 * takes to see what IGDB holds now. A Reload button routed through the cached
 * call re-read an entry up to a week old and issued no request at all.
 */
export const withCache = (ns, ttl, fn) => {
  const keyFor = (args) => `${ns}:${JSON.stringify(args)}`;

  /* Fetch and store, as one unit, so waiters that joined mid-flight do not each
     write the same result back. */
  const fetchAndStore = (key, args) => shared(key, async () => {
    const data = await fn(...args);
    if (isCacheable(data)) kvSet(key, data, ttl, Date.now());
    return data;
  });

  const cached = async (...args) => {
    const key = keyFor(args);
    const hit = kvGet(key, Date.now());

    // Discard entries poisoned before the isCacheable() guard existed. Their TTLs run
    // up to a month, so without this an already-affected user stays broken long after
    // auth recovers. Treating it as a miss self-heals on the next call.
    if (hit && isIgdbError(hit.data)) {
      kvDelete(key);
      return fetchAndStore(key, args);
    }
    if (hit) {
      if (hit.stale) {
        /* Best-effort, and not awaited: the caller gets the stale copy now. */
        fetchAndStore(key, args).catch(() => { /* background refresh is best-effort */ });
      }
      return hit.data;
    }
    return fetchAndStore(key, args);
  };

  /* Joining a request already in flight is still fresh: it started after
     anything that is cached. */
  cached.fresh = (...args) => fetchAndStore(keyFor(args), args);
  return cached;
};
