// One replay of a request that never reached the server.
// Run: node tests/net-retry.test.mjs
//
// Chrome reports "TypeError: Failed to fetch" / ERR_CONNECTION_CLOSED when it
// sends a request down a kept-alive connection the server has already closed
// (Cloudflare idles them out). It retries that itself for GET, never for POST,
// and every IGDB query is a POST. So the first request after Explore sits idle
// for a while sometimes fails before it starts. A single replay opens a fresh
// connection; a response from the server -- any status -- is never replayed.
import assert from 'node:assert';
import { withNetworkRetry } from '../src/services/netRetry.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const netError = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });

test('replays once when the request never left the client', async () => {
    let calls = 0;
    const res = await withNetworkRetry(async () => { calls++; if (calls === 1) throw netError(); return { ok: true, status: 200 }; }, { delayMs: 0 });
    assert.strictEqual(calls, 2);
    assert.strictEqual(res.status, 200);
});

test('gives up after the second network failure and throws it', async () => {
    let calls = 0;
    await assert.rejects(withNetworkRetry(async () => { calls++; throw netError(); }, { delayMs: 0 }), /Failed to fetch/);
    assert.strictEqual(calls, 2);
});

test('does not replay a response the server actually sent, even a 5xx', async () => {
    let calls = 0;
    const res = await withNetworkRetry(async () => { calls++; return { ok: false, status: 502 }; }, { delayMs: 0 });
    assert.strictEqual(calls, 1);
    assert.strictEqual(res.status, 502);
});

test('does not replay a non-network error', async () => {
    let calls = 0;
    await assert.rejects(withNetworkRetry(async () => { calls++; throw new Error('IGDB 429'); }, { delayMs: 0 }), /IGDB 429/);
    assert.strictEqual(calls, 1);
});

test('does not replay when the caller aborted', async () => {
    let calls = 0;
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    await assert.rejects(withNetworkRetry(async () => { calls++; throw abort; }, { delayMs: 0 }), /aborted/);
    assert.strictEqual(calls, 1);
});

let failed = 0;
for (const { name, fn } of tests) {
    try { await fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
