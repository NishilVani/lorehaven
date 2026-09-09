// src/services/db.js
//
// ─────────────────────────────────────────────────────────────────────────────
// Cloud schema v2 — structured Firestore mirror of localStorage
//
//   lorehaven_users/{uid}/data/library           { games: [...] }
//   lorehaven_users/{uid}/data/collections       { collections: [...] }
//   lorehaven_users/{uid}/data/franchises        { franchises: [...] }
//   lorehaven_users/{uid}/data/savedIgdbCollections  { ids: [...] }
//   lorehaven_users/{uid}/data/profile           { profile: {...} }
//
// Values are native Firestore objects (NOT JSON strings). localStorage stays
// the app's synchronous working store; the cloud is a mirror. List domains
// merge by id on pull — a partial cloud copy can never erase local items.
//
// Frozen artifacts from the v1→v2 migration (no code touches them):
//   users/{uid}    — the legacy string-dump doc
//   backups/{uid}  — snapshot of legacy doc + localStorage at migration time
//
// ponytail: each domain lives in one doc (1MB Firestore doc ceiling — same
// ceiling the old string dump had). Upgrade path: per-game subcollection.
// ─────────────────────────────────────────────────────────────────────────────
import { db, auth } from './firebase.js';
import {
    doc, setDoc, deleteDoc, onSnapshot, deleteField,
    collection, getDocs, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { toDateInputValue } from './libraryFields.js';
import { mergeLists, stampItems, mergeTombstones, tombstonesFor, pruneTombstones } from './syncMerge.js';
import { COMPAT_LEVEL, APP_VERSION, evaluateCompat } from './compat.js';

/* Re-exported so callers keep one import site for library concerns. */
export { toDateInputValue };

let currentUser = null;

/** localStorage key ←→ cloud domain doc mapping */
const DOMAINS = {
    moctale_library: { docId: 'library', field: 'games' },
    /* Deletions, so a game removed here is not put back by a device that still
       holds it. { id: deletedAt }, merged per id with the newest deletion
       winning -- see syncMerge.js. Its own docId: KEY_FOR_DOC is keyed by docId. */
    moctale_library_deleted: { docId: 'libraryDeleted', field: 'ids', mergePolicy: 'maxByKey' },
    moctale_collections: { docId: 'collections', field: 'collections' },
    moctale_franchises: { docId: 'franchises', field: 'franchises' },
    moctale_saved_igdb_collections: { docId: 'savedIgdbCollections', field: 'ids' },
    /* Merged per verdict, like the library: a verdict only one device has
       survives, a changed verdict goes to the newer stamp, and a CLEARED
       verdict travels as a tombstone in the domain below -- which is what lets
       this be a union without an omitted id turning back into "Not
       Interested" on the next sync. It used to declare `listPolicy: 'replace'`
       for that reason, and the declaration never reached applyDomainDoc:
       KEY_FOR_DOC copied only `key` and `field`, so feedback was unioned all
       along and a clear on one device WAS undone by the other. */
    moctale_rec_feedback: { docId: 'recFeedback', field: 'items' },
    moctale_rec_feedback_deleted: { docId: 'recFeedbackDeleted', field: 'ids', mergePolicy: 'maxByKey' },
    moctale_user_profile: { docId: 'profile', field: 'profile' },

    /* Recommendation settings — taste bias and release era. setPrefs already
       wrote through setLocalItem, so this was one missing line away from
       syncing and had simply never been added: the only piece of user
       configuration in the app that did not follow you between devices, while
       the library, shelves, feedback and platforms all did.

       An object, so it takes the whole-doc newest-wins path. That is what you
       want from a settings pair — the two fields are set together in one dialog
       and merging half of an older choice with half of a newer one would
       produce a combination the user never picked. */
    moctale_prefs: { docId: 'prefs', field: 'prefs' },

    /* The library update feed. Both of these were device-local, which is what
       made the feed stop at the device that computed it: the snapshot is the
       baseline the diff runs against, so a second device had none, treated every
       game as unsnapshotted, took a fresh baseline — and a baseline deliberately
       reports nothing. You saw an empty feed and no way to earn one back.

       The feed is an array of events with stable ids, so it takes the default
       union merge and two devices' findings combine. The snapshot is an object
       and takes the whole-doc newest-wins path, which is right: a snapshot is a
       coherent point-in-time picture of the library and the most recent one is
       the correct baseline for the next diff.

       lh_lib_updates_at is deliberately NOT synced. It is the 6-hour refresh
       timer, and sharing it would let a device that has not been opened in a
       week suppress the check on one that has. Each device keeps its own
       cadence; they share the baseline and pool the results. lh_lib_updates_v is
       a client schema marker and must stay local for the same reason. */
    lh_lib_snapshot: { docId: 'libSnapshot', field: 'snapshots' },
    lh_lib_updates: { docId: 'libUpdates', field: 'events' },

    /* When Clear All last ran, so a clear survives the union above.
       Pooling findings is right — two devices each see different updates — but
       it means an emptied list is refilled by any device that still holds the
       old events, so a watermark is the only thing that can express "I have
       seen everything up to here". An object, so it takes the whole-doc
       newest-wins path: the most recent clear is the correct one, and clears do
       not merge.

       Its own docId. KEY_FOR_DOC is keyed by docId, so hanging a second field
       off 'libUpdates' would silently make one of the two keys unreachable when
       a cloud doc arrives. */
    lh_lib_updates_clear: { docId: 'libUpdatesClear', field: 'clearedAt' },
};
/* The whole domain config, not just key and field: the policies are read off
   this map, and a map that dropped them silently disabled every one. */
const KEY_FOR_DOC = Object.fromEntries(
    Object.entries(DOMAINS).map(([k, v]) => [v.docId, { key: k, ...v }])
);

/* List domain -> the domain that carries its deletions. */
const TOMBSTONES_FOR = {
    moctale_library: 'moctale_library_deleted',
    moctale_rec_feedback: 'moctale_rec_feedback_deleted',
};

const domainRef = (uid, docId) => doc(db, 'lorehaven_users', uid, 'data', docId);

/* ── Sharding, so a large library still fits ─────────────────────────────────
 *
 * Every synced domain is one Firestore document holding the whole collection,
 * and Firestore refuses a document over 1 MiB. Measured: a 1000-game library is
 * 310 KB of JSON, and lh_lib_snapshot is a second copy of the same games. So a
 * few thousand games -- one Steam import -- and the write is rejected outright.
 * That is a hard failure, not a slowdown, and it arrives without warning.
 *
 * Above the threshold a domain is written across `docId`, `docId~1`, `docId~2`.
 * The first part carries `parts`, which is what says how many there are;
 * anything beyond that count is ignored on read and deleted on write, so a
 * library that shrinks does not resurrect games from a stale shard. Below the
 * threshold nothing changes at all, which is every user today.
 *
 * 400K chars leaves generous room: Firestore's ceiling is on its own encoding of
 * the document, not on the JSON we measured, and the two are not the same size.
 */
const SHARD_MAX_CHARS = 400 * 1024;
const SHARD_SEP = '~';

export const shardIdFor = (docId, i) => (i === 0 ? docId : `${docId}${SHARD_SEP}${i}`);

/**
 * Split a domain value into as few pieces as each will fit in. PURE.
 * Arrays split by element and rejoin with concat; objects split by entry and
 * rejoin with assign. Returns [value] untouched when it already fits, which is
 * the path every existing user stays on.
 */
export const splitPayload = (value, maxChars = SHARD_MAX_CHARS) => {
    if (JSON.stringify(value ?? null).length <= maxChars) return [value];
    const units = Array.isArray(value) ? value : Object.entries(value || {});
    if (units.length <= 1) return [value];   // one unit too big to split is still one write
    const rebuild = (part) => (Array.isArray(value) ? part : Object.fromEntries(part));

    const parts = [];
    let current = [];
    for (const unit of units) {
        const next = current.concat([unit]);
        if (current.length && JSON.stringify(rebuild(next)).length > maxChars) {
            parts.push(rebuild(current));
            current = [unit];
        } else {
            current = next;
        }
    }
    if (current.length) parts.push(rebuild(current));
    return parts;
};

/**
 * Rejoin the documents of a subcollection so the rest of the sync code keeps
 * seeing one document per domain. PURE.
 * @param {{id: string, data: object}[]} docs
 * @returns {{id: string, data: object}[]}
 */
export const mergeShards = (docs) => {
    const bases = new Map();
    const extras = new Map();                 // baseId -> Map(index -> data)
    for (const { id, data } of docs) {
        const sep = id.indexOf(SHARD_SEP);
        if (sep === -1) { bases.set(id, data); continue; }
        const baseId = id.slice(0, sep);
        const index = Number(id.slice(sep + 1));
        if (!Number.isInteger(index) || index < 1) continue;
        if (!extras.has(baseId)) extras.set(baseId, new Map());
        extras.get(baseId).set(index, data);
    }

    const out = [];
    for (const [id, data] of bases) {
        const parts = Number(data?.parts) || 1;
        const mine = extras.get(id);
        if (parts <= 1 || !mine) { out.push({ id, data }); continue; }
        /* The domain map knows the field name; the scan is only for a document
           whose docId is not in it, which should not happen but must not throw. */
        const field = KEY_FOR_DOC[id]?.field
            || Object.keys(data).find(k => k !== 'updatedAt' && k !== 'parts');
        if (!field) { out.push({ id, data }); continue; }
        let joined = data[field];
        for (let i = 1; i < parts; i++) {
            const piece = mine.get(i)?.[field];
            if (piece === undefined) continue;   // a part that has not arrived yet
            joined = Array.isArray(joined) ? joined.concat(piece) : { ...joined, ...piece };
        }
        out.push({ id, data: { ...data, [field]: joined } });
    }
    return out;
};

/* Whether the cloud is actually keeping up, so something can say so.
   Every failure path in here was a console.error and nothing else: a user whose
   Firestore rules rejected every write saw an app that behaved exactly like one
   that was syncing fine, and only found out by opening devtools. `at` is the
   last time a write or a pull succeeded this session; it is deliberately not
   persisted, because a timestamp restored from localStorage would claim a sync
   that this session never made. */
/* `outdated` is set from config/app and is independent of auth: a signed-out
   user should still be told their build cannot sync. */
let syncState = {
    signedIn: false, at: null, error: null,
    outdated: false, updateAvailable: false, latestVersion: null,
};
/* The live-sync listener's unsubscribe. It was discarded, so every sign-out
   left a listener that re-ran `list` with no credential (a rules denial that
   overwrote the sign-out's clean reset), and every sign-in leaked another. */
let unsubDomains = null;
const setSyncState = (patch) => {
    syncState = { ...syncState, ...patch };
    window.dispatchEvent(new Event('moctale_sync_state'));
};

/** { signedIn, at, error, outdated, updateAvailable, latestVersion } —
 *  `at` is null until something has synced this session. */
export const getSyncState = () => syncState;

/* How many shards each domain was last written as, so shrinking back to fewer
   can delete the ones no longer used. Session-scoped: a shard left behind by a
   previous session is ignored on read anyway, because `parts` on the first
   document is what counts, and the next write that needs fewer will clean up
   from whatever this says. */
const shardCounts = new Map();

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

const writeDomain = async (key, value) => {
    const domain = DOMAINS[key];
    if (!currentUser || !domain) return;
    try {
        const uid = currentUser.uid;
        if (value === null) {
            await setDoc(domainRef(uid, domain.docId),
                domainPayload(domain.field, deleteField(), { parts: 1, index: 0 }), { merge: true });
            await dropShardsFrom(uid, domain.docId, 1);
            shardCounts.set(domain.docId, 1);
        } else {
            // localStorage values are JSON strings — parse to store native objects
            const parts = splitPayload(JSON.parse(value));
            /* First part last would leave a window where `parts` says there are
               three and only one exists. Writing the tail first and the head
               after means a reader either sees the old document or a complete
               new one. */
            for (let i = parts.length - 1; i >= 0; i--) {
                await setDoc(domainRef(uid, shardIdFor(domain.docId, i)),
                    domainPayload(domain.field, parts[i], { parts: parts.length, index: i }), { merge: true });
            }
            await dropShardsFrom(uid, domain.docId, parts.length);
            shardCounts.set(domain.docId, parts.length);
        }
        setSyncState({ at: Date.now(), error: null });
    } catch (e) {
        console.error(`[db] Cloud sync failed for "${key}" — check Firestore rules for lorehaven_users/`, e);
        setSyncState({ error: e?.message || 'Cloud write failed' });
    }
};

/** Remove shards at or beyond `from` that a previous, larger write left. */
const dropShardsFrom = async (uid, docId, from) => {
    const had = shardCounts.get(docId) || 1;
    for (let i = Math.max(from, 1); i < had; i++) {
        try { await deleteDoc(domainRef(uid, shardIdFor(docId, i))); }
        catch { /* a shard that is already gone is the state we wanted */ }
    }
};

/* One write per domain per burst, and one write in flight at a time.
 *
 * Every write here sends the WHOLE domain document, so out of N writes to the
 * same domain only the last one carries anything: the earlier N-1 are the same
 * document minus the newest edit. Firing them all was pure waste, and past a
 * point it was a failure -- the import wizard saves the library once per row, so
 * importing a few hundred games queued a few hundred whole-library writes and
 * Firestore answered with
 *
 *   FirebaseError: [code=resource-exhausted]: Write stream exhausted maximum
 *   allowed queued writes
 *
 * followed by "Using maximum backoff delay", after which nothing synced for a
 * while. Any burst does it: a run of card toggles, a bulk shelf edit, a
 * migration. Coalescing here rather than at each caller is deliberate -- the
 * import loop was only the loudest of them, and a guard per caller is both a
 * bigger change and one the next caller will forget.
 *
 * Last write wins, which is correct precisely because each one is the whole
 * document. */
const FLUSH_MS = 400;
const pendingWrites = new Map();   // domain key -> the newest value for it
let flushTimer = null;
let flushing = null;

const flushCloud = async () => {
    flushTimer = null;
    if (flushing) return flushing;                 // one in flight, never a queue
    flushing = (async () => {
        while (pendingWrites.size && currentUser) {
            const [key, value] = pendingWrites.entries().next().value;
            pendingWrites.delete(key);
            await writeDomain(key, value);
        }
    })().finally(() => {
        flushing = null;
        /* A write that landed between the loop's last size check and here would
           otherwise sit until something else happened to trigger a flush. */
        if (pendingWrites.size && !flushTimer) flushTimer = setTimeout(flushCloud, FLUSH_MS);
    });
    return flushing;
};

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

/* A tab closed inside the coalescing window would otherwise drop the last edit
   from the cloud until something touched that domain again. localStorage still
   has it, so nothing is lost on this device -- but another device would not see
   it. visibilitychange fires while the page can still do work, unlike unload. */
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && pendingWrites.size) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            flushCloud();
        }
    });
}

