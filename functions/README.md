# The IGDB and Wikidata proxy

One small service that holds the IGDB credential so no client has to.

## Why it exists

Before this, every client read the IGDB `client_id` and `client_secret` out of a
world-readable Firestore document, exchanged them with Twitch for a token, and
sent that token to IGDB. The secret was therefore in that Firestore document, in
this repository's git history, and inside every shipped binary. A browser or a
desktop app cannot keep a secret, so no storage rule could fix it. Not needing
the secret is the fix.

It also has to exist for a website at all. `api.igdb.com` sends no CORS headers
and `query.wikidata.org` refuses browser origins, so a page served from a static
host cannot call either directly. The Vite dev proxy had been hiding that.

## The files

| File | What it is |
|---|---|
| `proxy.js` | The whole thing. Standard `Request` in, `Response` out, no platform SDK. |
| `worker.js` | Three lines of Cloudflare Worker entry point. |
| `serve.js` | The same code as a plain Node server, for development and the test. |
| `proxy.test.mjs` | Drives it against the real IGDB and Wikidata. |

`vite.config.js` starts `serve.js` in the dev server's own process and proxies
`/api` and `/wdqs` to it, so development runs the same code as production.

## Deploying

Cloudflare Workers, on the free plan: 100,000 requests a day, no card required.
Cloud Functions was the other candidate and is not used, because it needs the
Blaze plan and therefore a billing account.

It is already deployed, from the Cloudflare dashboard, as the Worker
`lorehaven-proxy` on `https://lorehaven-proxy.nishilvani.workers.dev`. The
dashboard editor holds one file, so what is pasted there is `proxy.js` with its
two `export` keywords dropped and `worker.js`'s default export appended. Rebuild
that single file with:

```bash
sed -e 's/^export async function handle/async function handle/' \
    -e '/^export const __test/d' functions/proxy.js > worker-bundle.js
printf '\nexport default {\n  fetch: (request, env) => handle(request, env),\n};\n' >> worker-bundle.js
```

For later changes, wrangler deploys `functions/worker.js` directly and needs no
bundle, because it follows the import. It is installed as a devDependency now,
so this is the whole of it:

```bash
npx wrangler login    # once; the OAuth grant is far wider than workers:write
npx wrangler deploy
```

`wrangler deploy` overwrites the Worker's remote configuration with
`wrangler.toml`, including settings nobody edited. The first deploy from this
repo silently turned versioned preview URLs on, because the dashboard had them
off and the file did not mention them -- hence the explicit `preview_urls =
false`. It also moved `compatibility_date` from the 2026-09-06 the dashboard had
set back to the committed 2024-11-01. Read wrangler's config diff before
confirming; anything not in this file is a setting you are about to reset.

The two secrets are set once, either in the Worker's Settings under "Runtime
variables and secrets" with the Secret box ticked, or with
`npx wrangler secret put IGDB_CLIENT_ID` and the same for `IGDB_CLIENT_SECRET`.
Nothing secret is written to disk either way: Cloudflare stores the values
encrypted and they cannot be read back.

## Pointing the app at it

Every built target needs the origin, because the proxy is a Worker on its own
hostname rather than a route on the site, and a static host cannot proxy.

```bash
# .env.production, or the environment of whatever builds the app
VITE_PROXY_ORIGIN=https://lorehaven-proxy.nishilvani.workers.dev
```

Development points at the same deployed Worker, through `.env.development`, so
no machine here holds the IGDB credential either. It costs a handful of the free
plan's 100,000 daily requests and buys development that runs the production
path, CORS included.

The local copy in `serve.js` is the opt-out, for working on the proxy itself
without deploying to see a change: empty or delete `VITE_PROXY_ORIGIN` in
`.env.development` and the relative `/api` and `/wdqs` paths fall back to the
middleware in `vite.config.js`. That is the only situation that needs a
credential on disk, through `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` in the
environment.

## Rotate the credential

Do this once, whichever host you choose. The current pair has been readable by
anyone through Firestore and is in this repository's history, so it should be
treated as public. Regenerate it in the Twitch developer console for the IGDB
application, then `wrangler secret put` the new values. Nothing else needs to
change, because nothing else holds them any more.

## The shared edge cache

Nothing this proxy returns is user-specific, so identical queries are cached at
the edge for an hour with the Workers Cache API, which costs nothing on the free
plan. One request per query per hour then serves every visitor instead of one
per cold client, and it makes IGDB's four-per-second limit much harder to reach.

Responses carry `x-lh-cache: HIT` or `MISS`, so it can be checked from outside.
Two back-to-back curls are NOT the check, though the obvious version of this
paragraph used to say they were: `cache.put` runs inside `ctx.waitUntil`, after
the response has already been returned, so a second request sent milliseconds
later can easily still miss. Prime the key, pause, then sample:

```bash
U=https://lorehaven-proxy.nishilvani.workers.dev
Q='fields name; limit 1;'
curl -sS -o /dev/null -X POST -d "$Q" $U/api/games          # prime
sleep 3
for i in $(seq 1 10); do
  curl -sS -D- -o /dev/null -X POST -d "$Q" $U/api/games | grep -i x-lh-cache
  sleep 0.4
done
```

Expect mostly HIT, not all HIT. Measured on the live Worker right after the
first deploy: 16 of 20 on `/api/games`, 7 of 12 on `/wdqs/sparql`. The Cache API
is per-colo and a colo is many machines, so a request landing on a server that
has not seen the key yet misses and populates that one too. Every hit is still
an IGDB request that never happened.

Only 200s are stored, so a failed upstream call is never cached. `caches` does
not exist outside Workers, so `serve.js` and the test run the same file with the
cache simply absent.

## Adding an endpoint

`ALLOWED` in `proxy.js` lists the IGDB endpoints the app calls. The proxy
authenticates everything it forwards, so without that list it would be an open
credential for the whole of IGDB to anyone who found the URL. A new fetcher in
the app means a new entry here.

## Checking it

```bash
node functions/proxy.test.mjs
```

Real requests to IGDB and Wikidata. It asserts that a call succeeds with no
credential from the caller, that an endpoint the app never uses is refused, that
Wikidata is reachable with the user agent its policy asks for, and that a
misconfigured deployment fails closed rather than forwarding unauthenticated.
