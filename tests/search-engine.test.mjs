/* Search: normalisation, matching, ranking, completion and suggestions, driven
   against the real shipped index so the cases are the ones people type. The
   failures listed against each case are what IGDB's own search returned for
   it on 2026-10-04. Run: node tests/search-engine.test.mjs */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalize, editDistance } from '../src/services/search/normalize.js';
import { search, completion, suggest, prepare } from '../src/services/search/engine.js';
import { buildLocal, deviceDocs } from '../src/services/search/localIndex.js';

/* ── Normalising ── */
assert.strictEqual(normalize("Marvel's Spider-Man"), 'marvels spider man');
assert.strictEqual(normalize('PERSONA5'), 'persona 5');
assert.strictEqual(normalize('Grand Theft Auto V'), 'grand theft auto 5');
assert.strictEqual(normalize('gta v'), normalize('GTA 5'));
assert.strictEqual(normalize('Pokémon Sword & Shield'), 'pokemon sword and shield');
assert.strictEqual(normalize('  '), '');

/* ── Edit distance ── */
assert.strictEqual(editDistance('witcher', 'witcher'), 0);
assert.strictEqual(editDistance('wicher', 'witcher'), 1);
assert.strictEqual(editDistance('teh', 'the'), 1, 'a transposition is one edit');
assert.ok(editDistance('zelda', 'mario', 2) > 2, 'gives up past the limit');

/* ── The real index ── */
const ix = JSON.parse(readFileSync(new URL('../src/services/search/searchIndex.json', import.meta.url), 'utf8'));
const L = buildLocal(ix);
assert.ok(L.docs.length >= 3000, 'the index loaded');
const top = (q, kinds) => search(L.docs, q, { limit: 1, kinds })[0]?.doc.name;
const names = (q) => search(L.docs, q, { limit: 5 }).map(r => r.doc.name);

// Typos. IGDB: nothing.
assert.strictEqual(top('wicher 3'), 'The Witcher 3: Wild Hunt');
assert.strictEqual(top('eldn ring'), 'Elden Ring');
assert.strictEqual(top('skyrm'), 'The Elder Scrolls V: Skyrim');
assert.strictEqual(top('mass efect'), 'Mass Effect');
// Words not finished yet. IGDB: nothing.
assert.strictEqual(top('hollow kn'), 'Hollow Knight');
assert.strictEqual(top('the last of'), 'The Last of Us');
// Spacing, numbers and abbreviations. IGDB: a spin-off, an edition, an obscure game.
assert.strictEqual(top('persona5'), 'Persona 5');
assert.strictEqual(top('spiderman', ['game']), "Marvel's Spider-Man");
assert.strictEqual(top('gta 5'), 'Grand Theft Auto V');
assert.strictEqual(top('gta v'), 'Grand Theft Auto V');
assert.strictEqual(top('botw'), 'The Legend of Zelda: Breath of the Wild');
assert.strictEqual(top('final fantasy 7'), 'Final Fantasy VII');
// Popularity breaks ties: the game people mean, not the obscure one.
assert.strictEqual(top('red dead'), 'Red Dead Redemption');
assert.ok(names('zelda breath')[0] === 'The Legend of Zelda: Breath of the Wild');
// Studios and franchises.
assert.strictEqual(top('fromsoft', ['company']), 'FromSoftware');
assert.strictEqual(top('cyberpunk', ['franchise']), 'Cyberpunk');

/* ── Completion ── */
const first = (q) => search(L.docs, q, { limit: 1 })[0];
assert.strictEqual(completion('hollow kn', first('hollow kn')), 'ight', 'the rest of the name, for ghost text');
assert.strictEqual(completion('the last of', first('the last of')), ' Us');
assert.strictEqual(completion('wicher 3', first('wicher 3')), '', 'never completes over a letter you typed differently');

/* ── Suggestions: chosen by what they find ── */
assert.deepStrictEqual(suggest(L.docs, 'elden rng', L.dict)?.query, 'elden ring', 'not "elden rpg", the commoner word');
assert.deepStrictEqual(suggest(L.docs, 'red ded', L.dict)?.query, 'red dead', 'a typo that lands on a real word, and never "red red"');
assert.strictEqual(suggest(L.docs, 'witcher 3', L.dict), null, 'nothing to suggest for a good match');

/* ── Your device: library first, and what you opened is findable ── */
const mine = deviceDocs([{ id: 999001, name: 'Tiny Indie Gem', status: 'Backlog' }], [{ id: 999002, name: 'Obscure Thing I Opened' }]);
const all = [...mine, ...L.docs];
assert.strictEqual(search(all, 'tiny indi', { limit: 1 })[0]?.doc.name, 'Tiny Indie Gem', 'a library game the index does not hold');
assert.strictEqual(search(all, 'obscure thng', { limit: 1 })[0]?.doc.name, 'Obscure Thing I Opened', 'a game you opened, with a typo');
const ranked = search([...prepare([{ kind: 'game', id: 1, name: 'Doom', pop: 3000 }]), ...prepare([{ kind: 'game', id: 2, name: 'Doom', pop: 10, mine: true }])], 'doom');
assert.strictEqual(ranked[0].doc.id, 2, 'your copy of a same-named game comes first');
const deduped = search([...prepare([{ kind: 'game', id: 7, name: 'Hades', mine: true }]), ...prepare([{ kind: 'game', id: 7, name: 'Hades', pop: 900 }])], 'hades');
assert.strictEqual(deduped.length, 1, 'one game, one result, however many sources hold it');

console.log(`search engine: all assertions passed (index built ${L.built}, ${L.docs.length} documents)`);
