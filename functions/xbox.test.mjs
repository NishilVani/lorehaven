/* Signing in with Xbox, and reading what an Xbox account has played.
 *
 * Microsoft, both Xbox Live hosts, titlehub, Google and Firestore are all
 * stubbed here, and the RSA key is made in this process and thrown away with
 * it, so nothing reaches the network and no real account, project or secret is
 * needed. Run: node functions/xbox.test.mjs
 */
import assert from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importSPKI, exportJWK } from 'jose';
import { authRoute, parseServiceAccount } from './auth.js';
import { shapeTitles, platformForDevices, productIdsOf, isAllowedRedirect, xstsProblem } from './xbox.js';

const PROJECT = 'testproject';
const XUID = '2533274800000001';
const OTHER_XUID = '2533274800000002';
const STEAMID = '76561197960287930';
const UID = 'existing_uid';
const SECRET = 'a-test-ticket-secret';
const REDIRECT = 'https://lorehaven.app/auth/xbox';
const doc = (provider, id) => `${provider}_${id}`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  client_email: 'worker@testproject.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  project_id: PROJECT,
};
const PEM_PUBLIC = publicKey.export({ type: 'spki', format: 'pem' });
const ENV = {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA),
  STEAM_TICKET_SECRET: SECRET,
  XBOX_CLIENT_ID: 'an-app-registration',
  XBOX_CLIENT_SECRET: 'a-client-secret',
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* One title as titlehub decorates it: a Store product id per availability, the
   devices it can run on, and when it was last played. */
const title = (over = {}) => ({
  titleId: '1234',
  name: 'Clair Obscur: Expedition 33',
  type: 'Game',
  devices: ['XboxSeriesX|S', 'XboxOne'],
  displayImage: 'https://store-images.example/clair.png',
  detail: { availabilities: [{ ProductId: '9PBLMX0KDKQS' }] },
  titleHistory: { lastTimePlayed: '2026-08-02T19:04:00Z' },
  ...over,
});

