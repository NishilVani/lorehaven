// Regression test for the dismissed-outdated / live-error visibility bug.
// Run: node tests/banner-visibility.test.mjs
//
// Mirrors the early-return predicate in ApiErrorBanner.jsx line-for-line as a
// pure function -- it does not import the component (no React test setup in
// this project) -- so this is a mirror check, not an integration proof. If the
// predicate in ApiErrorBanner.jsx changes, this copy must change with it.
//
// The bug: `(outdated && dismissedOutdated) || (!error && !outdated)` fires its
// first clause on outdated+dismissed alone, with no `error` term, so once a
// user dismisses the "Sync is off" notice every later unrelated API error is
// silently swallowed for the rest of the session. The fix keeps the dismissal
// latch scoped to the pure-outdated case only, by putting `error` outside it.
import assert from 'node:assert';

// Mirrors ApiErrorBanner.jsx's `if (...) return null;` line. `shown` is the
// inverse of that early return: true means the banner renders.
function shown({ error, outdated, dismissedOutdated }) {
  return !(!error && (!outdated || dismissedOutdated));
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('error only, not dismissed -> shown', () => {
  assert.strictEqual(shown({ error: 'request', outdated: false, dismissedOutdated: false }), true);
});

test('outdated only, not dismissed -> shown', () => {
  assert.strictEqual(shown({ error: null, outdated: true, dismissedOutdated: false }), true);
});

test('outdated only, dismissed -> hidden', () => {
  assert.strictEqual(shown({ error: null, outdated: true, dismissedOutdated: true }), false);
});

test('outdated dismissed AND an error present -> shown (the regression)', () => {
  assert.strictEqual(shown({ error: 'request', outdated: true, dismissedOutdated: true }), true);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log('  ok   ', name); }
  catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
