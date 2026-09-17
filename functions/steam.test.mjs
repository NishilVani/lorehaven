/* The Steam routes of the proxy: OpenID sign-in verification, profile link
   resolution, owned games and wishlist. Run: node functions/steam.test.mjs
   No network and no key: Steam is stubbed, so this runs in CI. It asserts what
   the Worker accepts, what it refuses without asking Steam, and that a user's
   library is never written to the shared edge cache. */
import assert from 'node:assert';
import {
  steamIdFromClaimedId, openIdAssertionProblem, openIdCheckBody, isValidCheckResponse,
  shapeOwnedGames, shapeWishlist, DEFAULT_RETURN_ORIGINS,
} from './steam.js';
import { handle } from './proxy.js';

const GABE = '76561197960287930';

/* ── Claimed id ── */
assert.strictEqual(steamIdFromClaimedId(`https://steamcommunity.com/openid/id/${GABE}`), GABE);
assert.strictEqual(steamIdFromClaimedId(`http://steamcommunity.com/openid/id/${GABE}`), GABE, 'Steam documents the http form');
assert.strictEqual(steamIdFromClaimedId(`https://steamcommunity.com.evil.example/openid/id/${GABE}`), null);
assert.strictEqual(steamIdFromClaimedId(`https://steamcommunity.com/openid/id/${GABE}/extra`), null);
assert.strictEqual(steamIdFromClaimedId(undefined), null);

/* ── The assertion, checked before Steam is asked ── */
const good = {
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${GABE}`,
  'openid.identity': `https://steamcommunity.com/openid/id/${GABE}`,
  'openid.return_to': 'https://lorehaven.web.app/import/steam',
  'openid.response_nonce': '2026-09-15T10:00:00Zabcdef',
  'openid.assoc_handle': '1234567890',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  'openid.sig': 'c2lnbmF0dXJl',
};
assert.ok(DEFAULT_RETURN_ORIGINS.includes('https://lorehaven.app'));
assert.ok(DEFAULT_RETURN_ORIGINS.includes('https://lorehaven.web.app'));
assert.strictEqual(openIdAssertionProblem(good, DEFAULT_RETURN_ORIGINS), null);
assert.ok(openIdAssertionProblem({ ...good, 'openid.op_endpoint': 'https://evil.example/openid/login' }, DEFAULT_RETURN_ORIGINS),
  'an assertion from any other provider is refused');
assert.ok(openIdAssertionProblem({ ...good, 'openid.return_to': 'https://evil.example/import/steam' }, DEFAULT_RETURN_ORIGINS),
  'an assertion minted for another site is refused, so a sign-in there cannot be replayed here');
