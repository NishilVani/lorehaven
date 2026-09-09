/* The exact scenario that lost data, replayed against the real module with a
   fake cloud: two devices, each with its own localStorage, each receiving the
   other's WHOLE document through applyDomainDoc. The old code: whichever
   document is newer replaces the other wholesale. The new code: both games
   survive on both devices, and the loser asks for a write-back. */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const src = fs.readFileSync('src/services/db.js', 'utf8');
/* applyDomainDoc is module-private on purpose; lift it for this check by
   appending an export to a temp copy that imports the same neighbours. */
const tmp = path.resolve('tests/_db.tmp.mjs');
fs.writeFileSync(tmp, src
  .replace(/from '\.\/([^']+)'/g, (m, f) => `from '../src/services/${f}'`)
  + '\nexport const __apply = applyDomainDoc; export const __pending = pendingWrites; export const __signIn = (u) => { currentUser = u; }; export const __setOutdated = (v) => { syncState = { ...syncState, outdated: v }; };\n');

const makeDevice = () => {
  const store = new Map();
  return { store, ls: {
    getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k), get length() { return store.size; }, key: i => [...store.keys()][i] } };
};
globalThis.window = globalThis; globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.dispatchEvent = () => true; globalThis.addEventListener = () => {};
globalThis.Event = class { constructor(t) { this.type = t; } };
const A = makeDevice(); globalThis.localStorage = A.ls;
const db = await import(pathToFileURL(tmp).href);
db.__signIn({ uid: 'test' });
const doc = (games, at) => ({ games, updatedAt: { toMillis: () => at } });

/* Device A adds Astro Bot; device B (separate storage) adds Silent Hill f. Each
   then receives the OTHER's whole document, stamped newer than its own. */
db.saveToLibrary({ id: 303811, name: 'Astro Bot', status: 'Wishlist', priority: 'Next Up' });
const aDoc = JSON.parse(A.store.get('moctale_library'));
const B = makeDevice(); globalThis.localStorage = B.ls;
db.saveToLibrary({ id: 222343, name: 'Silent Hill f', status: 'Wishlist', priority: 'Soon' });
const bDoc = JSON.parse(B.store.get('moctale_library'));

db.__pending.clear();
db.__apply('library', doc(aDoc, Date.now() + 60_000));          // B receives A's newer document
const bAfter = JSON.parse(B.store.get('moctale_library'));
assert.deepStrictEqual(bAfter.map(g => g.name).sort(), ['Astro Bot', 'Silent Hill f'], 'B keeps its own game AND gets A\'s');
assert.ok(db.__pending.has('moctale_library'), 'B queues a write-back because the cloud lacks Silent Hill f');

globalThis.localStorage = A.ls; db.__pending.clear();
db.__apply('library', doc(bDoc, Date.now() - 60_000));          // A receives B's OLDER document
const aAfter = JSON.parse(A.store.get('moctale_library'));
assert.deepStrictEqual(aAfter.map(g => g.name).sort(), ['Astro Bot', 'Silent Hill f'], 'A keeps its own game AND gets B\'s');

/* Deletion still travels: A removes Astro Bot; B receives A's document and tombstones. */
db.removeFromLibrary(303811);
const aTombs = JSON.parse(A.store.get('moctale_library_deleted'));
globalThis.localStorage = B.ls; db.__pending.clear();
db.__apply('libraryDeleted', { ids: aTombs, updatedAt: { toMillis: () => Date.now() } });
db.__apply('library', doc(JSON.parse(A.store.get('moctale_library')), Date.now() + 1000));
assert.deepStrictEqual(JSON.parse(B.store.get('moctale_library')).map(g => g.name), ['Silent Hill f'], 'a deletion on A is applied on B');

/* Same game edited on both sides: the newer edit wins whichever document is newer. */
globalThis.localStorage = B.ls;
db.saveToLibrary({ id: 222343, priority: 'Maybe' });                              // B: newer edit
const bNow = JSON.parse(B.store.get('moctale_library'));
const stale = bDoc.map(g => ({ ...g, priority: 'Someday', _u: g._u - 5000 }));      // an older edit in a NEWER doc
db.__apply('library', doc(stale, Date.now() + 60_000));
assert.strictEqual(JSON.parse(B.store.get('moctale_library'))[0].priority, 'Maybe', 'the newer per-item edit survives an older whole document');
/* Tombstones themselves merge per id: B has its own deletion; receiving A's
   newer tombstone document must not throw B's away. */
