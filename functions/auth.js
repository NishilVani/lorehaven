/* Sign in to LoreHaven with an account somebody already has: Steam, or Xbox.
 *
 *   POST /auth/steam/signin   { params, verifier? }        -> { status, token | ticket }
 *   POST /auth/xbox/signin    { code, verifier, redirectUri }
 *                                                          -> { status, token | ticket }
 *   POST /auth/xbox/library   { code, verifier, redirectUri }
 *                                                          -> { xuid, gamertag, titles }
 *
 * and, the same for either service, with the provider naming which:
 *
 *   POST /auth/<provider>/create   { ticket }              -> { token, uid }
 *   POST /auth/<provider>/link     { ticket }  + Bearer id -> { <id>, <ids> }
 *   POST /auth/<provider>/unlink   { <id> }    + Bearer id -> { unlinked, <ids> }
 *   POST /auth/<provider>/accounts             + Bearer id -> { accounts }
 *
 * Only the sign-in differs between services, because only the sign-in is
 * theirs: Steam signs an OpenID assertion, Microsoft hands back a code to
 * redeem. Everything after "this is who it is" -- the link table, the account,
 * the claim, the last-way-in rule -- is one implementation taking a provider.
 *
 * Why the Worker and not the client: minting a Firebase sign-in token needs the
 * service-account key, and deciding which LoreHaven account a Steam account
 * belongs to must not be something a browser can claim. The client sends what
 * Steam signed; the Worker checks it with Steam, reads and writes the link
 * table, and hands back a token Firebase will accept.
 *
 * Which LoreHaven account an external account signs in to lives in Firestore as
 * account_links/{provider}_{externalId} -> { uid, provider, externalId, label,
 * linkedAt }. Only this code touches it: firestore.rules denies every client
 * read and write. A LoreHaven account may hold several of them -- two Steam
 * accounts, or Steam and something else later -- while each external account
 * signs in to exactly one LoreHaven account.
 */
import { SignJWT, jwtVerify, importPKCS8, createRemoteJWKSet } from 'jose';
import {
  STEAM_API, STEAM_OPENID_LOGIN, DEFAULT_RETURN_ORIGINS,
  openIdAssertionProblem, openIdCheckBody, isValidCheckResponse, steamIdFromClaimedId,
} from './steam.js';
import {
  DEFAULT_REDIRECT_URIS, isAllowedRedirect, XboxError, authorizeUrl, xboxIdentity, titleHistory, shapeTitles,
} from './xbox.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDENTITY_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const IDENTITY_API = 'https://identitytoolkit.googleapis.com/v1';
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit';

const TICKET_MINUTES = 10;
const LINKS = 'account_links';

/* Both secrets arrive through `wrangler secret put`, which keeps whatever the
   owner's shell piped in -- PowerShell adds a newline. */
const clean = (s) => String(s ?? '').trim();

/** The service-account JSON, checked for the three fields this code uses. */
export function parseServiceAccount(raw) {
  let sa;
  try { sa = JSON.parse(clean(raw)); } catch { throw new Error('the service account is not JSON'); }
  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (!sa?.[field]) throw new Error(`the service account has no ${field}`);
  }
  /* Stored through a shell, the PEM's line breaks often arrive escaped. */
  return { ...sa, private_key: String(sa.private_key).replace(/\\n/g, '\n') };
}

const keyCache = new Map();
const signingKey = async (sa) => {
  if (!keyCache.has(sa.client_email)) keyCache.set(sa.client_email, await importPKCS8(sa.private_key, 'RS256'));
  return keyCache.get(sa.client_email);
};

/**
 * A Firebase custom token: the thing signInWithCustomToken takes. Developer
 * claims ride along so the first ID token already carries the Steam id.
 */
export async function mintCustomToken(sa, uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ uid, ...(Object.keys(claims).length ? { claims } : {}) })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(IDENTITY_AUD)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await signingKey(sa));
}

/* One access token per isolate until it is nearly out of time: every route here
   makes at least one Google call, and re-minting per request would double them. */
let accessToken = { value: null, expires: 0, email: null };

