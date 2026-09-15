/* Moving a game's collection memberships to another entry, and putting them
   back. Shared by Transfer Data and Find Duplicates' merge, so both keep a
   game's collections the same way. Runs the real db.js against a storage shim,
   like tests/db-write-path.test.mjs. */
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

const { moveCollections, restoreCollections } = await import('../src/services/libraryTransfer.js');
const games = (id) => JSON.parse(store.get('moctale_collections')).find(c => c.id === id).games;

store.set('moctale_collections', JSON.stringify([
  { id: 'rpg', name: 'RPGs', games: [22439, 5] },
  { id: 'fav', name: 'Favourites', games: [22439, 1942] },
  { id: 'none', name: 'Other', games: [7] },
]));

const moved = moveCollections(22439, 1942);
assert.deepStrictEqual(games('rpg'), [5, 1942], 'the kept game takes the removed one\'s place');
assert.deepStrictEqual(games('fav'), [1942], 'a collection already holding the kept game does not list it twice');
assert.deepStrictEqual(games('none'), [7], 'unrelated collections are untouched');

restoreCollections(moved);
assert.deepStrictEqual(games('rpg').slice().sort(), [22439, 5].sort(), 'undo puts the removed game back and takes out what it added');
assert.deepStrictEqual(games('fav').slice().sort(), [1942, 22439].sort(), 'but leaves the kept game where it already was');

console.log('library transfer: all assertions passed');
/* db.js stands up Firebase at import, and its handles keep node alive. */
process.exit(0);
