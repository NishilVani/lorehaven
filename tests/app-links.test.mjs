/* Steam sign-in from the desktop and Android apps: which lorehaven:// links the
   app follows, and that the state the app sends Steam is the one the Worker
   checks. Node has WebCrypto and a localStorage shim is enough. */
import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  routeFromAppLink, stateForVerifier, newVerifier, keepVerifier, takeVerifier, stateFromReturnTo,
} = await import('../src/services/appSignIn.js');
const { verifierMatches } = await import('../functions/auth.js');

/* ── Which links the app follows ── */
assert.strictEqual(routeFromAppLink('lorehaven://auth/steam?openid.mode=id_res&from=%2Fprofile'), '/auth/steam?openid.mode=id_res&from=%2Fprofile');
assert.strictEqual(routeFromAppLink('lorehaven://import/steam?openid.mode=id_res'), '/import/steam?openid.mode=id_res');
assert.strictEqual(routeFromAppLink('lorehaven://auth/steam/'), '/auth/steam', 'a trailing slash is the same page');
assert.strictEqual(routeFromAppLink('lorehaven://library/backlog'), null, 'only the sign-in and import pages open from a link');
assert.strictEqual(routeFromAppLink('lorehaven://profile?delete=everything'), null);
assert.strictEqual(routeFromAppLink('https://lorehaven.app/auth/steam'), null, 'a web address is not an app link');
assert.strictEqual(routeFromAppLink('evil://auth/steam'), null, 'another scheme is not ours');
assert.strictEqual(routeFromAppLink('not a url'), null);
assert.strictEqual(routeFromAppLink(undefined), null);

/* ── The state the app sends is the one the Worker checks ── */
{
  const verifier = newVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.notStrictEqual(verifier, newVerifier(), 'and different every time');
  const state = await stateForVerifier(verifier);
  assert.strictEqual(await verifierMatches(verifier, state), true,
    'the Worker accepts the verifier the app kept for the state it sent');
  assert.strictEqual(await verifierMatches(newVerifier(), state), false,
    'and refuses any other verifier');
}
assert.strictEqual(await stateForVerifier('hello'), 'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ',
  'the same value the Worker tests fix for the same input');

/* ── The verifier is kept for one sign-in ── */
{
  keepVerifier('abc', 1_000_000);
  assert.strictEqual(takeVerifier(1_000_000 + 60_000), 'abc');
  assert.strictEqual(takeVerifier(1_000_000 + 60_000), null, 'reading it removes it, so it cannot finish a second sign-in');
  keepVerifier('old', 1_000_000);
  assert.strictEqual(takeVerifier(1_000_000 + 16 * 60_000), null, 'an abandoned attempt does not linger');
}

assert.strictEqual(stateFromReturnTo('https://lorehaven.web.app/auth/steam?next=x&state=abc'), 'abc');
assert.strictEqual(stateFromReturnTo('https://lorehaven.web.app/auth/steam'), null);

console.log('app links: all assertions passed');
