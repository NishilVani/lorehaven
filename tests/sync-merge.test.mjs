// The cross-device merge for list domains (the library above all).
// Run: node tests/sync-merge.test.mjs
//
// Written against a real loss: on 2026-09-08 two signed-in sessions each held a
// full copy of the library, every cloud write was the whole document, and the
// receiving side kept whichever whole document was newer. Seven wishlisted
// games and a session of priority edits were discarded that way.
import assert from 'node:assert';
import { mergeLists, stampItems, mergeTombstones } from '../src/services/syncMerge.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const g = (id, extra = {}) => ({ id, name: `Game ${id}`, status: 'Wishlist', ...extra });
const ids = (list) => list.map(x => String(x.id));

test('a game only this device has survives a newer cloud document', () => {
    const { merged } = mergeLists({ local: [g(1), g(2), g(3)], cloud: [g(1), g(2)], localAt: 1000, cloudAt: 2000 });
    assert.deepStrictEqual(ids(merged).sort(), ['1', '2', '3']);
});

test('a game only the cloud has survives a newer local write', () => {
    const { merged } = mergeLists({ local: [g(1), g(2)], cloud: [g(1), g(2), g(3)], localAt: 2000, cloudAt: 1000 });
    assert.deepStrictEqual(ids(merged).sort(), ['1', '2', '3']);
});

test('the same game edited on both sides: the newer per-item stamp wins, whichever document is newer', () => {
    const local = [g(1, { priority: 'Soon', _u: 5000 })];
    const cloud = [g(1, { priority: 'Next Up', _u: 4000 })];
    assert.strictEqual(mergeLists({ local, cloud, localAt: 1000, cloudAt: 9000 }).merged[0].priority, 'Soon', 'local item newer, cloud doc newer');
    assert.strictEqual(mergeLists({ local: cloud, cloud: local, localAt: 9000, cloudAt: 1000 }).merged[0].priority, 'Soon', 'cloud item newer, local doc newer');
});

test('unstamped entries on both sides fall back to the newer document', () => {
    const local = [g(1, { priority: 'Soon' })];
    const cloud = [g(1, { priority: 'Next Up' })];
    assert.strictEqual(mergeLists({ local, cloud, localAt: 1000, cloudAt: 2000 }).merged[0].priority, 'Next Up');
    assert.strictEqual(mergeLists({ local, cloud, localAt: 2000, cloudAt: 1000 }).merged[0].priority, 'Soon');
});

test('a game deleted on another device stays deleted here', () => {
    const { merged } = mergeLists({ local: [g(1), g(2, { _u: 1000 })], cloud: [g(1)], localAt: 1000, cloudAt: 2000, tombstones: { 2: 1500 } });
    assert.deepStrictEqual(ids(merged), ['1']);
});

test('a game re-added after its deletion is not deleted again', () => {
    const { merged } = mergeLists({ local: [g(1), g(2, { _u: 3000 })], cloud: [g(1)], localAt: 3000, cloudAt: 2000, tombstones: { 2: 1500 } });
    assert.deepStrictEqual(ids(merged).sort(), ['1', '2']);
});

test('reports when the cloud is missing something so the caller can write it back', () => {
    assert.strictEqual(mergeLists({ local: [g(1), g(2)], cloud: [g(1)], localAt: 1000, cloudAt: 2000 }).cloudIsBehind, true);
    assert.strictEqual(mergeLists({ local: [g(1)], cloud: [g(1), g(2)], localAt: 1000, cloudAt: 2000 }).cloudIsBehind, false);
    assert.strictEqual(mergeLists({ local: [g(1, { _u: 2 })], cloud: [g(1, { _u: 1 })], localAt: 1000, cloudAt: 2000 }).cloudIsBehind, true, 'a newer local edit of a shared game');
});

test('local order is kept and cloud extras append, so the library does not reshuffle on every sync', () => {
    const { merged } = mergeLists({ local: [g(3), g(1)], cloud: [g(1), g(2), g(3)], localAt: 1000, cloudAt: 2000 });
    assert.deepStrictEqual(ids(merged), ['3', '1', '2']);
});

test('primitive lists union', () => {
    const { merged } = mergeLists({ local: [1, 2], cloud: [2, 3], localAt: 1000, cloudAt: 2000 });
    assert.deepStrictEqual(merged, [1, 2, 3]);
});

test('the replace policy (recommendation feedback) still takes the newer document whole', () => {
    const { merged } = mergeLists({ local: [g(1), g(2)], cloud: [g(1)], localAt: 1000, cloudAt: 2000, policy: 'replace' });
    assert.deepStrictEqual(ids(merged), ['1']);
});

test('stampItems marks new and changed entries with the write time and leaves the rest alone', () => {
    const prev = [g(1, { _u: 100 }), g(2, { _u: 100 })];
    const next = [g(1, { _u: 100 }), g(2, { _u: 100, priority: 'Soon' }), g(3)];
    const out = stampItems(prev, next, 500);
    assert.strictEqual(out[0]._u, 100, 'untouched entry keeps its stamp');
    assert.strictEqual(out[1]._u, 500, 'changed entry is restamped');
    assert.strictEqual(out[2]._u, 500, 'new entry is stamped');
});

test('mergeTombstones keeps the latest deletion per id', () => {
    assert.deepStrictEqual(mergeTombstones({ 1: 100, 2: 300 }, { 2: 200, 3: 50 }), { 1: 100, 2: 300, 3: 50 });
});

let failed = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
