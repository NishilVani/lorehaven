/* The Xbox side of signing in: Microsoft's code, exchanged for a gamertag.
 *
 * Nothing here is stored. Each request runs the whole chain and throws every
 * token away at the end of it, which is why reading a library means signing in
 * again rather than reaching for a saved token. The only thing that outlives a
 * request is the link written by auth.js: which LoreHaven account an Xbox
 * account signs in to.
 *
 * The chain, four calls deep:
 *
 *   1. Microsoft's token endpoint turns the authorization code into an
 *      XboxLive.signin access token. PKCE: the verifier the app kept proves the
 *      code is being redeemed by whoever started the sign-in.
 *   2. user.auth.xboxlive.com turns that into an Xbox user token.
 *   3. XSTS turns the user token into a token for Xbox Live itself, and is the
 *      step that finally says who this is: XUID and gamertag.
 *   4. titlehub, only for an import, lists what the account has played.
 *
 * Step 4 is undocumented. It is what xbox.com's own "recently played" reads,
 * and Microsoft publishes no owned-games API at all, so it is this or nothing.
 * It can change without notice, which is why every read of it is defensive and
 * a failure says so plainly instead of showing an empty library.
 *
 * Pure enough to test: every function here takes what it needs and returns data,
 * and functions/xbox.test.mjs stubs fetch. Nothing reads process or env.
 */

const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const XBL_USER_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTHORIZE = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const TITLEHUB = 'https://titlehub.xboxlive.com';

/* Where Microsoft may send a sign-in back to. Unlike Steam, which signs one
   return address, Microsoft checks the address against the app registration --
   so this list exists to stop the Worker being used to redeem somebody else's
   code against a site that is not ours, not to stop Microsoft. It matches the
   three addresses registered in Entra. */
export const DEFAULT_REDIRECT_URIS = [
  'https://lorehaven.app/auth/xbox',
  'https://lorehaven.web.app/auth/xbox',
  'http://localhost:5173/auth/xbox',
];

export const isAllowedRedirect = (uri, allowed = DEFAULT_REDIRECT_URIS) =>
  !!uri && allowed.includes(String(uri));

/* What XSTS says when it will not issue a token. Each of these is a fact about
   the account rather than a fault in the sign-in, so each gets the sentence
   that says what to do about it. */
const XSTS_PROBLEMS = {
  2148916233: 'that Microsoft account has no Xbox profile. Create one at xbox.com, then sign in again',
  2148916235: 'Xbox Live is not available in that account\'s country or region',
  2148916236: 'that account needs adult verification before it can use Xbox Live',
  2148916237: 'that account needs adult verification before it can use Xbox Live',
  2148916238: 'that is a child account. An adult must add it to a family group before it can sign in',
};

export const xstsProblem = (xerr) => XSTS_PROBLEMS[Number(xerr)] || null;

/** Thrown where the chain stops, so a route can answer with the right status. */
export class XboxError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const postJson = (url, body, headers = {}) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
  body: JSON.stringify(body),
});

/* Where a sign-in starts. The app asks the Worker for this rather than holding
   the client id itself: the id is not a secret, but a shipped binary that holds
   one is a binary that has to be rebuilt to change it, and the app already
   holds nothing -- the IGDB credential moved here for the same reason.

   `prompt=select_account` because a person with two Microsoft accounts is
   exactly the person linking a second Xbox account, and without it Microsoft
   signs them straight back in as the one they used last. */
export function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'XboxLive.signin',
    code_challenge: String(challenge),
    code_challenge_method: 'S256',
    state: String(state),
    prompt: 'select_account',
  });
  return `${MS_AUTHORIZE}?${params}`;
}

/**
 * Step 1. The authorization code, the verifier that proves who started the
 * sign-in, and the client secret, for an access token good for one chain.
 */
export async function redeemCode({ clientId, clientSecret, code, verifier, redirectUri }) {
  const res = await fetch(MS_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code ?? ''),
      code_verifier: String(verifier ?? ''),
      redirect_uri: String(redirectUri ?? ''),
      grant_type: 'authorization_code',
      scope: 'XboxLive.signin',
    }).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    /* invalid_grant is the ordinary one: a code used twice, or one that sat too
       long. It is the person's to fix by starting again, not a server fault. */
    const expired = data?.error === 'invalid_grant';
    throw new XboxError(
      expired ? 'that Xbox sign-in has expired. Start it again' : 'Microsoft would not complete that sign-in',
      expired ? 400 : 502,
    );
  }
  return String(data.access_token);
}

