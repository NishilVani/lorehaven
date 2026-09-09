# Compatibility gate — design

**Date:** 2026-09-09
**Status:** approved, not yet implemented
**Scope:** the gate only. Update *delivery* (Updates page, Tauri updater, Android
install routes) is a separate spec — see "Explicitly out of scope".

## The problem

LoreHaven ships to the Microsoft Store and to GitHub Releases as a sideloaded
APK. Neither channel guarantees a user is current, and there is no Play Store
listing at all, so an Android build can sit unchanged on a device indefinitely.

On 2026-09-09 the sync layer changed shape (`3dc2b8c`, `bbcb222`). A client built
before that change is not merely missing features — it actively corrupts the
account it syncs with. Verified against the pre-change code:

1. **It resurrects deletions.** It never reads `moctale_library_deleted` or
   `moctale_rec_feedback_deleted`, so a game deleted on one device returns from
   the other and is written back to the cloud.
2. **It never stamps its edits.** An edit made today keeps whatever `_u` the
   entry already had, so a current client comparing stamps discards it as the
   older change. A silent wrong winner, with no error anywhere.
3. **It overwrites the whole document.** The old rule was "if local is newer than
   the cloud, keep local" — and the next local edit then writes that entire array
   to the cloud, dropping every game the cloud held that this device did not.
   That is exactly the failure that cost seven wishlisted games and 56 priority
   edits on 2026-09-08.

Version `0.1.0` — live on the Store and attached to the GitHub release — is such
a client.

## The model

A single integer, **`compatLevel`**, carried by the client and incremented **only
when a change makes older builds behave incorrectly**. It is currently `2`
(level 1 was everything before the per-item merge).

The essential property is that **level is not version**. Releases 0.3.0, 0.4.0
and 0.5.0 of fixes and features all stay at level `2`, and every one of them is
optional. Only a genuine breaking change bumps to `3`. In this project's entire
history the level would have moved once.

`compatLevel` is deliberately **not** named for the database. The mechanism has
nothing to do with Firestore: a future breaking change might be a proxy contract
change, a removed IGDB endpoint, or a Worker response shape. Any of those bumps
the same number.

The client asks two independent questions:

| Comparison | Category | Consequence |
|---|---|---|
| `COMPAT_LEVEL < minCompatLevel` | **Breaking** | Cloud sync off, explained, update offered |
| `version < latestVersion` | **Patch** | Nothing. Optional, indefinitely |

A gated client keeps working entirely on local data — browse, edit, everything.
Only the cloud write path stops. Nothing is lost: local edits stay on disk and
sync the moment the user updates. This is the one deliberate choice of the
design, and it is why the gate is survivable on a plane, on mobile data, or on a
device the user cannot update right now.

## Two enforcement layers, doing different jobs

**Firestore rules** are the guarantee. They cannot be bypassed, and they work on
builds that can no longer be changed. They can only gate Firestore writes.

**The client check** covers what rules cannot see — a breaking change with no
server-side chokepoint — and is what produces a readable explanation instead of a
bare permission error. For a non-database breaking change it is the *only*
mechanism, which is why `config/app` is load-bearing rather than a nicety.

## Components

### `src/services/compat.js` (new, pure, no imports)

Owns the number and the comparisons. No Firestore import, so it is unit-testable
— the same split as `syncMerge.js` against `db.js`, for the same reason: `db.js`
stands up a Firestore client at import time and nothing in it can be tested.

```js
export const COMPAT_LEVEL = 2;

/** Numeric semver compare. -1 / 0 / 1. PURE. */
export const compareVersions = (a, b) => { /* numeric per segment, not lexical */ };

/** PURE. Unknown/unreachable config must resolve to compatible — see Fail-open. */
export const evaluateCompat = ({ level, minLevel, version, latestVersion }) => ({
  outdated: Number.isInteger(minLevel) && level < minLevel,
  updateAvailable: !!latestVersion && compareVersions(version, latestVersion) < 0,
});
```

`compareVersions` must compare segments numerically. Lexical comparison makes
`0.10.0` older than `0.9.0`, which would suppress a real update.

### The app's own version

The client does not currently know its version. `package.json` says `0.0.0` and
is meaningless; `src-tauri/tauri.conf.json` holds the real one (`0.1.0`) and the
release workflow already fails the build when the git tag disagrees with it.

`vite.config.js` reads that file and injects `__APP_VERSION__` via `define`, so
there is one source of truth and it is the one CI already validates.

### Stamping the writes — `db.js`

`writeDomain` adds `compatLevel: COMPAT_LEVEL` to every `setDoc`.

**Every shard, not just the first.** Rules are evaluated per document, so a
sharded domain whose parts lack the field would have its tail rejected while its
head succeeded — a torn write, which is worse than a refused one.

**Including the clear path.** `removeLocalItem` reaches `writeDomain` with a null
value, which still issues a `setDoc` (writing `deleteField()` into the domain's
field). It is a write like any other and must carry the level, or clearing a
domain would be the one operation an otherwise-current client could not perform.

**Stamped explicitly, never inherited.** Every write uses `{ merge: true }`, and
under a merge `request.resource.data` is the *merged result* — so a document that
already carries `compatLevel` would satisfy the rule even if the write omitted
it. Relying on that would mean the field silently stops being sent, and the gate
holds only for documents that do not yet exist. Send it on every write.

### Firestore rules — split by operation

```
match /lorehaven_users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;

  match /data/{docId} {
    allow read:   if request.auth != null && request.auth.uid == userId;
    allow delete: if request.auth != null && request.auth.uid == userId;
    allow create, update: if request.auth != null && request.auth.uid == userId
                          && request.resource.data.compatLevel is int
                          && request.resource.data.compatLevel >= 2;
  }
}
```

