# Releasing

A version bump cuts every build. The version in `src-tauri/tauri.conf.json` is
the single source of truth: `main.yml` watches that one field, and the release
workflow refuses a version that disagrees with it. `package.json` is **not** the
source of truth and still reads `0.0.0`.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. Get that bump onto `main`, through a pull request like anything else.

That is the whole procedure. There is no tag to push: when the version on `main`
differs from the version on the previous commit, `main.yml` runs the suite and,
if it is green, calls `Release`, which creates the tag itself.

A push that does not touch the version runs the suite and deploys the web app,
and stops there. Re-running a release that already has its tag is a no-op, so a
re-run of a green workflow cannot double-publish.

### Why the workflow is allowed to create the tag

The `release tag protection` ruleset on `v*` restricts **updates, deletions and
force pushes, but not creations**. Creation has to stay open: a ruleset bypass
list accepts roles, teams, GitHub Apps and Dependabot, never a workflow's
`GITHUB_TOKEN`, so with "Restrict creations" ticked `create-release` fails with a
ruleset violation.

That is safe because the gate that matters is the `production` approval, not the
tag. A new `v*` tag can at most start a draft release; nothing is signed,
published, written to Firestore or sent to the Store until you approve the run.
And once a release tag exists, nobody off the bypass list can move or delete it.

**Do not push a `v*` tag for a version you have not released yet.** `main.yml`
treats an existing tag as "already released" and skips, so a tag pushed early,
or left behind by a failed run, stops that version releasing automatically. The
run stays green and says `Tag vX.Y.Z already exists. Nothing to do.` in the
`Detect a version change` log. Because updates are restricted, the tag cannot be
moved either; delete it (you are on the bypass list) and use the manual path
below.

### Releasing by hand

To rebuild a tag that already exists, run `Release` from the Actions tab and pass
the tag name.

The `Release` workflow then:

| Job | Produces |
|---|---|
| `create-release` | The tag, and a **draft** GitHub Release, after checking the version matches `tauri.conf.json` |
| `desktop` | `.dmg` + `.app` (Apple Silicon and Intel), `.deb` + `.AppImage` + `.rpm` (Linux), `.msi` + `.exe` NSIS + `.msix` (Windows) |
| `android` | A signed universal APK |
| `publish` | Flips the release from draft to public |
| `app-config` | Writes `latestVersion` into the Firestore document `config/app`, so running clients learn a newer version exists |
| `store` | Submits the MSIX to the Microsoft Store |

Nothing is visible until every platform has uploaded, so a partially built
release never reaches anyone. If a job fails, the release stays a draft, and
pushing a fix will **not** start a new release: the version on `main` no longer
differs from the commit before it. Recover by hand:

