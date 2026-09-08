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

## What is waiting on a human

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
