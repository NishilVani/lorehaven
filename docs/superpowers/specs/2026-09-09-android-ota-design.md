# Android OTA frontend updates — design

**Date:** 2026-09-09
**Status:** approved, not yet implemented
**Depends on:** [the compatibility gate](2026-09-09-compat-gate-design.md), which
ships first and stands on its own.

## Goal

Update the Android app's frontend without an APK reinstall, and make the app
*say so* when a change genuinely does need one.

LoreHaven has no Play Store listing. The APK is sideloaded from a GitHub Release,
so a device can sit on an old build indefinitely and there is no channel that
will move it. Meanwhile the same frontend is deployed continuously to
`moctalegames.web.app`, where every user is current within minutes.

The APK is mostly web bundle wrapped in a thin native shell. The bundle changes
almost every release; the shell changes rarely. Updating just the bundle covers
the large majority of releases — including, notably, the entire sync layer
(`db.js`, `syncMerge.js`, `compat.js`), which is the breaking change the
compatibility gate exists to contain.

## The origin trap, and why the obvious design is wrong

The obvious implementation is to point the WebView at the live site. It silently
orphans every user's local data, because `localStorage` is partitioned by origin
and the library lives in `localStorage`.

This is not theoretical. The development machine holds both, right now, read out
of the WebView's LevelDB store:

```
http://localhost:5173   moctale_library   263 games, 131 priorities
http://tauri.localhost  moctale_library   234 games, 131 priorities
```

One app, one machine, two origins, two libraries that have already drifted apart.
Moving Android to a remote origin would start every signed-out user from empty
and force every signed-in user through a full cloud re-pull.

**So `index.html` stays bundled in the APK** — the origin never changes — and only
its scripts and stylesheets come from the network. Remote code, local origin.

Three consequences follow, and all three are load-bearing:

- **No data migration.** The origin is the same as it has always been.
- **Native IPC keeps working, with no security widening.** `__TAURI_INTERNALS__`
  is injected because the document is local. The alternative — a remote origin
  granted IPC through a capability's `remote` list — would hand a website the
  ability to invoke native commands.
- **Offline still opens.** If the network fetch fails, the bootstrap loads the
  assets already inside the APK.

The bundle needs no changes to work this way: it already branches on
`window.__TAURI_INTERNALS__`, so the same build serves as web app and as Android
frontend.

## The bootstrap, and the Vite change it needs

`dist/index.html` today hardcodes its entry:

```html
<script type="module" crossorigin src="/assets/index-DQna1xSY.js"></script>
```

If that tag ships in the APK it loads immediately and no OTA logic can run
first. **The entry has to be injected rather than declared**, which means a small
Vite plugin using `transformIndexHtml` to lift the entry (and its stylesheet) out
of the markup and hand them to an inline bootstrap instead.

One `index.html` serves both targets; the bootstrap branches at runtime:

- **On the web** — no `__TAURI_INTERNALS__`, so it injects the local entry
  synchronously and does nothing else. Behaviour is byte-identical to today, and
  no request is made to R2. This matters: the change ships to the website too, so
  it must be inert there.
- **In the Android shell** — it reads the manifest, checks `minShellVersion` and
  the boot marker, then injects either the remote entry or the local one.

`modulepreload` hints must be lifted with the entry. Left behind, they would
preload the embedded chunks on every launch — wasted bytes when the remote bundle
is the one that ends up loading.

## Pinned to releases, not to live `main`

Android loads a specific released bundle, not whatever the website is serving.

Following `main` would be simpler and the risk is arguably the same one web users
already carry, but it costs something that matters more: a release stops being a
reproducible artifact. "Android 0.2.0" would mean whatever the site was that day,
a bug report could not be tied to a commit, and a web-only regression would reach
phones with nothing in between.

## Where the pinned bundle lives: R2, behind the Worker

The bundle is 108 files and 3.2 MB — 62 content-hashed assets under `assets/`,
plus a nested `platform-icons/` tree and root files. It is a static site, and it
needs a host that serves one.

**Chosen: Cloudflare R2, served through a new `/ota/*` route on the existing
`lorehaven-proxy` Worker.**

