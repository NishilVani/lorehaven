# Status

**Read `FIXES.md` first.** It is every issue fixed on the deep-QA branch: what
was wrong, what changed, and what a user sees differently. One row per fix,
grouped by cause. `PERF-AUDIT.md` is the networking, storage, sync and
infinite-scroll audit, with the measurement behind every claim.

## Where this stands

- **The deep QA run is complete through group 2.** Every one-line fix and every
  clustered root-cause fix landed, each gated before it was committed.
- **Group 3 is untouched, deliberately.** Those eighteen items need a product
  decision or an investigation first. They are listed at the end of `FIXES.md`.
- **All ten performance findings are fixed.** Two are done but not verified end
  to end: the Firestore sharding needs the emulator, which needs a JDK 21 this
  machine does not have, and the proxy's edge cache needs a deploy.

## History

This repository was re-initialised with a single commit before its first push.
The full 314-commit development history is preserved locally as a bare mirror at
`../moctale-games-history.git` — browse it with `git -C ../moctale-games-history.git log`.

The reason for the reset: `release.keystore`, the Android release signing key,
had been committed in `d6586dd` and was still reachable in history. It was never
pushed anywhere, so it was never exposed and does not need rotating — but it
could not go to a public GitHub repo. The re-init drops it. The keystore itself
is still on disk, gitignored, and still signs releases.

The same reset also dropped `datbase_config.json`, which held the old IGDB
client secret. That credential was rotated in the Twitch console earlier and now
returns 403, so it was already dead.

## Security

- Firestore rules are deployed to `moctalegames` and verified against the live
  project: three formerly world-writable collections refuse everything, and the
  public `config` wildcard is narrowed to the one document the app reads.
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

`tests/phase7-mobile.spec.ts` is restricted by the CLI invocation, never by a
`test.skip`. Run it with `--project="Mobile Chrome"` or `--project="Mobile Safari"`;
under a desktop project its cases fail by design.

## Known follow-up

The screen-reader summary on a failed category load still reads "0 of 0 games"
although the visible count is now hidden.
