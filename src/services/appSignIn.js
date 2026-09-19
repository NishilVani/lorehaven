// A store sign-in that starts in the desktop or Android app.
//
// The app cannot be the store's return address: Steam only comes back to
// https://lorehaven.app, and Microsoft only to an address registered in Entra.
// That page hands the result to the app through a lorehaven:// link the
// operating system routes. Another program can register for that link too, so
// the app keeps a random verifier and sends the store only its SHA-256. The
// Worker then accepts the sign-in only from whoever holds the verifier -- this
// app.
//
// Steam carries the hash inside the return address it signs; Microsoft carries
// it as the PKCE challenge, which is the same idea with a specification behind
// it. Either way the secret never leaves the device that started the sign-in.
//
// Pure apart from localStorage and WebCrypto, both present in the app's webview
// and in node, so tests/app-links.test.mjs runs it directly.

export const APP_SCHEME = 'lorehaven';

/* The in-app pages a lorehaven:// link may open. Anything else is ignored, so a
   link from a stranger cannot walk the app somewhere unexpected. */
const APP_ROUTES = ['/auth/steam', '/import/steam', '/auth/xbox'];

/* One store, one kept verifier: linking a Steam account while an Xbox sign-in
   is in flight must not have either of them take the other's. */
const VERIFIER_KEYS = { steam: 'lorehaven_steam_verifier', xbox: 'lorehaven_xbox_verifier' };
const verifierKey = (provider) => VERIFIER_KEYS[provider] || VERIFIER_KEYS.steam;
/* Long enough to finish a Steam sign-in, including two-factor on a phone; short
   enough that a verifier left behind by an abandoned attempt does not linger. */
const VERIFIER_MINUTES = 15;

export const base64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const newVerifier = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** The state Steam carries: SHA-256 of the verifier, base64url, as the Worker computes it. */
export async function stateForVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier)));
  return base64url(new Uint8Array(digest));
}

export function keepVerifier(verifier, now = Date.now(), provider = 'steam') {
  try { localStorage.setItem(verifierKey(provider), JSON.stringify({ verifier, at: now })); } catch { /* storage refused */ }
}

/** The kept verifier, removed as it is read: a verifier is good for one sign-in. */
export function takeVerifier(now = Date.now(), provider = 'steam') {
  try {
    const raw = localStorage.getItem(verifierKey(provider));
    localStorage.removeItem(verifierKey(provider));
    const kept = JSON.parse(raw || 'null');
    if (!kept?.verifier || now - Number(kept.at) > VERIFIER_MINUTES * 60_000) return null;
    return String(kept.verifier);
  } catch { return null; }
}

/** The state inside a signed Steam return address, when an app began the sign-in. */
export const stateFromReturnTo = (returnTo) => {
  try { return new URL(String(returnTo)).searchParams.get('state'); } catch { return null; }
};

/**
 * lorehaven://auth/steam?openid... -> /auth/steam?openid..., or null for a link
 * that is not one of ours. The URL parser reads "auth" as the host and
 * "/steam" as the path, so the route is put back together from both.
 */
export function routeFromAppLink(link) {
  let url;
  try { url = new URL(String(link)); } catch { return null; }
  if (url.protocol !== `${APP_SCHEME}:`) return null;
  const path = `/${url.host}${url.pathname}`.replace(/\/+$/, '');
  if (!APP_ROUTES.includes(path)) return null;
  return `${path}${url.search}`;
}