The decisive property is **fate decoupling**. Every alternative that serves the
pinned bundle from Firebase Hosting requires the hosting deploy to retain the
pinned release's assets, because a deploy replaces `/assets/*` wholesale — so a
routine push to `main` would share fate with the Android app, and a retention step
that silently no-ops would break phones days later. R2 makes a web deploy touch
nothing Android depends on. Those two things should be independent.

Also true, and each worth something:

- **Immutability is structural.** R2 objects do not change or vanish; nothing has
  to be maintained to keep an old bundle alive.
- **Rollback is unlimited and free.** Every past release persists, so `ota.json`
  can be repointed at any of them.
- **No new dependency at app launch.** The app already cannot function without
  the Worker. Serving from Hosting would add a second thing that must be up.
- **A real path tree.** All 108 files upload unchanged, with no flattening.
- 10 GB free against 3.2 MB a release is on the order of three thousand releases.

### Rejected: GitHub Release assets, directly or via the Worker

Verified against the live release rather than assumed. `browser_download_url`
returns:

- **No `Access-Control-Allow-Origin`.** Fatal on its own — see CORS below.
- **`Content-Type: application/octet-stream`** with `Content-Disposition:
  attachment`. Fatal independently — see MIME below.
- **A 302 to a signed URL that expires in about an hour**, so it is not a stable
  link even ignoring the other two.

Proxying them through the Worker fixes the headers but not the shape: a flat
namespace built for ~13 installers would have to absorb 108 build fragments with
an encoded path scheme, turning the release page into a list of 121 assets.

### Rejected: Firebase Hosting with a retention step

Serves the tree natively with correct MIME types and needs no new
infrastructure, but couples web deploys to Android as described above, and makes
immutability something a workflow step must keep true forever.

## Why CORS and MIME decide the host

Both bite the same request through different mechanisms, and both are absolute —
the app does not degrade, it fails to boot.

**CORS.** The document's origin is the app's own; the assets are not. Classic
`<script src>` has always been allowed cross-origin, but **module scripts are
fetched in `cors` mode by specification**, because their semantics are
observable — you can import them and read their exports, and errors surface in
full — so a cross-origin grant must be explicit. Vite emits
`<script type="module" crossorigin>`. Code splitting compounds it: route chunks
load through dynamic `import()` resolved relative to the importing module, so each
one is a cross-origin module fetch too.

**MIME.** A second gate, applied after CORS passes. A module script is refused
unless the `Content-Type` is a JavaScript type — strict MIME checking, which
exists to stop MIME-confusion attacks.

The Worker therefore sets `Access-Control-Allow-Origin: *` (these files are
public static assets), and R2 carries the correct `Content-Type` per object as
metadata set at **upload** time. Uploading a `.js` object without its content type
is the single most likely way to break this, and it fails at the MIME gate.

## The manifest

`ota.json` is the **one deliberately mutable object** in the design — it is the
pointer, and everything it points at is immutable. It lives at a fixed key
(`ota/android.json`) that each release overwrites, which is also what makes
rollback a single small upload rather than a rebuild.

```json
{
  "version": "0.2.0",
  "minShellVersion": "0.2.0",
  "base": "https://lorehaven-proxy.nishilvani.workers.dev/ota/0.2.0/",
  "entry": "assets/index-ABC.js",
  "css": ["assets/index-XYZ.css"]
}
```

`base` is absolute, so switching hosts later is a manifest change rather than a
code change.

The bundles under `ota/<version>/` are never overwritten and never deleted; only
this one key moves.

## `minShellVersion` — the reinstall boundary

The shell reports its own version through `@tauri-apps/api`'s `getVersion()`. If
it is below `minShellVersion`, the bootstrap **refuses the remote bundle**, loads
the embedded one, and surfaces that an APK update is required.

This is the enforced form of "until something changes that requires a reinstall".
The list of such changes is everything the bundle cannot carry: anything under
`src-tauri/` (Rust code, a plugin added or upgraded, a Tauri version bump), new
Android permissions, manifest changes such as a FileProvider, and native config
in `tauri.conf.json` including CSP and capabilities.

