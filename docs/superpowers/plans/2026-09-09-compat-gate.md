# Compatibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an app build that corrupts data from writing to the cloud, without taking the app away from anyone.

**Architecture:** A single integer `compatLevel`, carried by the client and stamped onto every Firestore domain document. Firestore rules refuse writes below a minimum — the unbypassable guarantee. A world-readable `config/app` document tells the client the minimum so it can explain itself instead of emitting permission errors, and covers future breaking changes that have no server-side chokepoint. A gated client keeps working entirely on local data; only the cloud write path stops.

**Tech Stack:** React 19, Vite 8, Firebase Firestore, plain `node:assert` test harnesses run by `npm test`.

**Spec:** [2026-09-09-compat-gate-design.md](../specs/2026-09-09-compat-gate-design.md)

## Global Constraints

- `COMPAT_LEVEL` is **2**. Level 1 is every build before the per-item merge.
- The Firestore field name is exactly `compatLevel`. The config document is exactly `config/app`.
- `compatLevel` must be on **every** domain write: every shard, and the null/clear path.
- Never inherit the field from a `{ merge: true }` write — always send it explicitly.
- Fail-open: an unreadable or absent `config/app` means the client treats itself as current.
- **Do not deploy the Firestore rules until Task 8.** Deploying earlier stops the live 0.1.0 Store build and 0.1.0 APK from syncing.
- Zero emoji in any code, comment, commit message or copy (CLAUDE.md, enforced by `npm run lint:emoji`).
- Every task ends green on `npm run lint` and `npm test`.

## File Structure

| File | Responsibility |
|---|---|
| `src/services/compat.js` | **Create.** The level constant, the app version, and two pure comparisons. No imports, so it is unit-testable. |
| `tests/compat.test.mjs` | **Create.** Contract for `compareVersions` and `evaluateCompat`. |
| `vite.config.js` | **Modify.** Inject `__APP_VERSION__` from `src-tauri/tauri.conf.json`. |
| `src/services/db.js` | **Modify.** Stamp every write, read `config/app`, suppress writes when outdated. |
| `tests/db-write-path.test.mjs` | **Modify.** Assert the stamp is on every shard and on the clear path. |
| `src/components/ui/ApiErrorBanner.jsx` | **Modify.** Persistent explanation when sync is gated. |
| `src/pages/profile/Profile.jsx` | **Modify.** The sync status line says "off, and why". |
| `firestore.rules` | **Modify.** Split `data/{docId}` by operation; add `config/app`. |
| `STATUS.md`, `docs/RELEASING.md` | **Modify.** Record the gate and the rollout order. |

---

### Task 1: The pure compatibility module

**Files:**
- Create: `src/services/compat.js`
- Create: `tests/compat.test.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: `COMPAT_LEVEL: number` (2), `APP_VERSION: string`, `compareVersions(a: string, b: string) => -1|0|1`, `evaluateCompat({level, minLevel, version, latestVersion}) => {outdated: boolean, updateAvailable: boolean}`.

- [ ] **Step 1: Write the failing test**

Create `tests/compat.test.mjs`:

```js
// The compatibility comparisons. Run: node tests/compat.test.mjs
//
// compareVersions must be numeric per segment. Lexical comparison makes
// "0.10.0" older than "0.9.0", which would hide a real update from everyone
// past the ninth patch.
import assert from 'node:assert';
import { COMPAT_LEVEL, compareVersions, evaluateCompat } from '../src/services/compat.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the level is an integer, because the Firestore rule compares it as one', () => {
    assert.ok(Number.isInteger(COMPAT_LEVEL), 'COMPAT_LEVEL must be an integer');
});

test('compareVersions orders segments numerically, not lexically', () => {
    assert.strictEqual(compareVersions('0.10.0', '0.9.0'), 1, '0.10.0 is newer than 0.9.0');
    assert.strictEqual(compareVersions('0.9.0', '0.10.0'), -1);
    assert.strictEqual(compareVersions('1.0.0', '0.99.99'), 1);
});

test('compareVersions treats equal versions as equal', () => {
    assert.strictEqual(compareVersions('0.2.0', '0.2.0'), 0);
});

test('compareVersions pads missing segments with zero', () => {
    assert.strictEqual(compareVersions('0.2', '0.2.0'), 0);
    assert.strictEqual(compareVersions('0.2.1', '0.2'), 1);
});

test('compareVersions tolerates a v prefix and unparseable input', () => {
    assert.strictEqual(compareVersions('v0.2.0', '0.2.0'), 0);
    assert.strictEqual(compareVersions('', ''), 0);
    assert.strictEqual(compareVersions('nonsense', '0.0.0'), 0);
});