/* Rebuildable caches, in the order we are willing to lose them.
   localStorage is one budget for the whole origin (~5MB), and the IGDB metadata
   cache fills to its own ceiling without ever asking what else needs room — so
   the write that finally runs out of space is not the one that took it, it is
   whichever comes next. That was saveToLibrary: QuotaExceededError thrown out of
   an onClick, uncaught, after React had already rendered the change, so the UI
   showed an edit that never reached disk. Both of these cost one network round
   trip to rebuild. The library cannot be rebuilt at all. */
const EVICTABLE = [
    k => k === 'moctale_igdb_games_cache',
    k => k.startsWith('lh_awards_'),
];

/** Drop one tier of rebuildable cache. Returns true if anything was freed. */
const evictCache = (matches) => {
    const keys = Object.keys(window.localStorage).filter(matches);
    keys.forEach(k => { try { window.localStorage.removeItem(k); } catch { /* nothing to do */ } });
    return keys.length > 0;
};

const tryWrite = (key, value) => {
    try { window.localStorage.setItem(key, value); return true; }
    catch { return false; }
};

const setLocalItem = (key, value) => {
    let stored = tryWrite(key, value);
    for (const matches of EVICTABLE) {
        if (stored) break;
        if (evictCache(matches)) stored = tryWrite(key, value);
    }

    /* Stamped only on a write that landed. `_mt` is what applyDomainDoc compares
       against the cloud doc's updatedAt, so stamping a failed write would tell
       the next snapshot that this device holds the newer copy and make it
       discard the cloud's — turning a save that failed into one that is gone. */
    if (stored && DOMAINS[key]) tryWrite(`${key}_mt`, String(Date.now()));
    if (!stored) {
        console.error(`[db] Device storage is full — "${key}" was not saved locally.`);
        setSyncState({ error: 'Device storage is full' });
    }

    /* Unconditional. A full disk is exactly when the cloud copy is the only copy,
       and the throw used to skip this line entirely. */
    syncToCloud(key, value);
};