export async function googleAccessToken(sa, now = Date.now()) {
  if (accessToken.value && accessToken.email === sa.client_email && accessToken.expires > now + 60_000) return accessToken.value;
  const seconds = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: SCOPES })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(seconds)
    .setExpirationTime(seconds + 3600)
    .sign(await signingKey(sa));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new Error('Google refused the service account');
  accessToken = { value: data.access_token, expires: now + (Number(data.expires_in) || 3600) * 1000, email: sa.client_email };
  return accessToken.value;
}

/* ── The link table, through Firestore's REST API ──
 *
 * One document per EXTERNAL account, keyed by it: account_links/steam_7656...,
 * and later epic_... or xbox_.... That way one Steam (or Epic, or Xbox) account
 * can never sign in to two LoreHaven accounts, while a LoreHaven account may
 * hold as many of them as its owner has -- two Steam accounts and an Epic one
 * are an ordinary case, not an error.
 */

const linkId = (provider, externalId) => `${provider}_${externalId}`;
const linkUrl = (sa, provider, externalId, query = '') =>
  `${FIRESTORE_API}/projects/${sa.project_id}/databases/(default)/documents/${LINKS}/${linkId(provider, externalId)}${query}`;

export async function readLink(sa, provider, externalId) {
  const res = await fetch(linkUrl(sa, provider, externalId), { headers: { authorization: `Bearer ${await googleAccessToken(sa)}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('the link table could not be read');
  const doc = await res.json().catch(() => null);
  const uid = doc?.fields?.uid?.stringValue;
  return uid ? { uid } : null;
}

/**
 * Writes the link only when that external account has none. Two taps on Create
 * Account, or a link racing a sign-in, leave one link and one loser: the
 * precondition fails and Firestore answers 409.
 */
export async function claimLink(sa, provider, externalId, uid, label = null) {
  const fields = {
    uid: { stringValue: uid },
    provider: { stringValue: provider },
    externalId: { stringValue: externalId },
    linkedAt: { timestampValue: new Date().toISOString() },
  };
  if (label) fields.label = { stringValue: label };
  const res = await fetch(linkUrl(sa, provider, externalId, '?currentDocument.exists=false'), {
    method: 'PATCH',
    headers: { authorization: `Bearer ${await googleAccessToken(sa)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error('the link could not be written');
  return true;
}

export async function deleteLink(sa, provider, externalId) {
  const res = await fetch(linkUrl(sa, provider, externalId), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${await googleAccessToken(sa)}` },
  });
  if (!res.ok && res.status !== 404) throw new Error('the link could not be removed');
  return true;
}

/** Every external account a LoreHaven account holds. Firestore is the authority. */
export async function listLinks(sa, uid) {
  const res = await fetch(`${FIRESTORE_API}/projects/${sa.project_id}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await googleAccessToken(sa)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: LINKS }],
        where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
        limit: 100,
      },
    }),
  });
  if (!res.ok) throw new Error('the link table could not be read');
  const rows = await res.json().catch(() => null);
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r?.document)
    .map(r => ({
      provider: r.document.fields?.provider?.stringValue || null,
      externalId: r.document.fields?.externalId?.stringValue || null,
      label: r.document.fields?.label?.stringValue || null,
    }))
    .filter(l => l.provider && l.externalId);
}

/* ── Firebase accounts ── */

