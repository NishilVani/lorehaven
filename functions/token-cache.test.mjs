/* The Twitch token, cached at the edge rather than once per isolate.
   Run: node functions/token-cache.test.mjs
   No credentials and no network: Twitch is stubbed and the Workers Cache API is
   a Map, so this runs in CI. proxy.test.mjs is the one that talks to the real
   thing.

   Why it exists: Cloudflare's metrics for 2026-09-09 showed 174 token exchanges
   in 24 hours against 5.67k requests. A Twitch app-access token lasts ~60 days,
   so 174 is not refresh -- it is one mint per cold isolate, each throwing the
   last one away. The edge cache is the tier that outlives an isolate.

   A fresh `import` with a distinct query string gives a fresh module registry
   entry, which is exactly what a cold isolate is: new module state, same edge
   cache underneath. */
import assert from 'node:assert';

const TWITCH = 'https://id.twitch.tv/oauth2/token';
const env = { IGDB_CLIENT_ID: 'cid', IGDB_CLIENT_SECRET: 'sec' };

/* Stands in for caches.default. Matches on the request URL, and clones on the
   way in and out because a Response body can only be read once. */
const makeCaches = () => {
    const store = new Map();
    return {
        store,
        default: {
            async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
            async put(req, res) { store.set(req.url, res.clone()); },
            async delete(req) { return store.delete(req.url); },
        },
    };
};

let exchanges = 0;
const installTwitch = ({ expiresIn = 60 * 24 * 3600 } = {}) => {
    exchanges = 0;
    globalThis.fetch = async (url) => {
        if (!String(url).startsWith(TWITCH)) throw new Error('unexpected fetch: ' + url);
        exchanges++;
        return new Response(JSON.stringify({ access_token: `tok-${exchanges}`, expires_in: expiresIn }), { status: 200 });
    };
};

let isolates = 0;
const coldIsolate = () => import(`./proxy.js?isolate=${++isolates}`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a cold isolate reuses the token a previous isolate minted', async () => {
    globalThis.caches = makeCaches();
    installTwitch();
    const first = await coldIsolate();
    const a = await first.__test.getToken(env);
    assert.strictEqual(exchanges, 1, 'the first isolate mints one');

    const second = await coldIsolate();
    const b = await second.__test.getToken(env);
    assert.strictEqual(exchanges, 1, 'the second isolate did NOT go to Twitch');
    assert.strictEqual(b, a, 'and it got the same token');
});

test('the in-memory copy is still preferred, so a warm isolate reads no cache', async () => {
    globalThis.caches = makeCaches();
    installTwitch();
    const mod = await coldIsolate();
    await mod.__test.getToken(env);
    let reads = 0;
    const real = globalThis.caches.default.match.bind(globalThis.caches.default);
    globalThis.caches.default.match = async (r) => { reads++; return real(r); };
    await mod.__test.getToken(env);
    await mod.__test.getToken(env);
    assert.strictEqual(reads, 0, 'a token already in memory costs no cache lookup');
    assert.strictEqual(exchanges, 1);
});

test('a cached token that has since expired is not adopted', async () => {
    globalThis.caches = makeCaches();
    installTwitch({ expiresIn: 3600 });          // one hour
    const first = await coldIsolate();
    await first.__test.getToken(env);
    assert.strictEqual(exchanges, 1);

    const second = await coldIsolate();
    await second.__test.getToken(env, Date.now() + 2 * 3600 * 1000);   // two hours on
    assert.strictEqual(exchanges, 2, 'an expired cache entry is re-minted, not served');
});

test('a token inside the refresh margin is re-minted rather than handed out', async () => {
    globalThis.caches = makeCaches();
    installTwitch({ expiresIn: 30 });            // expires inside the 60s margin
    const first = await coldIsolate();
    await first.__test.getToken(env);
    const second = await coldIsolate();
    await second.__test.getToken(env);
    assert.strictEqual(exchanges, 2, 'a token about to expire is not worth adopting');
});

test('dropToken clears the edge copy, so a revoked token is not served on', async () => {
    /* The 401 path. Without this, dropping only the in-memory copy is pointless:
       the next cold isolate reads the same dead token back out of the edge and
       fails the same way, for every colo, until the entry expires. */
    globalThis.caches = makeCaches();
    installTwitch();
    const first = await coldIsolate();
    await first.__test.getToken(env);
    assert.strictEqual(exchanges, 1);

    await first.__test.dropToken(env);
    const second = await coldIsolate();
    await second.__test.getToken(env);
    assert.strictEqual(exchanges, 2, 'after dropToken a cold isolate re-authenticates');
});

test('concurrent callers in one isolate share a single exchange', async () => {
    globalThis.caches = makeCaches();
    installTwitch();
    const mod = await coldIsolate();
    const [a, b, c] = await Promise.all([
        mod.__test.getToken(env), mod.__test.getToken(env), mod.__test.getToken(env),
    ]);
    assert.strictEqual(exchanges, 1);
    assert.strictEqual(a, b); assert.strictEqual(b, c);
});

test('rotating the client id does not serve a token minted for the old one', async () => {
    globalThis.caches = makeCaches();
    installTwitch();
    const first = await coldIsolate();
    await first.__test.getToken({ IGDB_CLIENT_ID: 'old', IGDB_CLIENT_SECRET: 'sec' });
    const second = await coldIsolate();
    await second.__test.getToken({ IGDB_CLIENT_ID: 'new', IGDB_CLIENT_SECRET: 'sec' });
    assert.strictEqual(exchanges, 2, 'a different client id is a different cache key');
});

test('the token is stored only under an unroutable synthetic key', async () => {
    /* Nothing reachable by an inbound request may ever key a stored token.
       `.invalid` is reserved and never resolves, and the Worker fronts no zone,
       so no HTTP request can produce this key. */
    globalThis.caches = makeCaches();
    installTwitch();
    const mod = await coldIsolate();
    await mod.__test.getToken(env);
    const keys = [...globalThis.caches.store.keys()];
    assert.ok(keys.length > 0, 'something was stored');
    for (const k of keys) {
        assert.ok(k.startsWith('https://lorehaven.invalid/'), `stored under a routable key: ${k}`);
    }
    /* And the secret itself is never a cache key or a cached value. */
    const bodies = await Promise.all([...globalThis.caches.store.values()].map(r => r.clone().text()));
    const seen = keys.join(' ') + bodies.join(' ');
    assert.ok(!seen.includes('sec'), 'the client secret is not in the cache');
});

test('with no Cache API at all the proxy still mints and works', async () => {
    /* serve.js and the local dev path run this same file under Node, where
       `caches` does not exist. */
    delete globalThis.caches;
    installTwitch();
    const mod = await coldIsolate();
    const t = await mod.__test.getToken(env);
    assert.strictEqual(t, 'tok-1');
    assert.strictEqual(exchanges, 1);
    assert.strictEqual(await mod.__test.getToken(env), 'tok-1', 'in-memory copy still serves');
    assert.strictEqual(exchanges, 1);
    await mod.__test.dropToken(env);                 // must not throw without a cache
    await mod.__test.getToken(env);
    assert.strictEqual(exchanges, 2);
});

const realFetch = globalThis.fetch;
let failed = 0;
for (const { name, fn } of tests) {
    try { await fn(); console.log('  ok   ', name); }
    catch (e) { failed++; console.log('  FAIL ', name, '\n         ', String(e.message).split('\n')[0]); }
}
globalThis.fetch = realFetch;
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