/* ── The world outside ── */
let world;
const reset = (over = {}) => {
  world = {
    calls: [],
    links: {},               // account_links: document id -> the account it signs in to
    claimAccepted: true,
    msError: null,           // what Microsoft's token endpoint refuses with
    xblFails: false,
    xsts: { xid: XUID, uhs: 'userhash', gtg: 'LoreHavenOwner' },
    xstsError: null,         // { status, XErr }
    titlehubStatus: 200,
    titles: [title()],
    user: { localId: UID, customAttributes: '{}', providerUserInfo: [{ providerId: 'password' }] },
    ...over,
  };
  return world;
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  world.calls.push(`${method} ${url.split('?')[0]}`);

  if (url.startsWith('https://login.microsoftonline.com/')) {
    world.lastTokenBody = String(init.body || '');
    return world.msError
      ? json(400, { error: world.msError })
      : json(200, { access_token: 'ms-access-token', token_type: 'Bearer' });
  }
  if (url.startsWith('https://user.auth.xboxlive.com/')) {
    world.userAuth = JSON.parse(String(init.body || '{}'));
    world.lastRps = world.userAuth?.Properties?.RpsTicket;
    return world.xblFails
      ? json(401, { error: 'no' })
      : json(200, { Token: 'xbl-user-token', DisplayClaims: { xui: [{ uhs: 'userhash' }] } });
  }
  if (url.startsWith('https://xsts.auth.xboxlive.com/')) {
    world.xstsAsked = JSON.parse(String(init.body || '{}'));
    if (world.xstsError) return json(world.xstsError.status, { XErr: world.xstsError.XErr });
    return json(200, { Token: 'xsts-token', DisplayClaims: { xui: [world.xsts] } });
  }
  if (url.startsWith('https://titlehub.xboxlive.com/')) {
    world.titlehubAuth = init.headers?.authorization;
    return world.titlehubStatus === 200
      ? json(200, { titles: world.titles })
      : json(world.titlehubStatus, { error: 'no' });
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
    const [provider, externalId] = [id.slice(0, id.indexOf('_')), id.slice(id.indexOf('_') + 1)];
    if (method === 'GET') {
      return world.links[id]
        ? json(200, { fields: { uid: { stringValue: world.links[id] }, provider: { stringValue: provider }, externalId: { stringValue: externalId } } })
        : json(404, { error: { message: 'not found' } });
    }
    if (method === 'PATCH') {
      if (!world.claimAccepted || world.links[id]) return json(409, { error: { message: 'exists' } });
      world.links[id] = JSON.parse(String(init.body)).fields.uid.stringValue;
      return json(200, {});
    }
    if (method === 'DELETE') { delete world.links[id]; return json(200, {}); }
  }
  if (url.endsWith('/documents:runQuery')) {
    const uid = JSON.parse(String(init.body)).structuredQuery.where.fieldFilter.value.stringValue;
    return json(200, Object.entries(world.links).filter(([, owner]) => owner === uid).map(([id]) => ({
      document: {
        fields: {
          provider: { stringValue: id.slice(0, id.indexOf('_')) },
          externalId: { stringValue: id.slice(id.indexOf('_') + 1) },
          label: { stringValue: id.startsWith('xbox_') ? 'LoreHavenOwner' : 'GabeN' },
        },
      },
    })));
  }
  if (url.includes('/accounts:lookup')) return json(200, { users: [world.user] });
  if (url.includes('/accounts:update')) {
    world.user.customAttributes = JSON.parse(String(init.body)).customAttributes;
    return json(200, {});
  }
  if (url.endsWith(`/projects/${PROJECT}/accounts`)) {
    world.created = JSON.parse(String(init.body));
    return json(200, { localId: world.created.localId });
  }
  throw new Error(`the test reached something it does not stub: ${method} ${url}`);
};

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (action, body = {}, headers = {}, env = ENV) =>
  authRoute(action, new Request('https://worker.test/auth/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }), env, respond);
const read = async (res) => ({ status: res.status, body: await res.json() });

const idToken = async (uid = UID) => new SignJWT({ user_id: uid })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' })
  .setIssuer(`https://securetoken.google.com/${PROJECT}`)
  .setAudience(PROJECT)
  .setSubject(uid)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(await importPKCS8Key());

let cachedKey = null;
async function importPKCS8Key() {
  if (!cachedKey) {
    const { importPKCS8 } = await import('jose');
    cachedKey = await importPKCS8(SA.private_key, 'RS256');
  }
  return cachedKey;
}

const ticketFor = (externalId, label = null, provider = 'xbox') =>
  new SignJWT({ provider, externalId, label })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('lorehaven').setAudience('account-link')
    .setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(SECRET));

const signIn = (over = {}) => call('xbox/signin', { code: 'a-code', verifier: 'a-verifier', redirectUri: REDIRECT, ...over });

/* ── Reading titlehub, with nothing running ── */
{
  assert.strictEqual(platformForDevices(['XboxOne', 'Win32']), 'Xbox One', 'the newest console a title runs on wins');
  assert.strictEqual(platformForDevices(['Win32']), 'PC', 'and a PC-only title is a PC title');
  assert.strictEqual(platformForDevices([]), null, 'a title that says nothing gets no platform rather than a guessed one');
  assert.strictEqual(platformForDevices(['Nintendo64']), 'Xbox', 'a device this does not know still came from Xbox');

  assert.deepStrictEqual(
    productIdsOf({ detail: { availabilities: [{ ProductId: 'A' }, { ProductId: 'B' }, { ProductId: 'A' }] } }),
    ['A', 'B'],
    'every Store id a title carries, each once -- Resident Evil 3 has two and IGDB holds the second',
  );
}

{
  const rows = shapeTitles([
    title(),
    title({ titleId: '5678', name: 'Netflix', type: 'App' }),
    title({ titleId: '9999', name: '   ' }),
  ]);
  assert.strictEqual(rows.length, 1, 'apps and nameless rows are not games and do not reach a library');
  assert.deepStrictEqual(rows[0], {
    titleId: '1234',
    name: 'Clair Obscur: Expedition 33',
    productIds: ['9PBLMX0KDKQS'],
    platform: 'Xbox Series X|S',
    lastPlayed: '2026-08-02T19:04:00Z',
    image: 'https://store-images.example/clair.png',
  });
}

{
  /* The same game, once per generation it was played on. */
  const rows = shapeTitles([
    title({ devices: ['XboxOne'], detail: { availabilities: [{ ProductId: 'ONE' }] }, titleHistory: { lastTimePlayed: '2024-01-01T00:00:00Z' }, displayImage: null }),
    title({ devices: ['XboxSeriesX|S'], detail: { availabilities: [{ ProductId: 'SERIES' }] }, titleHistory: { lastTimePlayed: '2026-05-05T00:00:00Z' } }),
  ]);
  assert.strictEqual(rows.length, 1, 'one game, one row');
  assert.deepStrictEqual(rows[0].productIds, ['ONE', 'SERIES'], 'holding every id either entry knew, so the IGDB match has both to try');
  assert.strictEqual(rows[0].platform, 'Xbox Series X|S', 'under the newest console it ran on');
  assert.strictEqual(rows[0].lastPlayed, '2026-05-05T00:00:00Z', 'and the later of the two times it was played');
  assert.ok(rows[0].image, 'and whichever entry had the artwork');
}

{
  assert.ok(isAllowedRedirect('http://localhost:5173/auth/xbox'), 'the dev server is one of ours');
  assert.ok(!isAllowedRedirect('https://evil.example/auth/xbox'), 'and nothing else is');
  assert.ok(!isAllowedRedirect(''), 'including nothing at all');
  assert.match(xstsProblem(2148916238), /child account/, 'every XSTS refusal names what to do about it');
  assert.strictEqual(xstsProblem(1), null, 'and one it does not know gets the general sentence instead');
}

/* ── Where a sign-in starts ── */
{
  reset();
  const challenge = 'a'.repeat(43);
  const { status, body } = await read(await call('xbox/start', { redirectUri: REDIRECT, challenge, state: 'some-state' }));
  assert.strictEqual(status, 200);
  const url = new URL(body.url);
  assert.strictEqual(url.origin + url.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), 'an-app-registration', 'the app never holds the client id; this is where it comes from');
  assert.strictEqual(url.searchParams.get('code_challenge'), challenge);
  assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.strictEqual(url.searchParams.get('scope'), 'XboxLive.signin', 'nothing but the sign-in scope: there is no refresh token to want');
  assert.strictEqual(url.searchParams.get('prompt'), 'select_account', 'so a second Xbox account can be linked at all');
  assert.ok(!body.url.includes('a-client-secret'), 'and the secret never leaves the Worker');
}

