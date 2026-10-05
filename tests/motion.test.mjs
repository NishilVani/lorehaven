/* The motion level: what each choice resolves to, where it is kept, and that
 * it reaches <html>. node tests/motion.test.mjs */
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
globalThis.document = {
  documentElement: { dataset },
  addEventListener: () => {},
};

const { resolveMotion, getMotionChoice, setMotionChoice, motionLevel, initMotion, MOTION_CHOICES } = await import('../src/motion/motion.js');

assert.deepStrictEqual(MOTION_CHOICES, ['system', 'reduced', 'standard', 'expressive']);
assert.strictEqual(resolveMotion('system', false), 'standard');
assert.strictEqual(resolveMotion('system', true), 'reduced', 'follows the system');
assert.strictEqual(resolveMotion('expressive', true), 'expressive', 'an explicit choice wins over the system');
assert.strictEqual(resolveMotion('bogus', false), 'standard', 'unknown values fall back');

assert.strictEqual(getMotionChoice(), 'system', 'nothing stored: follow the system');
store.set('lorehaven_motion', 'nonsense');
assert.strictEqual(getMotionChoice(), 'system', 'a hand-edited value is not trusted');

initMotion();
assert.strictEqual(dataset.motion, 'standard');
setMotionChoice('expressive');
assert.strictEqual(store.get('lorehaven_motion'), 'expressive');
assert.strictEqual(motionLevel(), 'expressive');
setMotionChoice('system');
assert.ok(!store.has('lorehaven_motion'), 'system is the absence of a choice');
reduce = true;
listeners.forEach((f) => f());
assert.strictEqual(dataset.motion, 'reduced', 'a system change applies at once');
assert.ok(!store.has('moctale_prefs'), 'never written to the synced prefs');

console.log('motion: all assertions passed');
