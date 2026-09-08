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

| Secret | What it holds |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Store password |
| `ANDROID_KEY_ALIAS` | Key alias inside the store |
| `ANDROID_KEY_PASSWORD` | Key password |

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

The web build deploys to Firebase Hosting at https://moctalegames.web.app.

```bash
npm run build
firebase deploy --only hosting
```

Firestore rules and indexes are deployed separately, and deliberately — a rules
change is a security change:

```bash
firebase deploy --only firestore
```

## Store submissions

- **Google Play** — upload the `.aab` from the release to the Play Console.
- **Microsoft Store** — see [MICROSOFT-STORE.md](MICROSOFT-STORE.md).