globalThis.localStorage = B.ls;
db.saveToLibrary({ id: 7, name: 'Seven', status: 'Backlog' }); db.removeFromLibrary(7);
db.__apply('libraryDeleted', { ids: { 303811: Date.now() }, updatedAt: { toMillis: () => Date.now() + 60_000 } });
const bTombs = JSON.parse(B.store.get('moctale_library_deleted'));
assert.ok(bTombs['7'] && bTombs['303811'], 'a newer tombstone document merges with local tombstones instead of replacing them');

/* Recommendation feedback, same scenario: A marks X Not Interested, B marks Y
   Interested, each receives the other's whole document. Then A clears X. */
const fbOf = (dev) => JSON.parse(dev.store.get('moctale_rec_feedback') || '[]');
globalThis.localStorage = A.ls; db.__pending.clear();
db.setRecFeedback({ id: 100, name: 'X' }, 'not_interested');
globalThis.localStorage = B.ls;
db.setRecFeedback({ id: 200, name: 'Y' }, 'interested');
db.__apply('recFeedback', { items: fbOf(A), updatedAt: { toMillis: () => Date.now() + 60_000 } });
assert.deepStrictEqual(fbOf(B).map(x => x.id).sort(), [100, 200], 'B keeps its verdict AND gets the verdict from A in a newer document');
globalThis.localStorage = A.ls;
db.__apply('recFeedback', { items: fbOf(B), updatedAt: { toMillis: () => Date.now() - 60_000 } });
assert.deepStrictEqual(fbOf(A).map(x => x.id).sort(), [100, 200], 'A keeps its verdict AND gets the verdict from B in an older document');
db.setRecFeedback(100, null);                                     // A clears X
const fbTombs = JSON.parse(A.store.get('moctale_rec_feedback_deleted') || '{}');
assert.ok(Number(fbTombs['100']) > 0, 'a cleared verdict leaves a tombstone');
globalThis.localStorage = B.ls;
db.__apply('recFeedbackDeleted', { ids: fbTombs, updatedAt: { toMillis: () => Date.now() } });
db.__apply('recFeedback', { items: fbOf(A), updatedAt: { toMillis: () => Date.now() + 1000 } });
assert.deepStrictEqual(fbOf(B).map(x => x.id), [200], 'a clear on A is applied on B');
db.setRecFeedback({ id: 200, name: 'Y' }, 'not_interested');       // B flips its verdict: an edit, not a clear
db.__apply('recFeedback', { items: [{ id: 200, name: 'Y', verdict: 'interested', _u: Date.now() - 5000 }], updatedAt: { toMillis: () => Date.now() + 60_000 } });
assert.strictEqual(fbOf(B)[0].verdict, 'not_interested', 'the newer verdict survives an older whole document');

/* outdated is the whole point of Task 4: a client the rules will refuse must
   stop queueing cloud writes, or every one comes back permission-denied and
   floods the console with the one message that matters. Assert the control
   case first (queuing works at all) so the outdated case can't pass by
   accident if syncToCloud were broken outright, then assert the guard, then
   confirm localStorage still has the edit -- only the cloud write is gone. */
db.__setOutdated(false);
db.__pending.clear();
db.saveToLibrary({ id: 555, name: 'Control Case', status: 'Wishlist' });
assert.ok(db.__pending.size > 0, 'a current client queues a cloud write for a library save');

db.__setOutdated(true);
db.__pending.clear();
db.saveToLibrary({ id: 556, name: 'Gated Case', status: 'Wishlist' });
assert.strictEqual(db.__pending.size, 0, 'an outdated client must queue nothing, or a gated build floods the console with permission-denied errors');
const gatedLibrary = JSON.parse(B.store.get('moctale_library'));
assert.ok(gatedLibrary.some(g => g.name === 'Gated Case'), 'localStorage still has the edit -- outdated only suppresses the cloud write, nothing is lost');

fs.unlinkSync(tmp);
console.log('two sessions: all assertions passed');
process.exit(0);
