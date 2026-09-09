/* Exercises the real db.js write path in node: every library write must stamp
   the entries it changed and tombstone the ones it dropped. Firebase is
   imported for real; with no user signed in it never touches the network. */
import assert from 'node:assert';
const store = new Map();
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  get length() { return store.size; }, key: i => [...store.keys()][i],
};
globalThis.dispatchEvent = () => true; globalThis.addEventListener = () => {};
globalThis.Event = class { constructor(t) { this.type = t; } };
const db = await import('../src/services/db.js');
const lib = () => JSON.parse(store.get('moctale_library') || '[]');
const tombs = () => JSON.parse(store.get('moctale_library_deleted') || '{}');

db.saveToLibrary({ id: 1, name: 'One', status: 'Wishlist' });
db.saveToLibrary({ id: 2, name: 'Two', status: 'Backlog' });
const t1 = lib();
assert.ok(t1.every(g => Number(g._u) > 0), 'new entries are stamped');
const stampOne = t1[0]._u;

await new Promise(r => setTimeout(r, 5));
db.saveToLibrary({ id: 2, priority: 'Soon' });
const t2 = lib();
assert.strictEqual(t2[0]._u, stampOne, 'untouched entry keeps its stamp');
assert.ok(t2[1]._u > t1[1]._u, 'edited entry is restamped');
assert.strictEqual(t2[1].priority, 'Soon');

db.removeFromLibrary(1);
assert.deepStrictEqual(lib().map(g => g.id), [2], 'removed');
assert.ok(Number(tombs()['1']) > 0, 'removal leaves a tombstone');

db.saveLibrary([]);                       // ManagePlatforms-style bulk write that drops a game
assert.ok(Number(tombs()['2']) > 0, 'a bulk write that drops a game tombstones it');

db.saveToLibrary({ id: 1, name: 'One again', status: 'Wishlist' });
assert.ok(lib()[0]._u > tombs()['1'], 're-added game is stamped after its tombstone, so the merge keeps it');

/* getLibrary's heal path must not restamp: a legacy priority name is migrated on read. */
store.set('moctale_library', JSON.stringify([{ id: 9, name: 'Legacy', priority: 'Must Play', _u: 42 }]));
assert.strictEqual(db.getLibrary()[0].priority, 'Next Up', 'migrated on read');
assert.strictEqual(lib()[0]._u, 42, 'heal keeps the stamp it had');

console.log('db write path: all assertions passed');
process.exit(0);
