# Agent Task: Add Wikidata Award Data to Game Library App

## Context

You're working in a **React + Tauri v2** game backlog/library manager app. Key facts about this codebase:

- Frontend: React + Vite, TypeScript
- Native layer: Tauri v2, **no custom Rust code** — the webview handles networking directly
- Database: **Firestore** (Firebase) — no custom backend server; the React app talks to Firestore directly via the Firebase JS SDK
- Game metadata (title, cover art, platforms, etc.) is already sourced from the **IGDB API**, and each game record has a stable **IGDB game ID**
- IGDB does not provide award data, so it has to come from an external source

## Objective

Two features, both backed by the same sync:

1. **Per-game awards** — show a game's awards on its detail page
2. **Per-award browse page** — a page for a given award (e.g. "The Game Award for Game of the Year") listing every game in the library that won it

Data source: **Wikidata**. No backend server, no Rust — the fetch happens directly from the webview.

## How award lookup works

Wikidata items for video games carry an `IGDB game ID` property (`P5794`) and an `award received` property (`P166`). Each award itself is also a Wikidata entity with a stable ID (a "QID", e.g. `Q10855212`) — **use this QID, not the text label, as the canonical key for an award**, since labels can vary and QIDs never change.

Example query — batch multiple IGDB IDs per request using `VALUES`:

```sparql
SELECT ?igdbId ?award ?awardLabel ?pointInTime ?forWorkLabel WHERE {
  VALUES ?igdbId { "1942" "7331" "119171" }
  ?game wdt:P5794 ?igdbId .
  ?game p:P166 ?awardStmt .
  ?awardStmt ps:P166 ?award .
  OPTIONAL { ?awardStmt pq:P585 ?pointInTime . }
  OPTIONAL { ?awardStmt pq:P1686 ?forWork . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

`?award` binds to a full entity URI like `http://www.wikidata.org/entity/Q10855212` — extract the `Q...` suffix as the QID.

Endpoint: `POST https://query.wikidata.org/sparql`, header `Accept: application/sparql-results+json`, body `query=<url-encoded SPARQL>`.

## Fetching — plain webview `fetch()`, no Rust

- Wikidata's SPARQL endpoint is CORS-enabled, so a standard `fetch()` call from React works with no plugin and no native code
- The one required native-side change: add `https://query.wikidata.org` to `connect-src` in the app's CSP, in `src-tauri/tauri.conf.json` under `app.security.csp`. This is a JSON edit, not Rust
- Trade-off: the browser blocks setting a custom `User-Agent` header on `fetch`, so requests will go out as anonymous webview traffic. This is fine for a personal app's usage volume — just keep batching (below) so you're not firing dozens of requests in a burst

## Firestore schema

