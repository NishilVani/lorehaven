# Performance and data-flow audit

Networking, IGDB calls, local library reads, per-feature save and sync, and
infinite scroll. Every number here was measured on this machine on 2026-09-06;
nothing is estimated unless it says so.

**Measured against the production build wherever a count could be inflated.**
React StrictMode is on in `main.jsx`, so the dev server runs every effect twice
and doubles request and read counts. The first pass of this audit read the dev
numbers and would have over-reported duplicate requests by 2x. Where dev and
production differ, both are given.

The probes are in `qa/2026-09-05-deep/` (`perf-audit.mjs`, `perf-library-cost.mjs`,
`perf-kv-cost.mjs`, `perf-dupe-requests.mjs`), untracked with the rest of `qa/`.
They are read-only: they load routes and count, and write nothing to Firestore.

One of them was wrong on the first pass and finding 6 carries the correction.
A probe is as much a claim as the finding it supports.

---

## What is already right

Worth stating, because the findings below are a short list against a lot of
deliberate work.

- Nearly every IGDB fetcher is wrapped in `withCache` with a TTL that suits how
  fast the data actually changes: `MONTH` for genres and platforms, `WEEK` for
  game detail, `SIXH` for trending. Stale entries serve instantly and refresh in
  the background.
- Absent ids are tombstoned rather than refetched forever, with a shorter TTL
  than present ones, and the reasoning is written down.
- Error payloads are refused by the cache, so a transient 401 cannot pin itself
  for a month.
- The games cache is bounded in **bytes**, not just entries, specifically so a
  rebuildable cache cannot evict the one thing that cannot be refetched.
- Card images are `loading="lazy"`.
- The Library route makes **zero** network requests; it is served entirely from
  local state.

---

## Findings, worst first

### 1. A large library will eventually exceed Firestore's document limit

**Severity: correctness. It will break, not slow down.**

Every synced domain is one Firestore document holding the whole collection, and
the library is one of them. Measured: a 1000-game library is **310 KB** of JSON.
Firestore's hard ceiling is 1 MiB per document, and `lh_lib_snapshot` is a
second, similarly sized copy of the same library.

The exact game count where this fails is **not measured** — Firestore's stored
representation is not the same bytes as the JSON — but the trajectory is
measured and the ceiling is fixed. Somewhere in the low thousands of games,
sync stops working, and the failure mode is a write that is rejected outright.

Fix: shard the library across documents (a document per few hundred games), or
move to a subcollection with a document per game. Either is a real piece of
work and wants doing before someone imports a Steam library of 4000 titles, not
after.

### 2. Nothing limits the rate of IGDB requests

**Severity: high. Already happening.**

Observed in the reporter's own console:

```
igdb.js:495 IGDB query failed (/api/games): Error: IGDB 429
    at getGamesForUpdates (igdb.js:602)
    at refreshLibraryUpdates (discover.js:405)
```

IGDB allows 4 requests per second per client id. `replayOrThrow` retries once
after a second, which recovers a single collision but prevents none, and there
is no concurrency cap anywhere: a page that mounts several components fires
their queries in parallel, and the library-update sweep chunks by 500 ids on top
of that.

This got more likely, not less, when the proxy landed: every client now shares
one client id through one Worker, so the 4/s budget is shared across all users
and all tabs.

Fix, cheapest first:
- A token bucket in `igdbGames` — 4 per second, queue the rest. About 15 lines.
- Better, later: the same limit in `functions/proxy.js`, where it can be shared
  across clients rather than each client policing only itself.

### 3. `getLibrary()` re-parses and re-migrates on every single call

**Severity: high. Scales with library size times cards on screen.**

`getLibrary` does `JSON.parse` of the whole library and then runs the migration
`map` over every game — completion-date normalisation, priority renames, the lot
— on **every call**, not once. Measured on the dev server:

| library | `getLibrary` | 34 cards x that |
|---|---|---|
| 100 games (31 KB) | 0.12 ms | 4 ms |
| 400 games (124 KB) | 0.31 ms | 11 ms |
| 1000 games (310 KB) | 1.31 ms | 45 ms |

That multiplier is real, because of finding 4.