/* Exported so services that own their own persistence — discover.js writes the
   update feed directly — can write a synced domain without reaching for
   localStorage and silently skipping the cloud. Writing a DOMAINS key with
   window.localStorage.setItem is how the update feed came to be device-local. */
export { setLocalItem as setSyncedLocalItem };

const removeLocalItem = (key) => {
    window.localStorage.removeItem(key);
    if (DOMAINS[key]) window.localStorage.setItem(`${key}_mt`, String(Date.now()));
    syncToCloud(key, null);
};

const keyOf = (x) => (x && typeof x === 'object') ? `id:${String(x.id)}` : `v:${String(x)}`;

const readTombstones = (key) => {
    if (!key) return {};
    try { return JSON.parse(window.localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
};

/* A tombstone document has to land before the list it applies to, whatever
   order Firestore hands them back in. */
const isTombstoneDoc = (id) => KEY_FOR_DOC[id]?.mergePolicy === 'maxByKey';
const tombstonesFirst = (docs) => [...docs].sort((a, b) =>
    (isTombstoneDoc(a.id) ? -1 : 0) - (isTombstoneDoc(b.id) ? -1 : 0));

// Key-order-insensitive stringify — Firestore alphabetizes map keys, so a
// write's own echo differs from local ONLY in key order. Comparing raw JSON
// made every save look like a remote change and remount the whole app.
const stableStr = (x) => JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {})
        : v);

/** Apply one cloud domain doc to localStorage. Returns true if local changed. */
const applyDomainDoc = (docId, data) => {
    const mapping = KEY_FOR_DOC[docId];
    if (!mapping || !data) return false;
    const value = data[mapping.field];
    if (value === undefined || value === null) return false;
    const local = window.localStorage.getItem(mapping.key);

    // ponytail: list domains MERGE (union by id) instead of cloud-wins overwrite —
    // a stale or partial cloud copy can never erase local items again.
    // Tradeoff: deleting an item on one device may resurrect from another; the
    // delete path still wins on the device where it happened via setLocalItem.
    //
    // Id conflicts go to whichever side wrote most recently: the cloud doc's
    // updatedAt vs this device's last local write ({key}_mt, stamped in
    // setLocalItem). Either way, items only one side has always survive.
    // ponytail: whole-doc timestamps + device clock vs serverTimestamp skew —
    // move to per-item timestamps if concurrent cross-device edits ever matter.
    const cloudAt = data.updatedAt?.toMillis?.() ?? 0;
    const localAt = Number(window.localStorage.getItem(`${mapping.key}_mt`) || 0);

    if (Array.isArray(value)) {
        let localArr;
        try { localArr = JSON.parse(local || '[]'); } catch { localArr = []; }
        /* Per item, not per document -- the rules, and the loss that forced
           them, are in syncMerge.js. */
        const { merged, cloudIsBehind } = mergeLists({
            local: localArr, cloud: value, localAt, cloudAt,
            tombstones: readTombstones(TOMBSTONES_FOR[mapping.key]),
        });
        /* The cloud lacks something this device has: a game it never received,
           or a newer edit of one. Write the merged list back so the next device
           gets it too. It is the superset of both sides, so two devices doing
           this at once converge on one document instead of ping-ponging. */
        if (cloudIsBehind) syncToCloud(mapping.key, JSON.stringify(merged));
        // Order-insensitive compare: merging may reorder identical content, and
        // an order-only diff must not fire moctale_sync_update (it remounts routes).
        const asSet = (arr) => stableStr([...arr].map(keyOf).sort()) + stableStr(Object.fromEntries(arr.map(x => [keyOf(x), x])));
        if (asSet(merged) !== asSet(localArr)) {
            try {
                window.localStorage.setItem(mapping.key, JSON.stringify(merged));
                window.localStorage.setItem(`${mapping.key}_mt`, String(cloudAt || Date.now()));
            } catch (e) { console.error('[db] localStorage write failed applying cloud sync', e); return false; }
            return true;
        }
        return false;
    }

    let localObj = null;
    try { localObj = JSON.parse(local); } catch { /* treat as different */ }
    if (mapping.mergePolicy === 'maxByKey') {
        const merged = mergeTombstones(localObj || {}, value);
        if (stableStr(merged) !== stableStr(value)) syncToCloud(mapping.key, JSON.stringify(merged));
        if (stableStr(merged) === stableStr(localObj)) return false;
        try {
            window.localStorage.setItem(mapping.key, JSON.stringify(merged));
            window.localStorage.setItem(`${mapping.key}_mt`, String(cloudAt || Date.now()));
        } catch (e) { console.error('[db] localStorage write failed applying cloud sync', e); return false; }
        return true;
    }
    if (stableStr(value) !== stableStr(localObj)) {
        // Object domains have no merge — only overwrite local with a NEWER cloud copy
        if (localObj !== null && cloudAt <= localAt) return false;
        try {
            window.localStorage.setItem(mapping.key, JSON.stringify(value));
            window.localStorage.setItem(`${mapping.key}_mt`, String(cloudAt || Date.now()));
        } catch (e) { console.error('[db] localStorage write failed applying cloud sync', e); return false; }
        return true;
    }
    return false;
};

