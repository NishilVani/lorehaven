/* The Steam sign-in routes, with Steam, Google and Firestore stubbed.
 *
 * The RSA key is generated here and thrown away with the process, so no real
 * service account, Firebase project or Steam key is needed, and nothing in this
 * file reaches the network. Run: node functions/auth.test.mjs
 */
import assert from 'node:assert';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportJWK } from 'jose';
import {
  authRoute, parseServiceAccount, stateFromReturnTo, verifierMatches,
  claimedIds, hasPassword,
} from './auth.js';

const PROJECT = 'testproject';
const STEAMID = '76561197960287930';
const UID = 'existing_uid';
const SECRET = 'a-test-ticket-secret';
const OTHER_STEAMID = '76561198000000001';
const doc = (steamid) => `steam_${steamid}`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM_PRIVATE = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PEM_PUBLIC = publicKey.export({ type: 'spki', format: 'pem' });
const SA = {
  client_email: 'worker@testproject.iam.gserviceaccount.com',
  private_key: PEM_PRIVATE,
  project_id: PROJECT,
};
const ENV = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA),
  STEAM_TICKET_SECRET: SECRET,
  STEAM_API_KEY: 'steamkey',
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const assertion = (overrides = {}) => ({
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAMID}`,
  'openid.identity': `https://steamcommunity.com/openid/id/${STEAMID}`,
  'openid.return_to': 'https://lorehaven.app/auth/steam',
  'openid.response_nonce': '2026-09-16T10:00:00Zabc',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce',
  'openid.sig': 'c2ln',
  ...overrides,
});

/* ── The world outside ── */
let world;
const reset = (over = {}) => {
  world = {
    calls: [],
    links: {},             // account_links: document id -> the account it signs in to
    claimAccepted: true,   // whether the precondition write succeeds
    steamValid: true,
    user: { localId: UID, customAttributes: '{}', providerUserInfo: [{ providerId: 'password' }] },
    createFails: false,
    ...over,
  };
  return world;
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  world.calls.push(`${method} ${url.split('?')[0]}`);

  if (url.startsWith('https://steamcommunity.com/openid/login')) {
    return new Response(world.steamValid ? 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n' : 'is_valid:false\n', { status: 200 });
  }
  if (url.startsWith('https://api.steampowered.com/ISteamUser/GetPlayerSummaries')) {
    return json(200, { response: { players: [{ personaname: 'GabeN' }] } });
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return json(200, { access_token: 'google-access-token', expires_in: 3600 });
  }
  if (url.includes('/service_accounts/v1/jwk/securetoken')) {
    const jwk = await exportJWK(await importSPKI(PEM_PUBLIC, 'RS256'));
    return json(200, { keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] });
  }
if (url.includes('/documents/account_links/')) {
    const id = decodeURIComponent(url.split('/documents/account_links/')[1].split('?')[0]);
    if (method === 'GET') {
      return world.links[id]
        ? json(200, { fields: { uid: { stringValue: world.links[id] }, provider: { stringValue: 'steam' }, externalId: { stringValue: id.slice('steam_'.length) } } })
        : json(404, { error: { message: 'not found' } });
    }
    if (method === 'PATCH') {
      assert.ok(url.includes('currentDocument.exists=false'), 'a link is only ever written when there is none');
      if (!world.claimAccepted || world.links[id]) return json(409, { error: { message: 'already exists' } });
      world.links[id] = JSON.parse(init.body).fields.uid.stringValue;
      return json(200, {});
    }
    if (method === 'DELETE') { delete world.links[id]; return json(200, {}); }
  }
  if (url.endsWith('/documents:runQuery')) {
    const wanted = JSON.parse(init.body).structuredQuery.where.fieldFilter.value.stringValue;
    return json(200, Object.entries(world.links)
      .filter(([, owner]) => owner === wanted)
      .map(([id, owner]) => ({
        document: {
          name: id,
          fields: { uid: { stringValue: owner }, provider: { stringValue: 'steam' }, externalId: { stringValue: id.slice('steam_'.length) } },
        },
      })));
  }
  if (url.endsWith('/accounts:lookup')) return json(200, { users: world.user ? [world.user] : [] });
  if (url.endsWith('/accounts:update')) {
    world.user = { ...world.user, customAttributes: JSON.parse(init.body).customAttributes };
    return json(200, {});
  }
  if (url.endsWith(`/projects/${PROJECT}/accounts`)) {
    if (world.createFails) return json(500, { error: { message: 'no' } });
    world.created = JSON.parse(init.body);
    return json(200, { localId: world.created.localId });
  }
  throw new Error(`unexpected call: ${method} ${url}`);
};

