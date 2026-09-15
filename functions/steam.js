/* The Steam routes of the proxy.
 *
 *   POST /steam/verify    { params }   -> { steamid }   Steam sign-in (OpenID 2.0)
 *   POST /steam/resolve   { profile }  -> { steamid }   a profile link or custom name
 *   POST /steam/owned     { steamid }  -> { visible, games }
 *   POST /steam/wishlist  { steamid }  -> { available, items }
 *
 * Why these go through the Worker: the Web API key is a secret like the IGDB
 * credential, and api.steampowered.com sends no CORS headers, so neither the
 * browser nor the Tauri shell could call it directly anyway.
 *
 * Unlike every IGDB response, these are personal. None of them passes through
 * the edge cache, and each is marked no-store.
 */
import { parseProfileInput } from '../src/services/steamProfile.js';

export const STEAM_API = 'https://api.steampowered.com';
export const STEAM_OPENID_LOGIN = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const STEAM_ID = /^7656119\d{10}$/;

/* Where a Steam sign-in may return to. An assertion Steam signed for any other
   site is refused before Steam is asked, so a sign-in completed somewhere else
   cannot be replayed here. STEAM_RETURN_ORIGINS, comma-separated, replaces the
   list for a preview deployment. */
export const DEFAULT_RETURN_ORIGINS = [
  'https://lorehaven.web.app',
  'https://moctalegames.web.app',
  'http://localhost:5173',
  'http://localhost:5174',
];

/* Steam documents the claimed id as http://steamcommunity.com/openid/id/<steamid>
   and sends https in practice; both are accepted, nothing else is. */
export const steamIdFromClaimedId = (claimed) => {
  const m = String(claimed ?? '').match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/);
  return m ? m[1] : null;
};

/** null when the assertion is well formed for this site, else the reason. */
export function openIdAssertionProblem(params, origins) {
  if (!params || typeof params !== 'object') return 'no sign-in to check';
  if (params['openid.ns'] !== OPENID_NS) return 'not an OpenID 2.0 response';
  if (params['openid.mode'] !== 'id_res') return 'the sign-in was not completed';
  if (params['openid.op_endpoint'] !== STEAM_OPENID_LOGIN) return 'not signed by Steam';
  if (!steamIdFromClaimedId(params['openid.claimed_id'])) return 'no Steam account in the response';
  if (params['openid.identity'] !== params['openid.claimed_id']) return 'the identity and the account differ';
  let origin;
  try { origin = new URL(params['openid.return_to']).origin; } catch { return 'no return address'; }
  if (!origins.includes(origin)) return 'this sign-in was made for another site';
  const signed = String(params['openid.signed'] || '').split(',');
  for (const field of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce']) {
    if (!signed.includes(field)) return `${field} is not signed`;
  }
  return null;
}

/* check_authentication: the whole response sent back to Steam with the mode
   changed. Steam answers is_valid:true once per nonce, which is what stops a
   captured sign-in being used twice. */
export const openIdCheckBody = (params) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k.startsWith('openid.')) body.set(k, String(v));
  body.set('openid.mode', 'check_authentication');
  return body.toString();
};

export const isValidCheckResponse = (text) => /(^|\n)is_valid:true(\r?\n|$)/.test(String(text ?? ''));

/* A private "Game details" setting comes back as an empty response with no
   game_count at all; a public library with nothing in it has game_count 0. */
export const shapeOwnedGames = (json) => {
  const r = json?.response;
  if (!r || r.game_count === undefined) return { visible: false, games: [] };
  return {
    visible: true,
    games: (r.games || []).map(g => ({
      appid: g.appid,
      name: g.name || null,
      playtimeMinutes: Number(g.playtime_forever) || 0,
      lastPlayed: Number(g.rtime_last_played) > 0 ? Number(g.rtime_last_played) : null,
    })),
  };
};

export const shapeWishlist = (json) => {
  const items = json?.response?.items;
  if (!Array.isArray(items)) return { available: false, items: [] };
  return { available: true, items: items.map(i => ({ appid: i.appid, dateAdded: Number(i.date_added) || null })) };
};

/**
 * @param {string} action   the path after /steam/
 * @param {Request} req
 * @param {{STEAM_API_KEY?: string, STEAM_RETURN_ORIGINS?: string}} env
 * @param {(status: number, body: object) => Response} json  the proxy's responder, CORS included
 */
export async function steamRoute(action, req, env, json) {
  const send = (status, body) => {
    const res = json(status, body);
    res.headers.set('cache-control', 'no-store');
    return res;
  };
  const body = await req.json().catch(() => null) || {};
  const key = env.STEAM_API_KEY;
  const origins = env.STEAM_RETURN_ORIGINS
    ? String(env.STEAM_RETURN_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_RETURN_ORIGINS;

  const steamGet = (path, params) => {
    const url = new URL(STEAM_API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return fetch(url.toString(), { headers: { accept: 'application/json' } });
  };

  switch (action) {
    case 'verify': {
      const problem = openIdAssertionProblem(body.params, origins);
      if (problem) return send(400, { error: problem });
      const res = await fetch(STEAM_OPENID_LOGIN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: openIdCheckBody(body.params),
      });
      const text = await res.text();
      if (!res.ok || !isValidCheckResponse(text)) return send(401, { error: 'Steam could not confirm this sign-in' });
      return send(200, { steamid: steamIdFromClaimedId(body.params['openid.claimed_id']) });
    }

    case 'resolve': {
      const parsed = parseProfileInput(body.profile);
      if (!parsed) return send(400, { error: 'not a Steam profile' });
      if (parsed.steamid) return send(200, { steamid: parsed.steamid });
      if (!key) return send(503, { error: 'steam not configured' });
      const res = await steamGet('/ISteamUser/ResolveVanityURL/v1/', { key, vanityurl: parsed.vanity });
      if (!res.ok) return send(502, { error: 'Steam did not answer' });
      const data = await res.json().catch(() => null);
      const steamid = String(data?.response?.steamid ?? '');
      if (data?.response?.success === 1 && STEAM_ID.test(steamid)) return send(200, { steamid });
      return send(404, { error: 'no Steam profile with that name' });
    }

    case 'owned': {
      if (!STEAM_ID.test(String(body.steamid ?? ''))) return send(400, { error: 'not a Steam id' });
      if (!key) return send(503, { error: 'steam not configured' });
      const res = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
        key, steamid: body.steamid, include_appinfo: '1', include_played_free_games: '1', format: 'json',
      });
      if (!res.ok) return send(502, { error: 'Steam did not answer' });
      return send(200, shapeOwnedGames(await res.json().catch(() => null)));
    }

    /* Best effort. Steam's published Web API reference does not list a wishlist
       service, so a missing or changed one reports itself as unavailable
       rather than failing an import of the owned library. */
    case 'wishlist': {
      if (!STEAM_ID.test(String(body.steamid ?? ''))) return send(400, { error: 'not a Steam id' });
      const params = { steamid: body.steamid };
      if (key) params.key = key;
      let res;
      try { res = await steamGet('/IWishlistService/GetWishlist/v1/', params); } catch { return send(200, { available: false, items: [] }); }
      if (!res.ok) return send(200, { available: false, items: [] });
      return send(200, shapeWishlist(await res.json().catch(() => null)));
    }

    default:
      return send(404, { error: 'unknown steam route' });
  }
}
