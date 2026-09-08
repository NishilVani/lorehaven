/* The IGDB and Wikidata proxy.
 *
 * Why this exists: the app is a browser and a Tauri shell, and neither can keep
 * a secret. Before this, every client read the IGDB client_id and client_secret
 * out of a world-readable Firestore document, did the Twitch client-credentials
 * exchange itself, and sent the resulting token to IGDB. The secret was
 * therefore in the Firestore document, in the git history, and inside every
 * shipped binary. No storage rule can fix that; only not needing it can.
 *
 * Here the secret lives on the server, the token never leaves the server, and a
 * client asks for game data instead of asking for credentials.
 *
 * It also has to exist for the web build at all: api.igdb.com sends no CORS
 * headers and query.wikidata.org refuses browser origins, so a page served from
 * a static host cannot call either directly. The Vite dev proxy has been hiding
 * that during development.
 *
 * No platform SDK is used on purpose. `handle()` takes and returns the standard
 * Request/Response pair, so the same file runs behind Cloud Functions, Cloud
 * Run, a Cloudflare Worker, or the plain Node server in serve.js.
 */

const IGDB = 'https://api.igdb.com/v4';
const TWITCH = 'https://id.twitch.tv/oauth2/token';
const WDQS = 'https://query.wikidata.org';

/* Wikimedia's user-agent policy: identify the client or collect 403s and 429s. */
const WD_UA = 'LoreHaven/1.0 (game library app; contact via app repo)';

/* IGDB endpoints the app actually calls. An allowlist rather than a pass-through:
 * this proxy authenticates every request it forwards, so without one it would be
 * an open credential for the whole of IGDB to anyone who finds the URL. Adding a
 * new fetcher to the app means adding its endpoint here.
 * Source: every `fetch('/api/…')` in src/services/igdb.js. */
const ALLOWED = new Set([
  'games', 'games/count', 'genres', 'themes', 'platforms', 'companies',
  'franchises', 'collections', 'collection_memberships', 'collection_relations',
  'collection_types', 'events', 'external_game_sources', 'game_engines',
  'game_modes', 'game_time_to_beats', 'release_dates', 'multiquery',
]);

/* ── The token, held here and only here ──────────────────────────────────────
 * A Twitch app-access token lasts about 60 days. One in-memory copy per
 * instance is refreshed a minute before it expires, and concurrent callers
 * share the one in-flight request rather than each starting their own. */
let token = null;        // { value, expiresAt }
let inFlight = null;

async function getToken(env, now = Date.now()) {
  if (token && token.expiresAt > now + 60_000) return token.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const url = `${TWITCH}?client_id=${encodeURIComponent(env.IGDB_CLIENT_ID)}`
      + `&client_secret=${encodeURIComponent(env.IGDB_CLIENT_SECRET)}`
      + '&grant_type=client_credentials';
    const res = await fetch(url, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      /* Never echo the upstream body: on a bad credential Twitch names the
         field that failed, and that is a hint about the secret. */
      throw Object.assign(new Error('token exchange failed'), { status: 502 });
    }
    token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 0) * 1000 };
    return token.value;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the cached token so the next call re-authenticates. */
const dropToken = () => { token = null; };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: cors({ 'content-type': 'application/json' }) });

/* Same-origin behind Firebase Hosting, cross-origin for the Tauri shell, which
   sends an `Origin` of tauri://localhost or http://tauri.localhost. */
const cors = (h = {}) => ({
  ...h,
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
});

