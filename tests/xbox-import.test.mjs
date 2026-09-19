/* Turning an Xbox played list into review rows, and ticked rows into writes.
 *
 * Pure: no network, no browser, no IGDB. Run: node tests/xbox-import.test.mjs
 */
import assert from 'node:assert';
import {
  XBOX_STORE, XBOX_PLATFORM, consolePlatform,
  buildXboxRows, rowReady, planXboxImport, linkRowToIgdb, unlinkRowFromIgdb,
} from '../src/services/xboxImport.js';

const title = (over = {}) => ({
  titleId: '1',
  name: 'Clair Obscur: Expedition 33',
  productIds: ['9PBLMX0KDKQS'],
  platform: 'Xbox Series X|S',
  lastPlayed: '2026-08-02T19:04:00Z',
  ...over,
});

const igdb = (id, name) => ({ id, name, cover: { image_id: `cover${id}` }, game_type: 0 });

/* ── The store row ── */
{
  assert.strictEqual(XBOX_STORE.name, 'Microsoft Store', 'the name must match DEFAULT_CUSTOM_PLATFORMS exactly, or an import marks a store nothing else knows');
  assert.strictEqual(XBOX_PLATFORM.id, 'custom_store_microsoft_store');
  assert.strictEqual(consolePlatform('Xbox Series X|S').id, 169);
  assert.strictEqual(consolePlatform('PC').id, 6);
  assert.strictEqual(consolePlatform('Dreamcast'), null, 'a device this does not know gets no console rather than a guessed one');
}

/* ── Rows ── */
{
  const { rows } = buildXboxRows({
    titles: [title()],
    matches: new Map([['9PBLMX0KDKQS', igdb(1, 'Clair Obscur: Expedition 33')]]),
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].igdb.id, 1);
  assert.strictEqual(rows[0].selected, true, 'a Store id match is IGDB\'s own record, so it arrives ticked');
  assert.strictEqual(rows[0].byName, false);
  assert.strictEqual(rows[0].status, null, 'and with no status: the owner picks one per game');
}

{
  const { rows } = buildXboxRows({
    titles: [title({ productIds: [] })],
    suggestions: new Map([['1', igdb(7, 'Clair Obscur: Expedition 33')]]),
  });
  assert.strictEqual(rows[0].igdb.id, 7);
  assert.strictEqual(rows[0].byName, true, 'a name match says so');
  assert.strictEqual(rows[0].selected, false, 'and is never ticked by the app, however confident it looks');
}

{
  const { rows } = buildXboxRows({ titles: [title({ productIds: ['UNKNOWN'] })], matches: new Map() });
  assert.strictEqual(rows[0].igdb, null, 'a title IGDB has no record of keeps its own row');
  assert.strictEqual(rows[0].selected, false);
  assert.strictEqual(rows[0].xboxName, 'Clair Obscur: Expedition 33', 'under the name Xbox gave it');
}

{
  /* Two product ids under one IGDB game: one row, both ids. */
  const match = igdb(3, 'RESIDENT EVIL 3');
  const { rows } = buildXboxRows({
    titles: [
      title({ titleId: '10', name: 'RESIDENT EVIL 3', productIds: ['ID-A'], platform: 'Xbox One', lastPlayed: '2024-01-01T00:00:00Z' }),
      title({ titleId: '11', name: 'RESIDENT EVIL 3 (Series X|S)', productIds: ['ID-B'], platform: 'Xbox Series X|S', lastPlayed: '2026-03-03T00:00:00Z' }),
    ],
    matches: new Map([['ID-A', match], ['ID-B', match]]),
  });
  assert.strictEqual(rows.length, 1, 'one game, one row');
  assert.deepStrictEqual(rows[0].productIds, ['ID-A', 'ID-B']);
  assert.strictEqual(rows[0].lastPlayed, '2026-03-03T00:00:00Z', 'and the later of the two times it was played');
}

