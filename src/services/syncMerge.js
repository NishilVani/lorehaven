// Pure merge rules for a synced list domain -- the library above all.
//
// Its own module, with no imports, because db.js stands up a Firestore client
// at import time and nothing in it can be unit-tested. tests/sync-merge.test.mjs
// is the contract.
//
// Why this exists. Every cloud write sends the WHOLE domain document, and the
// old rule on receipt was "whichever whole document is newer wins". Two
// signed-in sessions -- a browser tab and the desktop app -- each held a full
// copy, and whichever wrote last erased everything the other had added since
// it last synced. On 2026-09-08 that cost seven wishlisted games and a session
// of priority edits, and the comment above the old code claimed the opposite:
// "items only one side has always survive". They did not.
//
// The rule now is per item, not per document:
//   - an item only one side has is kept, unless the other side deleted it
//     (tombstone) after it was last written;
//   - an item both sides have goes to the newer per-item stamp (`_u`, ms);
//     with no stamps on either side -- entries from before this shipped -- the
//     newer document decides, which is the one case the old rule was right for.
// `cloudIsBehind` tells the caller the cloud lacks something local has, so it
// can write the merged list back. That write is the merged superset, so two
// devices writing back at once converge instead of ping-ponging.

/** Per-item last-write stamp, unix ms. Absent on entries written before this
 *  shipped; they are treated as 0, so any stamped edit beats them. */
export const ITEM_STAMP = '_u';

const keyOf = (x) => (x && typeof x === 'object') ? `id:${String(x.id)}` : `v:${String(x)}`;
const stampOf = (x) => (x && typeof x === 'object' && Number(x[ITEM_STAMP])) || 0;

/** Union two lists -- id-keyed for objects, value-keyed for primitives.
 *  First arg dictates order and wins conflicts; second arg's extras append. */
const union = (preferred, other, pick = (a) => a) => {
    const map = new Map();
    preferred.forEach(x => map.set(keyOf(x), x));
    other.forEach(x => {
        const k = keyOf(x);
        map.set(k, map.has(k) ? pick(map.get(k), x) : x);
    });
    return [...map.values()];
};

/**
 * @param {object} args
 * @param {any[]} args.local        what this device holds
 * @param {any[]} args.cloud        what the cloud document holds
 * @param {number} args.localAt     this device's last local write, ms
 * @param {number} args.cloudAt     the cloud document's updatedAt, ms
 * @param {Record<string, number>} [args.tombstones]  id -> deletedAt ms,
 *        already merged from both sides.
 * @returns {{ merged: any[], cloudIsBehind: boolean }}
 */
export const mergeLists = ({ local, cloud, localAt, cloudAt, tombstones = {} }) => {
    /* Both stamped: newer stamp. Neither stamped: newer document. One stamped:
       the stamped one -- it was written by code that knows about stamps, so it
       is the more recent edit by construction. */
    const pick = (mine, theirs) => {
        const a = stampOf(mine), b = stampOf(theirs);
        if (a || b) return b > a ? theirs : mine;
        return cloudAt > localAt ? theirs : mine;
    };
    const dead = (x) => {
        const at = Number(tombstones[String(x?.id)]) || 0;
        return at > 0 && at > stampOf(x);
    };

    const merged = union(local, cloud, pick).filter(x => !dead(x));

    /* The cloud is behind when the merge holds something the cloud does not:
       an item it lacks, or a version newer than its own. */
    const cloudByKey = new Map(cloud.map(x => [keyOf(x), x]));
    const cloudIsBehind = merged.some(x => {
        const c = cloudByKey.get(keyOf(x));
        return !c || (x !== c && stampOf(x) > stampOf(c));
    }) || cloud.some(x => dead(x));

    return { merged, cloudIsBehind };
};

/** Stamp the entries of `next` that are new or differ from `prev`, leaving the
 *  untouched ones with the stamp they had. Called at write time with the list
 *  as it was and the list as it will be. PURE. */
export const stampItems = (prev, next, now = Date.now()) => {
    const before = new Map(prev.map(x => [keyOf(x), x]));
    return next.map(x => {
        if (!x || typeof x !== 'object') return x;
        const was = before.get(keyOf(x));
        /* Unchanged content keeps the stamp it HAD: an incoming copy of the
           same entry may carry a stale stamp from another device, and a
           re-save must never move a game's clock backwards. */
        if (was && sameEntry(was, x)) return was[ITEM_STAMP] ? { ...x, [ITEM_STAMP]: was[ITEM_STAMP] } : x;
        return { ...x, [ITEM_STAMP]: now };
    });
};

/* Key-order-insensitive equality on the fields that matter -- the stamp itself
   is excluded, or a re-save of an unchanged entry would look like an edit. */
const sameEntry = (a, b) => canon(a) === canon(b);
const canon = (x) => JSON.stringify(x, (k, v) =>
    k === ITEM_STAMP ? undefined
        : (v && typeof v === 'object' && !Array.isArray(v))
            ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {})
            : v);

/** Per id, the latest deletion. PURE. */
export const mergeTombstones = (a = {}, b = {}) => {
    const out = { ...a };
    for (const [id, at] of Object.entries(b)) {
        if (!(id in out) || Number(at) > Number(out[id])) out[id] = at;
    }
    return out;
};

/** Ids that `next` no longer has, as tombstones dated `now`. PURE. */
export const tombstonesFor = (prev, next, now = Date.now()) => {
    const keep = new Set(next.map(x => String(x?.id)));
    const out = {};
    for (const x of prev) {
        const id = String(x?.id);
        if (!keep.has(id)) out[id] = now;
    }
    return out;
};

/** Drop tombstones older than `maxAgeMs`; a deletion nobody has failed to see
 *  for three months does not need remembering. PURE. */
export const pruneTombstones = (tombs, now = Date.now(), maxAgeMs = 90 * 24 * 3600 * 1000) =>
    Object.fromEntries(Object.entries(tombs).filter(([, at]) => now - Number(at) < maxAgeMs));