const call = (action, body = {}, headers = {}) => authRoute(
  action,
  new Request('https://proxy.test/auth/' + action, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  ENV,
  json,
);
const read = async (res) => ({ status: res.status, body: await res.json() });

const idToken = async (uid = UID, over = {}) => new SignJWT({ user_id: uid, ...over })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' })
  .setIssuer(`https://securetoken.google.com/${PROJECT}`)
  .setAudience(PROJECT)
  .setSubject(uid)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(await importPKCS8(PEM_PRIVATE, 'RS256'));

/* ── The service account ── */
assert.throws(() => parseServiceAccount('not json'), /not JSON/);
assert.throws(() => parseServiceAccount('{"client_email":"a","project_id":"b"}'), /private_key/);
assert.strictEqual(parseServiceAccount(JSON.stringify({ ...SA, private_key: 'a\\nb' })).private_key, 'a\nb',
  'a PEM stored through a shell arrives with its line breaks escaped');
assert.strictEqual(parseServiceAccount(` ${JSON.stringify(SA)}\n`).project_id, PROJECT, 'a trailing newline from wrangler is trimmed');

/* ── An app sign-in is tied to the app that began it ── */
assert.strictEqual(stateFromReturnTo('https://lorehaven.web.app/auth/steam/app?state=abc'), 'abc');
assert.strictEqual(stateFromReturnTo('not a url'), null);
assert.strictEqual(await verifierMatches('hello', 'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ'), true);
assert.strictEqual(await verifierMatches('hello!', 'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ'), false);
assert.strictEqual(await verifierMatches(undefined, 'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ'), false);

/* ── Nothing works without the secrets ── */
{
  const res = await authRoute('steam/signin', new Request('https://proxy.test/auth/steam/signin', { method: 'POST', body: '{}' }), {}, json);
  const { status, body } = await read(res);
  assert.strictEqual(status, 503);
  assert.match(body.error, /not configured/);
}

/* ── Signing in ── */
{
  reset();
  const { status, body } = await read(await call('steam/signin', { params: assertion() }));
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'unlinked', 'a Steam account nobody has linked cannot sign anybody in');
  assert.strictEqual(body.steamid, STEAMID);
  assert.strictEqual(body.personaName, 'GabeN', 'the Steam name comes back, for the new account to start with');
  const { payload } = await jwtVerify(body.ticket, new TextEncoder().encode(SECRET), { issuer: 'lorehaven', audience: 'steam-link' });
  assert.strictEqual(payload.steamid, STEAMID, 'the ticket carries the Steam account through the choice screen');
  assert.ok(!body.token, 'and no sign-in token is handed out');
}

{
  reset({ links: { [doc(STEAMID)]: UID } });
  const { status, body } = await read(await call('steam/signin', { params: assertion() }));
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'signed-in');
  const { payload } = await jwtVerify(body.token, createPublicKey(PEM_PUBLIC), {
    audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    issuer: SA.client_email,
  });
  assert.strictEqual(payload.uid, UID, 'the token signs in the account the Steam id is linked to');
  assert.deepStrictEqual(payload.claims, { steamid: STEAMID }, 'and carries the Steam id as a claim');
}

{
  reset();
  const { status, body } = await read(await call('steam/signin', { params: assertion({ 'openid.return_to': 'https://evil.example/auth/steam' }) }));
  assert.strictEqual(status, 400, 'an assertion Steam signed for another site is refused');
  assert.match(body.error, /another site/);
  assert.ok(!world.calls.some(c => c.includes('steamcommunity.com')), 'and Steam is never asked about it');
}

{
  reset({ steamValid: false });
  const { status } = await read(await call('steam/signin', { params: assertion() }));
  assert.strictEqual(status, 401, 'Steam itself has the last word on whether a sign-in is real');
}

{
  /* An app sign-in: Steam signed a state, so the verifier behind it must be shown. */
  reset();
  const params = assertion({ 'openid.return_to': 'https://lorehaven.web.app/auth/steam/app?state=LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ' });
  const without = await read(await call('steam/signin', { params }));
  assert.strictEqual(without.status, 400, 'without the verifier, whoever caught the link gets nothing');
  assert.match(without.error || without.body.error, /started somewhere else/);
  const with_ = await read(await call('steam/signin', { params, verifier: 'hello' }));
  assert.strictEqual(with_.status, 200, 'the app that kept the verifier finishes its own sign-in');
}

/* ── A new account from Steam ── */
{
  reset();
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  const { status, body } = await read(await call('steam/create', { ticket }));
  assert.strictEqual(status, 200);
  assert.ok(body.uid.startsWith('steam_'), 'the account id is ours, not Steam\'s');
  assert.strictEqual(world.links[doc(STEAMID)], body.uid, 'the Steam account is now linked to it');
  assert.strictEqual(world.created.displayName, 'GabeN', 'and the account starts with the Steam name');
  assert.deepStrictEqual(JSON.parse(world.user.customAttributes).links, { steam: [STEAMID] }, 'the account records its Steam accounts');
  const { payload } = await jwtVerify(body.token, createPublicKey(PEM_PUBLIC), {
    audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    issuer: SA.client_email,
  });
  assert.strictEqual(payload.uid, body.uid);
}