onAuthStateChanged(auth, async (user) => {
    if (unsubDomains) { unsubDomains(); unsubDomains = null; }
    /* Anything still queued belongs to the account that is leaving. Writing it
       after the switch would put one user's library in another user's document. */
    if (currentUser && currentUser.uid !== user?.uid) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        pendingWrites.clear();
    }
    currentUser = user;
    setSyncState({ signedIn: !!user, ...(user ? {} : { at: null, error: null }) });
    if (!user) return;

    try {
        // Pull all structured domain docs into localStorage
        const dataSnap = await getDocs(collection(db, 'lorehaven_users', user.uid, 'data'));
        let changed = false;
        const cloudDocIds = new Set();
        const pulled = tombstonesFirst(mergeShards(dataSnap.docs.map(d => ({ id: d.id, data: d.data() }))));
        for (const { id, data } of pulled) {
            cloudDocIds.add(id);
            /* Remember what the cloud is sharded as, so the first write of the
               session can clean up shards this device never made. */
            if (Number(data?.parts) > 1) shardCounts.set(id, Number(data.parts));
            if (applyDomainDoc(id, data)) changed = true;
        }
        if (changed) window.dispatchEvent(new Event('moctale_sync_update'));
        // The pull completed — that is a successful sync whether or not it
        // changed anything, and it is the one most users will see first.
        setSyncState({ at: Date.now(), error: null });

        // Bootstrap: push local domains the cloud doesn't have yet (e.g. first sign-in on a device)
        for (const [key, domain] of Object.entries(DOMAINS)) {
            const local = window.localStorage.getItem(key);
            if (!cloudDocIds.has(domain.docId) && local && local !== '[]') {
                syncToCloud(key, local);
            }
        }

        // Live sync — other devices' writes flow into localStorage
        unsubDomains = onSnapshot(
            collection(db, 'lorehaven_users', user.uid, 'data'),
            (snap) => {
                if (snap.metadata.hasPendingWrites) return;
                let changed = false;
                for (const { id, data } of tombstonesFirst(mergeShards(snap.docs.map(d => ({ id: d.id, data: d.data() }))))) {
                    if (applyDomainDoc(id, data)) changed = true;
                }
                if (changed) window.dispatchEvent(new Event('moctale_sync_update'));
                setSyncState({ at: Date.now(), error: null });
            },
            (e) => {
                console.error('[db] Live sync listener denied — check the nested match /data/{docId} rule under lorehaven_users/', e);
                setSyncState({ error: 'Live sync was refused' });
            }
        );
    } catch (e) {
        console.error('[db] Cloud sync init failed — running local-only. Check Firestore rules for lorehaven_users/ and backups/', e);
        setSyncState({ error: e?.message || 'Could not reach the cloud' });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────
const LIBRARY_KEY = 'moctale_library';
const USER_PROFILE_KEY = 'moctale_user_profile';

/* Every write to a merged list domain -- the library, recommendation
   feedback -- goes through here, so every write does the two things the
   cross-device merge depends on: stamp the entries that changed (`_u`, unix
   ms -- the per-item clock the merge compares) and record a tombstone for
   every id that disappeared, so a device still holding that entry removes it
   instead of putting it back.

   `heal` is for getLibrary's read-time migrations: they rewrite the stored
   shape, not the user's data, and stamping them would let a migration on a
   stale copy outrank a real edit made elsewhere. Returns the JSON written. */
/* Strictly increasing within a session. Two commits in one millisecond -- a
   set and its clear from a test, or a burst of toggles -- would otherwise
   stamp an entry and its tombstone with the same time, and the merge could not
   say which came last. */
let lastStamp = 0;
const nextStamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp; };

const commitList = (key, next, { heal = false } = {}) => {
  let prev = [];
  try { prev = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* unreadable: nothing to diff against */ }
  if (!Array.isArray(prev)) prev = [];
  const now = nextStamp();
  const stamped = heal ? next : stampItems(prev, next, now);
  const gone = tombstonesFor(prev, stamped, now);
  const deletedKey = TOMBSTONES_FOR[key];
  if (deletedKey && Object.keys(gone).length) {
    setLocalItem(deletedKey, JSON.stringify(pruneTombstones(mergeTombstones(readTombstones(deletedKey), gone), now)));
  }
  const json = JSON.stringify(stamped);
  setLocalItem(key, json);
  return json;
};
const commitLibrary = (next, opts) => commitList(LIBRARY_KEY, next, opts);
/** @deprecated use USER_PROFILE_KEY. Kept for one-time migration only. */
const LEGACY_PLATFORMS_KEY = 'moctale_user_platforms';

// ─────────────────────────────────────────────────────────────────────────────
// Internal platform normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────
const normalizePlatformName = (name) => String(name || '').trim();

const normalizePlatform = (platform) => {
  if (!platform) return null;
  if (typeof platform === 'string') {
    const name = normalizePlatformName(platform);
    if (!name) return null;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return {
      id: `custom_hardware_${cleanName}`,
      name,
      abbreviation: null,
      category: 'hardware',
      linkedIgdbId: null,
      linkedIgdbName: null
    };
  }
  const name = normalizePlatformName(platform.name);
  if (!name) return null;
  const category = platform.category ?? 'hardware';
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return {
    id: platform.id ?? `custom_${category}_${cleanName}`,
    name,
    abbreviation: platform.abbreviation ? String(platform.abbreviation).trim() : null,
    platform_logo: platform.platform_logo ?? undefined,
    platform_logo_image_id: platform.platform_logo_image_id ?? platform.platform_logo?.image_id ?? undefined,
    category,
    linkedIgdbId: platform.linkedIgdbId ?? null,
    linkedIgdbName: platform.linkedIgdbName ?? null,
  };
};

const platformKey = (platform) => {
  if (!platform) return '';
  if (platform.id !== undefined && platform.id !== null && platform.id !== '') return `id:${platform.id}`;
  return `name:${normalizePlatformName(platform.name).toLowerCase()}`;
};

const normalizePlatformList = (platforms) => {
  if (!Array.isArray(platforms)) return [];
  const map = new Map();
  platforms.forEach((platform) => {
    const normalized = normalizePlatform(platform);
    if (!normalized) return;
    map.set(platformKey(normalized), normalized);
  });
  return Array.from(map.values());
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal store normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────
const normalizeStore = (store) => {
  if (!store) return null;
  if (typeof store === 'string') {
    const name = store.trim();
    if (!name) return null;
    return { id: name.toLowerCase(), name };
  }
  const name = String(store.name || '').trim();
  if (!name) return null;
  return {
    id: String(store.id || name.toLowerCase()).trim(),
    name,
    url: store.url ? String(store.url).trim() : undefined
  };
};

const normalizeStoreList = (stores) => {
  if (!Array.isArray(stores)) return [];
  const map = new Map();
  stores.forEach((store) => {
    const normalized = normalizeStore(store);
    if (!normalized) return;
    map.set(normalized.id, normalized);
  });
  return Array.from(map.values());
};

// ─────────────────────────────────────────────────────────────────────────────
// User Profile — schema
// {
//   name            : string      — display name
//   platforms       : Platform[]  — IGDB platforms the user physically owns
//   custom_platforms: Platform[]  — user-created platform labels (e.g. "Steam Deck")
// }
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_CUSTOM_PLATFORMS = [
  // PC
  { name: 'Steam', category: 'store', linkedIgdbId: 6, linkedIgdbName: 'PC (Windows)' },
  { name: 'Epic Games Store', category: 'store', linkedIgdbId: 6, linkedIgdbName: 'PC (Windows)' },
  { name: 'GOG', category: 'store', linkedIgdbId: 6, linkedIgdbName: 'PC (Windows)' },
  { name: 'PC Game Pass', category: 'subscription', linkedIgdbId: 6, linkedIgdbName: 'PC (Windows)' },

  // PlayStation
  { name: 'PlayStation Store', category: 'store', linkedIgdbId: 167, linkedIgdbName: 'PlayStation 5' },
  { name: 'PlayStation Plus', category: 'subscription', linkedIgdbId: 167, linkedIgdbName: 'PlayStation 5' },

  // Xbox
  { name: 'Microsoft Store', category: 'store', linkedIgdbId: 169, linkedIgdbName: 'Xbox Series X|S' },
  { name: 'Xbox Game Pass', category: 'subscription', linkedIgdbId: 169, linkedIgdbName: 'Xbox Series X|S' },

  // Nintendo Switch
  { name: 'Nintendo eShop', category: 'store', linkedIgdbId: 130, linkedIgdbName: 'Nintendo Switch' },
  { name: 'Nintendo Switch Online', category: 'subscription', linkedIgdbId: 130, linkedIgdbName: 'Nintendo Switch' },

  // Mobile
  { name: 'App Store', category: 'store', linkedIgdbId: 39, linkedIgdbName: 'iOS' },
  { name: 'Apple Arcade', category: 'subscription', linkedIgdbId: 39, linkedIgdbName: 'iOS' },
  { name: 'Google Play Store', category: 'store', linkedIgdbId: 34, linkedIgdbName: 'Android' },
  { name: 'Google Play Pass', category: 'subscription', linkedIgdbId: 34, linkedIgdbName: 'Android' },
];

const DEFAULT_USER_PROFILE = {
  name: '',
  platforms: [],
  custom_platforms: [],
};

/**
 * One-time migration: if the old `moctale_user_platforms` key exists and the
 * new profile has no custom_platforms yet, import the old list as custom
 * platforms and delete the legacy key.
 */
const migrateUserPlatforms = (profile) => {
  const legacyRaw = localStorage.getItem(LEGACY_PLATFORMS_KEY);
  if (!legacyRaw) return profile;
  if (profile.custom_platforms.length > 0) {
    removeLocalItem(LEGACY_PLATFORMS_KEY);
    return profile;
  }
  try {
    const legacy = normalizePlatformList(JSON.parse(legacyRaw));
    const migrated = { ...profile, custom_platforms: legacy };
    setLocalItem(USER_PROFILE_KEY, JSON.stringify(migrated));
    removeLocalItem(LEGACY_PLATFORMS_KEY);
    return migrated;
  } catch {
    return profile;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Core User Profile read / write
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the full user profile object. */
export const getUser = () => {
  const raw = localStorage.getItem(USER_PROFILE_KEY);
  let profile = { ...DEFAULT_USER_PROFILE };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      profile = {
        name: parsed.name ?? '',
        platforms: normalizePlatformList(parsed.platforms ?? []),
        custom_platforms: normalizePlatformList(parsed.custom_platforms ?? []),
      };
    } catch (e) {
      console.error('[db] Failed to parse user profile:', e);
    }
  }

  // Pre-population of default custom platforms has been removed to allow custom sections to be empty by default.

  return migrateUserPlatforms(profile);
};

/** Persists the full profile. Returns the saved profile. */
export const saveUser = (profileData) => {
  const merged = {
    ...DEFAULT_USER_PROFILE,
    ...profileData,
    platforms: normalizePlatformList(profileData.platforms ?? []),
    custom_platforms: normalizePlatformList(profileData.custom_platforms ?? []),
  };
  setLocalItem(USER_PROFILE_KEY, JSON.stringify(merged));
  return merged;
};

/** Merges partial fields into the current profile. Returns the saved profile. */
export const updateUser = (partial) => {
  const current = getUser();
  return saveUser({ ...current, ...partial });
};

// ─────────────────────────────────────────────────────────────────────────────
// Convenience field accessors
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the user's display name. */
export const getUserName = () => getUser().name;

/** Sets the user's display name. */
export const setUserName = (name) => updateUser({ name: String(name ?? '').trim() });

// — Platforms (IGDB hardware the user physically owns) ————————————————————

/** Returns the platforms the user owns. */
export const getUserOwnedPlatforms = () => getUser().platforms;

/** Replaces the entire owned-platforms list. */
export const setUserOwnedPlatforms = (platforms) => updateUser({ platforms });

// — Custom Platforms (user-created labels) ————————————————————————————————

/** Returns the list of user-created custom platforms. */
export const getUserCustomPlatforms = () => getUser().custom_platforms;

/** Replaces the entire custom-platforms list. */
export const setUserCustomPlatforms = (custom_platforms) => updateUser({ custom_platforms });

/** Adds a custom platform if it doesn't already exist. Returns the updated list. */
export const addUserCustomPlatform = (platform) => {
  const normalized = normalizePlatform(platform);
  if (!normalized) return getUserCustomPlatforms();
  const current = getUser();
  const exists = current.custom_platforms.some(p =>
    p.name.toLowerCase() === normalized.name.toLowerCase() &&
    p.category === normalized.category
  );
  if (exists) return current.custom_platforms;
  const updated = [...current.custom_platforms, normalized];
  updateUser({ custom_platforms: updated });
  return updated;
};

/** Removes a custom platform. Returns the updated list. */
export const removeUserCustomPlatform = (platform) => {
  const normalized = normalizePlatform(platform);
  if (!normalized) return getUserCustomPlatforms();
  const current = getUser();
  const updated = current.custom_platforms.filter(p => {
    if (normalized.id && p.id === normalized.id) return false;
    return !(p.name.toLowerCase() === normalized.name.toLowerCase() && p.category === normalized.category);
  });
  updateUser({ custom_platforms: updated });

  // If this is a purely custom platform, also scrub it from all games in the library
  if (!normalized.linkedIgdbId) {
    const library = getLibrary();
    let libraryDirty = false;
    const migrated = library.map(game => {
      if (!game.user_platforms || !Array.isArray(game.user_platforms)) return game;
      const originalLength = game.user_platforms.length;
      const filtered = game.user_platforms.filter(p => {
        if (normalized.id && p.id === normalized.id) return false;
        return !(p.name.toLowerCase() === normalized.name.toLowerCase() && p.category === normalized.category);
      });
      if (filtered.length !== originalLength) {
        libraryDirty = true;
        return { ...game, user_platforms: filtered };
      }
      return game;
    });

    if (libraryDirty) {
      commitLibrary(migrated);
    }
  }

  return updated;
};

// ─────────────────────────────────────────────────────────────────────────────
// Legacy aliases — keep existing callers working without changes
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use getUserCustomPlatforms(). */
export const getUserPlatforms = () => getUserCustomPlatforms();

/** @deprecated Use setUserCustomPlatforms(). */
export const saveUserPlatforms = (platforms) => {
  setUserCustomPlatforms(platforms);
  return normalizePlatformList(platforms);
};

/** @deprecated Use addUserCustomPlatform / removeUserCustomPlatform. */
export const toggleUserPlatform = (platform) => {
  const normalized = normalizePlatform(platform);
  if (!normalized) return getUserCustomPlatforms();
  const key = platformKey(normalized);
  const current = getUserCustomPlatforms();
  return current.some(p => platformKey(p) === key)
    ? removeUserCustomPlatform(normalized)
    : addUserCustomPlatform(normalized);
};

// ─────────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────────

/* getLibrary parses the whole library AND re-runs every migration below over
   every game, and it is called per GameCard and again on every library event.
   Measured at 0.12 / 0.31 / 1.31 ms for 100 / 400 / 1000 games, times the number
   of cards on screen, which is how one card toggle cost 32ms at 1000 games.

   The stored string is the cache key: if it has not changed, neither has
   anything the migrations would produce, so the result is reused. A shallow copy
   goes out because saveToLibrary pushes onto what it is handed (db.js, in
   saveToLibrary); the copy costs one array of references, not a re-parse. The
   game objects themselves are shared, which is safe because nothing writes to a
   library entry in place -- every writer builds a new object with a spread. */
let libraryMemo = { raw: null, games: null };

export const getLibrary = () => {
  const data = localStorage.getItem(LIBRARY_KEY);
  if (!data) { libraryMemo = { raw: null, games: null }; return []; }
  if (data === libraryMemo.raw) return libraryMemo.games.slice();
  try {
    const library = JSON.parse(data);
    let dirty = false;
    const migrated = library.map(g => {
      let updatedGame = { ...g };

      // 1. One-time migration: completion_date → dateCompleted
      if (Object.prototype.hasOwnProperty.call(g, 'completion_date')) {
        dirty = true;
        const { completion_date, ...rest } = updatedGame;
        updatedGame = { ...rest, dateCompleted: completion_date ?? g.dateCompleted ?? null };
      }

      /* 1b. Completion dates to yyyy-MM-dd, once, on read.
         Done here rather than at the input because four other places already
         read this field and all of them were right; the input was the odd one
         out, and normalising at the boundary means every reader and writer
         agrees on one shape. Covers the import path too, which writes whatever
         format the spreadsheet cell held. */
      const normalizedDate = toDateInputValue(updatedGame.dateCompleted);
      /* `normalizedDate` is null when the value could not be parsed. Writing that
         null would destroy the user's data on a read. A heal-on-read step may
         normalise what it can derive; it never persists a derivation that failed. */
      if (updatedGame.dateCompleted && normalizedDate && normalizedDate !== updatedGame.dateCompleted) {
        dirty = true;
        updatedGame = { ...updatedGame, dateCompleted: normalizedDate };
      }

      // 2. Normalize user_platforms if present
      if (g.user_platforms && Array.isArray(g.user_platforms)) {
        const normalized = normalizePlatformList(g.user_platforms);
        // Check if anything actually changed (e.g. elements were added/normalized/IDs generated)
        const needsUpdate = normalized.length !== g.user_platforms.length ||
          normalized.some((p, idx) => {
            const orig = g.user_platforms[idx];
            if (!orig || typeof orig === 'string') return true;
            return p.id !== orig.id || p.category !== orig.category;
          });

        if (needsUpdate) {
          updatedGame.user_platforms = normalized;
          /* Same invariant: normalizePlatformList drops rows it cannot normalise and
             de-duplicates by key. A list that lost rows is used for this read but
             never written back, so a getter cannot delete anything from disk. */
          if (normalized.length === g.user_platforms.length) dirty = true;
        }
      }

      // 3. One-time migration: old priority names → new names
      const PRIORITY_MIGRATION = {
        'Whenever': 'Someday',
        'Give it a try': 'Maybe',
        'Want to Play': 'Soon',
        'Must Play': 'Next Up',
      };
      if (g.priority && PRIORITY_MIGRATION[g.priority]) {
        dirty = true;
        updatedGame.priority = PRIORITY_MIGRATION[g.priority];
      }

      return updatedGame;
    });

    if (dirty) {
      /* The migrations rewrote the store, so `data` is no longer what is on
         disk. Memoising against the new string keeps the next call a hit
         instead of re-running a migration that now has nothing to do. */
      const json = commitLibrary(migrated, { heal: true });
      libraryMemo = { raw: json, games: migrated };
    } else {
      libraryMemo = { raw: data, games: migrated };
    }
    return migrated.slice();
  } catch (error) {
    console.error('[db] Failed to parse moctale_library:', error);
    return [];
  }
};

/* The one-game path, kept as the thin wrapper it now is so every caller and
   every test that used it is unchanged. */
export const saveToLibrary = (gameData) => saveManyToLibrary([gameData]);

const normalizeEntry = (gameData) => ({
    ...gameData,
    ...(gameData && Object.prototype.hasOwnProperty.call(gameData, 'user_platforms')
      ? { user_platforms: normalizePlatformList(gameData.user_platforms) }
      : {}),
    ...(gameData && Object.prototype.hasOwnProperty.call(gameData, 'user_stores')
      ? { user_stores: normalizeStoreList(gameData.user_stores) }
      : {}),
});

/**
 * Merge any number of games into the library in one pass, and write once.
 *
 * The import wizard called saveToLibrary per row, and each call read the whole
 * library, scanned it for the id, stringified all of it and wrote it back --
 * O(n squared) in rows, and before the sync coalescing it also queued one
 * whole-library Firestore write per row, which is what exhausted the write
 * stream. One row still costs one pass, because saveToLibrary is now this.
 *
 * Order is preserved: an existing game stays where it is and is merged in
 * place, a new one is appended, and a batch containing the same id twice
 * applies both in order. That last one matters for an import whose sheet lists
 * a game on two rows.
 */
export const saveManyToLibrary = (games) => {
  const incoming = (Array.isArray(games) ? games : [games]).filter(Boolean);
  if (incoming.length === 0) return;

  const library = getLibrary();
  /* One index for the whole batch instead of a findIndex per game. Kept in step
     as the batch appends, so a duplicate id inside one batch merges rather than
     producing a second entry. */
  const at = new Map(library.map((g, i) => [String(g.id), i]));

  for (const gameData of incoming) {
    const normalizedGameData = normalizeEntry(gameData);
    const existingIndex = at.get(String(gameData.id));
    if (existingIndex !== undefined) {
      library[existingIndex] = { ...library[existingIndex], ...normalizedGameData };
      continue;
    }
    /* When the game entered the library. Nothing recorded this before, so
       `dateCompleted` was the only date the app held — and that one is optional
       and offered for Beaten games alone. Every "this year" figure had to hang
       off it, and "added in 2026" could not be answered at all.

       Stamped on first insert only, and never backfilled: the 240 entries that
       predate this were added over five years, and writing Date.now() onto them
       would claim they all arrived the day this shipped. Absent means "before we
       started counting", which is true, and any stat reading this field has to
       say so rather than treating the library as if it began today.

       Spread first so a caller can supply its own — the CSV import knows real
       dates for the rows it is replaying and should win over the clock. */
    at.set(String(gameData.id), library.length);
    library.push({ addedAt: Date.now(), ...normalizedGameData });
  }
  commitLibrary(library);
};

/** Replaces the whole library. For bulk edits that touch many entries at once —
 *  a per-game loop over saveToLibrary would re-stringify and re-upload the list
 *  once per game.
 *
 *  It exists because the two places that needed it reached for
 *  `localStorage.setItem('moctale_library', …)` instead
 *  (ManagePlatforms' transfer and delete), and that skips both the cloud write
 *  AND the `_mt` stamp. Missing the stamp is the worse half: the array merge in
 *  applyDomainDoc compares the cloud doc's updatedAt against `_mt`, so an
 *  unstamped local write looks OLDER than the cloud and the next snapshot
 *  overwrites it wholesale. The edit was not merely device-local — it was
 *  reverted. */
export const saveLibrary = (games) => {
  commitLibrary(Array.isArray(games) ? games : []);
};

export const removeFromLibrary = (gameId) => {
  const library = getLibrary();
  const filtered = library.filter(g => g.id.toString() !== gameId.toString());
  commitLibrary(filtered);
};

/* Announces itself. Every other library mutation is dispatched by its caller,
   which was survivable while the only caller was the page rendering the list.
   Clearing now fires from the account menu, so any mounted view has to hear it
   without the menu knowing who is listening. */
export const clearLibrary = () => {
  commitLibrary([]);              // a tombstone per game, or another device restores them all
  removeLocalItem(LIBRARY_KEY);
  window.dispatchEvent(new Event('moctale_lib_update'));
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved Franchises
// ─────────────────────────────────────────────────────────────────────────────
const FRANCHISES_KEY = 'moctale_franchises';

/** Returns all saved franchises: [{ id, name }] — sanitized; heals corrupt storage in place. */
export const getSavedFranchises = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FRANCHISES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter(f => f && typeof f === 'object' && Number.isFinite(Number(f.id)) && f.name);
    if (clean.length !== parsed.length) setLocalItem(FRANCHISES_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return [];
  }
};

/** Saves (or updates) a franchise entry. Refuses a nameless one: getSavedFranchises
    drops it on the next read and rewrites storage in place, so the invariant
    belongs here, at the only write. Returns whether it was saved. */
export const saveFranchise = ({ id, name }) => {
  if (!name) return false;
  const list = getSavedFranchises();
  const idx = list.findIndex(f => String(f.id) === String(id));
  if (idx >= 0) {
    list[idx] = { id, name };
  } else {
    list.push({ id, name });
  }
  setLocalItem(FRANCHISES_KEY, JSON.stringify(list));
  return true;
};

/** Removes a franchise by id. */
export const removeFranchise = (id) => {
  const list = getSavedFranchises().filter(f => String(f.id) !== String(id));
  setLocalItem(FRANCHISES_KEY, JSON.stringify(list));
};

/** Returns true if the franchise with the given id is saved. */
export const isFranchiseSaved = (id) =>
  getSavedFranchises().some(f => String(f.id) === String(id));

// ─────────────────────────────────────────────────────────────────────────────
// Collections (storing only game IDs, other details fetched from IGDB)
// ─────────────────────────────────────────────────────────────────────────────
const COLLECTIONS_KEY = 'moctale_collections';

/** Returns all saved collections: [{ id, name, description, games: [gameId, ...] }] */
export const getCollections = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter(c => c && typeof c === 'object' && c.id && c.name);
    if (clean.length !== parsed.length) setLocalItem(COLLECTIONS_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return [];
  }
};

/** Saves (or updates) a collection entry. */
export const saveCollection = (collection) => {
  const list = getCollections();
  if (!collection.id) {
    collection.id = `coll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  const idx = list.findIndex(c => String(c.id) === String(collection.id));
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...collection };
  } else {
    list.push({ games: [], description: '', ...collection });
  }
  setLocalItem(COLLECTIONS_KEY, JSON.stringify(list));
  return collection;
};

/** Removes a collection by id. */
export const deleteCollection = (id) => {
  const list = getCollections().filter(c => String(c.id) !== String(id));
  setLocalItem(COLLECTIONS_KEY, JSON.stringify(list));
};

/** Adds a game ID to a collection. */
export const addGameToCollection = (collectionId, gameId) => {
  const list = getCollections();
  const idx = list.findIndex(c => String(c.id) === String(collectionId));
  if (idx >= 0) {
    const collection = list[idx];
    if (!Array.isArray(collection.games)) collection.games = [];
    const gId = Number(gameId);
    if (!collection.games.includes(gId)) {
      collection.games.push(gId);
      setLocalItem(COLLECTIONS_KEY, JSON.stringify(list));
    }
  }
};

/** Removes a game ID from a collection. */
export const removeGameFromCollection = (collectionId, gameId) => {
  const list = getCollections();
  const idx = list.findIndex(c => String(c.id) === String(collectionId));
  if (idx >= 0) {
    const collection = list[idx];
    if (!Array.isArray(collection.games)) collection.games = [];
    const gId = Number(gameId);
    collection.games = collection.games.filter(id => Number(id) !== gId);
    setLocalItem(COLLECTIONS_KEY, JSON.stringify(list));
  }
};

/** Returns all collection IDs that contain the given game ID. */
export const getCollectionsWithGame = (gameId) => {
  const gId = Number(gameId);
  return getCollections()
    .filter(c => Array.isArray(c.games) && c.games.map(Number).includes(gId))
    .map(c => c.id);
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved IGDB Collections (read-only community collections bookmarked by user)
// ─────────────────────────────────────────────────────────────────────────────
const SAVED_IGDB_COLLECTIONS_KEY = 'moctale_saved_igdb_collections';

export const getSavedIgdbCollections = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_IGDB_COLLECTIONS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    // Sanitize — stray junk (e.g. a literal "[]" string) breaks the IGDB id query
    const clean = parsed.map(Number).filter(Number.isFinite);
    if (clean.length !== parsed.length) setLocalItem(SAVED_IGDB_COLLECTIONS_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return [];
  }
};

export const saveIgdbCollection = (id) => {
  const list = getSavedIgdbCollections();
  const numId = Number(id);
  if (!list.includes(numId)) {
    list.push(numId);
    setLocalItem(SAVED_IGDB_COLLECTIONS_KEY, JSON.stringify(list));
  }
};

export const removeIgdbCollection = (id) => {
  const numId = Number(id);
  const list = getSavedIgdbCollections().filter(x => Number(x) !== numId);
  setLocalItem(SAVED_IGDB_COLLECTIONS_KEY, JSON.stringify(list));
};

export const isIgdbCollectionSaved = (id) => {
  const numId = Number(id);
  return getSavedIgdbCollections().includes(numId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation feedback (Interested / Not Interested on non-library games)
// Stored as a list of {id, name, cover_id, verdict} so it merges by id across
// devices like the other list domains, and the manager page needs no IGDB fetch.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Taste preferences
// ─────────────────────────────────────────────────────────────────────────────
//
// The first scalar-preference domain in this file; everything else here is a
// list. Two dials, read by BOTH recommendation surfaces: Explore scores games
// you do not own, Pick Next scores games you do, and they should not disagree
// about what you like.
//
// They are weights, never filters. A filter can empty the result set — which is
// exactly how the Explore section used to go permanently blank for heavy users —
// whereas a weight can only reorder.

const PREFS_KEY = 'moctale_prefs';

/** tasteBias: -1 comfort (more like your favourites) … +1 novelty (unlike what
 *  you have beaten). releaseEra: which era to favour, or 'any' to ignore. */
export const DEFAULT_PREFS = { tasteBias: 0, releaseEra: 'any' };

const ERAS = new Set(['any', 'new', 'neutral', 'old']);

export const getPrefs = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const bias = Number(parsed?.tasteBias);
    return {
      // Clamped, not trusted: this is user-editable storage.
      tasteBias: Number.isFinite(bias) ? Math.max(-1, Math.min(1, bias)) : 0,
      releaseEra: ERAS.has(parsed?.releaseEra) ? parsed.releaseEra : 'any',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const setPrefs = (patch) => {
  const next = { ...getPrefs(), ...patch };
  setLocalItem(PREFS_KEY, JSON.stringify(next));
  /* Its own event, not moctale_lib_update: the library has not changed, and
     every game card in the app listens to that one. */
  window.dispatchEvent(new Event('moctale_prefs_update'));
  return getPrefs();
};

const REC_FEEDBACK_KEY = 'moctale_rec_feedback';

/* Same memo as getLibrary, for the same reason: every GameCard reads this on
   mount and on every library event, and it parses and filters the whole list
   each time. Keyed on the stored string, so any write invalidates it. */
let feedbackMemo = { raw: null, items: null };

export const getRecFeedbackList = () => {
  const raw = localStorage.getItem(REC_FEEDBACK_KEY) || '[]';
  if (raw === feedbackMemo.raw) return feedbackMemo.items.slice();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = parsed.filter(x => x && Number.isFinite(Number(x.id)) &&
      (x.verdict === 'interested' || x.verdict === 'not_interested'));
    feedbackMemo = { raw, items };
    return items.slice();
  } catch {
    return [];
  }
};

/* Lookups by id, built once per version of the underlying list.
 *
 * A GameCard needs one entry, and asked for it with getLibrary().find(...) --
 * so a grid of N cards did N scans of a list of M games, and did them again on
 * every library event. At 34 cards and 1000 games that is 34,000 comparisons
 * per toggle, on top of 34 reads of a 310 KB string.
 *
 * These share the memos above, so building an index costs one pass the first
 * time the underlying string changes and nothing at all on every call after. */
/* `raw` starts undefined, not null: localStorage.getItem returns null for a
   library that has never been written, so a null sentinel matches on the very
   first call and hands back the null index that has not been built yet. */
let libraryIndexMemo = { raw: undefined, index: null };
let feedbackIndexMemo = { raw: undefined, index: null };

/** Map of String(id) -> library entry. Do not mutate the entries. */
export const getLibraryIndex = () => {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (libraryIndexMemo.index && raw === libraryIndexMemo.raw) return libraryIndexMemo.index;
  const index = new Map(getLibrary().map(g => [String(g.id), g]));
  libraryIndexMemo = { raw, index };
  return index;
};

/** Map of String(id) -> 'interested' | 'not_interested'. */
export const getRecFeedbackIndex = () => {
  const raw = localStorage.getItem(REC_FEEDBACK_KEY) || '[]';
  if (feedbackIndexMemo.index && raw === feedbackIndexMemo.raw) return feedbackIndexMemo.index;
  const index = new Map(getRecFeedbackList().map(x => [String(x.id), x.verdict]));
  feedbackIndexMemo = { raw, index };
  return index;
};

/** verdict: 'interested' | 'not_interested' | null (clear). game may be an
 *  object {id, name, cover_id} or a bare id (for clearing). */
export const setRecFeedback = (game, verdict) => {
  const id = Number(typeof game === 'object' && game ? game.id : game);
  if (!Number.isFinite(id)) return getRecFeedbackList();
  const list = getRecFeedbackList().filter(x => Number(x.id) !== id);
  if (verdict === 'interested' || verdict === 'not_interested') {
    list.push({ id, name: game?.name || null, cover_id: game?.cover_id || null, verdict });
  }
  commitList(REC_FEEDBACK_KEY, list);
  window.dispatchEvent(new Event('moctale_lib_update'));
  return list;
};