const identity = async (sa, path, body) => {
  const res = await fetch(`${IDENTITY_API}/projects/${sa.project_id}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await googleAccessToken(sa)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || 'Firebase refused the request');
  return data || {};
};

export const lookupUser = async (sa, uid) => {
  const data = await identity(sa, '/accounts:lookup', { localId: [uid] });
  return data.users?.[0] || null;
};

/**
 * The account's own copy of its links, so the app reads them from its own token
 * instead of the link table, which no client may touch.
 *
 * Custom claims are capped at 1000 bytes, and a Steam id costs about twenty of
 * them inside a JSON array, so the copy holds the first twenty per service. The
 * table stays the authority; nobody links twenty accounts, and an app that
 * showed nineteen of twenty-one would still be right about every one it showed.
 */
const CLAIMED_PER_PROVIDER = 20;

export async function refreshLinkClaims(sa, uid) {
  const links = await listLinks(sa, uid);
  const byProvider = {};
  for (const l of links) {
    byProvider[l.provider] = byProvider[l.provider] || [];
    if (byProvider[l.provider].length < CLAIMED_PER_PROVIDER) byProvider[l.provider].push(l.externalId);
  }
  const user = await lookupUser(sa, uid);
  let claims;
  try { claims = JSON.parse(user?.customAttributes || '{}'); } catch { claims = null; }
  if (!claims || typeof claims !== 'object') claims = {};
  if (Object.keys(byProvider).length) claims.links = byProvider; else delete claims.links;
  /* The single-account shape this replaced, cleared wherever it still sits. */
  delete claims.steamid;
  await identity(sa, '/accounts:update', { localId: uid, customAttributes: JSON.stringify(claims) });
  return byProvider;
}

/** The external accounts of one service an account holds, from its own record. */
export const claimedIds = (user, provider) => {
  try {
    const claims = JSON.parse(user?.customAttributes || '{}');
    const ids = claims?.links?.[provider];
    return Array.isArray(ids) ? ids : [];
  } catch { return []; }
};

export const hasPassword = (user) => (user?.providerUserInfo || []).some(p => p.providerId === 'password');

/** A new LoreHaven account for a Steam sign-in. The uid is ours, not Steam's. */
export const createUser = async (sa, uid, displayName) => {
  await identity(sa, '/accounts', { localId: uid, displayName: displayName || undefined, disabled: false });
  return uid;
};

/* ── The ticket ──
 *
 * A store confirms a sign-in once and only once -- Steam spends its nonce,
 * Microsoft spends its code -- so the choice screen, link this to my account or
 * start a new one, cannot hand the sign-in back for a second check. It carries
 * this instead: which service, which account there, and what that account is
 * called, signed by the Worker and good for ten minutes.
 *
 * The audience names the shape rather than the service, so a ticket cannot be
 * presented to the wrong provider's route: the provider inside it is checked
 * against the route that reads it. A ticket signed before this carried a
 * provider is refused, which costs nothing -- it was already ten minutes from
 * expiring when this shipped.
 *
 * The key is STEAM_TICKET_SECRET, whatever the name says. It was set before
 * there was a second service, and renaming a secret means the owner setting it
 * again on a live Worker for no gain.
 */
const ticketKey = (secret) => new TextEncoder().encode(clean(secret));

export async function signTicket(secret, { provider, externalId, label = null }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ provider, externalId: String(externalId), label: label || null })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('lorehaven')
    .setAudience('account-link')
    .setIssuedAt(now)
    .setExpirationTime(now + TICKET_MINUTES * 60)
    .sign(ticketKey(secret));
}

export async function readTicket(secret, ticket, provider = null) {
  const { payload } = await jwtVerify(String(ticket ?? ''), ticketKey(secret), { issuer: 'lorehaven', audience: 'account-link' });
  const spec = PROVIDERS[String(payload.provider || '')];
  const externalId = String(payload.externalId || '');
  if (!spec || !spec.validId(externalId)) throw new Error('the ticket carries no account');
  if (provider && payload.provider !== provider) throw new Error('that ticket is for another service');
  return { provider: String(payload.provider), externalId, label: payload.label || null };
}

/* ── The signed-in person, from their Firebase ID token ── */

let jwks = null;
export async function uidFromIdToken(sa, header, jwksUrl = GOOGLE_JWKS) {
  const token = /^Bearer (.+)$/i.exec(clean(header))?.[1];
  if (!token) throw new Error('not signed in');
  if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUrl));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${sa.project_id}`,
    audience: sa.project_id,
  });
  const uid = String(payload.user_id || payload.sub || '');
  if (!uid) throw new Error('that sign-in names no account');
  return uid;
}

/* ── An app's sign-in, tied to the app that started it ──
 *
 * A desktop or Android sign-in comes home through a link the operating system
 * routes, and another program can ask for that link too. So the app keeps a
 * random verifier and sends only its hash to Steam, inside the return address
 * Steam signs. Whoever finishes the sign-in must present the verifier itself.
 */
export const stateFromReturnTo = (returnTo) => {
  try { return new URL(String(returnTo)).searchParams.get('state'); } catch { return null; }
};

export async function verifierMatches(verifier, state) {
  if (!verifier) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier)));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === String(state);
}

/* ── Steam ── */