{
  const library = [{ id: '1', name: 'Clair Obscur: Expedition 33', user_platforms: [], status: 'Backlog' }];
  const { rows } = buildXboxRows({
    titles: [title()],
    matches: new Map([['9PBLMX0KDKQS', igdb(1, 'Clair Obscur: Expedition 33')]]),
    library,
  });
  assert.ok(rows[0].existing, 'a game already in the library is recognised');
  assert.strictEqual(rows[0].selected, true);
}

/* ── What gets written ── */
{
  const rows = [{
    key: 'igdb:1', titleId: '1', productIds: ['P'], xboxName: 'Clair Obscur',
    platform: 'Xbox Series X|S', igdb: igdb(1, 'Clair Obscur'), existing: null,
    status: 'Beaten', selected: true,
  }];
  const { entries, skipped } = planXboxImport(rows);
  assert.strictEqual(skipped, 0);
  assert.strictEqual(entries[0].id, 1);
  assert.strictEqual(entries[0].status, 'Beaten');
  assert.deepStrictEqual(entries[0].user_platforms.map(p => p.id), ['custom_store_microsoft_store', 169],
    'the store it came from and the console it was played on, both marked');
}

{
  /* A game already in the library gains the marks and nothing else. */
  const existing = { id: 1, name: 'Clair Obscur', user_platforms: [{ id: 6, name: 'PC (Windows)' }], status: 'Playing', rating: 9 };
  const { entries } = planXboxImport([{
    key: 'igdb:1', titleId: '1', productIds: ['P'], platform: 'Xbox One',
    igdb: igdb(1, 'Clair Obscur'), existing, status: null, selected: true,
  }]);
  assert.deepStrictEqual(Object.keys(entries[0]).sort(), ['id', 'user_platforms'], 'no status, no name, no rating: only what the import is for');
  assert.deepStrictEqual(entries[0].user_platforms.map(p => p.id), [6, 'custom_store_microsoft_store', 49], 'its own platforms are kept');
}

{
  const { entries } = planXboxImport([{
    key: 'xbox:42', titleId: '42', productIds: [], xboxName: 'A Game IGDB Has Never Heard Of',
    platform: 'Xbox One', igdb: null, existing: null, status: 'Backlog', selected: true,
  }]);
  assert.strictEqual(entries[0].id, 'custom_xbox_42', 'a title IGDB does not have becomes a custom entry keyed on its title id');
  assert.strictEqual(entries[0].is_custom, true);
}

{
  const { entries, skipped } = planXboxImport([
    { key: 'a', titleId: '1', productIds: [], igdb: null, existing: null, status: null, selected: true },
    { key: 'b', titleId: '2', productIds: [], igdb: null, existing: null, status: 'Backlog', selected: false },
  ]);
  assert.strictEqual(entries.length, 0);
  assert.strictEqual(skipped, 1, 'a ticked row with no status is counted, not guessed at');
  assert.strictEqual(rowReady({ selected: true, status: null, existing: null }), false);
  assert.strictEqual(rowReady({ selected: true, status: 'Backlog', existing: null }), true);
}

/* ── Matching by hand ── */
{
  const row = { key: 'xbox:42', titleId: '42', productIds: ['P'], xboxName: 'Unknown', platform: 'Xbox One', igdb: null, byName: false, existing: null, status: 'Backlog', selected: false };
  const linked = linkRowToIgdb(row, { id: 55, name: 'The Real Game', cover: { image_id: 'c55' } }, [{ id: '55', name: 'The Real Game' }]);
  assert.strictEqual(linked.key, 'igdb:55');
  assert.strictEqual(linked.selected, true, 'a game found by hand is a decision, so it arrives ticked');
  assert.strictEqual(linked.byName, false, 'and is no longer a guess');
  assert.ok(linked.existing, 'and picks up the library entry when the game is already there');
  assert.strictEqual(linked.status, 'Backlog', 'while keeping what was chosen for it');
  assert.deepStrictEqual(linked.productIds, ['P']);

  const back = unlinkRowFromIgdb(linked, []);
  assert.strictEqual(back.key, 'xbox:42');
  assert.strictEqual(back.igdb, null);
  assert.strictEqual(back.status, 'Backlog');
}

console.log('xbox import: all assertions passed');
