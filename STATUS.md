# Status

**Read `FIXES.md` first.** It is every issue fixed on the deep-QA branch: what
was wrong, what changed, and what a user sees differently. One row per fix,
grouped by cause. `PERF-AUDIT.md` is the networking, storage, sync and
infinite-scroll audit, with the measurement behind every claim.

## Where this stands

- **Live at https://moctalegames.web.app**, deployed by CI on every push to
  `main`. See [docs/RELEASING.md](docs/RELEASING.md).
- **The deep QA run is complete through group 2.** Group 3 is untouched,
  deliberately — those eighteen items need a product decision or an
  investigation first, and they are listed at the end of `FIXES.md`.
- **All ten performance findings are fixed.** Two are done but not verified end
  to end: the Firestore sharding needs the emulator, which needs a JDK 21 this
  machine does not have, and the proxy's edge cache needs a deploy.

## Pipelines

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push / PR to main | lint, unit tests, build; Playwright chromium (advisory) |
| `firebase-hosting.yml` | push / PR to main | deploys live, or a 7-day PR preview channel |
| `release.yml` | tag `v*` | macOS (arm64 + Intel), Linux, Windows (incl. MSIX), Android APKs into one draft release, published only when every platform succeeds |
| `store-submission.yml` | `release.yml` completing | downloads that release's MSIX and publishes it to the Microsoft Store |

`v0.1.0` is **published**, from commit `772a0b3`, with every platform in one
release: the four desktop bundles, `LoreHaven-0.1.0.msix`, and
`LoreHaven-0.1.0-universal.apk`. Every job passed, so `publish` undrafted it
automatically — which is the whole design.

Its first run, at `3e20502`, is worth remembering: Android failed for want of
the signing secrets, and the release correctly stayed a draft rather than
shipping a half-built version. The tag was later re-pointed at `772a0b3` and the
stale draft deleted first, so the new run could not append to it.

## Cross-device sync lost data — fixed 2026-09-09

Reported as "games I wishlisted and prioritised are gone, and Top Pick is
suggesting them again". It was real, and it was the sync design.

**Mechanism.** Every cloud write sends the whole library document, and
`applyDomainDoc` resolved a difference by taking whichever whole document was
newer — despite a comment claiming "items only one side has always survive".
A browser tab and the `tauri dev` window, both signed in, each held a full
copy; whichever wrote last erased what the other had added. Evidence, all
from storage rather than memory: the update-feed snapshot still held seven
games the library did not; every copy carried the identical `_mt`, i.e. had
been replaced wholesale by the same cloud write at 20:29Z on Sep 8; and
Chrome's raw LevelDB still held a superseded version of the library from
07:24Z that day with 261 games and 187 priorities against the 263/131 that
survived. An earlier session had compared local with cloud, found them equal,
and concluded nothing was lost — both were already the clobbered copy.

**Fix.** [src/services/syncMerge.js](src/services/syncMerge.js), pure and
tested by `tests/sync-merge.test.mjs` (12 checks, part of `npm test`). Merge
is per item: entries carry a `_u` write stamp, the newer stamp wins a
conflict, an item only one side has survives, deletions travel as tombstones
in a new `moctale_library_deleted` domain, and a device whose merge holds
more than the cloud writes the superset back. Every library write goes
through one `commitLibrary` in db.js that stamps and tombstones. Verified
against the real module by replaying the two-session scenario
(`tests/two-sessions.test.mjs`): both games survive on both devices.

**Recovery.** `scripts/ldb_history.mjs` reads superseded values
out of Chromium LevelDB files; the 261-game version it found is the source of
the restoration. Four games (Majora's Mask, Sleeping Dogs DE, Khazan, Monster
Hunter Wilds) survive only as names in the feed snapshot — restored as
Wishlist with no priority, because nothing else about them is known.

Restored 2026-09-09 04:34Z, and by the fix itself rather than by hand: the
recovered entries were placed in the signed-in browser's localStorage with
fresh `_u` stamps, the page was reloaded, and the new merge kept them over the
older cloud copy and wrote the superset back. Cloud and local now both read
270 games, 187 with a priority, all seven games present. A copy of the
pre-restore library is in that browser's localStorage under
`moctale_library_backup_2026-09-09`, and as a JSON file under the ignored `qa/`
directory on the machine that ran the restore. It is deliberately **not**
committed: this repository is public and that file is a personal library.

**Recommendation feedback** takes the same per-verdict merge, with clears as
tombstones in `moctale_rec_feedback_deleted`. Fixing that exposed a second
bug: `KEY_FOR_DOC` copied only `key` and `field` out of each domain, so the
old `listPolicy: 'replace'` on feedback had never been in effect — and neither
was the new tombstone policy until the map carried the whole config.

**Still whole-document:** the object domains (profile, prefs, snapshot,
clear-watermark). They are single settings, not lists, and newest-wins is
the right rule for them.