/* ── Shared edge cache ───────────────────────────────────────────────────────
 *
 * Nothing this proxy returns is user-specific. Trending, genres, platforms and
 * the taxonomy queries are byte-identical for every visitor, and each one used
 * to cost IGDB a request per cold client. The Workers runtime has a cache that
 * costs nothing on the free plan, so one request per query per TTL serves the
 * whole user base -- which also makes the four-per-second IGDB limit much
 * harder to reach.
 *
 * The Cache API keys on a GET request, and these are POSTs whose body is the
 * query, so the key is a synthetic GET URL carrying a hash of the body. SHA-256
 * rather than something cheaper because a collision would serve one query's
 * answer to another.
 *
 * An hour. The client caches these for six hours to a month depending on the
 * fetcher, so the edge is never the reason someone sees stale data; it only
 * collapses the cold ones.
 *
 * Guarded, because `caches` exists in Workers and not in Node: serve.js and the
 * test run the same file with the cache simply absent. */
const EDGE_TTL_S = 3600;

const edgeCache = () => (typeof caches !== 'undefined' && caches.default) || null;

async function cacheKeyFor(kind, path, body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://lorehaven.invalid/${kind}/${path}?q=${hex}`, { method: 'GET' });
}

/* Run `send` unless the edge already has the answer. `ctx` is the Worker's
   execution context; without it the cache write would be cancelled when the
   response is returned, so no ctx means no caching rather than a dropped
   promise. */
async function throughCache(kind, path, body, ctx, send) {
  const cache = edgeCache();
  const key = cache ? await cacheKeyFor(kind, path, body) : null;
  if (key) {
    const hit = await cache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-lh-cache', 'HIT');
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const res = await send();
  if (key && res.status === 200 && ctx?.waitUntil) {
    const stored = new Response(res.clone().body, { status: res.status, headers: new Headers(res.headers) });
    stored.headers.set('cache-control', `public, max-age=${EDGE_TTL_S}`);
    ctx.waitUntil(cache.put(key, stored));
  }
  const headers = new Headers(res.headers);
  if (key) headers.set('x-lh-cache', 'MISS');
  return new Response(res.body, { status: res.status, headers });
}

async function igdb(path, req, env, ctx) {
  if (!ALLOWED.has(path)) return json(404, { error: 'unknown endpoint' });
  const body = await req.text();

  const send = async (bearer) => fetch(`${IGDB}/${path}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'text/plain',
    },
    body,
  });

  return throughCache('api', path, body, ctx, async () => {
    let res = await send(await getToken(env));
    /* A 401 here means the cached token died early: drop it, mint a new one and
       replay once. The client used to carry this logic because it held the token;
       it belongs on whoever owns the token, which is now this. */
    if (res.status === 401) {
      dropToken();
      res = await send(await getToken(env));
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: cors({ 'content-type': res.headers.get('content-type') || 'application/json' }),
    });
  });
}

async function wikidata(path, req, ctx) {
  if (path !== 'sparql') return json(404, { error: 'unknown endpoint' });
  const body = await req.text();
  return throughCache('wdqs', path, body, ctx, async () => {
  const res = await fetch(`${WDQS}/sparql`, {
    method: 'POST',
    headers: {
      'User-Agent': WD_UA,
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: cors({ 'content-type': res.headers.get('content-type') || 'application/json' }),
  });
  });
}

/**
 * @param {Request} req
 * @param {{IGDB_CLIENT_ID: string, IGDB_CLIENT_SECRET: string}} env
 */
export async function handle(req, env, ctx) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return json(500, { error: 'proxy is not configured' });

  const { pathname } = new URL(req.url);
  /* Hosting rewrites keep the original path, so both /api/games and a bare
     /games arrive here depending on how it is mounted. */
  const path = pathname.replace(/^\/+/, '').replace(/^(api|wdqs)\//, '');
  const kind = /^\/+(api)\//.test(pathname) ? 'api' : /^\/+(wdqs)\//.test(pathname) ? 'wdqs' : null;

  try {
    if (kind === 'api') return await igdb(path, req, env, ctx);
    if (kind === 'wdqs') return await wikidata(path, req, ctx);
    return json(404, { error: 'unknown route' });
  } catch (e) {
    return json(e.status || 502, { error: e.message || 'upstream failed' });
  }
}

export const __test = { getToken, dropToken, ALLOWED, throughCache, cacheKeyFor, EDGE_TTL_S };