async function personaName(key, steamid) {
  if (!key) return null;
  try {
    const url = new URL(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/`);
    url.searchParams.set('key', key);
    url.searchParams.set('steamids', steamid);
    const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.response?.players?.[0]?.personaname || null;
  } catch { return null; }
}

/** The whole Steam side of a sign-in: it is really them, and this is who. */
export async function confirmSteamSignIn(body, origins) {
  const problem = openIdAssertionProblem(body?.params, origins);
  if (problem) return { error: problem, status: 400 };

  /* An app sign-in carries a state in the return address. When Steam signed
     one, only the holder of the verifier may finish. */
  const state = stateFromReturnTo(body.params['openid.return_to']);
  if (state && !(await verifierMatches(body.verifier, state))) {
    return { error: 'this sign-in was started somewhere else', status: 400 };
  }

  const res = await fetch(STEAM_OPENID_LOGIN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: openIdCheckBody(body.params),
  });
  const text = await res.text();
  if (!res.ok || !isValidCheckResponse(text)) return { error: 'Steam could not confirm this sign-in', status: 401 };
  return { steamid: steamIdFromClaimedId(body.params['openid.claimed_id']) };
}

const newUid = (provider) => `${provider}_${crypto.randomUUID().replace(/-/g, '')}`;

/* What differs between one service and the next, after the sign-in itself is
   done: what an answer calls its account id, and what a real one looks like.
   Everything else -- claiming the link, the claim on the token, the refusal to
   remove the last way in -- is the same for all of them, so it is written once
   below and takes one of these.

   The keys are the ones the app already reads, which is why they are per
   provider rather than a tidy `externalId` everywhere: a Worker deploy lands
   before the site does, and an answer the running app cannot read is an outage
   for however long that gap is. */
const PROVIDERS = {
  steam: {
    name: 'Steam',
    idKey: 'steamid',
    idsKey: 'steamids',
    labelKey: 'personaName',
    validId: (id) => /^7656119\d{10}$/.test(id),
  },
  xbox: {
    name: 'Xbox',
    idKey: 'xuid',
    idsKey: 'xuids',
    labelKey: 'gamertag',
    /* An XUID is a decimal number Microsoft has been handing out since 2005 and
       has never promised a width for, so this checks the shape, not a size. */
    validId: (id) => /^\d{10,20}$/.test(id),
  },
};

/**
 * @param {string} action   the path after /auth/, as <provider>/<verb>
 * @param {Request} req
 * @param {{FIREBASE_SERVICE_ACCOUNT?: string, STEAM_TICKET_SECRET?: string, STEAM_API_KEY?: string, STEAM_RETURN_ORIGINS?: string, XBOX_CLIENT_ID?: string, XBOX_CLIENT_SECRET?: string, XBOX_REDIRECT_URIS?: string}} env
 * @param {(status: number, body: object) => Response} json  the proxy's responder, CORS included
 */
export async function authRoute(action, req, env, json) {
  const send = (status, body) => {
    const res = json(status, body);
    res.headers.set('cache-control', 'no-store');
    return res;
  };

  const [providerName, verb] = String(action ?? '').split('/');
  const provider = PROVIDERS[providerName];
  if (!provider || !verb) return send(404, { error: 'unknown auth route' });

  if (!env.FIREBASE_SERVICE_ACCOUNT || !env.STEAM_TICKET_SECRET) {
    return send(503, { error: `${providerName} sign-in is not configured` });
  }
  let sa;
  try { sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT); }
  catch { return send(503, { error: `${providerName} sign-in is not configured` }); }

  const secret = env.STEAM_TICKET_SECRET;
  const body = await req.json().catch(() => null) || {};

  /* The signed-in person, where a route needs one. Null means no usable token,
     and every caller answers that the same way. */
  const signedInUid = async () => {
    try { return await uidFromIdToken(sa, req.headers.get('authorization')); }
    catch { return null; }
  };

  /* ── The half that is the same for every service ── */

  /** A LoreHaven account of their own, made from a store sign-in. */
  const create = async () => {
    let ticket;
    try { ticket = await readTicket(secret, body.ticket, providerName); }
    catch { return send(400, { error: `that ${provider.name} sign-in has expired` }); }
    const existing = await readLink(sa, providerName, ticket.externalId);
    if (existing) return send(409, { error: `that ${provider.name} account is already linked to a LoreHaven account` });

    const uid = newUid(providerName);
    if (!await claimLink(sa, providerName, ticket.externalId, uid, ticket.label)) {
      return send(409, { error: `that ${provider.name} account is already linked to a LoreHaven account` });
    }
    try {
      await createUser(sa, uid, ticket.label);
      await refreshLinkClaims(sa, uid);
    } catch (err) {
      /* No account to reach the link by, so the store account must not stay
         claimed: it would lock its owner out of ever signing in. */
      await deleteLink(sa, providerName, ticket.externalId).catch(() => {});
      throw err;
    }
    return send(200, {
      uid,
      [provider.idKey]: ticket.externalId,
      [provider.labelKey]: ticket.label,
      token: await mintCustomToken(sa, uid, { [provider.idKey]: ticket.externalId }),
    });
  };

  /** Their store account, onto the LoreHaven account they are signed in to. */
  const link = async () => {
    const uid = await signedInUid();
    if (!uid) return send(401, { error: 'sign in to LoreHaven first' });
    let ticket;
    try { ticket = await readTicket(secret, body.ticket, providerName); }
    catch { return send(400, { error: `that ${provider.name} sign-in has expired` }); }

    /* An account may hold several accounts of one service -- a main and a
       family one, say -- so the only refusal here is an account that belongs to
       somebody else's LoreHaven account. */
    const existing = await readLink(sa, providerName, ticket.externalId);
    if (existing && existing.uid !== uid) {
      return send(409, { error: `that ${provider.name} account is already linked to another LoreHaven account` });
    }
    if (!existing && !await claimLink(sa, providerName, ticket.externalId, uid, ticket.label)) {
      return send(409, { error: `that ${provider.name} account is already linked to another LoreHaven account` });
    }
    const links = await refreshLinkClaims(sa, uid);
    return send(200, {
      [provider.idKey]: ticket.externalId,
      [provider.labelKey]: ticket.label,
      [provider.idsKey]: links[providerName] || [],
    });
  };

  /* The accounts of this service that this LoreHaven account holds, under the
     names the service gave them, because an id tells its owner nothing. */
  const accounts = async () => {
    const uid = await signedInUid();
    if (!uid) return send(401, { error: 'sign in to LoreHaven first' });
    const mine = await listLinks(sa, uid);
    return send(200, {
      accounts: mine
        .filter(l => l.provider === providerName)
        .map(l => ({ [provider.idKey]: l.externalId, name: l.label || null })),
    });
  };

  /* Unlinking names which account to remove, because there may be several, and
     is refused only when it would be the last way into the LoreHaven account --
     counting every service, not just this one. */
  const unlink = async () => {
    const uid = await signedInUid();
    if (!uid) return send(401, { error: 'sign in to LoreHaven first' });

    const user = await lookupUser(sa, uid);
    const mine = await listLinks(sa, uid);
    const ours = mine.filter(l => l.provider === providerName);
    const externalId = String(body[provider.idKey] ?? '') || (ours.length === 1 ? ours[0].externalId : '');
    if (!externalId) return send(400, { error: `say which ${provider.name} account to unlink` });
    if (!ours.some(l => l.externalId === externalId)) {
      return send(400, { error: `that ${provider.name} account is not linked to this account` });
    }
    if (!hasPassword(user) && mine.length === 1) {
      return send(400, { error: 'add an email and password before unlinking your last account, or there would be no way back in' });
    }

    await deleteLink(sa, providerName, externalId);
    const links = await refreshLinkClaims(sa, uid);
    return send(200, { unlinked: true, [provider.idKey]: externalId, [provider.idsKey]: links[providerName] || [] });
  };

  /**
   * The end of every sign-in, whichever service confirmed it: signed in when
   * that account already reaches a LoreHaven account, and otherwise a ticket
   * for the choice screen, which is the only thing that outlives the request.
   */
  const finishSignIn = async ({ externalId, label }) => {
    const existing = await readLink(sa, providerName, externalId);
    if (existing) {
      return send(200, {
        status: 'signed-in',
        [provider.idKey]: externalId,
        token: await mintCustomToken(sa, existing.uid, { [provider.idKey]: externalId }),
      });
    }
    return send(200, {
      status: 'unlinked',
      [provider.idKey]: externalId,
      [provider.labelKey]: label,
      ticket: await signTicket(secret, { provider: providerName, externalId, label }),
    });
  };

  /* ── The half each service owns: proving who signed in ── */

  const steamSignIn = async () => {
    const origins = env.STEAM_RETURN_ORIGINS
      ? String(env.STEAM_RETURN_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_RETURN_ORIGINS;
    const confirmed = await confirmSteamSignIn(body, origins);
    if (confirmed.error) return send(confirmed.status, { error: confirmed.error });
    return finishSignIn({ externalId: confirmed.steamid, label: await personaName(env.STEAM_API_KEY, confirmed.steamid) });
  };

  /* Microsoft's code, redeemed and walked all the way to a gamertag. The
     redirect address is checked here, before Microsoft is called at all, so
     this Worker cannot be borrowed to redeem a code for another site. */
  const xboxChain = async () => {
    if (!env.XBOX_CLIENT_ID || !env.XBOX_CLIENT_SECRET) {
      throw new XboxError('xbox sign-in is not configured', 503);
    }
    const allowed = env.XBOX_REDIRECT_URIS
      ? String(env.XBOX_REDIRECT_URIS).split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_REDIRECT_URIS;
    if (!isAllowedRedirect(body.redirectUri, allowed)) {
      throw new XboxError('that sign-in was made for another site', 400);
    }
    return xboxIdentity({
      clientId: clean(env.XBOX_CLIENT_ID),
      clientSecret: clean(env.XBOX_CLIENT_SECRET),
      code: body.code,
      verifier: body.verifier,
      redirectUri: body.redirectUri,
    });
  };

  /* Where to send somebody to sign in. The challenge is the app's, the state is
     the app's, and both are checked for shape rather than trusted: this answer
     becomes a link somebody follows, so nothing that arrives here may write
     anything else into it. */
  const xboxStart = async () => {
    if (!env.XBOX_CLIENT_ID || !env.XBOX_CLIENT_SECRET) return send(503, { error: 'xbox sign-in is not configured' });
    const allowed = env.XBOX_REDIRECT_URIS
      ? String(env.XBOX_REDIRECT_URIS).split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_REDIRECT_URIS;
    if (!isAllowedRedirect(body.redirectUri, allowed)) return send(400, { error: 'that sign-in was made for another site' });
    const challenge = String(body.challenge ?? '');
    const state = String(body.state ?? '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return send(400, { error: 'that sign-in has no challenge' });
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(state)) return send(400, { error: 'that sign-in has no usable state' });
    return send(200, {
      url: authorizeUrl({ clientId: clean(env.XBOX_CLIENT_ID), redirectUri: body.redirectUri, challenge, state }),
    });
  };

  const xboxSignIn = async () => {
    const who = await xboxChain();
    return finishSignIn({ externalId: who.xuid, label: who.gamertag });
  };

  /**
   * What an Xbox account has played. It runs the whole sign-in again rather
   * than reading a stored token, because no Microsoft or Xbox token is ever
   * stored: a library read and a sign-in cost exactly the same chain, and the
   * one thing kept from it is nothing.
   *
   * No LoreHaven account is needed. Reading a library proves an Xbox sign-in
   * and nothing about who is asking, exactly as the Steam import does.
   */
  const xboxLibrary = async () => {
    const who = await xboxChain();
    const titles = shapeTitles(await titleHistory({ token: who.token, uhs: who.uhs, xuid: who.xuid }));
    return send(200, { xuid: who.xuid, gamertag: who.gamertag, titles });
  };

  try {
    switch (verb) {
      case 'start':
        /* Steam needs no such thing: its sign-in address is a plain link the
           app builds itself, with no client id and nothing to keep. */
        if (providerName !== 'xbox') return send(404, { error: 'unknown auth route' });
        return await xboxStart();
      case 'signin': return providerName === 'steam' ? await steamSignIn() : await xboxSignIn();
      case 'create': return await create();
      case 'link': return await link();
      case 'unlink': return await unlink();
      case 'accounts': return await accounts();
      case 'library':
        /* Steam's library is public and needs no sign-in, so it is read by
           functions/steam.js instead; only Xbox pays for it with a sign-in. */
        if (providerName !== 'xbox') return send(404, { error: 'unknown auth route' });
        return await xboxLibrary();
      default:
        return send(404, { error: 'unknown auth route' });
    }
  } catch (err) {
    /* Everything the Xbox chain refuses arrives here already carrying the
       sentence to show and the status to show it with. Anything else is ours,
       and the Worker's own catch turns it into a 502. */
    if (err instanceof XboxError) return send(err.status, { error: err.message });
    throw err;
  }
}