Fix: run the migration once and cache the parsed array in module scope,
invalidated by the writes that already go through `setLocalItem`. The migration
is idempotent and only needs to run when the stored string changes.

### 4. Every card re-reads the whole library, and every library event re-reads it again

**Severity: high. Compounds finding 3.**

`GameCard.jsx:97` calls `getLibrary()` and `getRecFeedbackList()` per card, on
mount and again on every `moctale_lib_update` and `moctale_sync_update`.
Measured on the **production** build, Explore with 33 cards:

```
localStorage reads: 91
   38x  moctale_library
   33x  moctale_rec_feedback
    6x  moctale_igdb_kv   (37 KB parsed)
```

and one `moctale_lib_update` event — what a single card toggle dispatches —
costs 35 library reads and 33 feedback reads. At 1000 games that measured 32 ms
of blocking work for one toggle, with only 34 cards mounted. Explore reveals 24
more cards per scroll page with no upper bound, so this grows without limit as
the user scrolls.

Fix: lift the lookup. One subscription in the grid (or a context) that reads the
library once and passes each card its own entry, instead of every card reading
the whole thing. Finding 3's memoisation would also blunt it.

### 5. The KV cache parses and re-serialises the whole store on every call

**Severity: medium now, high later. Unbounded in bytes.**

`kvGet` calls `readKv()`, which parses the entire store; `kvSet` parses it,
mutates, re-serialises and writes all of it. `withCache` does this on every
cached call, hit or miss. Measured:

```
KV store: 6 cached views, 92 KB
  JSON.parse      0.36 ms   <- every kvGet, i.e. every withCache call
  JSON.stringify  0.17 ms   <- every kvSet, on top of a parse and a write
```

That is about 4 ms per megabyte parsed. Today it is cheap. The problem is the
ceiling: `KV_CACHE_MAX` is **600 entries with no byte limit**, and this sample
averages 15 KB per entry. The games cache has `GAMES_CACHE_MAX_CHARS` precisely
because entry counts are the wrong unit, and the comment there explains why at
length — the KV cache never learned it. A full store will grow until localStorage
throws, at which point `writeKv` halves it and it grows again: a sawtooth, with
every page paying tens of milliseconds of blocking JSON.

Game detail, production build: 26 localStorage reads parsing **520 KB**, and
Explore writes 107 KB across 3 KV writes.

Fix: two things, both small.
- Hold the parsed store in module scope and write through, instead of
  round-tripping localStorage per call.
- Give it a byte ceiling like the games cache has.

### 6. Concurrent cache misses each fire their own request

**Severity: medium.**

**Correction, after fixing it.** This finding originally claimed two duplicated
queries per cold session on the production build. That was wrong, and the error
was mine: the probe truncated each request body at 110 characters, and the
queries it called duplicates differ only in `limit` and `offset`, past the cut.
Read in full, every request on every route is distinct. The dev server's extra
requests were entirely StrictMode.

So there was no measured duplicate to fix. The defect is still real, but the
evidence for it is a direct test rather than a page load: `withCache` has no
single-flight, so callers that miss the same key in the same tick each fetch.
Five concurrent calls to one cached fetcher made **5 requests before, 1 after**.
A run of stale hits was the same shape — every one started its own background
refresh of the same key.

That is a cold-start and a mount-storm problem rather than something the current
routes trip on. Worth the ten lines, and the same pattern already exists in
`functions/proxy.js` for the Twitch token.

Fix: an in-flight map keyed by the cache key, resolved for all waiters. It fixes
the background stale-refresh path too, which today can start N refreshes for N
stale hits in one tick.

### 7. A cloud sync remounts the entire route tree

**Severity: medium.**

`App.jsx:57` bumps `syncKey` on `moctale_sync_update`, remounting every route.
The code already calls this out (`ponytail: remount-on-sync is blunt`). The cost
is now higher than when it was written, because of finding 4: a remount
re-mounts every card, and every card re-reads the whole library. It also throws
away scroll position and every infinite-scroll page the user had loaded.

Fix: per-page refresh driven by the same event, which several pages already
listen for directly. The remount can then go.

### 8. Infinite scroll runs an unthrottled scroll listener alongside the observer

**Severity: medium.**

`Discover.jsx:148`, `ExploreList.jsx:86` and `Collections.jsx:172` each register
an `IntersectionObserver` **and** a `scroll` listener that does