`delete` is separated deliberately: a delete carries no `request.resource`, so
folding it into the same clause would reject every shard cleanup that
`dropShardsFrom` performs and strand orphaned shards.

The parent `lorehaven_users/{userId}` rule is left alone; no code writes it.
`users/{userId}` and `backups/{userId}` are frozen migration artifacts and are
untouched.

### `config/app` — the advisory document

```
match /config/app {
  allow read: if true;
  allow write: if false;
}
```

Same pattern as the existing `config/igdb`: world-readable, never writable by any
client, edited only from the Firebase console or the CLI. Shape:

```json
{ "minCompatLevel": 2, "latestVersion": "0.2.0", "latestNotes": "…" }
```

Read once from `db.js` at module init rather than on sign-in, so a signed-out
user still learns their build is outdated.

### Fail-open on an unreachable config

If the `config/app` read fails or has not landed yet, the client assumes it is
compatible. Failing closed would disable sync for everyone the moment Firestore
hiccups, and it buys nothing: the rules are the hard guarantee, so a genuinely
incompatible client still cannot write. The client check exists to *explain*, and
an explanation that has not arrived is not a reason to break the app.

### Degraded mode

- `syncToCloud` returns early when outdated, so a gated client never queues a
  write. Without this, every edit produces a `permission-denied` and the console
  fills with failures that are working as designed.
- `syncState` gains `outdated: boolean` and `latestVersion`. `getSyncState`
  already exists and `moctale_sync_state` already fires; the Profile sync line
  (`Profile.jsx:147`) already renders `sync.error`.
- The persistent notice goes through `ApiErrorBanner`, which is already mounted
  at the app root and already keyed by type through its `COPY` map. A new entry,
  not a new component.

Copy follows the house error formula — what happened, why, how to fix:
> "Sync is off. This version of LoreHaven can't safely share data with your other
> devices. Your library is safe on this device and will sync once you update."

## Rollout — no flag day

Deploying the rule before clients stamp would immediately stop the live 0.1.0
Store build and 0.1.0 APK from syncing. The order matters:

1. **Ship a client that writes `compatLevel: 2`.** Rules unchanged. A complete
   no-op — an extra field nothing reads yet, so nothing can break.
2. **Rebuild and reinstall desktop and Android from that build. Verify the field
   is actually present** in the live Firestore documents before continuing.
3. **Only then deploy the rule** with `>= 2`, and set `minCompatLevel: 2` in
   `config/app`.

There is never a moment when a good client is refused.

## Testing

**Testable, and worth testing** — in `npm test`, following the existing pattern:

- `compareVersions` across the cases that matter: `0.10.0` vs `0.9.0`, unequal
  segment counts, equality, a `v` prefix.
- `evaluateCompat`: outdated, update-available, both, neither, and an absent or
  malformed `minCompatLevel` resolving to compatible.
- Write path, in the `tests/db-write-path.test.mjs` harness: every domain
  write carries `compatLevel`, **including every shard** of a sharded domain and
  including the null/clear path; and `syncToCloud` queues nothing once outdated.

**The honest gap.** Firestore rules cannot be tested here: the emulator needs a
JDK 21 this machine does not have (recorded in `STATUS.md`). Rather than claim
coverage that does not exist, the rules are verified against the *live* project:
attempt a write with `compatLevel: 1` from a signed-in browser and confirm
`permission-denied`; attempt the same write with `compatLevel: 2` and confirm it
succeeds; confirm a shard `delete` still succeeds. Real, reversible, and it tests
the rules that are actually deployed rather than a local copy of them.

## Explicitly out of scope

Deferred to the update-delivery spec:

- The **Updates page** — current version, latest version, whether an update is
  required or optional, and the install routes. The user's decision on 2026-09-09
  was to present *all* install options on a page and let the reader choose,
  rather than the app picking one.
- **`tauri-plugin-updater`** for direct-download Windows, macOS and Linux. Silent
  background download, applied on next launch. Needs a signing keypair as a repo
  secret, `createUpdaterArtifacts`, and a `latest.json` release asset at
  `releases/latest/download/latest.json` (the endpoint shape Tauri documents).
- **Microsoft Store builds must not self-update.** MSIX is read-only and the
  Store already updates it; detect the packaged container at runtime
  (`GetCurrentPackageFamilyName` fails when unpackaged) and disable the updater.
- **Android**, which `tauri-plugin-updater` does not support — its install
  command targets `cfg(any(target_os = "macos", windows, target_os = "linux"))`.
  Android also cannot install silently under any design: the system package
  installer always confirms. Routes to offer: browser handoff (free), native
  download plus install intent (costs `REQUEST_INSTALL_PACKAGES`, a FileProvider
  and a native bridge; that permission is visible to users and flagged by some
  security tooling), and a link to the release page.

Also deliberately omitted: an "automatic updates" toggle. The objection raised
was to being *prompted*; silent updating is the opposite of a prompt, and a
switch for it is speculative until someone asks.

## Risks

- **The rule is a single hardcoded integer.** Raising it is a one-line change and
  a rules deploy, which is good, but it also means a careless bump locks out
  every client at once. Step 2 of the rollout — verifying the field is live
  before raising the minimum — is the control, and it must not be skipped.
- **`config/app` is a new startup read.** It is one small document and the failure
  path is fail-open, so a slow or failed read costs nothing but the explanation.
- **A gated user who cannot update is stuck without sync.** That is the accepted
  trade: the alternative is silent corruption of their library, which is worse
  and was the actual observed outcome.