**Explore's `ERR_CONNECTION_CLOSED` to the proxy** is not the worker:
Cloudflare's metrics for the last 24h show 0 errors, 0 limit hits, 0 stream
disconnects. It is Chrome sending a POST on a kept-alive connection the edge
had idled out; Chrome replays that for GET, never for POST. `netRetry.js`
replays a request that never left the client exactly once, and never a
response the server sent.

**The Twitch token is cached at the edge**, deployed 2026-09-09 as version
`247dc70b`. Those 174 exchanges were never refreshes — a token lasts ~60 days —
they were one mint per cold isolate. A cold isolate now adopts the token the
last one left in the edge cache.

Measured on the live Worker, per script version, from Cloudflare's
`workersSubrequestsAdaptiveGroups`:

| | IGDB subrequests | Twitch mints | IGDB calls per mint |
|---|---|---|---|
| `9a8bdd3a` (before) | 2820 | 190 | 14.8 |
| `247dc70b`, warm colo | 72 | **0** | — |

The second row is the one that means anything: 40 deliberately distinct queries,
every one a response-cache MISS and therefore needing a token, all landing in
BOM, adding 72 IGDB subrequests and not one token exchange. The old code would
have minted roughly five.

Do not read the first minutes after a deploy as the steady state — I nearly did.
Overall the new version sits at 113 IGDB / 5 mints, because a deploy kills every
isolate and each colo's first few then race on an empty token cache. Those mints
scale with colos and deploys, not with traffic.

The stored value is the access token, never the client secret; it is keyed under
an unroutable `.invalid` URL that no inbound request can produce, carries its own
expiry which is re-checked on read, and is dropped from the edge as well as
memory on a 401 — without that last part a revoked token would be served back to
every cold isolate until the entry expired. Nine checks in
`functions/token-cache.test.mjs`, in `npm test`, with Twitch stubbed; the live
check is `scripts/verify_proxy_live.mjs`.

## What is waiting on a human

- **Delete the `config/igdb` document in Firestore.** The rule exposing it is
  gone from `firestore.rules`, so a rules deploy stops it being world-readable,
  but the document itself is still there holding a superseded IGDB credential
  pair. Nothing reads it. Firebase console -> Firestore -> `config` -> `igdb` ->
  delete. Listed in [SECURITY.md](SECURITY.md) as known-and-accepted until then.
- **Turn on branch protection for `main`** now the repository invites
  contributions. `.github/CODEOWNERS` requests a review on the sensitive paths
  but cannot require one by itself -- that needs "Require a pull request before
  merging" plus "Require review from Code Owners" under Settings -> Branches.
  Make `CI` the required status check, **not** `Deploy web`: the latter is
  skipped on fork pull requests by design, so requiring it would block every
  external contribution permanently.
- **Turn on private vulnerability reporting** under Settings -> Security, or the
  reporting route [SECURITY.md](SECURITY.md) tells people to use does not exist.

- **Known, parked:** when the compatibility notice has been dismissed and an
  IGDB error then occurs, the banner shows the outdated headline (with a Retry
  button) rather than the error copy. Real but narrow, and the whole path is
  dormant until the rule is armed. The fix is two lines in
  `src/components/ui/ApiErrorBanner.jsx`: gate the copy and the ARIA role on
  `outdated && !dismissedOutdated` rather than on `outdated` alone. Surfaced by
  the final branch review and deliberately deferred rather than dropped.
- **The compatibility gate is built but not armed.** `firestore.rules` carries
  the `compatLevel >= 2` requirement and the client stamps it, but the rule is
  **not deployed** and `config/app` does not exist yet. Arming it before the
  0.1.0 Store build and 0.1.0 APK are replaced would stop them syncing with
  nowhere to go. The order is in [docs/RELEASING.md](docs/RELEASING.md).
- **Microsoft Store**: the first submission is done — `LoreHaven-0.1.0.msix`
  was submitted by hand through Partner Center with the full listing, and it is
  **in certification** (Store ID `9N7FD5QBSMBB`). **No code signing certificate
  was needed**: the listing is an MSIX and Microsoft re-signs it. What is left is
  only the automation for *later* releases — an Entra app with the Manager role
  and four repository secrets (`AZURE_AD_TENANT_ID`,
  `AZURE_AD_APPLICATION_CLIENT_ID`, `AZURE_AD_APPLICATION_SECRET`, `SELLER_ID`).
  The Seller ID page returned "Access restricted" on this account, so that one
  may need a different role. Until they exist, `store-submission.yml` fails
  loudly on a tagged release rather than passing green having done nothing. See
  [docs/MICROSOFT-STORE.md](docs/MICROSOFT-STORE.md), which also flags that the
  publisher name in Partner Center reads "LoreHeaven".
- **The Clone pair in `phase4-deep`** is the only real test failure left, and it
  predates the recent refactoring. See the table below.

## Lint

`npm run lint` reports **zero errors** and is a blocking gate in both `ci.yml`
and `firebase-hosting.yml`. It started at 270.

