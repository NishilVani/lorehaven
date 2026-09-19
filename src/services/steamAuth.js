// The app's side of the Worker's Steam sign-in routes (functions/auth.js).
//
// Steam sends a sign-in back to one address only: https://lorehaven.app.
// The page there hands the result on to wherever the sign-in began -- a dev
// server, or one day an app through its own link -- and only to addresses this
// file allows.

import { proxyFetch } from './igdb';
import { auth } from './firebase';
import { isTauri, openExternal } from './openExternal';
import { newVerifier, keepVerifier, stateForVerifier } from './appSignIn';

export class SteamAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const SIGN_IN_RETURN = 'https://lorehaven.app/auth/steam';
const REALM = 'https://lorehaven.app';

/* Where a sign-in may be handed on to. Steam signs the return address, so this
   list is what stops a signed sign-in being walked to another site. The old
   lorehaven.web.app stays on it while people still arrive there. */
const ALLOWED_NEXT = [
  /^https:\/\/lorehaven\.app(\/|$)/,
  /^https:\/\/lorehaven\.web\.app(\/|$)/,
  /^http:\/\/localhost:517[34](\/|$)/,
  /^lorehaven:\/\//,
];
export const isAllowedNext = (next) => !!next && ALLOWED_NEXT.some(re => re.test(String(next)));

/**
 * Steam's sign-in page. `next` is where the result should end up: this app,
 * wherever it is running. `state` is the hash of an app's verifier, which the
 * Worker checks before it will finish an app's sign-in.
 */
export const steamSignInHref = ({ next, intent = null, state = null } = {}) => {
  const ret = new URL(SIGN_IN_RETURN);
  if (next) ret.searchParams.set('next', next);
  if (intent) ret.searchParams.set('intent', intent);
  if (state) ret.searchParams.set('state', state);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': ret.toString(),
    'openid.realm': REALM,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `https://steamcommunity.com/openid/login?${params}`;
};

/** This app's own address for the return, whichever origin it is running on. */
export const hereForSteam = () => `${window.location.origin}/auth/steam`;

/**
 * Sends the person to Steam to sign in, and arranges the way back.
 *
 * On the web that is this site's own /auth/steam or /import/steam. In the
 * desktop and Android apps Steam opens in the system browser, and the way back
 * is a lorehaven:// link, which only the app holding the verifier kept here can
 * finish. `target` is 'auth' for signing in or linking, 'import' for reading a
 * library.
 */
export async function startSteamSignIn({ target = 'auth', from = '/', intent = null } = {}) {
  const query = target === 'auth' ? `?from=${encodeURIComponent(from)}` : '';
  const page = target === 'import' ? 'import/steam' : 'auth/steam';

  if (isTauri()) {
    /* Reading a public library proves nothing and signs nobody in, so only a
       sign-in carries the verifier and its state. */
    let state = null;
    if (target === 'auth') {
      const verifier = newVerifier();
      keepVerifier(verifier);
      state = await stateForVerifier(verifier);
    }
    await openExternal(steamSignInHref({ next: `lorehaven://${page}${query}`, intent, state }));
    return;
  }
  window.location.assign(steamSignInHref({ next: `${window.location.origin}/${page}${query}`, intent }));
}

const post = async (action, body = {}, idToken = null) => {
  const res = await proxyFetch(`/auth/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SteamAuthError(data?.error || `Steam sign-in failed (${res.status})`, res.status);
  return data;
};

const currentIdToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new SteamAuthError('Sign in to LoreHaven first', 401);
  return user.getIdToken();
};

/* Steam confirms a sign-in exactly once: the nonce inside it is spent by the
   first check_authentication and every later one is answered "not valid". So a
   second call for the same assertion cannot succeed, and making it would throw
   away a sign-in that already had. It happened in the ordinary case -- signing
   in pulls the account's data, which remounts the routes, which mounted this
   page again on the same address -- and the person saw a failure after a
   success. The first call's answer stands for all of them. A call that never
   got an answer is forgotten again, because then nothing was spent. */
const confirmations = new Map();

export const steamSignIn = (params, verifier = null) => {
  const nonce = params?.['openid.response_nonce'];
  const key = nonce ? String(nonce) : null;
  if (key && confirmations.has(key)) return confirmations.get(key);
  const call = post('steam/signin', { params, ...(verifier ? { verifier } : {}) })
    .catch((err) => {
      if (key && !err?.status) confirmations.delete(key);
      throw err;
    });
  if (key) confirmations.set(key, call);
  return call;
};

export const steamCreateAccount = (ticket) => post('steam/create', { ticket });

export const steamLinkAccount = async (ticket) => {
  const out = await post('steam/link', { ticket }, await currentIdToken());
  /* The Worker just wrote the claim; without a refresh the app would keep
     reading a token minted before it existed. */
  await auth.currentUser?.getIdToken(true);
  return out;
};

export const steamUnlinkAccount = async (steamid) => {
  const out = await post('steam/unlink', { steamid }, await currentIdToken());
  await auth.currentUser?.getIdToken(true);
  return out;
};

/** The Steam accounts with the names Steam gave them, straight from the Worker. */
export const steamAccounts = async () => {
  const out = await post('steam/accounts', {}, await currentIdToken());
  return Array.isArray(out.accounts) ? out.accounts : [];
};

/**
 * The Steam accounts this LoreHaven account holds, from its own token. There
 * can be several -- a main account and a family one, say -- so this is always a
 * list, even when it holds one.
 */
export const linkedSteamIds = async (refresh = false) => {
  const user = auth.currentUser;
  if (!user) return [];
  const token = await user.getIdTokenResult(refresh).catch(() => null);
  const ids = token?.claims?.links?.steam;
  return Array.isArray(ids) ? ids : [];
};
