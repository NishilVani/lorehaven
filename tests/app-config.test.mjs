// The payloads written to config/app from CI.
// Run: node tests/app-config.test.mjs
//
// The point of this file is one property: the payload a RELEASE writes can
// never contain `minCompatLevel`. That field is the compatibility gate. Writing
// it when a release is cut would arm the gate the instant the tag landed --
// before a single person had installed that release -- and every desktop and
// Android user would lose sync until they got round to updating. That is
// precisely the flag day the three-step rollout in docs/RELEASING.md exists to
// prevent, so it is guarded here by construction rather than by care.
import assert from 'node:assert';
import { releasePayload, armPayload } from '../scripts/app_config_payload.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a release payload carries the version and the notes', () => {
    const p = releasePayload({ version: '0.2.0', notes: 'Compatibility gate.', now: 1234 });
    assert.strictEqual(p.latestVersion, '0.2.0');
    assert.strictEqual(p.latestNotes, 'Compatibility gate.');
    assert.strictEqual(p.updatedAt, 1234);
});

test('a release payload NEVER carries minCompatLevel, whatever it is handed', () => {
    /* The whole reason this module exists. Every one of these is a way the
       field could sneak in: passed directly, passed under the release key,
       or smuggled through a field that is copied verbatim. */
    const attempts = [
        { version: '0.2.0', minCompatLevel: 3 },
        { version: '0.2.0', notes: 'x', minCompatLevel: 99 },
        { version: '0.2.0', notes: 'x', extra: { minCompatLevel: 4 } },
        { version: '0.2.0', latestVersion: '9.9.9', minCompatLevel: 2 },
    ];
    for (const args of attempts) {
        const p = releasePayload(args);
        assert.ok(!('minCompatLevel' in p),
            `minCompatLevel reached a release payload from ${JSON.stringify(args)}`);
        assert.deepStrictEqual(Object.keys(p).sort(), ['latestNotes', 'latestVersion', 'updatedAt'],
            'a release payload has exactly three keys and no others');
    }
});

test('a release payload refuses a version that is not a version', () => {
    /* A bad version silently published would tell every client a release
       exists that does not. Fail loudly at the CI step instead. */
    for (const bad of [undefined, null, '', 'latest', 'v', '0.2.0; DROP', 42]) {
        assert.throws(() => releasePayload({ version: bad }), /version/i,
            `accepted a bad version: ${JSON.stringify(bad)}`);
    }
});

test('a release payload accepts a v prefix and stores it without one', () => {
    /* Tags are `v0.2.0`; compareVersions in compat.js tolerates the prefix but
       storing it would make the value inconsistent with tauri.conf.json. */
    assert.strictEqual(releasePayload({ version: 'v0.2.0' }).latestVersion, '0.2.0');
});

test('notes default to empty rather than undefined', () => {
    /* Firestore rejects an undefined value outright, which would fail the
       release job over a field nobody supplied. */
    assert.strictEqual(releasePayload({ version: '0.2.0' }).latestNotes, '');
});

test('an arm payload carries only minCompatLevel', () => {
    const p = armPayload({ level: 2, now: 5678 });
    assert.strictEqual(p.minCompatLevel, 2);
    assert.strictEqual(p.updatedAt, 5678);
    assert.deepStrictEqual(Object.keys(p).sort(), ['minCompatLevel', 'updatedAt'],
        'arming touches the gate and nothing else, so a bad arm cannot also corrupt the version');
});

test('an arm payload refuses anything that is not a positive integer', () => {
    /* Firestore rules test `compatLevel is int`. A float or a string stored
       here would make the client and the rules disagree about who is gated. */
    for (const bad of [undefined, null, '2', 2.5, 0, -1, NaN, Infinity]) {
        assert.throws(() => armPayload({ level: bad }), /level/i,
            `accepted a bad level: ${JSON.stringify(bad)}`);
    }
});

test('the two payloads share no keys, so neither can overwrite the other', () => {
    /* Both are written with merge:true against the same document. Overlapping
       keys would mean a release could clobber the gate or vice versa. */
    const rel = Object.keys(releasePayload({ version: '0.2.0' }));
    const arm = Object.keys(armPayload({ level: 2 }));
    const shared = rel.filter(k => arm.includes(k) && k !== 'updatedAt');
    assert.deepStrictEqual(shared, [], `the payloads overlap on ${shared.join(', ')}`);
});

let failed = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
