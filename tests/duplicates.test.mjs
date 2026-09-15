/* Find Duplicates: what counts as a duplicate, which entry is kept by default,
   and exactly what a merge writes and what its undo puts back. Pure module. */
import assert from 'node:assert';
import {
  normalizeName, findDuplicateGroups, defaultKeep, mergeConflicts, planMerge,
  mergeUndo, dismissPatch, restorePatch, versionLabel,
} from '../src/services/duplicates.js';

/* ── Names ── */
assert.strictEqual(
  normalizeName('The Witcher 3: Wild Hunt'),
  normalizeName('The Witcher 3: The Wild Hunt - Game of the Year Edition'),
  'the owner\'s own example: edition words, articles and punctuation do not make a different game',
);
assert.strictEqual(normalizeName('Witcher III'), normalizeName('Witcher 3'), 'roman numerals');
assert.strictEqual(normalizeName('Pokémon Red'), 'pokemon red', 'diacritics');
assert.strictEqual(normalizeName('Ratchet & Clank'), normalizeName('Ratchet and Clank'));
assert.notStrictEqual(normalizeName('Dark Souls Remastered'), normalizeName('Dark Souls'),
  'a remaster is a related version, never a name match');

/* ── Detection ── */
const PC = { id: 6, name: 'PC' };
const PS4 = { id: 48, name: 'PlayStation 4' };
const library = [
  { id: 1942, name: 'The Witcher 3: Wild Hunt', status: 'Beaten', feel: 'Perfection', notes: 'Best RPG', user_platforms: [PC], addedAt: 1000 },
  { id: 22439, name: 'The Witcher 3: Wild Hunt - Game of the Year Edition', status: 'Backlog', priority: 'Soon', notes: 'Bought on sale', user_platforms: [PS4], addedAt: 500 },
  { id: 1943, name: 'The Witcher 3: Wild Hunt - Hearts of Stone', status: 'Backlog' },
  { id: 'custom_1', name: 'Hollow Knight', is_custom: true, status: 'Backlog' },
  { id: 26758, name: 'Hollow Knight', status: 'Wishlist' },
  { id: 100, name: 'Resident Evil 2', status: 'Beaten' },
  { id: 101, name: 'Resident Evil 2', status: 'Backlog' },
  { id: 200, name: 'Doom', status: 'Backlog' },
  { id: 201, name: 'DOOM', status: 'Wishlist' },
  { id: 400, name: 'Portal', status: 'Beaten' },
  { id: 401, name: 'The Orange Box', status: 'Backlog' },
  { id: 402, name: 'Half-Life 2', status: 'Beaten' },
  { id: 500, name: 'Tetris', status: 'Backlog', notDuplicateOf: ['501'] },
  { id: 501, name: 'Tetris', status: 'Backlog' },
];
const relations = new Map(Object.entries({
  1942: { id: 1942, game_type: 0, first_release_date: 1431993600 },
  22439: { id: 22439, game_type: 0, version_parent: 1942, first_release_date: 1472601600 },
  1943: { id: 1943, game_type: 1, parent_game: 1942 },
  26758: { id: 26758, game_type: 0 },
  100: { id: 100, game_type: 0, remakes: [101], first_release_date: 885600000 },
  101: { id: 101, game_type: 8, first_release_date: 1548374400 },
  400: { id: 400, game_type: 0, bundles: [401] },
  401: { id: 401, game_type: 3 },
  402: { id: 402, game_type: 0, bundles: [401] },
}));

const sets = (groups) => groups.map(g => g.members.map(m => String(m.id)).sort().join(',')).sort();
const reasonOf = (groups, key) => groups.find(g => g.members.map(m => String(m.id)).sort().join(',') === key)?.reason;

const found = findDuplicateGroups(library, relations);
assert.deepStrictEqual(sets(found.same), ['1942,22439', '200,201', '26758,custom_1', '400,401', '401,402']);
assert.strictEqual(reasonOf(found.same, '1942,22439'), 'edition');
assert.strictEqual(reasonOf(found.same, '26758,custom_1'), 'custom');
assert.strictEqual(reasonOf(found.same, '200,201'), 'name');
assert.strictEqual(reasonOf(found.same, '400,401'), 'bundle',
  'a bundle pairs with each game it contains separately, so keeping one part never removes another');
assert.deepStrictEqual(sets(found.related), ['100,101'],
  'Resident Evil 2 and its remake share a name, but IGDB says remake, so it is related, not the same game');
assert.strictEqual(reasonOf(found.related, '100,101'), 'remake');
assert.ok(!sets(found.same).some(s => s.includes('1943')), 'DLC is never a duplicate of its base game');
assert.deepStrictEqual(sets(found.dismissed), ['500,501'], 'a dismissed pair stays out, and can be shown again');