```js
window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700
```

on every scroll event. Reading `scrollHeight` forces layout, so this is a forced
reflow per scroll event, on exactly the pages with the most DOM. The observer
alone already does the job, with the browser doing the work off the main thread.

Two smaller things in the same code: `Discover`'s observer effect re-subscribes
on every `recVisible` change and `ExploreList`'s on every `items.length` change,
so both tear down and rebuild the observer once per page of results.

**Correction, after fixing it.** The recommendation above was to delete the
scroll listeners and stabilise the effect dependencies. Both halves were wrong,
and the code said so where the audit did not read carefully enough:

- `Collections.jsx:153` comments the listener as a deliberate fallback for
  webviews that throttle observers. Deleting it risks breaking infinite scroll
  in the Tauri webview, which is the environment hardest to test here.
- the re-subscription is load-bearing. An `IntersectionObserver` fires on a
  transition, so once the sentinel is already in view, revealing another page
  produces no new event. Re-creating the observer when the page count changes is
  what re-fires it. A stable dependency would stall paging after one page.

What was done instead: the listeners stay and are coalesced to one check per
frame with `requestAnimationFrame`, which bounds the forced layout at one per
frame however fast the events arrive.

Not demonstrated: a measured reduction in layout reads. Synthetic wheel events
do not arrive faster than a frame, so reads matched events both before and
after. The bound is structural rather than observed; a real flick on a device is
where it would show.

### 9. The import wizard saves the whole library once per imported row

**Severity: medium, and the one already agreed to fix.**

`ImportWizard.jsx:477` calls `saveToLibrary` inside a `forEach`, and each call
stringifies the entire library and writes it. That is O(n squared) in rows, and
it is what produced the Firestore write-queue exhaustion before the coalescing
fix in `919e528`.

Measured after coalescing: 200 saves cost 11 ms of loop and issue 1 cloud write.
So the local side is not urgent at 200 rows — but a 2000-row import is 100x that
work.

Fix: `saveManyToLibrary(games)` that merges once and writes once.

### 10. The proxy caches nothing

**Severity: opportunity, not a defect.**

`functions/proxy.js` forwards every request. Trending, genres, platforms and the
taxonomy queries are identical for every user, and the Worker runtime has a Cache
API that costs nothing on the free plan. Caching those responses at the edge
would cut IGDB traffic to roughly one request per query per TTL for the whole
user base, instead of one per user per cold cache, and would make finding 2 much
harder to trigger.

Worth doing when there is more than one user; not before.

---

## Not a problem, checked

- **Chunked id queries** (`getGamesProfile`, `getGamesForUpdates`) await each
  500-id chunk in sequence. That is slower than firing them in parallel and it
  is the right choice while there is no rate limiter.
- **`getGamesForUpdates` is deliberately uncached** — it is the freshness check
  itself, and caching it would defeat the feature.
- **Card images** are lazy-loaded and use `cover_big`; the hero uses `1080p`.
- **The Firestore snapshot listener** only dispatches when `applyDomainDoc`
  reports an actual change, so an echo of the app's own write does not remount
  anything. The order-insensitive comparison that makes that work is already
  documented in `db.js`.

---

## Status

All ten are addressed, one commit each, in the order below. Two findings needed
correcting once the code was read properly rather than skimmed, and both
corrections are written into the findings above rather than quietly dropped:
finding 6's evidence was a probe truncation artefact, and finding 8's
recommendation would have broken paging and the webview fallback.

Two things are done but not verified end to end, and both say so in their
commits: the Firestore wire path for finding 1's sharding, which needs the
emulator and therefore a JDK 21, and finding 10's edge cache, which needs a
deploy this session could not make.

## Suggested order

1. Finding 2, the rate limiter. It is failing now, and it is small.
2. Findings 3 and 4 together. They are one problem seen from two ends and the
   fix for either helps the other.
3. Finding 5, the KV cache. Cheap, and it stops a slow-growing problem.
4. Finding 9, `saveManyToLibrary`, already agreed.
5. Finding 6, single-flight.
6. Finding 1, the document ceiling. The largest piece of work, and the only one
   that is a hard failure rather than a slowdown, so it should not sit forever.