{
  reset();
  const { status, body } = await read(await call('xbox/start', { redirectUri: 'https://evil.example/auth/xbox', challenge: 'a'.repeat(43), state: 's' }));
  assert.strictEqual(status, 400, 'a start for another site is refused here too, not only at the return');
  assert.match(body.error, /another site/);
}

{
  reset();
  const { status } = await read(await call('xbox/start', { redirectUri: REDIRECT, challenge: 'too-short', state: 's' }));
  assert.strictEqual(status, 400, 'a challenge that is not a SHA-256 is not a challenge');
}

{
  reset();
  const { status } = await read(await call('xbox/start', { redirectUri: REDIRECT, challenge: 'a'.repeat(43), state: 'has spaces and &symbols' }));
  assert.strictEqual(status, 400, 'and nothing may write extra parameters into the address through the state');
}

{
  reset();
  const { status } = await read(await call('steam/start', { redirectUri: REDIRECT }));
  assert.strictEqual(status, 404, 'Steam builds its own sign-in address and needs nothing from here');
}

/* ── Signing in ── */
{
  reset();
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'unlinked', 'an Xbox account nobody has linked cannot sign anybody in');
  assert.strictEqual(body.xuid, XUID);
  assert.strictEqual(body.gamertag, 'LoreHavenOwner', 'the gamertag comes back, for the new account to start with');
  assert.ok(body.ticket && !body.token, 'a ticket for the choice screen, and no sign-in token');
  assert.match(world.lastRps, /^d=ms-access-token$/, 'Xbox Live is handed the Microsoft token as an RPS ticket');
  assert.match(world.lastTokenBody, /code_verifier=a-verifier/, 'and the code is redeemed with the verifier the app kept');
  assert.match(world.lastTokenBody, /client_secret=a-client-secret/, 'and the secret only the Worker holds');

  /* The two relying parties are not interchangeable, and getting one wrong
     yields a token that fails a step later, or one titlehub refuses. */
  assert.strictEqual(world.userAuth.RelyingParty, 'http://auth.xboxlive.com', 'the user token is asked of the user-auth relying party');
  assert.strictEqual(world.xstsAsked.RelyingParty, 'http://xboxlive.com', 'and the XSTS token of Xbox Live itself');
  assert.strictEqual(world.xstsAsked.Properties.SandboxId, 'RETAIL', 'in the retail sandbox, which is where real accounts live');
  assert.deepStrictEqual(world.xstsAsked.Properties.UserTokens, ['xbl-user-token'], 'carrying the user token the step before produced');
}