Bumping `minShellVersion` is therefore a deliberate act taken in the same commit
as the native change that forces it.

## Boot verification and rollback

A remote bundle that fails to start must not brick the app.

Before injecting the remote entry the bootstrap writes a pending marker naming
the version. The app clears it once React has mounted. If the bootstrap finds a
marker still set on the next launch, that version failed to boot: it is recorded
as bad, never attempted again, and the embedded bundle loads instead.

The marker is deliberately **not** a synced domain. It describes one device's
experience of one bundle and must never travel to another device.

## Offline

Assets are content-hashed and served `immutable, max-age=31536000`, so the WebView
caches them. The first launch after an update needs the network; every launch
after that is served from cache and works offline. With no network and no cached
bundle, the embedded one loads — which is the state a freshly installed APK is
in anyway.

## Release flow

On tag, after the existing build and release jobs:

1. Upload `dist/**` to R2 under `ota/<version>/`, each object with its correct
   `Content-Type`.
2. Generate `ota.json` from the built `index.html` — the entry and CSS hashes are
   read from it, never hand-written.
3. Overwrite `ota/android.json` last, so it never names a bundle that is not
   fully present.

Ordering matters: `ota.json` is the switch, and it is thrown only once everything
it points at exists.

## Interaction with the compatibility gate

OTA does not replace the gate; it reduces how often it fires. The gate still
covers native-layer breaking changes, which no OTA can fix, and the window before
OTA ships. Note that **OTA cannot bootstrap itself** — the first APK must contain
the bootstrap, so at least one manual reinstall is unavoidable.

Once OTA is live, step 2 of the gate's rollout ("rebuild and reinstall Android")
becomes automatic for frontend-only changes.

## Security

Remote JavaScript runs with native IPC access. That is inherent to any OTA scheme
and it is a real widening of the trust boundary, so it is stated rather than
buried: the app currently executes only code shipped inside the APK.

What limits it: the bundle comes from R2 through a Worker on infrastructure this
project controls, over HTTPS, and the APK it replaces is itself downloaded from a
GitHub Release — a comparable trust profile. `minShellVersion` and the boot marker
bound the blast radius of a bad bundle, but neither is a defence against a
*malicious* one.

Not in this design, and worth revisiting if the app ever has users beyond its
author: signing the manifest with a pinned public key, so the client verifies the
bundle rather than trusting the host.

## Scope

**Android only.** Store desktop builds are excluded: they auto-update through the
Store already, and downloading executable code into an MSIX is a certification
risk for no benefit. Direct-download desktop stays on `tauri-plugin-updater` as
specced separately.

## Testing

Pure and testable, in `npm test`:

- Manifest evaluation: shell too old, bundle already current, malformed manifest,
  missing fields — every one resolving to "load the embedded bundle".
- `compareVersions` is shared with the compatibility gate and is tested there.
- The boot marker state machine: clean start, mounted, failed once, marked bad.

Verified by hand on a device, because it cannot be faked: a real APK loading a
real remote bundle, then the same APK with the network off, then with a
deliberately broken bundle to confirm it falls back and does not retry.

**The honest gap.** There is no automated test that a real WebView will fetch and
execute a cross-origin module bundle from R2 through the Worker. The CORS and
MIME behaviour can be checked from `curl` against the deployed route, and that is
worth doing as a committed check — but the end-to-end path is manual.

## Risks

- **The CI secret is the critical path.** This needs a Cloudflare API token with
  R2 write in Actions. The four Microsoft Store secrets specced earlier are still
  uncreated, and that has been the actual bottleneck; nothing here works until the
  token exists.
- **A wrong `Content-Type` at upload breaks the boot** and does it at the MIME
  gate, whose error message points at parsing rather than at metadata. The upload
  step should assert the content type it set on the entry file.
- **The Worker gains a second responsibility.** It is a credential proxy with a
  deliberately tight allowlist; the OTA route authenticates nothing, because R2
  content is public. That boundary belongs in a comment beside the allowlist so
  the reasoning is not lost.
- **A bad bundle reaches every device at once.** Rollback is repointing
  `ota.json`, which is fast, but there is no staged rollout.