149 of those were never real: ESLint was walking `src-tauri/target`, where Cargo
writes a JavaScript file per bundled asset. The rest were, and the bulk of them
were `react-hooks/set-state-in-effect` — effects that pushed state the render
could have computed. Most are now lazy `useState` initialisers (synchronous
localStorage reads), values derived during render, or route keys that let React
throw the old state away instead of the page pushing it back by hand.

Four suppressions remain. Each is one line, at the point of use, with its reason:

| Where | Why |
|---|---|
| `Tooltip.jsx` | `cloneElement` with a ref key reads as ref-access-during-render. The alternative is wrapping children in a span, which changes the DOM under every tooltip in the app. |
| `AwardsIndex.jsx` | `fetchCeremonies` paints synchronously off the localStorage tier on purpose — the measured alternative is 27.5s of skeleton. |
| `Schedule.jsx`, `Wallpapers.jsx` | Their loaders take a flag that skips the reset, and the effect passes it, so the synchronous path reaches no setState. The rule cannot follow a boolean across a call boundary. |
| `Library.jsx` | `hydrateLibrary` opens with `setIsLoading(true)`, which on mount is the value it already holds. The same function is the refresh path, where the flag does have to be raised. |

Nine `react-hooks/exhaustive-deps` warnings remain and are deliberately warnings.

## History

This repository was re-initialised with a single commit before its first push.
The full 314-commit development history is preserved locally as a bare mirror at
`../moctale-games-history.git` — browse it with
`git -C ../moctale-games-history.git log`.

The reason for the reset: `release.keystore`, the Android release signing key,
had been committed in `d6586dd` and was still reachable in history. It was never
pushed anywhere, so it was never exposed and does not need rotating — but it
could not go to a public GitHub repo. The same reset dropped
`datbase_config.json`, which held the old IGDB client secret; that credential
was rotated in the Twitch console earlier and now returns 403.

## Security

- Firestore rules are deployed to `moctalegames` and verified against the live
  project: three formerly world-writable collections refuse everything, and the
  public `config` wildcard is narrowed to the one document the app reads. Rules
  are deployed by hand on purpose — a rules change is a security change.
- The IGDB credential lives only in the Cloudflare Worker
  `lorehaven-proxy.nishilvani.workers.dev`. Nothing on a developer machine holds
  it. `functions/README.md` has the deploy, rotate and endpoint-allowlist detail.
- One dead artifact can be deleted whenever convenient: the `config/igdb`
  Firestore document. Nothing reads it.

## How to run things

```
npm run dev                     # the dev server the probes drive
npx playwright test --project=chromium
npm run test:e2e:webkit         # sharded; webkit wedges past ~37 contexts in one process
npm run test:e2e:ios            # judge by the reported pass counts, not the exit code
```

`tests/phase7-mobile.spec.ts` is excluded from the desktop projects by
`playwright.config.ts`, at collection time. Run it with
`--project="Mobile Chrome"` or `--project="Mobile Safari"`; under a desktop
project its cases fail by design, which is why they are no longer collected
there.

## Known test failures

Measured on `--project=chromium`, 421 cases, and each one checked against the
pre-refactor tree before being written down here.

| Case | State |
|---|---|
| `phase4-deep:857` Clone writes a local copy and navigates to it | **Real, pre-existing.** The clone is written and the URL changes, but the new page renders its Not Found branch instead of the `(Clone)` heading. Reproduces identically on the pre-refactor tree. |
| `phase4-deep:870` FINDING 11 — Clone twice | **Real, pre-existing.** Same cause. |
| `phase2-deep:912` no duplicate cards while scrolling | Flake. Passes in isolation. The grid de-duplicates by id; the assertion compares names, and IGDB can ship two ids with one name. |
| `phase3-deep:1276` Save to Shelves | Order-dependent. Fails alone on the pre-refactor tree too, passes inside a batch. |
| `phase6-deep:629` Reload refetches from IGDB | Order-dependent. Run as a pair with case 41 it fails on the pre-refactor tree identically; it passes inside a full-file run. |
| `phase6-deep:862` a failed reload clears the stale plates | Real, pre-existing. Fails on the pre-refactor tree in every arrangement tried. |

`phase7-mobile.spec.ts` is now excluded from the desktop projects in
`playwright.config.ts`. It asserts phone-only behaviour, so all ~47 of its cases
failed by design under `--project=chromium` and made the suite look far worse
than it was.

A worker crash (`code=3221226091`) has been seen partway through a full local
run on Windows, which reports every remaining case as failed. It is the same
class of process instability the config header documents for webkit. Judge a
full local run by the named failures, not the tally.

## Known follow-up

- The screen-reader summary on a failed category load still reads "0 of 0 games"
  although the visible count is now hidden.
- `DEFAULT_CUSTOM_PLATFORMS` in `src/services/db.js` is exported but nothing
  seeds it into a new profile any more. Three comments in `platformMatch.js`
  still name it as the canonical store vocabulary. Worth deciding which it is.