test('a level below the minimum is outdated', () => {
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: 2 }).outdated, true);
});

test('a level at or above the minimum is not outdated', () => {
    assert.strictEqual(evaluateCompat({ level: 2, minLevel: 2 }).outdated, false);
    assert.strictEqual(evaluateCompat({ level: 3, minLevel: 2 }).outdated, false);
});

test('an absent or malformed minimum means current -- the config is advisory', () => {
    /* Fail-open. The Firestore rules are the hard guarantee, so a config that
       did not load is a missing explanation, not a reason to stop syncing. */
    assert.strictEqual(evaluateCompat({ level: 1 }).outdated, false, 'undefined minimum');
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: null }).outdated, false);
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: '2' }).outdated, false, 'a string is not a level');
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: 2.5 }).outdated, false);
});

test('updateAvailable is independent of outdated', () => {
    const patch = evaluateCompat({ level: 2, minLevel: 2, version: '0.1.0', latestVersion: '0.2.0' });
    assert.strictEqual(patch.outdated, false, 'a newer version alone never gates');
    assert.strictEqual(patch.updateAvailable, true);

    const current = evaluateCompat({ level: 2, minLevel: 2, version: '0.2.0', latestVersion: '0.2.0' });
    assert.strictEqual(current.updateAvailable, false);

    const both = evaluateCompat({ level: 1, minLevel: 2, version: '0.1.0', latestVersion: '0.2.0' });
    assert.strictEqual(both.outdated, true);
    assert.strictEqual(both.updateAvailable, true);
});

test('no latestVersion means no update to offer', () => {
    assert.strictEqual(evaluateCompat({ level: 2, minLevel: 2, version: '0.1.0' }).updateAvailable, false);
});

let failed = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/compat.test.mjs`
Expected: FAIL — `Cannot find module '.../src/services/compat.js'`

- [ ] **Step 3: Write the implementation**

Create `src/services/compat.js`:

```js
// Which breaking generation this build belongs to, and the two comparisons
// that decide what to do about it.
//
// No imports on purpose. db.js stands up a Firestore client at import time and
// nothing in it can be unit-tested, so the logic that decides whether this
// build may sync lives here instead. tests/compat.test.mjs is the contract.

/* Incremented ONLY when a change makes older builds behave incorrectly -- in
   any layer, not just the database. Level 1 is every build before the
   per-item merge landed; those clients resurrect deleted games, never stamp
   their edits, and overwrite the whole library document, which is what cost
   seven games and 56 priorities on 2026-09-08.

   This is NOT the version number. Releases of fixes and features all stay at
   the same level and are all optional; only a genuine breaking change moves
   it. In this project's history it has moved once. */
export const COMPAT_LEVEL = 2;

/* Injected by vite.config.js from src-tauri/tauri.conf.json, which the release
   workflow already checks against the git tag. The typeof guard keeps this
   module importable under plain node, where the define does not exist -- which
   is how the tests run. */
export const APP_VERSION =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/**
 * Numeric semver compare. PURE.
 * Segments compare as numbers: "0.10.0" is newer than "0.9.0", which a string
 * compare gets backwards.
 * @returns {-1|0|1}
 */