/** Step 2. Microsoft's token, for an Xbox user token. */
export async function xboxUserToken(accessToken) {
  const res = await postJson(XBL_USER_AUTH, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${accessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }, { 'x-xbl-contract-version': '1' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.Token) throw new XboxError('Xbox Live would not accept that sign-in', 502);
  return String(data.Token);
}

/**
 * Step 3. The user token, for a token Xbox Live accepts -- and for the two
 * things this whole chain exists to learn: the XUID, which is the account, and
 * the gamertag, which is what its owner calls it.
 */
export async function xstsToken(userToken) {
  const res = await postJson(XSTS_AUTHORIZE, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'http://xboxlive.com',
    TokenType: 'JWT',
  }, { 'x-xbl-contract-version': '1' });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const problem = xstsProblem(data?.XErr);
    throw new XboxError(problem || 'Xbox Live would not authorise that account', problem ? 403 : 502);
  }
  const claims = data?.DisplayClaims?.xui?.[0] || {};
  const xuid = String(claims.xid || '');
  const uhs = String(claims.uhs || '');
  if (!xuid || !uhs || !data?.Token) throw new XboxError('Xbox Live named no account in that sign-in', 502);
  return { token: String(data.Token), uhs, xuid, gamertag: claims.gtg ? String(claims.gtg) : null };
}

/** Everything up to knowing who signed in, which is all a sign-in needs. */
export async function xboxIdentity({ clientId, clientSecret, code, verifier, redirectUri }) {
  const access = await redeemCode({ clientId, clientSecret, code, verifier, redirectUri });
  const user = await xboxUserToken(access);
  return xstsToken(user);
}

/* ── What the account has played ──
 *
 * titlehub answers with every title the account has ever launched, each with a
 * Microsoft Store product id where it has one -- 38 of 53 on the probe account.
 * That id is what IGDB knows a game by (external_games sources 11 and 54), so it
 * is the match; a title without one falls back to its name, and the app never
 * ticks a name match by itself.
 */
export async function titleHistory({ token, uhs, xuid }) {
  const res = await fetch(`${TITLEHUB}/users/xuid(${encodeURIComponent(xuid)})/titles/titlehistory/decoration/detail,image`, {
    headers: {
      authorization: `XBL3.0 x=${uhs};${token}`,
      'x-xbl-contract-version': '2',
      'accept-language': 'en-US',
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new XboxError('Xbox would not hand over what this account has played', 502);
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.titles)) throw new XboxError('Xbox answered with something this cannot read', 502);
  return data.titles;
}

/* The Xbox a title can run on, newest first, and PC last. titlehub's `devices`
   says where a title CAN run, never where it was played, so this is a default
   for the review to show and the person to correct, not a fact. */
const DEVICE_PLATFORM = [
  ['XboxSeriesX|S', 'Xbox Series X|S'],
  ['XboxSeries', 'Xbox Series X|S'],
  ['XboxOne', 'Xbox One'],
  ['Xbox360', 'Xbox 360'],
  ['Win32', 'PC'],
  ['PC', 'PC'],
];

const deviceRank = (devices) => {
  const list = (Array.isArray(devices) ? devices : []).map(d => String(d).toLowerCase());
  const at = DEVICE_PLATFORM.findIndex(([device]) => list.includes(device.toLowerCase()));
  return at === -1 ? (list.length ? DEVICE_PLATFORM.length : Infinity) : at;
};

export function platformForDevices(devices) {
  const rank = deviceRank(devices);
  if (rank === Infinity) return null;
  return DEVICE_PLATFORM[rank]?.[1] || 'Xbox';
}

/** Every Store product id on a title. Resident Evil 3 carries two; IGDB has the second. */
export const productIdsOf = (title) => [
  ...new Set(
    (title?.detail?.availabilities || [])
      .map(a => String(a?.ProductId || '').trim())
      .filter(Boolean),
  ),
];

/**
 * The titles, trimmed to what an import uses. Anything that is not a game is
 * dropped: titlehub lists apps -- Netflix, the Store itself -- the same way it
 * lists games, and a library is not the place for them.
 */
export function shapeTitles(titles) {
  const byTitle = new Map();
  for (const t of Array.isArray(titles) ? titles : []) {
    if (String(t?.type || '').toLowerCase() !== 'game') continue;
    const name = String(t?.name ?? '').trim();
    if (!name) continue;
    const titleId = String(t.titleId ?? '');
    const key = titleId || name.toLowerCase();
    const rank = deviceRank(t.devices);
    const row = {
      titleId,
      name,
      productIds: productIdsOf(t),
      platform: platformForDevices(t.devices),
      lastPlayed: t?.titleHistory?.lastTimePlayed || null,
      image: (t?.displayImage && String(t.displayImage)) || null,
      rank,
    };
    const had = byTitle.get(key);
    if (!had) { byTitle.set(key, row); continue; }
    /* The same game can arrive once per generation it runs on. They are one row:
       every product id either entry knows, the newest console of the two, and
       the later of the two times it was played. */
    had.productIds = [...new Set([...had.productIds, ...row.productIds])];
    if (row.rank < had.rank) { had.platform = row.platform; had.rank = row.rank; }
    if (!had.lastPlayed || (row.lastPlayed && row.lastPlayed > had.lastPlayed)) had.lastPlayed = row.lastPlayed;
    if (!had.image) had.image = row.image;
  }
  /* eslint-disable-next-line no-unused-vars -- rank is scaffolding for the merge */
  return [...byTitle.values()].map(({ rank, ...row }) => row);
}
