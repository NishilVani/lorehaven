// The app's side of the Worker's Steam routes (functions/steam.js).

import { proxyFetch } from './igdb';

export class SteamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const post = async (action, body) => {
  const res = await proxyFetch(`/steam/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SteamError(data?.error || `Steam request failed (${res.status})`, res.status);
  return data;
};

export const verifySteamSignIn = (params) => post('verify', { params });
export const resolveSteamProfile = (profile) => post('resolve', { profile });
export const getSteamOwnedGames = (steamid) => post('owned', { steamid });

/* Never fails the import: a wishlist Steam will not hand over is reported as
   unavailable and the owned library still comes through. */
export const getSteamWishlist = (steamid) =>
  post('wishlist', { steamid }).catch(() => ({ available: false, items: [] }));

/* Steam's OpenID sign-in, sending the person back to `returnTo`. The realm is
   the site's origin, which is what Steam shows as the site asking. */
export const steamSignInUrl = (returnTo) => {
  const origin = new URL(returnTo).origin;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `https://steamcommunity.com/openid/login?${params}`;
};

/* The openid.* fields Steam appended to the return address, or null. */
export const openIdParamsFrom = (search) => {
  const q = new URLSearchParams(search);
  if (!q.get('openid.mode')) return null;
  return Object.fromEntries([...q.entries()].filter(([k]) => k.startsWith('openid.')));
};