{
  reset({ links: { [doc('xbox', XUID)]: UID } });
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'signed-in');
  assert.ok(body.token, 'a linked Xbox account signs straight in');
}

{
  reset();
  const { status, body } = await read(await signIn({ redirectUri: 'https://evil.example/auth/xbox' }));
  assert.strictEqual(status, 400, 'a code meant for another site is refused');
  assert.match(body.error, /another site/);
  assert.ok(!world.calls.some(c => c.includes('login.microsoftonline.com')), 'and Microsoft is never asked to redeem it');
}

{
  reset({ msError: 'invalid_grant' });
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 400, 'a code used twice is the person\'s to fix, not a server fault');
  assert.match(body.error, /expired/);
}

{
  reset({ msError: 'server_error' });
  const { status } = await read(await signIn());
  assert.strictEqual(status, 502, 'and Microsoft failing is not');
}

{
  reset({ xblFails: true });
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 502);
  assert.match(body.error, /Xbox Live/);
}

for (const [XErr, wording] of [[2148916233, /no Xbox profile/], [2148916238, /child account/], [2148916235, /country or region/]]) {
  reset({ xstsError: { status: 401, XErr } });
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 403, 'an account Xbox Live will not authorise is a fact about the account, not a failure');
  assert.match(body.error, wording);
}

{
  reset({ xstsError: { status: 500, XErr: 999 } });
  const { status, body } = await read(await signIn());
  assert.strictEqual(status, 502, 'an XSTS failure this does not recognise is a server problem');
  assert.match(body.error, /would not authorise/);
}

{
  reset({ xsts: { uhs: 'userhash', gtg: 'NoXuid' } });
  const { status } = await read(await signIn());
  assert.strictEqual(status, 502, 'a sign-in that names no account is no sign-in');
}

{
  reset();
  const { status, body } = await read(await call('xbox/signin', { code: 'a-code', verifier: 'v', redirectUri: REDIRECT }, {}, { ...ENV, XBOX_CLIENT_SECRET: '' }));
  assert.strictEqual(status, 503, 'without its secrets the Xbox side says so rather than half-working');
  assert.match(body.error, /not configured/);
}

/* ── The account, and the link ── */
{
  reset();
  const { status, body } = await read(await call('xbox/create', { ticket: await ticketFor(XUID, 'LoreHavenOwner') }));
  assert.strictEqual(status, 200);
  assert.strictEqual(world.links[doc('xbox', XUID)], body.uid, 'the Xbox account now reaches the new LoreHaven account');
  assert.match(body.uid, /^xbox_/, 'whose id says where it came from');
  assert.strictEqual(world.created.displayName, 'LoreHavenOwner', 'and which starts under the gamertag');
  assert.ok(body.token, 'and it is signed in');
}

{
  reset();
  const { status, body } = await read(await call('xbox/create', { ticket: await ticketFor(STEAMID, 'GabeN', 'steam') }));
  assert.strictEqual(status, 400, 'a Steam ticket cannot be spent on the Xbox route');
  assert.match(body.error, /expired/);
  assert.deepStrictEqual(world.links, {}, 'and nothing is linked by the attempt');
}

{
  reset({ links: { [doc('xbox', XUID)]: 'somebody_else' } });
  const { status, body } = await read(await call('xbox/create', { ticket: await ticketFor(XUID) }));
  assert.strictEqual(status, 409, 'an Xbox account already linked cannot start a second account');
  assert.match(body.error, /already linked/);
  assert.strictEqual(world.links[doc('xbox', XUID)], 'somebody_else', 'and the link it had is untouched');
}

