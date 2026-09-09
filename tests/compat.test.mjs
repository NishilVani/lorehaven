// The compatibility comparisons. Run: node tests/compat.test.mjs
//
// compareVersions must be numeric per segment. Lexical comparison makes
// "0.10.0" older than "0.9.0", which would hide a real update from everyone
// past the ninth patch.
import assert from 'node:assert';
import { COMPAT_LEVEL, compareVersions, evaluateCompat } from '../src/services/compat.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the level is an integer, because the Firestore rule compares it as one', () => {
    assert.ok(Number.isInteger(COMPAT_LEVEL), 'COMPAT_LEVEL must be an integer');
});

test('compareVersions orders segments numerically, not lexically', () => {
    assert.strictEqual(compareVersions('0.10.0', '0.9.0'), 1, '0.10.0 is newer than 0.9.0');
    assert.strictEqual(compareVersions('0.9.0', '0.10.0'), -1);
    assert.strictEqual(compareVersions('1.0.0', '0.99.99'), 1);
});

test('compareVersions treats equal versions as equal', () => {
    assert.strictEqual(compareVersions('0.2.0', '0.2.0'), 0);
});

test('compareVersions pads missing segments with zero', () => {
    assert.strictEqual(compareVersions('0.2', '0.2.0'), 0);
    assert.strictEqual(compareVersions('0.2.1', '0.2'), 1);
});

test('compareVersions tolerates a v prefix and unparseable input', () => {
    assert.strictEqual(compareVersions('v0.2.0', '0.2.0'), 0);
    assert.strictEqual(compareVersions('', ''), 0);
    assert.strictEqual(compareVersions('nonsense', '0.0.0'), 0);
});

test('a level below the minimum is outdated', () => {
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: 2 }).outdated, true);
});

test('a level at or above the minimum is not outdated', () => {
    assert.strictEqual(evaluateCompat({ level: 2, minLevel: 2 }).outdated, false);
    assert.strictEqual(evaluateCompat({ level: 3, minLevel: 2 }).outdated, false);
});

test('an absent or malformed minimum means current -- the config is advisory', () => {
    /* Fail-open. The Firestore rules are the hard guarantee, so a config that
       did not load is a missing explanation, not a reason to stop syncing. */
    assert.strictEqual(evaluateCompat({ level: 1 }).outdated, false, 'undefined minimum');
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: null }).outdated, false);
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: '2' }).outdated, false, 'a string is not a level');
    assert.strictEqual(evaluateCompat({ level: 1, minLevel: 2.5 }).outdated, false);
});

test('updateAvailable is independent of outdated', () => {
    const patch = evaluateCompat({ level: 2, minLevel: 2, version: '0.1.0', latestVersion: '0.2.0' });
    assert.strictEqual(patch.outdated, false, 'a newer version alone never gates');
    assert.strictEqual(patch.updateAvailable, true);

    const current = evaluateCompat({ level: 2, minLevel: 2, version: '0.2.0', latestVersion: '0.2.0' });
    assert.strictEqual(current.updateAvailable, false);

    const both = evaluateCompat({ level: 1, minLevel: 2, version: '0.1.0', latestVersion: '0.2.0' });
    assert.strictEqual(both.outdated, true);
    assert.strictEqual(both.updateAvailable, true);
});

test('no latestVersion means no update to offer', () => {
    assert.strictEqual(evaluateCompat({ level: 2, minLevel: 2, version: '0.1.0' }).updateAvailable, false);
});

let failed = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
