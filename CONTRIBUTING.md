# Contributing to LoreHaven

Thanks for looking. This file is the whole contract: what to run, what the gates
are, and which parts of the codebase need care.

## Getting a working copy

```bash
git clone https://github.com/NishilVani/lorehaven.git
cd lorehaven
npm ci
npm run dev
```

That is genuinely all of it. **You need no credentials to develop.**
`.env.development` points at the deployed Cloudflare Worker, which holds the IGDB
credential server-side, so a fresh clone can fetch real game data without any
secret on your machine. Signing in is optional; the app works signed out, on
local data.

The desktop and Android shells need more (Rust, and for Android a JDK plus the
NDK) and are only worth setting up if you are changing native behaviour. See
[README.md](README.md).

## The gates

CI runs these on every pull request, and all four must be green:

| Command | What it is |
|---|---|
| `npm run lint` | ESLint. **Zero errors** is the bar, not "no new errors". Warnings are tolerated. |
| `npm test` | Unit and integration checks. Plain node scripts, no framework. |
| `npm run build` | The production Vite build. |
| `npm run test:e2e` | Playwright end-to-end suite, chromium. About 11 minutes at one worker. |

On the pull request itself only "Lint, test, build" is a required check today, so
a red end-to-end run is reported rather than blocking the merge. After the merge
it does block: `main.yml` deploys and releases only when all four pass, so a red
run on `main` stops both.

The end-to-end suite runs **offline**, and a new spec has to as well. No spec may
reach live IGDB, Wikidata or production Firestore: call `offlineIgdb(page)` from
`tests/igdb-stub.ts`, or install your own `page.route`, before `page.goto`. The
config points the IGDB proxy at an origin nothing listens on, so a forgotten stub
fails straight away instead of passing whenever IGDB happens to be quick. A case
that only passes on a retry is reported as flaky; treat that as a bug.

### No emoji. Anywhere.

This is the rule that catches people. Not in code, comments, commit messages, UI
copy, or documentation. Use a [lucide](https://lucide.dev) icon or plain words.
`python scripts/check_no_emoji.py --no-dash src` enforces it for `src/`; the same
standard applies to everything else by convention.

### How tests are written here

There is no Jest or Vitest. A test is a `.mjs` file using `node:assert` that
exits non-zero on failure, wired into `package.json` as its own `test:*` script
and appended to the `test` chain. Look at `tests/compat.test.mjs` for the shape.

Two things are expected of a new test:

- **Assert real values, not presence.** `assert.strictEqual(x.level, 2)` beats
  `assert.ok('level' in x)`.
- **Prove it can fail.** Break the code it covers, watch the test go red, put the
  code back. A test that passes against a broken implementation is worse than no
  test, because it buys false confidence. Several tests in this repo carry a
  comment recording exactly that check.

## Code style

Match the file you are editing. The one convention worth stating explicitly:
**comments explain why, not what.** The code already says what it does. A comment
earns its place by recording a decision, a constraint, or a failure that shaped
it — ideally with the measurement or the incident behind it. Skim
`src/services/syncMerge.js` for the register.

Commit messages follow the same idea: an imperative subject line in sentence
case with no prefix, and a body explaining why the change is right, not what
changed. `git log` is the reference.

## Parts that need care

These are guarded by [CODEOWNERS](.github/CODEOWNERS), so a change to them asks
for a review. That is not distrust — each one has a way of failing that is
invisible in a diff.

| Path | Why |
|---|---|
| `firestore.rules` | The only thing standing between a bug and every user's data. |
| `src/services/syncMerge.js`, `src/services/db.js` | The cross-device merge. A whole-document overwrite here cost a user seven games and 56 edits in September 2026; the tests exist because of it. |
| `src/services/compat.js` | `COMPAT_LEVEL` gates cloud writes for every client. See below. |
| `.github/workflows/` | Has access to signing keys and deploy credentials. |
| `functions/` | The IGDB proxy. Its endpoint allowlist is what stops it becoming an open credential. |
| `scripts/*app_config*` | Structurally prevents CI arming the compatibility gate. |

### Do not bump `COMPAT_LEVEL`

`COMPAT_LEVEL` in `src/services/compat.js` is not a version number. Raising it,
and then raising `minCompatLevel` in production, **stops every older client
syncing**. It moves only when a change makes older builds actively corrupt data,
which has happened once. If you think your change needs it, say so in the PR and
let it be discussed rather than doing it.

## Opening a pull request

Branch from `main`, keep the change focused, and fill in the template.

Two things to expect on a **fork** PR:

- The **Deploy web** check is skipped. It needs a deploy credential, and GitHub
  correctly refuses to hand secrets to a fork. That is not your change failing.
- A maintainer approves the workflow run before CI starts, so there may be a
  pause before anything reports.

**CI** is the check that judges your change. If it is green, the work is done.

## Reporting a bug

Open an issue with what you did, what you expected, and what happened. If it
involves data going missing, say which platforms were signed in at the time and
roughly when — the sync layer is per-device and that detail is usually the whole
diagnosis.

For anything security-related, do not open an issue. See
[SECURITY.md](SECURITY.md).

## Licence

By contributing you agree your work is licensed under the
[MIT License](LICENSE) that covers this project.