Three collections, split so the per-award browse page can be queried directly (Firestore can't efficiently query "all docs where this array contains an object matching X"):

### 1. `gameAwards/{igdbId}` — per-game sync status
```ts
interface GameAwardsStatus {
  igdbId: string;
  status: "found" | "not_found" | "error";
  fetchedAt: Timestamp;
}
```
Purely a cache-control doc: tells the sync whether this game has already been checked, and when. Doesn't store the award data itself.

### 2. `awardWins/{docId}` — one doc per game-award pairing (the actual data)
```ts
interface AwardWin {
  awardQid: string;      // e.g. "Q10855212" — stable Wikidata ID for the award
  awardLabel: string;    // e.g. "The Game Award for Game of the Year"
  igdbId: string;
  gameTitle: string;     // denormalized from your existing games collection, not from Wikidata's forWorkLabel — keeps display consistent with the rest of your app
  year: number | null;
}
```
Use a **deterministic doc ID**: `${awardQid}_${igdbId}_${year ?? "unk"}`. This makes the sync idempotent — re-running it overwrites the same doc instead of creating duplicates.

This is what the per-award page queries: `where("awardQid", "==", qid)`.

### 3. `awardsCatalog/{awardQid}` — distinct list of awards, for the browse index
```ts
interface AwardCatalogEntry {
  label: string;
  updatedAt: Timestamp;
}
```
Firestore has no "distinct" query, so this collection is maintained by upserting (merge: true) an entry every time the sync encounters an award QID it hasn't written before. It's what powers an "all awards" index page.

## Sync logic

- `src/services/wikidata/awards.ts` — builds the batched SPARQL query, calls `fetch`, parses `results.bindings` into rows
- `src/services/firestore/awards.ts` — helpers:
  - `getMissingOrStale(igdbIds, staleDays)` — reads `gameAwards` docs, returns IDs needing a fetch
  - `writeSyncResults(rows, checkedIgdbIds)` — for each row: upsert `awardWins/{deterministicId}`, upsert `awardsCatalog/{awardQid}` (merge), and upsert `gameAwards/{igdbId}` with `status: "found"`. For any `checkedIgdbIds` with **no** matching rows, write `gameAwards/{igdbId}` with `status: "not_found"`. Use a Firestore batched write (max 500 ops per batch)
- `src/hooks/useGameAwards.ts` — for a game detail page: queries `awardWins where igdbId == X`; if no `gameAwards/{igdbId}` doc exists yet, triggers a fetch for just that one game
- A library-wide sync utility (manual "Refresh awards" button, or run on app startup): reads all IGDB IDs from your games collection → `getMissingOrStale` → chunk into batches of ~50 → query Wikidata → `writeSyncResults`
- Re-check both `not_found` **and** `found` docs older than ~90 days — see "Data freshness" below for why `found` needs re-checking too, not just `not_found`

## Data freshness — does this need to be re-run?

This is a cache of Wikidata, not a one-time import — it needs periodic re-syncing. Split by whether that requires code changes:

**Needs no code changes, ever:**
- New games added to your library — picked up automatically next sync via `getMissingOrStale`
- New award categories that don't exist yet — the query has no hardcoded award list; anything linked via `P166` is picked up, and `awardsCatalog` grows on its own
- Wikidata later adding an IGDB-ID link for a game that didn't have one — caught the next time that game's `not_found` doc goes stale and gets re-checked

**Needs periodic re-syncing (same code, just run it again):**
- A game that already has one award later wins another, or editors backfill award data for a game already marked `found` — re-checking only `not_found` docs would miss this, so both statuses need the same staleness window
- Corrections in Wikidata (a wrong year gets fixed, a mis-attributed award gets removed) — the deterministic doc ID (`awardQid_igdbId_year`) means a *changed* year produces a new doc instead of updating the old one, leaving a stale orphan behind. Incremental upserts can add and overwrite, but can't detect removals or edits to a value baked into the doc ID

**The fix for the correction case:** run an occasional **full resync** per game — delete all existing `awardWins` docs for that `igdbId`, then re-query and re-write from scratch — rather than relying only on incremental upserts. Incremental sync is fine day-to-day (cheap, mostly no-ops for already-synced games); do a full resync less often (e.g. monthly, or via an on-demand "force refresh" button) to catch corrections and removals that incremental sync structurally can't see.

## UI

- `src/components/GameDetail/AwardsList.tsx` — on the game detail page, queries `awardWins` for that `igdbId`, renders award name + year. Shows nothing if empty (don't clutter the UI with "no awards")
- `src/pages/AwardsIndex.tsx` — new route (e.g. `/awards`), lists all `awardsCatalog` entries alphabetically by label, each linking to:
- `src/pages/AwardCategory.tsx` — new route (e.g. `/awards/:awardQid`), queries `awardWins where awardQid == :awardQid` ordered by `year desc`, renders the list of winning games (title + year), each linking back to that game's detail page

## Non-functional requirements

- No backend server, no Rust — all fetching and writing happens client-side in React via `fetch` and the Firebase JS SDK
- Don't block the UI while syncing — run as a background async operation, show a subtle loading/progress state if syncing many games at once
- Must degrade gracefully offline — Firestore's local cache serves reads with no network
- Idempotent — deterministic doc IDs mean re-running the sync never duplicates data

## Acceptance criteria

- [ ] CSP updated in `tauri.conf.json` to allow `connect-src` to `query.wikidata.org`
- [ ] Syncing populates `gameAwards`, `awardWins`, and `awardsCatalog` correctly for at least one game with real awards and one without, verifying both `found` and `not_found` paths
- [ ] Game detail page shows awards for a game that has them
- [ ] `/awards` lists all distinct awards found across the library
- [ ] `/awards/:awardQid` lists every game in the library that won that award, linking back to each game's detail page
- [ ] Re-running the incremental sync does not create duplicate `awardWins` or `awardsCatalog` documents
- [ ] Staleness check re-verifies both `found` and `not_found` docs after the refresh window, not just `not_found`
- [ ] A full resync path exists (delete-then-rewrite per game) to catch corrections/removals that incremental upserts can't detect
- [ ] No API keys or secrets required anywhere in this feature

## Notes for the agent

- Adapt file paths and naming to match this codebase's actual existing conventions — the paths above are suggestions, not requirements
- Confirm the existing games collection's field name for IGDB ID and game title before wiring up `gameTitle` denormalization
- Ask before adding new dependencies — this feature should need none beyond what's already in the project
