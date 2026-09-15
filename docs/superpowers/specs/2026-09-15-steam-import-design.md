# Steam import: design brief

Agreed with the owner on 2026-09-15. It began as roadmap task 1, "IGDB External
Game Source page". The owner replaced the store-catalogue reading with an import
of their whole Steam library, and dropped the Stores browse pages.

## Decisions

- **Two ways in.**
  - Sign in with Steam: Steam's OpenID page, which returns only the account's
    public 64-bit SteamID.
  - Paste a profile link or custom name.
- **Sign-in only on the web app this round.**
  - The desktop and Android apps have no way to receive a sign-in redirect: no
    deep links, and a `tauri-plugin-oauth` that is registered but never used.
  - The owner chose app deep links. They come next round, together with Steam as
    a LoreHaven sign-in, because they need native code and new releases.
  - Until then the apps show the profile-link option and a sentence saying so.
- **Wishlist too.**
  - Imported where Steam provides it. Steam's published Web API reference lists
    no wishlist service, so this is best effort and must be checked live once
    the Worker is deployed.
  - A wishlisted game starts as Wishlist, since that is where Steam says it is.
- **Matched by Steam app id, never by name.**
  - IGDB `external_games` with source 1.
  - Two Steam apps filed under one IGDB game become one row.
- **Status is picked per game in review.**
  - No automatic status for owned games; there is bulk selection and a bulk Set
    Status.
  - A game already in the library keeps its status unless one is picked, and
    only gains Steam.
- **Not on IGDB.** Steam items with no IGDB match are listed unticked. Ticked,
  they become custom entries `custom_steam_<appid>`, so a re-import updates them.
  Wishlisted items with no match have no name to show and are counted, not listed.
- **Playtime and last played** are shown in the review only, never saved.
- **One write, with Undo.** The Undo restores every key the import touched and
  removes the games it added.

## Architecture

- **Worker, `functions/steam.js`.**
  - POST routes `/steam/verify`, `/steam/resolve`, `/steam/owned` and
    `/steam/wishlist`.
  - They are handled before the IGDB credential check, never pass through the
    edge cache, and are marked `no-store`.
  - A sign-in is accepted only when its `return_to` is on an allowed origin, and
    only after Steam's `check_authentication` confirms it.
  - The `STEAM_API_KEY` secret is needed for `resolve` (custom names) and `owned`.
  - `external_games` is added to the IGDB allowlist.
- **Client.**
  - `src/services/steamProfile.js` (shared parser)
  - `src/services/steamImport.js` (rows, plan, undo; pure)
  - `src/services/steam.js` (route calls, OpenID URL)
  - `matchSteamApps` in `src/services/igdb.js`
  - `src/pages/ImportWizard/SteamImport.jsx` at `/import/steam`, linked from the
    Import page and Your Data

## Owner actions before it works live

1. Get a Steam Web API key at steamcommunity.com/dev/apikey.
2. `npx wrangler secret put STEAM_API_KEY`
3. `npx wrangler deploy` (read the config diff first; see functions/README.md).
4. Set Steam profile Game details to Public.

## Next round

- Sign in to LoreHaven with Steam.
- Link an existing account to Steam in Profile. The link is written by the Worker
  after it has checked both the Firebase ID token and the Steam sign-in, never by
  the client.
- Firebase custom tokens signed with a service-account key held as a Worker
  secret.
- A Firestore rule that denies client writes to the link table.
- App deep links for desktop and Android.
- The import prompt after sign-in.
