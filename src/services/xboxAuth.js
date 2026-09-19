// The app's side of the Worker's Xbox sign-in routes (functions/xbox.js).
//
// Microsoft returns to the address the sign-in started from -- unlike Steam,
// which comes back to lorehaven.app and nowhere else -- so the web app finishes
// its own sign-ins. Only the desktop and Android apps take the long way round,
// through lorehaven.app and a lorehaven:// link, because an app has no https
// address Entra could hold.
//
// Two things travel with a sign-in and come back with it:
//
//   - the verifier, which stays on this device. Microsoft gets its SHA-256 as
//     the PKCE challenge, and the Worker will not redeem a code without the
//     verifier itself, so a code caught in flight is worth nothing.
//   - the state, which says what this sign-in was for -- signing in, linking,
//     or reading a library -- where to go afterwards, and a nonce. The nonce is
//     checked on return against the one kept here, so a stray /auth/xbox
//     address somebody sends cannot start anything.

import { proxyFetch } from './igdb';
import { auth } from './firebase';
import { isTauri, openExternal } from './openExternal';
import { newVerifier, keepVerifier, takeVerifier, stateForVerifier, base64url } from './appSignIn';

export class XboxAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const NONCE_KEY = 'lorehaven_xbox_state';

/* The three addresses the app registration holds. A sign-in that started
   anywhere else cannot come home, so it is refused before it is started. */
export const REDIRECT_URIS = [
  'https://lorehaven.app/auth/xbox',
  'https://lorehaven.web.app/auth/xbox',
  'http://localhost:5173/auth/xbox',
];

/** This app's own return address, or lorehaven.app's when it has none. */
export const redirectUriFor = (origin = window.location.origin) => {
  const here = `${origin}/auth/xbox`;
  return REDIRECT_URIS.includes(here) ? here : REDIRECT_URIS[0];
};

/* Where a finished sign-in may be handed on to. The apps are the reason this
   exists: lorehaven.app finishes nothing for them, it passes the code back. */
const ALLOWED_NEXT = [
  /^https:\/\/lorehaven\.app(\/|$)/,
  /^https:\/\/lorehaven\.web\.app(\/|$)/,
  /^http:\/\/localhost:517[34](\/|$)/,
  /^lorehaven:\/\//,
];
export const isAllowedNext = (next) => !!next && ALLOWED_NEXT.some(re => re.test(String(next)));

/* The state Microsoft carries and hands back, as characters an address can hold
   unescaped -- the Worker refuses anything else, because this ends up inside a
   link somebody follows. */
export const packState = (state) => base64url(new TextEncoder().encode(JSON.stringify(state)));

export function readState(packed) {
  try {
    const bytes = Uint8Array.from(atob(String(packed).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const state = JSON.parse(new TextDecoder().decode(bytes));
    return state && typeof state === 'object' ? state : null;
  } catch { return null; }
}

const keepNonce = (nonce) => {
  try { localStorage.setItem(NONCE_KEY, JSON.stringify({ nonce, at: Date.now() })); } catch { /* storage refused */ }
};

/** The nonce this device started a sign-in with, read once and removed. */
export function takeNonce(now = Date.now()) {
  try {
    const raw = localStorage.getItem(NONCE_KEY);
    localStorage.removeItem(NONCE_KEY);
    const kept = JSON.parse(raw || 'null');
    if (!kept?.nonce || now - Number(kept.at) > 15 * 60_000) return null;
    return String(kept.nonce);
  } catch { return null; }
}

const post = async (action, body = {}, idToken = null) => {
  const res = await proxyFetch(`/auth/xbox/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new XboxAuthError(data?.error || `Xbox sign-in failed (${res.status})`, res.status);
  return data;
};

const currentIdToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new XboxAuthError('Sign in to LoreHaven first', 401);
  return user.getIdToken();
};

/**
 * Sends the person to Microsoft, and arranges the way back.
 *
 * `purpose` is what to do with the sign-in when it returns: 'signin' to sign in
 * or start an account, 'link' to add this Xbox account to the one already
 * signed in, 'import' to read what it has played. `from` is where the person
 * was, so they land back there.
 *
 * In the desktop and Android apps Microsoft opens in the system browser and
 * comes home to lorehaven.app, which hands the code on to lorehaven://auth/xbox.
 * The verifier stays here, so only this app can finish what it started.
 */
export async function startXboxSignIn({ purpose = 'signin', from = '/' } = {}) {
  const verifier = newVerifier();
  const nonce = newVerifier();
  const challenge = await stateForVerifier(verifier);
  keepVerifier(verifier, Date.now(), 'xbox');
  keepNonce(nonce);

  const app = isTauri();
  const redirectUri = app ? REDIRECT_URIS[0] : redirectUriFor();
  const state = packState({
    purpose,
    from,
    nonce,
    ...(app ? { next: `lorehaven://auth/xbox` } : {}),
  });

  const { url } = await post('start', { redirectUri, challenge, state });
  if (app) {
    await openExternal(url);
    return;
  }
  window.location.assign(url);
}

/** The redeemed sign-in: signed in when this Xbox account is linked, or a ticket. */
export const xboxSignIn = (code, verifier, redirectUri) => post('signin', { code, verifier, redirectUri });

export const xboxCreateAccount = (ticket) => post('create', { ticket });

export const xboxLinkAccount = async (ticket) => {
  const out = await post('link', { ticket }, await currentIdToken());
  /* The Worker just wrote the claim; without a refresh the app would keep
     reading a token minted before it existed. */
  await auth.currentUser?.getIdToken(true);
  return out;
};

export const xboxUnlinkAccount = async (xuid) => {
  const out = await post('unlink', { xuid }, await currentIdToken());
  await auth.currentUser?.getIdToken(true);
  return out;
};

/** The Xbox accounts this LoreHaven account holds, with their gamertags. */
export const xboxAccounts = async () => {
  const out = await post('accounts', {}, await currentIdToken());
  return Array.isArray(out.accounts) ? out.accounts : [];
};

/**
 * What an Xbox account has played. The code buys this read and nothing else:
 * no token is kept anywhere, so coming back for it later means signing in
 * again.
 */
export const xboxLibrary = (code, verifier, redirectUri) => post('library', { code, verifier, redirectUri });

/** The verifier this device kept, read once, as the Worker's routes need it. */
export const takeXboxVerifier = () => takeVerifier(Date.now(), 'xbox');

/**
 * The Xbox accounts this LoreHaven account holds, from its own token. There can
 * be several, so this is always a list, even when it holds one.
 */
export const linkedXuids = async (refresh = false) => {
  const user = auth.currentUser;
  if (!user) return [];
  const token = await user.getIdTokenResult(refresh).catch(() => null);
  const ids = token?.claims?.links?.xbox;
  return Array.isArray(ids) ? ids : [];
};