assert.deepStrictEqual(
  findDuplicateGroups([{ id: 1, name: 'Minecraft' }, { id: 2, name: 'Minecraft' }], new Map([['2', { id: 2, game_type: 13 }]])).same, [],
  'a pack or DLC sharing its game\'s name exactly is still not a duplicate',
);

/* Without relations (IGDB unavailable) only name and custom matches remain. */
{
  const partial = findDuplicateGroups(library, new Map());
  assert.deepStrictEqual(sets(partial.same), ['100,101', '1942,22439', '200,201', '26758,custom_1']);
  assert.strictEqual(reasonOf(partial.same, '1942,22439'), 'name');
  assert.deepStrictEqual(partial.related, []);
}

/* ── What each column calls itself ── */
assert.strictEqual(versionLabel(library[1], relations.get('22439')), 'Edition');
assert.strictEqual(versionLabel(library[3], undefined), 'Custom entry');
assert.strictEqual(versionLabel(library[10], relations.get('401')), 'Bundle');
assert.strictEqual(versionLabel(library[6], relations.get('101')), 'Remake');
assert.strictEqual(versionLabel(library[0], relations.get('1942')), null, 'a main game needs no label');

/* ── Default keep ── */
const witcher = found.same.find(g => g.reason === 'edition').members;
assert.strictEqual(String(defaultKeep(witcher, relations)), '1942',
  'equal recorded data, so the original wins: the edition names 1942 as its version parent');
assert.strictEqual(String(defaultKeep([{ id: 'x', status: 'Backlog', notes: 'n', feel: 'Skip' }, { id: 'y', status: 'Backlog' }], new Map())), 'x',
  'more recorded data wins');
assert.strictEqual(String(defaultKeep(found.same.find(g => g.reason === 'custom').members, relations)), '26758',
  'on a tie an IGDB entry beats a custom one');
assert.strictEqual(String(defaultKeep(found.related[0].members, relations)), '100', 'on a tie the earlier release wins');

/* ── Merge ── */
assert.deepStrictEqual(
  mergeConflicts(witcher, '1942').map(c => [c.field, c.options.map(o => [String(o.id), o.value]), String(c.chosen)]),
  [['status', [['1942', 'Beaten'], ['22439', 'Backlog']], '1942']],
  'only status disagrees; a value only one side has is not a conflict, and notes are joined, not chosen',
);
assert.deepStrictEqual(
  mergeConflicts([{ id: 1, status: 'Completed' }, { id: 2, status: 'Beaten' }], 1), [],
  'legacy status names are the same status',
);

{
  const { patch, removeIds } = planMerge(witcher, '1942');
  assert.deepStrictEqual(patch, {
    id: 1942,
    status: 'Beaten',
    feel: 'Perfection',
    priority: 'Soon',
    notes: 'Best RPG\n\nBought on sale',
    user_platforms: [PC, PS4],
    addedAt: 500,
  });
  assert.deepStrictEqual(removeIds.map(String), ['22439']);
}
assert.strictEqual(planMerge(witcher, '1942', { status: 22439 }).patch.status, 'Backlog', 'a chosen value wins');
assert.deepStrictEqual(
  planMerge([{ id: 1, user_platforms: [PC], notes: 'Same' }, { id: 2, user_platforms: [{ id: 6, name: 'PC' }], notes: 'Same' }], 1).patch,
  { id: 1, user_platforms: [PC], notes: 'Same' },
  'platforms union by id, identical notes are not repeated',
);

{
  const { patch } = planMerge(witcher, '1942');
  const undo = mergeUndo(witcher, '1942', patch);
  assert.deepStrictEqual(undo.keepRestore, {
    id: 1942, status: 'Beaten', feel: 'Perfection', priority: null,
    notes: 'Best RPG', user_platforms: [PC], addedAt: 1000,
  }, 'undo names every merged key, with null for one the kept game never had');
  assert.deepStrictEqual(undo.reAdd.map(g => g.id), [22439]);
  assert.strictEqual(undo.reAdd[0].notes, 'Bought on sale', 'the removed game comes back whole');
}

/* ── Not duplicates ── */
const tetris = library.filter(g => g.name === 'Tetris');
assert.deepStrictEqual(dismissPatch(tetris), [
  { id: 500, notDuplicateOf: ['501'] },
  { id: 501, notDuplicateOf: ['500'] },
], 'written on both, so either device hides the pair');
assert.deepStrictEqual(restorePatch(tetris), [
  { id: 500, notDuplicateOf: [] },
  { id: 501, notDuplicateOf: [] },
]);

console.log('duplicates: all assertions passed');