export const compareVersions = (a, b) => {
    const parse = (v) => String(v ?? '').replace(/^v/, '').split('.')
        .map(n => { const i = parseInt(n, 10); return Number.isFinite(i) ? i : 0; });
    const x = parse(a), y = parse(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
};

/**
 * What this build should do about the published config. PURE.
 *
 * `outdated` requires a real integer minimum: an absent, null, string or
 * fractional value means the config did not load or is malformed, and that
 * must resolve to "current". Failing closed would disable sync for everyone
 * the moment Firestore hiccups, and it buys nothing -- the rules are the hard
 * guarantee, so a genuinely incompatible client still cannot write.
 *
 * @param {{level: number, minLevel?: unknown, version?: string, latestVersion?: string}} args
 * @returns {{outdated: boolean, updateAvailable: boolean}}
 */
export const evaluateCompat = ({ level, minLevel, version, latestVersion }) => ({
    outdated: Number.isInteger(minLevel) && Number.isInteger(level) && level < minLevel,
    updateAvailable: !!latestVersion && compareVersions(version, latestVersion) < 0,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/compat.test.mjs`
Expected: `10/10 passed` (the file above defines ten `test()` cases)

`compat.js` references `__APP_VERSION__` both inside a `typeof` guard and as a
value. ESLint's `no-undef` exempts the guard but not the value reference, so
`eslint.config.js` needs `__APP_VERSION__: 'readonly'` added to its globals.

- [ ] **Step 5: Wire it into `npm test`**

In `package.json`, add the script after `"test:sessions"`:

```json
"test:compat": "node tests/compat.test.mjs",
```

and append ` && npm run test:compat` to the end of the `"test"` script value.

- [ ] **Step 6: Verify the suite and lint**

Run: `npm test && npm run lint`
Expected: every suite passes; eslint reports nothing.

- [ ] **Step 7: Commit**

```bash
git add src/services/compat.js tests/compat.test.mjs package.json
git commit -m "Add the compatibility level and its comparisons

An integer bumped only by a breaking change, in any layer -- not by releases.
compareVersions is numeric per segment because a string compare puts 0.10.0
before 0.9.0 and would hide every update past the ninth patch.

evaluateCompat fails open on a missing or malformed minimum: the Firestore
rules are the guarantee, so a config that did not load is a missing
explanation rather than a reason to stop syncing."
```

---

### Task 2: Inject the real app version

**Files:**
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: `APP_VERSION` from Task 1, which reads the `__APP_VERSION__` define.
- Produces: `__APP_VERSION__` as a string literal in every build.

- [ ] **Step 1: Add the define**

In `vite.config.js`, add the import at the top of the file, beside the existing imports:

```js
import { readFileSync } from 'node:fs'
```

Then, immediately after the `const host = process.env.TAURI_DEV_HOST;` line, add:

```js
/* One source of truth for the version, and it is the one CI already checks:
   .github/workflows/release.yml fails the build when the git tag disagrees
   with tauri.conf.json. package.json says 0.0.0 and means nothing. */
const appVersion = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')
).version;
```

Then add a `define` key to the object passed to `defineConfig`, directly after `clearScreen: false,`:

```js
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
```

- [ ] **Step 2: Build and verify the version reached the bundle**

Run:

```bash
npm run build && node -e "
const fs=require('node:fs');
const v=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).version;
/* Quote-agnostic on purpose: the minifier is free to emit the injected string
   with single, double or backtick quotes, and an earlier version of this check
   looked only for double quotes and reported a false failure. */
const re=new RegExp('['"\`]'+v.replace(/\./g,'\.')+'['"\`]');
const hit=fs.readdirSync('dist/assets').some(f=>f.endsWith('.js')&&re.test(fs.readFileSync('dist/assets/'+f,'utf8')));
console.log(hit?'ok    version '+v+' is in the bundle':'FAIL  version '+v+' not found');
process.exit(hit?0:1);"
```

Expected: `ok    version 0.1.0 is in the bundle`

- [ ] **Step 3: Verify lint and tests still pass**

Run: `npm run lint && npm test`
Expected: both green. `tests/compat.test.mjs` still passes because the `typeof` guard falls back to `'0.0.0'` under node.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "Give the client its own version, from the file CI already checks

The app did not know its version. package.json says 0.0.0 and is meaningless;
tauri.conf.json holds the real one and release.yml already fails the build
when the git tag disagrees with it, so it is the only copy that cannot drift."
```

---

### Task 3: Stamp every domain write

**Files:**
- Modify: `src/services/db.js`
- Modify: `tests/db-write-path.test.mjs`

**Interfaces:**
- Consumes: `COMPAT_LEVEL` from Task 1.
- Produces: `domainPayload(field: string, value: unknown, opts: {parts: number, index: number}) => object`, exported from `db.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/db-write-path.test.mjs`, immediately before the final `console.log` line:

```js
/* Every domain document must carry compatLevel, or the Firestore rule refuses
   it. The payload builder is exported and pure precisely so this can be
   asserted without a Firestore client and without a signed-in user. */
{
  const { domainPayload } = db;
  const { COMPAT_LEVEL } = await import('../src/services/compat.js');

  const head = domainPayload('games', [{ id: 1 }], { parts: 3, index: 0 });
  assert.strictEqual(head.compatLevel, COMPAT_LEVEL, 'the first shard is stamped');
  assert.strictEqual(head.parts, 3, 'the first shard declares how many there are');
  assert.ok('updatedAt' in head, 'the first shard carries updatedAt');

  const tail = domainPayload('games', [{ id: 2 }], { parts: 3, index: 2 });
  assert.strictEqual(tail.compatLevel, COMPAT_LEVEL, 'every later shard is stamped too');
  assert.ok(!('parts' in tail), 'only the first shard declares the count');

  /* The clear path. removeLocalItem reaches writeDomain with a null value and
     still issues a setDoc, so without this, clearing a domain would be the one
     operation an otherwise-current client could not perform. */
  const cleared = domainPayload('games', null, { parts: 1, index: 0 });
  assert.strictEqual(cleared.compatLevel, COMPAT_LEVEL, 'the clear path is stamped');

  console.log('compat stamp: all assertions passed');
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/db-write-path.test.mjs`
Expected: FAIL — `domainPayload` is `undefined`, so the call throws `TypeError: db.domainPayload is not a function`.

- [ ] **Step 3: Add the payload builder and use it**

In `src/services/db.js`, add the import beside the existing `syncMerge.js` import:

```js
import { COMPAT_LEVEL } from './compat.js';
```

Then, directly above `const writeDomain = async (key, value) => {`, add:

```js
/**
 * The body of one domain document. Exported and PURE for the same reason
 * splitPayload and mergeShards are: it is the only way to assert what every
 * write carries without a Firestore client and without a signed-in user.
 *
 * compatLevel goes on EVERY document -- every shard, and the clear path --
 * because rules are evaluated per document. A sharded domain whose tail lacked
 * it would have its head accepted and its tail refused, which is a torn write
 * and worse than a refused one.
 *
 * It is also sent explicitly rather than inherited. Every write is
 * { merge: true }, and under a merge `request.resource.data` is the MERGED
 * result -- so a document that already carries the field would satisfy the rule
 * even if the write omitted it. Relying on that would mean the field silently
 * stops being sent and the gate holds only for documents that do not yet exist.
 */
export const domainPayload = (field, value, { parts, index }) => ({
    [field]: value,
    updatedAt: serverTimestamp(),
    compatLevel: COMPAT_LEVEL,
    ...(index === 0 ? { parts } : {}),
});
```

Then replace the two `setDoc` calls inside `writeDomain`. The null branch becomes:

```js
        if (value === null) {
            await setDoc(domainRef(uid, domain.docId),
                domainPayload(domain.field, deleteField(), { parts: 1, index: 0 }), { merge: true });
            await dropShardsFrom(uid, domain.docId, 1);
            shardCounts.set(domain.docId, 1);
```

and the sharded branch's loop body becomes:

```js
            for (let i = parts.length - 1; i >= 0; i--) {
                await setDoc(domainRef(uid, shardIdFor(domain.docId, i)),
                    domainPayload(domain.field, parts[i], { parts: parts.length, index: i }), { merge: true });
            }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/db-write-path.test.mjs`
Expected both lines, in this order — the new block sits above the file's
existing final line, so it prints first:

```
compat stamp: all assertions passed
db write path: all assertions passed
```

- [ ] **Step 5: Verify the suite and lint**

Run: `npm test && npm run lint`
Expected: all green. `tests/two-sessions.test.mjs` must still pass — it exercises the same write path.

- [ ] **Step 6: Commit**

```bash
git add src/services/db.js tests/db-write-path.test.mjs
git commit -m "Stamp compatLevel on every domain document

Every shard, not just the first: rules are evaluated per document, so a
sharded domain whose tail lacked the field would have its head accepted and
its tail refused. That is a torn write, which is worse than a refused one.

The clear path too. removeLocalItem reaches writeDomain with a null value and
still issues a setDoc, so without it, clearing a domain would be the one
operation an otherwise-current client could not perform.

Sent explicitly, never inherited: under { merge: true } the rule sees the
merged result, so an existing document would satisfy it even if the write
omitted the field -- and the gate would then hold only for new documents."
```

---

### Task 4: Read the config, and stop writing when gated

**Files:**
- Modify: `src/services/db.js`

**Interfaces:**
- Consumes: `COMPAT_LEVEL`, `APP_VERSION`, `evaluateCompat` from Task 1.
- Produces: `getSyncState()` now returns `{ signedIn, at, error, outdated, updateAvailable, latestVersion }`.

- [ ] **Step 1: Extend the imports**

In `src/services/db.js`, change the `firebase/firestore` import to include `getDoc`:

```js
import {
    doc, setDoc, deleteDoc, onSnapshot, deleteField,
    collection, getDocs, serverTimestamp, getDoc,
} from 'firebase/firestore';
```

and extend the compat import added in Task 3:

```js
import { COMPAT_LEVEL, APP_VERSION, evaluateCompat } from './compat.js';
```

- [ ] **Step 2: Add the new sync state fields**

Replace the `syncState` initialiser line:

```js
let syncState = { signedIn: false, at: null, error: null };
```

with:

```js
/* `outdated` is set from config/app and is independent of auth: a signed-out
   user should still be told their build cannot sync. */
let syncState = {
    signedIn: false, at: null, error: null,
    outdated: false, updateAvailable: false, latestVersion: null,
};
```

and update the JSDoc above `getSyncState` to:

```js
/** { signedIn, at, error, outdated, updateAvailable, latestVersion } —
 *  `at` is null until something has synced this session. */
```

- [ ] **Step 3: Suppress writes when gated**

Replace the body of `syncToCloud`:

```js
const syncToCloud = (key, value) => {
    if (!currentUser || !DOMAINS[key]) return;
    /* A build the rules will refuse must not queue writes. Every one would come
       back permission-denied, and the flood would bury the one message that
       actually explains what is wrong. localStorage still has the edit, so
       nothing is lost -- it syncs when the user updates. */
    if (syncState.outdated) return;
    pendingWrites.set(key, value);
    if (!flushTimer && !flushing) flushTimer = setTimeout(flushCloud, FLUSH_MS);
};
```

- [ ] **Step 4: Read `config/app` at module init**

Add immediately after the `syncToCloud` function:

```js
/* Read once at module init rather than on sign-in, so a signed-out user still
   learns their build is too old.
 *
 * Fail-open, deliberately. If this read fails or has not landed yet the client
 * assumes it is current: failing closed would disable sync for everyone the
 * moment Firestore hiccups, and it buys nothing, because the rules are the
 * hard guarantee and a genuinely incompatible client still cannot write. This
 * check exists to EXPLAIN, and an explanation that has not arrived is not a
 * reason to break the app. */
const readAppConfig = async () => {
    try {
        const snap = await getDoc(doc(db, 'config', 'app'));
        const cfg = snap.exists() ? snap.data() : null;
        const { outdated, updateAvailable } = evaluateCompat({
            level: COMPAT_LEVEL,
            minLevel: cfg?.minCompatLevel,
            version: APP_VERSION,
            latestVersion: cfg?.latestVersion,
        });
        setSyncState({ outdated, updateAvailable, latestVersion: cfg?.latestVersion ?? null });
        if (outdated) {
            console.warn(`[db] This build is compat level ${COMPAT_LEVEL}; the account requires ${cfg.minCompatLevel}. Cloud sync is off.`);
        }
    } catch (e) {
        console.warn('[db] Could not read config/app — assuming this build is current.', e);
    }
};
readAppConfig();
```

- [ ] **Step 5: Verify nothing regressed**

Run: `npm test && npm run lint && npm run build`
Expected: all green. The node harnesses have no Firestore connection, so `readAppConfig` rejects and takes the fail-open path — which is exactly the behaviour being asserted.

- [ ] **Step 6: Commit**

```bash
git add src/services/db.js
git commit -m "Read config/app, and stop queueing writes a gated build cannot make

Two enforcement layers doing different jobs. The rules are the guarantee: they
cannot be bypassed and they work on builds that can no longer be changed, but
they only see Firestore writes. This check covers a breaking change with no
server-side chokepoint, and it is what turns a permission error into a
sentence a person can act on.

Fail-open on an unreadable config. Failing closed would disable sync for
everyone the moment Firestore hiccups and buys nothing, since the rules still
refuse a genuinely incompatible client."
```

---

### Task 5: Say so, in the two places sync is already reported

**Files:**
- Modify: `src/components/ui/ApiErrorBanner.jsx`
- Modify: `src/pages/profile/Profile.jsx`

**Interfaces:**
- Consumes: `getSyncState()` from Task 4 and the existing `moctale_sync_state` event.
- Produces: no new exports.

- [ ] **Step 1: Add the persistent banner**

In `src/components/ui/ApiErrorBanner.jsx`, add the import:

```js
import { getSyncState } from '../../services/db';
```

Add an entry to the `COPY` map, after `request`:

```js
  /* Not an API failure, but it belongs in the same place: it is the one thing
     a person must read before they trust what the app is showing them. */
  outdated: {
    what: 'Sync is off',
    why: 'This version of LoreHaven cannot safely share data with your other devices. Your library is safe on this device and will sync once you update.',
  },
```

Inside the component, add below the existing `useState`:

```js
  const [outdated, setOutdated] = useState(() => getSyncState().outdated);

  /* db.js owns the truth and announces changes; this only mirrors it. Read once
     at subscribe time, because config/app may resolve before this mounts. */
  useEffect(() => {
    const read = () => setOutdated(getSyncState().outdated);
    read();
    window.addEventListener('moctale_sync_state', read);
    return () => window.removeEventListener('moctale_sync_state', read);
  }, []);
```

Add a dismissal flag beside it. The existing Dismiss button calls
`setError(null)`, which cannot clear `outdated` — so without this the button
would look broken, and the banner would be permanent and undismissable, which is
the nagging this whole design exists to avoid:

```js
  /* The gated state is not an error that can be cleared, so Dismiss needs
     something of its own to set. Per session, deliberately: the Profile page
     still says why, permanently, for anyone who goes looking. */
  const [dismissed, setDismissed] = useState(false);
```

Replace the early return and copy selection:

```js
  if (dismissed || (!error && !outdated)) return null;
  /* Outranks a transient API error: one is a request that failed and can be
     retried, the other is a state the app is in until it is updated. */
  const copy = outdated ? COPY.outdated : (COPY[error] || COPY.request);
```

Replace the two-button block at the end of the JSX. Retry is hidden for the
gated state — retrying is what you do with a request that failed, not with a
build that needs replacing — and Dismiss now clears both:

```jsx
      <div className="flex items-center gap-2 shrink-0">
        {!outdated && (
          <button
            onClick={retry}
            className="lh-label px-3 py-2 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
          >
            Retry
          </button>
        )}
        <button
          onClick={() => { setError(null); setDismissed(true); }}
          aria-label={outdated ? 'Dismiss update notice' : 'Dismiss error'}
          className="lh-label px-3 py-2 text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
        >
          Dismiss
        </button>
      </div>
```

- [ ] **Step 2: Add the profile status line**

In `src/pages/profile/Profile.jsx`, replace the `syncing` chain:

```js
  const syncing = sync.outdated
    ? { line: 'Sync is off — this version is too old to share data safely', tone: 'text-[var(--destructive)]', dot: 'var(--destructive)' }
    : !user
      ? { line: 'Not syncing — your library lives on this device', tone: 'text-white/60', dot: 'var(--status-solid-fallback)' }
      : sync.error
        ? { line: sync.error, tone: 'text-[var(--destructive)]', dot: 'var(--destructive)' }
        : sync.at
          ? { line: `Synced ${sinceText(sync.at)}`, tone: 'text-white/60', dot: 'var(--status-solid-playing)' }
          : { line: 'Connecting…', tone: 'text-white/60', dot: 'var(--status-solid-fallback)' };
```

`sync.outdated` is checked **before** `!user` on purpose: the build is too old whether or not anyone is signed in, and saying "your library lives on this device" would be the reassuring half of a contradiction.

- [ ] **Step 3: Verify it renders both ways**

Run `npm run dev`, then in the browser console force the state and confirm the banner and the profile line both appear, and that no retry button is offered:

```js
// Simulate a gated build without touching Firestore.
const db = await import('/src/services/db.js');
// getSyncState returns the live object; mutate through the event the UI listens to.
Object.assign(db.getSyncState(), { outdated: true });
window.dispatchEvent(new Event('moctale_sync_state'));
```

Expected: the banner reads "Sync is off" with a Dismiss button and **no Retry**;
`/profile` shows the destructive status line. Click Dismiss and confirm the
banner goes and the profile line stays. Then reload to clear the forced state
and confirm both are gone.

- [ ] **Step 4: Verify lint, tests and build**

Run: `npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ApiErrorBanner.jsx src/pages/profile/Profile.jsx
git commit -m "Say why sync is off, in the two places that already report it

Reuses the app-root banner and the profile status line rather than adding a
surface. The banner offers no retry for this state: retrying is what you do
with a request that failed, not with a build that needs replacing.

The profile line checks outdated before signed-out, because the build is too
old either way and 'your library lives on this device' would be the
reassuring half of a contradiction."
```

---

### Task 6: Write the rules — but do not deploy them

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: the `compatLevel` field written in Task 3.
- Produces: nothing in code. **The deploy is Task 8.**

- [ ] **Step 1: Add the config document rule**

In `firestore.rules`, directly after the closing brace of the `match /config/igdb` block, add:

```
    /* What the client needs to explain itself: the minimum compatibility level
     * an account will accept, and the newest version on offer.
     *
     * World-readable like config/igdb and for the same reason -- a signed-out
     * visitor must be able to read it, and there is nothing here to leak. Never
     * client-writable: it is edited from the Firebase console or the CLI, and a
     * client that could raise minCompatLevel could lock out every other device.
     *
     * Shape: { minCompatLevel: int, latestVersion: string, latestNotes: string }
     */
    match /config/app {
      allow read: if true;
      allow write: if false;
    }
```

- [ ] **Step 2: Split the data rule by operation**

Replace the nested `match /data/{docId}` block inside `match /lorehaven_users/{userId}`:

```
      /* Split by operation on purpose.
       *
       * A delete carries no request.resource, so folding it into the same
       * clause as create/update would reject every shard cleanup that
       * dropShardsFrom performs and strand orphaned shards behind a library
       * that had shrunk.
       *
       * compatLevel is the compatibility gate. A build below the minimum
       * resurrects deleted games, never stamps its edits, and overwrites the
       * whole library document -- see docs/superpowers/specs for what that
       * cost. The client refuses to write when it knows it is too old; this is
       * the half that works on builds that can no longer be changed. */
      match /data/{docId} {
        allow read:   if request.auth != null && request.auth.uid == userId;
        allow delete: if request.auth != null && request.auth.uid == userId;
        allow create, update: if request.auth != null && request.auth.uid == userId
                              && request.resource.data.compatLevel is int
                              && request.resource.data.compatLevel >= 2;
      }
```

- [ ] **Step 3: Confirm the file is unchanged in every other respect**

Run: `git diff firestore.rules`
Expected: exactly two additions — the `config/app` block and the rewritten `data/{docId}` block. The parent `lorehaven_users/{userId}` rule, `users/{userId}`, `backups/{userId}` and the awards cache must be untouched.

- [ ] **Step 4: Commit, without deploying**

**Do not run `firebase deploy`.** The live 0.1.0 Store build and 0.1.0 APK do not stamp `compatLevel`, and deploying now would stop them syncing before a replacement exists.

```bash
git add firestore.rules
git commit -m "Write the compatibility gate rule, unapplied

Committed but deliberately not deployed: the live 0.1.0 Store build and 0.1.0
APK do not stamp compatLevel yet, so deploying this before they are replaced
would stop them syncing with no version to move to. The rollout order is in
docs/RELEASING.md and the deploy is a separate, gated step.

delete is split from create/update because a delete carries no
request.resource, so a single clause would reject every shard cleanup
dropShardsFrom performs and strand orphaned shards."
```

---

### Task 7: Document the rollout

**Files:**
- Modify: `docs/RELEASING.md`
- Modify: `STATUS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the checklist Task 8 follows.

- [ ] **Step 1: Add the rollout section to `docs/RELEASING.md`**

Append:

```markdown
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
   value.
3. **Only then** set `minCompatLevel` in `config/app` and deploy
   `firestore.rules` with the matching minimum.

There is never a moment when a good client is refused.

`config/app` is edited by hand in the Firebase console:

```json
{ "minCompatLevel": 2, "latestVersion": "0.2.0", "latestNotes": "..." }
```
```

- [ ] **Step 2: Add the status entry to `STATUS.md`**

Add under "What is waiting on a human":

```markdown
- **The compatibility gate is built but not armed.** `firestore.rules` carries
  the `compatLevel >= 2` requirement and the client stamps it, but the rule is
  **not deployed** and `config/app` does not exist yet. Arming it before the
  0.1.0 Store build and 0.1.0 APK are replaced would stop them syncing with
  nowhere to go. The order is in [docs/RELEASING.md](docs/RELEASING.md).
```

- [ ] **Step 3: Verify the emoji gate and lint**

Run: `npm run lint:emoji && npm run lint`
Expected: both clean. The emoji check scans the instruction surface as well as `src/`.

- [ ] **Step 4: Commit**

```bash
git add docs/RELEASING.md STATUS.md
git commit -m "Document the compatibility rollout order

Step 2 -- verifying the field is really in Firestore before raising the
minimum -- is the control that stops a careless bump locking out every client
at once. It must not be skipped."
```

---

### Task 8: Arm the gate — GATED ON HUMAN CONFIRMATION

> **Stop.** Do not begin this task autonomously. It requires a human to confirm
> that a client stamping `compatLevel: 2` is installed on every device that
> syncs this account — desktop and Android both. Arming it before that stops
> those devices syncing with no version to move to.

**Files:** none. This is deployment and console work.

- [ ] **Step 1: Confirm clients are live**

Ask the human to confirm both, and do not proceed on an assumption:
- The desktop app has been rebuilt from a commit including Task 3 and reinstalled.
- The Android APK has been rebuilt from the same commit and reinstalled.

- [ ] **Step 2: Verify the field is actually being written**

In the signed-in browser, read a domain document straight out of Firestore and
confirm the field is present with the right value:

```js
const { getSyncState } = await import('/src/services/db.js');
console.log('sync state:', getSyncState());
// Then check Firestore directly in the Firebase console:
//   lorehaven_users/<uid>/data/library  ->  compatLevel: 2
```

Expected: `compatLevel: 2` on the `library` document, and on `libraryDeleted`,
`recFeedback` and `prefs`. If any domain lacks it, stop — Task 3 is incomplete.

- [ ] **Step 3: Create `config/app` in the Firebase console**

Collection `config`, document id `app`:

| Field | Type | Value |
|---|---|---|
| `minCompatLevel` | number | `2` |
| `latestVersion` | string | the version just released |
| `latestNotes` | string | one short line |

`minCompatLevel` must be stored as a **number**, not a string — the rule tests
`is int` and a string fails it, which would refuse every write.

- [ ] **Step 4: Deploy the rules**

```bash
firebase deploy --only firestore:rules
```

- [ ] **Step 5: Verify the gate against the live rules**

The Firestore emulator needs a JDK 21 this machine does not have, so this is
verified against the deployed rules instead. In the signed-in browser console:

```js
const { getFirestore, doc, setDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
// Use the app's own initialised instance rather than a second one.
const { db, auth } = await import('/src/services/firebase.js');
const uid = auth.currentUser.uid;
const probe = doc(db, 'lorehaven_users', uid, 'data', 'gateProbe');

// 1. A write below the minimum must be refused.
let refused = false;
try { await setDoc(probe, { items: [], compatLevel: 1, updatedAt: new Date() }); }
catch (e) { refused = e.code === 'permission-denied'; }
console.log(refused ? 'ok    compatLevel 1 refused' : 'FAIL  compatLevel 1 was accepted');

// 2. A write at the minimum must succeed.
let accepted = false;
try { await setDoc(probe, { items: [], compatLevel: 2, updatedAt: new Date() }); accepted = true; }
catch (e) { console.log('write error', e.code); }
console.log(accepted ? 'ok    compatLevel 2 accepted' : 'FAIL  compatLevel 2 was refused');

// 3. A write with no level at all must be refused.
const probe2 = doc(db, 'lorehaven_users', uid, 'data', 'gateProbe2');
let bare = false;
try { await setDoc(probe2, { items: [], updatedAt: new Date() }); }
catch (e) { bare = e.code === 'permission-denied'; }
console.log(bare ? 'ok    an unstamped write refused' : 'FAIL  an unstamped write was accepted');
```

Expected: three `ok` lines.

- [ ] **Step 6: Delete the probe documents**

Deleting also proves the split `allow delete` rule works:

```js
const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
await deleteDoc(probe);
console.log('ok    delete still permitted with no compatLevel in the request');
```

Expected: `ok`, and `gateProbe` gone from the console. If this throws
`permission-denied`, the `allow delete` clause was folded into create/update by
mistake and shard cleanup is broken — fix before leaving it deployed.

- [ ] **Step 7: Confirm the app still syncs normally**

Make a real edit — set a priority on a game — and confirm the Profile page
shows "Synced just now" rather than an error.

- [ ] **Step 8: Record the result in `STATUS.md`**

Replace the "built but not armed" entry with what was actually observed,
including the three probe results. Commit.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: `compat.js` and
`compareVersions` (Task 1); `__APP_VERSION__` (Task 2); stamping every shard and
the clear path, sent explicitly rather than inherited (Task 3); `config/app`,
fail-open, and suppressed writes (Task 4); degraded-mode copy on the existing
surfaces (Task 5); the split rules (Task 6); the three-step rollout (Tasks 7-8);
live rule verification in place of the unavailable emulator (Task 8, steps 5-6).

**Deliberately not covered**, and out of scope per the spec: the Updates page,
`tauri-plugin-updater`, Store packaging detection, and Android OTA. Those belong
to [the OTA spec](../specs/2026-09-09-android-ota-design.md).

**Type consistency.** `COMPAT_LEVEL` is a number everywhere. `domainPayload`
takes `(field, value, { parts, index })` in Task 3 and is called with that exact
shape in both `writeDomain` branches. `evaluateCompat` returns
`{ outdated, updateAvailable }` in Task 1 and is destructured as exactly those
two names in Task 4. `getSyncState()` gains `outdated`, `updateAvailable` and
`latestVersion` in Task 4 and Task 5 reads only `outdated`.

**Known gap, stated rather than papered over.** There is no automated test of
the Firestore rules, because the emulator needs a JDK 21 this machine does not
have. Task 8 verifies against the deployed rules instead, which tests what is
actually live but is manual and will not catch a future regression.