{
  reset({ links: { [doc(STEAMID)]: 'somebody_else' } });
  const ticket = await new SignJWT({ steamid: STEAMID, personaName: 'GabeN' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('lorehaven').setAudience('steam-link')
    .setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));
  const { status, body } = await read(await call('steam/create', { ticket }));
  assert.strictEqual(status, 409, 'a Steam account already linked cannot start a second account');
  assert.match(body.error, /already linked/);
  assert.strictEqual(world.links[doc(STEAMID)], 'somebody_else', 'and the link it had is untouched');
}

{
  reset({ createFails: true });
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  await assert.rejects(call('steam/create', { ticket }), 'the proxy turns a Firebase failure into its 502');
  assert.strictEqual(world.links[doc(STEAMID)], undefined,
    'a link with no account behind it would lock its owner out, so it is taken back');
}

{
  /* Two taps on Create Account, or a link landing first: Firestore refuses the
     second write, and the loser must be told, not handed the account. */
  reset({ claimAccepted: false });
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  const { status, body } = await read(await call('steam/create', { ticket }));
  assert.strictEqual(status, 409, 'losing the race to claim a Steam account creates nothing');
  assert.match(body.error, /already linked/);
  assert.strictEqual(world.created, undefined, 'and no account is left behind');
}

{
  reset();
  const { status, body } = await read(await call('steam/create', { ticket: 'not-a-ticket' }));
  assert.strictEqual(status, 400);
  assert.match(body.error, /expired/);
}