{
  reset();
  const { status, body } = await read(await call('xbox/link', { ticket: await ticketFor(XUID, 'LoreHavenOwner') }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.strictEqual(world.links[doc('xbox', XUID)], UID);
  assert.deepStrictEqual(body.xuids, [XUID], 'the answer lists the Xbox accounts this LoreHaven account now holds');
  assert.deepStrictEqual(JSON.parse(world.user.customAttributes).links.xbox, [XUID], 'and the account carries them on its own token');
}

{
  reset({ links: { [doc('xbox', XUID)]: 'another_account' } });
  const { status, body } = await read(await call('xbox/link', { ticket: await ticketFor(XUID) }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 409, 'one Xbox account, one LoreHaven account');
  assert.match(body.error, /another LoreHaven account/);
}

{
  reset({ links: { [doc('xbox', XUID)]: UID, [doc('steam', STEAMID)]: UID } });
  const { status, body } = await read(await call('xbox/accounts', {}, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.accounts, [{ xuid: XUID, name: 'LoreHavenOwner' }], 'the Xbox list holds Xbox accounts only');
}

{
  reset({ links: { [doc('xbox', XUID)]: UID } });
  const { status } = await read(await call('xbox/accounts', {}, {}));
  assert.strictEqual(status, 401, 'and nobody reads it without being signed in');
}

/* ── Unlinking ── */
{
  reset({ links: { [doc('xbox', XUID)]: UID, [doc('xbox', OTHER_XUID)]: UID } });
  const { status, body } = await read(await call('xbox/unlink', { xuid: XUID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.xuids, [OTHER_XUID], 'the one named is gone and the other stays');
  assert.ok(!world.links[doc('xbox', XUID)]);
}

{
  /* The last way in counts every service, not just this one. */
  reset({
    links: { [doc('xbox', XUID)]: UID, [doc('steam', STEAMID)]: UID },
    user: { localId: UID, customAttributes: '{}', providerUserInfo: [] },
  });
  const { status } = await read(await call('xbox/unlink', { xuid: XUID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 200, 'an account with no password may still unlink one of two ways in');
  assert.strictEqual(world.links[doc('steam', STEAMID)], UID);
}

{
  reset({
    links: { [doc('xbox', XUID)]: UID },
    user: { localId: UID, customAttributes: '{}', providerUserInfo: [] },
  });
  const { status, body } = await read(await call('xbox/unlink', { xuid: XUID }, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 400, 'but not the last one, which would lock it out of itself');
  assert.match(body.error, /no way back in/);
  assert.strictEqual(world.links[doc('xbox', XUID)], UID, 'and the link stays');
}

{
  reset({ links: { [doc('xbox', XUID)]: UID, [doc('xbox', OTHER_XUID)]: UID } });
  const { status, body } = await read(await call('xbox/unlink', {}, { authorization: `Bearer ${await idToken()}` }));
  assert.strictEqual(status, 400, 'with two linked, which one to remove is not this code\'s to guess');
  assert.match(body.error, /which Xbox account/);
}

/* ── What the account has played ── */
{
  reset();
  const { status, body } = await read(await call('xbox/library', { code: 'a-code', verifier: 'v', redirectUri: REDIRECT }));
  assert.strictEqual(status, 200);
  assert.strictEqual(body.xuid, XUID);
  assert.strictEqual(body.gamertag, 'LoreHavenOwner');
  assert.strictEqual(body.titles.length, 1);
  assert.deepStrictEqual(body.titles[0].productIds, ['9PBLMX0KDKQS'], 'the Store id IGDB matches on comes through');
  assert.strictEqual(world.titlehubAuth, 'XBL3.0 x=userhash;xsts-token', 'titlehub is read with the XSTS token and the user hash');
  assert.ok(!Object.keys(world.links).length, 'and reading a library links nothing and needs no account');
}

{
  reset({ titlehubStatus: 503 });
  const { status, body } = await read(await call('xbox/library', { code: 'a-code', verifier: 'v', redirectUri: REDIRECT }));
  assert.strictEqual(status, 502, 'titlehub is undocumented: when it stops answering the import says so');
  assert.match(body.error, /played/);
}

{
  reset();
  const { status } = await read(await call('steam/library', { }));
  assert.strictEqual(status, 404, 'Steam has no library route here -- its library is public and functions/steam.js reads it');
}

{
  reset();
  const { status } = await read(await call('nintendo/signin', {}));
  assert.strictEqual(status, 404, 'and a service nobody has built is not a half-built one');
}

/* Nothing above may have reached the service account's own key path unguarded. */
assert.ok(parseServiceAccount(ENV.FIREBASE_SERVICE_ACCOUNT).project_id === PROJECT);

console.log('xbox sign-in routes: all assertions passed');
