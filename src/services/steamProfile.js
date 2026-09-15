// Reading whatever a person pastes as their Steam profile.
//
// Shared by the import page, which checks the field as it is typed, and the
// Worker, which resolves it. Pure with no imports, so both node tests and the
// Worker bundle can load it.

/* A 64-bit SteamID for an individual account: the 7656119 prefix is the
   account-type and universe bits every personal profile shares. */
const STEAM_ID = /^7656119\d{10}$/;

/* Steam custom URL names: letters, digits, underscores and hyphens. */
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

const PROFILE_LINK = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/**
 * → { steamid } for a link or number that already names the account,
 *   { vanity } for a custom profile name that the Worker has to resolve,
 *   null for anything that is not a Steam profile.
 */
export function parseProfileInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (STEAM_ID.test(s)) return { steamid: s };

  const link = s.match(PROFILE_LINK);
  if (link) {
    if (link[1].toLowerCase() === 'profiles') return STEAM_ID.test(link[2]) ? { steamid: link[2] } : null;
    return VANITY.test(link[2]) ? { vanity: link[2] } : null;
  }

  /* Some other address, or a number that is not a personal SteamID: neither is
     a name Steam would resolve, and sending it would only cost a request. */
  if (/[./:]/.test(s) || /^\d+$/.test(s)) return null;
  return VANITY.test(s) ? { vanity: s } : null;
}