/* ── Linking an account that already exists ── */
{
  reset();
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  const { status, body } = await read(await call('steam/link', { ticket }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(body.steamid, STEAMID);
  assert.strictEqual(world.links[doc(STEAMID)], UID, 'the Steam account now points at the signed-in account');
  assert.deepStrictEqual(JSON.parse(world.user.customAttributes).links, { steam: [STEAMID] });
}

{
  reset();
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  const { status } = await read(await call('steam/link', { ticket }));
  assert.strictEqual(status, 401, 'linking needs the person to be signed in to LoreHaven');
  assert.deepStrictEqual(world.links, {});
}

{
  /* Two Steam accounts on one LoreHaven account -- a main and a family one --
     is an ordinary thing to want, not a conflict. */
  reset({ links: { [doc(STEAMID)]: UID } });
  const second = await new SignJWT({ steamid: OTHER_STEAMID, personaName: 'Second' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('lorehaven').setAudience('steam-link')
    .setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));
  const { status, body } = await read(await call('steam/link', { ticket: second }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(world.links[doc(OTHER_STEAMID)], UID, 'the second Steam account is linked too');
  assert.strictEqual(world.links[doc(STEAMID)], UID, 'and the first is still there');
  assert.deepStrictEqual(body.steamids.sort(), [STEAMID, OTHER_STEAMID].sort(), 'the answer lists both');
  assert.deepStrictEqual(JSON.parse(world.user.customAttributes).links.steam.sort(), [STEAMID, OTHER_STEAMID].sort());
}

{
  /* The account linked is the one the token names, not whichever account the
     stubs happen to hold. */
  reset({ user: { localId: 'someone_else', customAttributes: '{}', providerUserInfo: [{ providerId: 'password' }] } });
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  const { status } = await read(await call('steam/link', { ticket }, { authorization: `Bearer ${await idToken('someone_else')}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(world.links[doc(STEAMID)], 'someone_else', 'the Steam account points at the signed-in account, whoever that is');
}

{
  reset({ links: { [doc(STEAMID)]: UID } });
  const ticket = (await (await call('steam/signin', { params: assertion() })).json()).ticket;
  assert.strictEqual(ticket, undefined, 'a linked Steam account signs in instead of handing out a ticket');
}

{
  reset({ links: { [doc(STEAMID)]: 'another_account' } });
  const ticket = await new SignJWT({ steamid: STEAMID })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('lorehaven').setAudience('steam-link')
    .setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));
  const { status, body } = await read(await call('steam/link', { ticket }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 409, 'one Steam account, one LoreHaven account');
  assert.match(body.error, /another LoreHaven account/);
  assert.strictEqual(world.links[doc(STEAMID)], 'another_account');
}

{
  reset({ links: { [doc(STEAMID)]: UID } });
  const again = await new SignJWT({ steamid: STEAMID, personaName: 'GabeN' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('lorehaven').setAudience('steam-link')
    .setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));
  const { status, body } = await read(await call('steam/link', { ticket: again }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200, 'linking the same Steam account again changes nothing and says so');
  assert.deepStrictEqual(body.steamids, [STEAMID]);
}

/* ── Unlinking ── */
{
  reset({ links: { [doc(STEAMID)]: UID }, user: { localId: UID, customAttributes: JSON.stringify({ links: { steam: [STEAMID] } }), providerUserInfo: [{ providerId: 'password' }] } });
  const { status, body } = await read(await call('steam/unlink', { steamid: STEAMID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(body.unlinked, true);
  assert.strictEqual(world.links[doc(STEAMID)], undefined, 'the link is gone');
  assert.strictEqual(JSON.parse(world.user.customAttributes).links, undefined, 'and so is the account\'s record of it');
}

{
  /* Named, because there may be several. The one not named stays. */
  reset({
    links: { [doc(STEAMID)]: UID, [doc(OTHER_STEAMID)]: UID },
    user: { localId: UID, customAttributes: JSON.stringify({ links: { steam: [STEAMID, OTHER_STEAMID] } }), providerUserInfo: [{ providerId: 'password' }] },
  });
  const { status, body } = await read(await call('steam/unlink', { steamid: OTHER_STEAMID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(world.links[doc(OTHER_STEAMID)], undefined);
  assert.strictEqual(world.links[doc(STEAMID)], UID, 'the other Steam account is untouched');
  assert.deepStrictEqual(body.steamids, [STEAMID]);
}

{
  /* An account that signs in only with Steam may still drop one of two. */
  reset({
    links: { [doc(STEAMID)]: UID, [doc(OTHER_STEAMID)]: UID },
    user: { localId: UID, customAttributes: JSON.stringify({ links: { steam: [STEAMID, OTHER_STEAMID] } }), providerUserInfo: [] },
  });
  const { status } = await read(await call('steam/unlink', { steamid: OTHER_STEAMID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200, 'the first Steam account is still a way in');
  assert.strictEqual(world.links[doc(STEAMID)], UID);
}

{
  reset({
    links: { [doc(STEAMID)]: UID },
    user: { localId: UID, customAttributes: JSON.stringify({ links: { steam: [STEAMID] } }), providerUserInfo: [{ providerId: 'password' }] },
  });
  const { status, body } = await read(await call('steam/unlink', { steamid: OTHER_STEAMID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 400, 'a Steam account this LoreHaven account never held cannot be unlinked');
  assert.match(body.error, /not linked to this account/);
  assert.strictEqual(world.links[doc(STEAMID)], UID);
}

{
  reset({ links: { [doc(STEAMID)]: UID }, user: { localId: UID, customAttributes: JSON.stringify({ links: { steam: [STEAMID] } }), providerUserInfo: [] } });
  const { status, body } = await read(await call('steam/unlink', { steamid: STEAMID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 400, 'an account with no password and no other link would have no way back in');
  assert.match(body.error, /email and password/);
  assert.strictEqual(world.links[doc(STEAMID)], UID, 'so the link stays');
}

{
  reset({ user: { localId: UID, customAttributes: '{}', providerUserInfo: [{ providerId: 'password' }] } });
  const { status, body } = await read(await call('steam/unlink', {}, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 400, 'with nothing linked there is nothing to name');
  assert.match(body.error, /which Steam account/);
}

{
  reset();
  const { status } = await read(await call('steam/unlink', {}));
  assert.strictEqual(status, 401);
}

/* ── An unsigned or foreign ID token is not a sign-in ── */
{
  reset();
  const foreign = await new SignJWT({ user_id: 'someone' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://securetoken.google.com/another-project')
    .setAudience('another-project')
    .setIssuedAt().setExpirationTime('1h')
    .sign(await importPKCS8(PEM_PRIVATE, 'RS256'));
  const { status } = await read(await call('steam/unlink', {}, { authorization: `Bearer ${foreign}` }));
  assert.strictEqual(status, 401, 'a token minted for another Firebase project signs nobody in here');
}

/* ── Shapes ── */
assert.deepStrictEqual(claimedIds({ customAttributes: JSON.stringify({ links: { steam: [STEAMID] } }) }, 'steam'), [STEAMID]);
assert.deepStrictEqual(claimedIds({ customAttributes: JSON.stringify({ links: { steam: [STEAMID] } }) }, 'epic'), [], 'one service says nothing about another');
assert.deepStrictEqual(claimedIds({ customAttributes: 'not json' }, 'steam'), []);
assert.deepStrictEqual(claimedIds(null, 'steam'), []);
assert.strictEqual(hasPassword({ providerUserInfo: [{ providerId: 'password' }] }), true);
assert.strictEqual(hasPassword({ providerUserInfo: [{ providerId: 'google.com' }] }), false);
assert.strictEqual(hasPassword({}), false);

{
  reset();
  const { status } = await read(await call('steam/nothing'));
  assert.strictEqual(status, 404);
}

console.log('steam sign-in routes: all assertions passed');
