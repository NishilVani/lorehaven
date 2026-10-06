/* The motion engine's pure parts: how a navigation is classified, how shared
 * elements are keyed, how the old Motion choices migrate, and the level
 * module. node tests/motion.test.mjs */
import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let reduce = false;
const listeners = [];
globalThis.window = globalThis.window || globalThis;
window.matchMedia = () => ({ matches: reduce, addEventListener: (_, f) => listeners.push(f) });
window.dispatchEvent = window.dispatchEvent || (() => true);
const dataset = {};
globalThis.document = { documentElement: { dataset }, addEventListener: () => {} };

const {
  classifyTransition, siblingDirection, parseShared, sharedKey, migrateMotionChoice,
} = await import('../src/motion/classify.js');

/* ── Shared keys ── */
assert.deepStrictEqual(parseShared('poster:1942'), { kind: 'poster', id: '1942' });
assert.deepStrictEqual(parseShared('franchise-title:7'), { kind: 'franchise-title', id: '7' });
assert.strictEqual(parseShared('poster:'), null);
assert.strictEqual(parseShared('nonsense'), null);
assert.strictEqual(parseShared('bogus:1'), null, 'only known kinds');
assert.strictEqual(parseShared(null), null);
assert.strictEqual(sharedKey({ kind: 'poster', id: 1942 }), 'poster:1942');

/* ── Siblings ── */
assert.strictEqual(siblingDirection('/library/backlog', '/library/beaten'), 'right', 'later shelf: content moves toward the right tab');
assert.strictEqual(siblingDirection('/library/beaten', '/library/playing'), 'left');
assert.strictEqual(siblingDirection('/browse/genres', '/browse/modes'), 'right');
assert.strictEqual(siblingDirection('/library/backlog', '/game/1'), null);
assert.strictEqual(siblingDirection('/library/backlog', '/library/duplicates'), null, 'duplicates is not a shelf');

/* ── Classification ── */
const c = (from, to, navigationType = 'PUSH', pair = null) => classifyTransition({ from, to, navigationType, pair });
const pair = { kind: 'poster', id: '1942' };
assert.strictEqual(c('/', '/', 'PUSH'), null, 'same page: no transition');
assert.strictEqual(c('/', '/game/1942', 'PUSH', pair), 'carry');
assert.strictEqual(c('/game/1942', '/', 'POP', pair), 'carry-back');
assert.strictEqual(c('/game/1942', '/', 'POP'), 'back');
assert.strictEqual(c('/', '/game/1942', 'PUSH'), 'deeper');
assert.strictEqual(c('/', '/schedule', 'REPLACE'), 'deeper');
assert.strictEqual(c('/library/playing', '/library/backlog', 'PUSH', pair), 'sideways', 'siblings stay sideways even with a pair');
assert.strictEqual(c('/library/backlog', '/library/playing', 'POP'), 'sideways');

/* ── Migration of the first pass's choices ── */
assert.strictEqual(migrateMotionChoice('expressive'), 'system');
assert.strictEqual(migrateMotionChoice('standard'), 'system');
assert.strictEqual(migrateMotionChoice('reduced'), 'reduced');
assert.strictEqual(migrateMotionChoice(null), 'system');

/* ── The level module ── */
const { resolveMotion, getMotionChoice, setMotionChoice, motionLevel, initMotion, MOTION_CHOICES } = await import('../src/motion/motion.js');
assert.deepStrictEqual(MOTION_CHOICES, ['system', 'reduced']);
assert.strictEqual(resolveMotion('system', false), 'full');
assert.strictEqual(resolveMotion('system', true), 'reduced');
assert.strictEqual(resolveMotion('reduced', false), 'reduced');
store.set('lorehaven_motion', 'expressive');
assert.strictEqual(getMotionChoice(), 'system', 'a first-pass choice migrates');
initMotion();
assert.strictEqual(dataset.motion, 'full');
setMotionChoice('reduced');
assert.strictEqual(motionLevel(), 'reduced');
setMotionChoice('system');
assert.ok(!store.has('lorehaven_motion'));
reduce = true;
listeners.forEach((f) => f());
assert.strictEqual(dataset.motion, 'reduced', 'a system change applies at once');

console.log('motion: all assertions passed');