assert.ok(openIdAssertionProblem({ ...good, 'openid.mode': 'cancel' }, DEFAULT_RETURN_ORIGINS), 'a cancelled sign-in');
assert.ok(openIdAssertionProblem({ ...good, 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000' }, DEFAULT_RETURN_ORIGINS),
  'identity and claimed id must name the same account');
assert.ok(openIdAssertionProblem({ ...good, 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle' }, DEFAULT_RETURN_ORIGINS),
  'the claimed id must be among the signed fields, even when everything else is');

{
  const body = new URLSearchParams(openIdCheckBody({ ...good, other: 'x' }));
  assert.strictEqual(body.get('openid.mode'), 'check_authentication');
  assert.strictEqual(body.get('openid.sig'), 'c2lnbmF0dXJl', 'every signed field is passed back unchanged');
  assert.strictEqual(body.get('other'), null, 'only openid.* fields go to Steam');
}
assert.strictEqual(isValidCheckResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'), true);
assert.strictEqual(isValidCheckResponse('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n'), false);
assert.strictEqual(isValidCheckResponse('xis_valid:true'), false);

/* ── Shapes ── */
assert.deepStrictEqual(
  shapeOwnedGames({ response: { game_count: 2, games: [
    { appid: 620, name: 'Portal 2', playtime_forever: 0, rtime_last_played: 0, img_icon_url: 'x' },
    { appid: 400, name: 'Portal', playtime_forever: 120, rtime_last_played: 1600000000 },
  ] } }),
  { visible: true, games: [
    { appid: 620, name: 'Portal 2', playtimeMinutes: 0, lastPlayed: null },
    { appid: 400, name: 'Portal', playtimeMinutes: 120, lastPlayed: 1600000000 },
  ] },
);
assert.deepStrictEqual(shapeOwnedGames({ response: {} }), { visible: false, games: [] },
  'a private profile answers with an empty response and no game_count');
assert.deepStrictEqual(shapeOwnedGames({ response: { game_count: 0 } }), { visible: true, games: [] }, 'public and empty is not private');
assert.deepStrictEqual(
  shapeWishlist({ response: { items: [{ appid: 1091500, priority: 1, date_added: 1690000000 }] } }),
  { available: true, items: [{ appid: 1091500, dateAdded: 1690000000 }] },
);
assert.deepStrictEqual(shapeWishlist({}), { available: false, items: [] });

/* ── The routes, through the real proxy entry point ── */
const calls = [];
let steamReply = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return steamReply(String(url), init);
};
const put = [];
globalThis.caches = { default: { match: async () => undefined, put: async (k) => { put.push(k.url); } } };
const ctx = { waitUntil: () => {} };

const env = { STEAM_API_KEY: 'test-key' };
const call = (path, body, e = env, method = 'POST') =>
  handle(new Request(`https://proxy.example${path}`, { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), e, ctx);
const read = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });

{
  calls.length = 0;
  steamReply = () => Response.json({ response: { success: 1, steamid: GABE } });
  const r = await read(await call('/steam/resolve', { profile: 'https://steamcommunity.com/id/gabelogannewell' }));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { steamid: GABE });
  const u = new URL(calls[0].url);
  assert.strictEqual(u.origin + u.pathname, 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
  assert.strictEqual(u.searchParams.get('vanityurl'), 'gabelogannewell');
  assert.strictEqual(u.searchParams.get('key'), 'test-key');
  assert.ok(!JSON.stringify(r.body).includes('test-key'), 'the key never comes back');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
}
{
  calls.length = 0;
  const r = await read(await call('/steam/resolve', { profile: `https://steamcommunity.com/profiles/${GABE}` }));
  assert.deepStrictEqual(r.body, { steamid: GABE });
  assert.strictEqual(calls.length, 0, 'a link that already holds the id needs no request');
}
{
  steamReply = () => Response.json({ response: { success: 42, message: 'No match' } });
  const r = await read(await call('/steam/resolve', { profile: 'nobodyhere' }));
  assert.strictEqual(r.status, 404);
}
{
  const r = await read(await call('/steam/resolve', { profile: 'https://example.com/x' }));
  assert.strictEqual(r.status, 400, 'something that is not a Steam profile is refused before Steam is asked');
}
{
  calls.length = 0;
  steamReply = () => Response.json({ response: { game_count: 1, games: [{ appid: 400, name: 'Portal', playtime_forever: 120, rtime_last_played: 1600000000 }] } });
  const r = await read(await call('/steam/owned', { steamid: GABE }));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { visible: true, games: [{ appid: 400, name: 'Portal', playtimeMinutes: 120, lastPlayed: 1600000000 }] });
  const u = new URL(calls[0].url);
  assert.strictEqual(u.origin + u.pathname, 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  assert.strictEqual(u.searchParams.get('steamid'), GABE);
  assert.strictEqual(u.searchParams.get('include_appinfo'), '1');
  assert.strictEqual(u.searchParams.get('include_played_free_games'), '1');
  assert.deepStrictEqual(put, [], 'a library is personal and is never put in the shared edge cache');
}
{
  steamReply = () => Response.json({ response: {} });
  const r = await read(await call('/steam/owned', { steamid: GABE }));
  assert.deepStrictEqual(r.body, { visible: false, games: [] });
}
{
  const r = await read(await call('/steam/owned', { steamid: 'abc' }));
  assert.strictEqual(r.status, 400);
}
{
  const r = await read(await call('/steam/owned', { steamid: GABE }, {}));
  assert.strictEqual(r.status, 503, 'no key configured is said plainly, not passed to Steam');
  assert.strictEqual(r.body.error, 'steam not configured');
}
{
  steamReply = () => Response.json({ response: { items: [{ appid: 1091500, date_added: 1690000000 }] } });
  const r = await read(await call('/steam/wishlist', { steamid: GABE }));
  assert.deepStrictEqual(r.body, { available: true, items: [{ appid: 1091500, dateAdded: 1690000000 }] });
}
{
  steamReply = () => new Response('not found', { status: 404 });
  const r = await read(await call('/steam/wishlist', { steamid: GABE }));
  assert.strictEqual(r.status, 200, 'a missing wishlist does not fail the import');
  assert.deepStrictEqual(r.body, { available: false, items: [] });
}
{
  calls.length = 0;
  steamReply = (url, init) => {
    assert.strictEqual(url, 'https://steamcommunity.com/openid/login');
    assert.strictEqual(init.method, 'POST');
    assert.strictEqual(new URLSearchParams(init.body).get('openid.mode'), 'check_authentication');
    return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
  };
  const r = await read(await call('/steam/verify', { params: good }, {}));
  assert.strictEqual(r.status, 200, 'verifying a sign-in needs no API key');
  assert.deepStrictEqual(r.body, { steamid: GABE });
}
{
  steamReply = () => new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n');
  const r = await read(await call('/steam/verify', { params: good }));
  assert.strictEqual(r.status, 401, 'a replayed or forged assertion Steam will not vouch for');
}
{
  calls.length = 0;
  const r = await read(await call('/steam/verify', { params: { ...good, 'openid.return_to': 'https://evil.example/' } }));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 0);
}
{
  const r = await read(await call('/steam/verify', { params: { ...good, 'openid.return_to': 'https://preview.example/import/steam' } },
    { STEAM_RETURN_ORIGINS: 'https://preview.example' }));
  assert.strictEqual(r.status, 401, 'STEAM_RETURN_ORIGINS replaces the default list (Steam is still stubbed to refuse)');
}
{
  const r = await read(await call('/steam/nothing', {}));
  assert.strictEqual(r.status, 404);
}
{
  const r = await call('/steam/owned', null, env, 'GET');
  assert.strictEqual(r.status, 405, 'POST only, like every other route');
}
{
  const r = await call('/api/games', 'fields name;', env);
  assert.strictEqual(r.status, 500, 'the IGDB routes still fail closed without the IGDB credential');
}

/* Mutation check, recorded: accepting any host in steamIdFromClaimedId, dropping
   the return_to origin check, dropping the no-store header, taking claimed_id
   out of the required signed fields, and routing /steam after the IGDB
   credential check each turned this file red. The signed-fields case survived
   its first draft, which left out three fields at once; it now leaves out only
   the claimed id. */
console.log('steam proxy routes: all assertions passed');
