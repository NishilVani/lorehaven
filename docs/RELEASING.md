# Releasing

One tag cuts every build. The version in `src-tauri/tauri.conf.json` is the
single source of truth; the release workflow refuses a tag that disagrees with
it.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. Commit that bump on `main`.
3. Tag and push:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The `Release` workflow then:

| Job | Produces |
|---|---|
| `create-release` | A **draft** GitHub Release, after checking the tag matches `tauri.conf.json` |
| `desktop` | `.dmg` + `.app` (Apple Silicon and Intel), `.deb` + `.AppImage` + `.rpm` (Linux), `.msi` + `.exe` NSIS (Windows) |
| `android` | A signed `.aab` for Play, and a signed universal `.apk` for sideloading |
| `publish` | Flips the release from draft to public |

Nothing is visible until every platform has uploaded, so a partially built
release never reaches anyone. If a job fails, the release stays a draft — fix
the cause, delete the tag, and re-tag.

To rebuild an existing tag without moving it, run the workflow manually from the
Actions tab and pass the tag name.

## Required Actions secrets

Add these under **Settings → Secrets and variables → Actions**. Only the Android
job needs them; the desktop matrix uses the built-in `GITHUB_TOKEN`.

| Secret | Needed by | What it holds |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Android | The release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Android | Store password |
| `ANDROID_KEY_ALIAS` | Android | Key alias inside the store |
| `ANDROID_KEY_PASSWORD` | Android | Key password |
| `WINDOWS_CERTIFICATE_BASE64` | Windows | Authenticode `.pfx`, base64-encoded. Optional — without it the Windows build still succeeds, but the installer is unsigned and the Microsoft Store will reject it |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | The `.pfx` password |

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
and `keystore.properties`. Losing it means you can no longer ship an update to
the same Play listing — keep an offline backup.

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
npm run tauri android build -- --aab --apk
```

Output lands under `src-tauri/gen/android/app/build/outputs/`.

## Web

The web app deploys itself. Every push to `main` runs
[`firebase-hosting.yml`](../.github/workflows/firebase-hosting.yml), which lints,
runs the unit tests, builds, and deploys to the live Firebase Hosting channel at
https://moctalegames.web.app. A red lint or a red test stops the deploy.

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

## Store submissions

- **Google Play** — upload the `.aab` from the release to the Play Console.
- **Microsoft Store** — see [MICROSOFT-STORE.md](MICROSOFT-STORE.md).