1. Merge the fix to `main`.
2. Delete the stale draft release first, so the new run cannot append to it.
3. Delete the tag (you are on the ruleset's bypass list).
4. Run `Release` from the Actions tab with the tag name. It recreates the tag at
   the current `main` commit and builds from there.

`desktop`, `android`, `publish`, `app-config` and `store` all declare
`environment: production`, so the run pauses for your approval before anything is
signed, published or written.

### Why `app-config` cannot arm the compatibility gate

`app-config` writes `latestVersion` and nothing else. That is structural, not a
convention: `scripts/app_config_payload.mjs` builds the release object from named
locals rather than spreading its input, so `minCompatLevel` has no route into a
release write, and `publish_app_config.mjs` re-reads the document afterwards and
fails the job if that field moved.

Raising `minCompatLevel` is `arm-compat-gate.yml`, which only a human can
trigger and which makes you type `ARM` to confirm. Doing it at release time would
gate every device that had not yet installed that release. See "Raising the
compatibility level" below.

## Required Actions secrets

Add these under **Settings → Secrets and variables → Actions**. Only the Android
job needs them; the desktop matrix uses the built-in `GITHUB_TOKEN`.

| Secret | Needed by | What it holds |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Android | The release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Android | Store password |
| `ANDROID_KEY_ALIAS` | Android | Key alias inside the store |
| `ANDROID_KEY_PASSWORD` | Android | Key password |
| `WINDOWS_CERTIFICATE_BASE64` | Windows | Authenticode `.pfx`, base64-encoded. **Optional, and not needed for the Store** — the Store listing is an MSIX, which Microsoft signs. This only affects the MSI/NSIS people download straight from GitHub: unsigned, those raise a SmartScreen warning |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | The `.pfx` password |
| `AZURE_AD_TENANT_ID`, `AZURE_AD_APPLICATION_CLIENT_ID`, `AZURE_AD_APPLICATION_SECRET`, `SELLER_ID` | Store | Microsoft Store submission. See [MICROSOFT-STORE.md](MICROSOFT-STORE.md) |

To produce the base64 blob from the keystore on this machine:

```bash
base64 -w 0 release.keystore > keystore.b64
```

Paste the contents of `keystore.b64` into `ANDROID_KEYSTORE_BASE64`, then delete
the file. On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard
```

The workflow writes the key to the runner, builds, and shreds it in an
`if: always()` step, so a failed build does not leave a key behind.

**The keystore is never committed.** `.gitignore` blocks `*.keystore`, `*.jks`
and `keystore.properties`. Losing it means an installed copy of the app can
never be updated in place — Android only accepts an update signed with the same
key, so everyone would have to uninstall first. Keep an offline backup.

## Building locally

### Desktop

```bash
npm run tauri build
```

Bundles land in `src-tauri/target/release/bundle/`. Needs Rust 1.77.2+ and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

### Android

Needs the Android SDK, an NDK, and a JDK 17. Set `ANDROID_HOME` and `NDK_HOME`,
then create `src-tauri/gen/android/app/keystore.properties` (untracked):

```properties
storeFile=release.keystore
storePassword=...
keyAlias=...
keyPassword=...
```

Then:

```bash
npm run tauri android build -- --apk
```

Output lands under `src-tauri/gen/android/app/build/outputs/`.

## Web

The web app deploys itself. Every push to `main` runs
[`main.yml`](../.github/workflows/main.yml), which runs
[`ci.yml`](../.github/workflows/ci.yml) (lint, unit tests, build) and, only if
that is green, calls
[`firebase-hosting.yml`](../.github/workflows/firebase-hosting.yml) to build and
deploy to the live Firebase Hosting channel at https://moctalegames.web.app. A red
lint or a red test stops the deploy. The deploy workflow no longer runs the tests
itself; that copy drifted from `ci.yml` and was removed.

Every pull request gets its own preview channel with a URL commented on the PR,
expiring after seven days.

This needs one secret, `FIREBASE_SERVICE_ACCOUNT_MOCTALEGAMES`, holding a
service-account JSON key for the `moctalegames` project. The easiest way to
create the account, grant it the right roles, and upload the secret in one go is
to let the Firebase CLI do it:

```bash
firebase init hosting:github
```

Answer `NishilVani/lorehaven` when it asks for the repository, and decline its
offers to overwrite the existing workflow files — the ones in this repo already
do the job. Alternatively, create a key by hand under **Firebase Console →
Project settings → Service accounts** and paste it into the repository secret.

Firestore rules and indexes are deliberately *not* deployed by CI — a rules
change is a security change and should be a conscious act:

```bash
firebase deploy --only firestore
```

To deploy hosting manually, bypassing CI:

```bash
npm run build
firebase deploy --only hosting
```

## Android distribution

There is no Google Play listing, so the release builds APKs rather than an
`.aab` — an app bundle is a Play upload format and cannot be installed on a
device at all. Each release carries:

`LoreHaven-<version>-universal.apk` — every ABI in one file, so it installs on
any device. It is large (84.6 MB at v0.1.0) because it carries four
architectures of compiled Rust. `--split-per-abi` would cut that to roughly a
quarter each, but it produces per-ABI files *instead of* the universal one, and
for sideloading a single file that always works is worth more than the saving.

They still have to be signed, even though nothing checks them against a store:
Android refuses to install an unsigned APK, and an update only installs over an
existing app if it carries the **same** key. So the keystore still matters, and
losing it still means users must uninstall before they can update.

## Store submissions

- **Microsoft Store** — see [MICROSOFT-STORE.md](MICROSOFT-STORE.md).

## Raising the compatibility level

`compatLevel` (`src/services/compat.js`) is bumped **only** when a change makes
older builds behave incorrectly — in any layer, not just the database. Ordinary
releases leave it alone and stay optional forever.

Deploying the rule before clients stamp the new level stops every existing
install from syncing with no version to move to. The order is not optional:

1. **Ship a client that writes the new level.** Rules unchanged. This is a
   no-op: an extra field nothing reads yet.
2. **Rebuild and reinstall desktop and Android from that build, and verify the
   field is really in Firestore** before going further. Check a domain document
   in the Firebase console and confirm `compatLevel` is present with the new
   value. A build that stamps the field is not the same fact as the field
   being in Firestore: the install may not have actually replaced the old
   build, the write may never have reached the cloud (offline, or a silently
   failed write path), or a domain document simply hasn't been touched since
   the upgrade and still carries no field at all. Skip this check and raising
   the minimum starts refusing exactly those writes — the affected devices
   stop syncing with no version to move to, and while rolling the rule back
   is fast, the writes made in the meantime were never accepted.
3. **Only then** set `minCompatLevel` in `config/app` and deploy
   `firestore.rules` with the matching minimum.

There is never a moment when a good client is refused.

Two of those steps are automated, and the split between them is deliberate.

**`latestVersion` publishes itself.** The `app-config` job in `release.yml` runs
after the release goes public and writes it into `config/app`. It cannot arm the
gate: `scripts/app_config_payload.mjs` builds the release object from named
locals rather than spreading its input, so `minCompatLevel` has no route into a
release write, and `publish_app_config.mjs` re-reads the document afterwards and
fails the job if that field moved. Without the secret the step warns and skips,
which costs nothing, because the client's config read fails open.

**Arming the gate is a button you press.** `.github/workflows/arm-compat-gate.yml`
is `workflow_dispatch` only, takes the level as an input, and refuses to run
unless you also type `ARM`. Doing this on a release instead would gate every
device that had not yet installed that release -- which is the whole failure the
three steps above exist to avoid.

So step 3 is: run **Arm the compatibility gate** with the level, then deploy the
rules with the matching minimum.

### The secret it needs

`FIREBASE_CONFIG_WRITER`: a Google Cloud service account key, the whole JSON, as
one repository secret. It needs `roles/datastore.user` on the `moctalegames`
project.

Firestore IAM has no document-level scoping, so **anything holding this key can
write any Firestore document, including every user's library**. Fork pull
requests are not given secrets and only a collaborator can push a tag or press a
dispatch, so the exposure is bounded -- but it is a real key and deserves its own
service account rather than reusing the Hosting deployer.

The Admin SDK authenticates through IAM and bypasses security rules, which is why
this works at all: `config/app` is `allow write: if false` for every client, so a
privileged identity is the only thing that can ever change it.

The document ends up shaped like this, whoever wrote it:

```json
{ "minCompatLevel": 2, "latestVersion": "0.2.0", "latestNotes": "LoreHaven 0.2.0" }
```
