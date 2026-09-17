# Sign in with Xbox, and import the Xbox played list

2026-09-17. Follows `2026-09-16-steam-sign-in-design.md`, which built the link
table, the Worker's `/auth/*` routes, and the app-link handoff. Xbox reuses all
of it.

## What this adds

- **Sign in with Xbox** as a third way into a LoreHaven account, beside email and
  Steam.
- **Linking** one or more Xbox accounts to a LoreHaven account, and unlinking.
- **Import from Xbox**: the games an Xbox account has played, reviewed and
  imported the same way as the Steam import.

## Evidence this rests on

- **The sign-in works with an ordinary app registration.** Probe run on
  2026-09-16: a Microsoft `XboxLive.signin` token, accepted by
  `user.auth.xboxlive.com`, and XSTS (relying party `http://xboxlive.com`,
  sandbox `RETAIL`) returned the gamertag and XUID. No Xbox developer programme.
- **The played list is readable.** Probe step 5, 2026-09-17, on the owner's
  account: `titlehub.xboxlive.com/users/xuid(..)/titles/titlehistory/decoration/detail,image`
  returned 53 titles, all of type `Game`. 38 of 53 carry a Microsoft Store product
  id in `detail.availabilities[].ProductId`. `titleHistory.lastTimePlayed` is
  present. Game Pass flags were all false.
- **IGDB knows those product ids.** All five probe samples were found in IGDB
  `external_games` by uid, under source 11 (Microsoft Store), source 54 (Xbox /
  Microsoft cloud listing), or both. Resident Evil 3 carries two product ids and
  IGDB holds the second.
- **titlehub is undocumented.** It is what xbox.com itself reads. It can change
  without notice; the import must fail with a clear message, never a broken page.

## Decisions

- **Same shape as Steam.** Full sign-in, linking and unlinking, one LoreHaven
  account holding several Xbox accounts, one Xbox account belonging to a single
  LoreHaven account. The link is `account_links/xbox_<xuid>`, the claim is
  `links.xbox`.
- **Reuse the probe's app registration.** It becomes the real one: renamed
  LoreHaven, a Web platform with the return addresses below, a client secret on
  the Worker, and public client flows switched off once the probe is retired.
- **Authorization code with PKCE, redeemed by the Worker.** The Worker holds
  `XBOX_CLIENT_ID` (public) and `XBOX_CLIENT_SECRET`. Scope `XboxLive.signin`
  only: no `offline_access`, because nothing is kept.
- **No Microsoft or Xbox token is ever stored**, in the Worker or the client.
  Each sign-in runs the chain once and throws the tokens away. That is why the
  import reads the played list in the same request that proves the sign-in, and
  why reading it again means signing in again.
- **Microsoft returns to the origin that started the sign-in.** Unlike Steam, an
  app registration holds a list of return addresses:
  `https://lorehaven.app/auth/xbox`, `https://lorehaven.web.app/auth/xbox`,
  `http://localhost:5173/auth/xbox`. The import uses `/auth/xbox` too, with the
  purpose carried in `state`, so the registration needs only those three.
- **The apps go through `lorehaven.app`, like Steam.** The desktop and Android
  apps open Microsoft in the system browser with `lorehaven.app/auth/xbox` as the
  return; that page hands `code` and `state` to `lorehaven://auth/xbox`. PKCE is
  the protection: the code is useless without the verifier, which never leaves
  the app. No extra state hash is needed, unlike Steam's OpenID.
- **Matching by Store product id first.** A title matches an IGDB game when any
  of its product ids is an IGDB uid under source 11 or 54. Those rows arrive
  ticked, like a Steam app id match.
- **Then a suggestion by name, never ticked.** A title with no product id, or no
  id IGDB knows, is searched by name. One confident result is shown as
  "Matched by name, check it", unticked. Anything else is listed like Steam's "Not
  on IGDB" rows, with **Find It on IGDB** and import-as-custom.
- **"Played on Xbox".** Every imported game gets the store **Xbox**. titlehub's
  `devices` says where a title can run, not where it was played, so the platform
  defaults to the newest Xbox in that list (Series X|S, then One) and falls back
  to PC when PC is the only device. It stays editable per row in review.
- **Status is picked per game**, as in the Steam import. Last played is shown in
  review only, never saved. Achievement progress is not read.
- **A child account, or one with no Xbox profile, is told why.** XSTS error codes
  2148916233, 2148916235, 2148916236/7 and 2148916238 each get a plain
  sentence naming what to do.

## Architecture

### Worker (`functions/xbox.js`, routed from `functions/auth.js`)

The chain, once per request:

1. `POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token` with the
   code, verifier, redirect address and client secret.
2. `POST https://user.auth.xboxlive.com/user/authenticate`, `RpsTicket: d=<token>`.
3. `POST https://xsts.auth.xboxlive.com/xsts/authorize`, relying party
   `http://xboxlive.com`, sandbox `RETAIL` -> `xid` (XUID), `gtg` (gamertag),
   `uhs`.
4. Only for an import: the titlehub read above, `x-xbl-contract-version: 2`.

| Route | Takes | Does |
|---|---|---|
| `auth/xbox/signin` | `code`, `verifier`, `redirectUri` | Runs 1-3. Linked: a Firebase custom token. Not linked: a ticket and the gamertag. |
| `auth/xbox/create` | a ticket | As Steam's `create`. |
| `auth/xbox/link` | a ticket, Bearer ID token | As Steam's `link`. |
| `auth/xbox/unlink` | `{ xuid }`, Bearer ID token | As Steam's `unlink`; the last-way-in rule already counts every provider. |
| `auth/xbox/accounts` | Bearer ID token | The linked Xbox accounts, named by the gamertag stored as the link's label at link time (there is no way to look a gamertag up without a token). |
| `auth/xbox/library` | `code`, `verifier`, `redirectUri` | Runs 1-4 and returns `{ xuid, gamertag, titles }`, each title trimmed to name, titleId, product ids, devices, last played and a cover URL. No account needed. |

- **`redirectUri` is checked** against the same three addresses before Microsoft
  is called, so the Worker cannot be used to redeem codes for another site.
- **The ticket gains a provider.** `signTicket` takes `{ provider, externalId,
  label }`; a Steam ticket signed before the change is refused (it lives ten
  minutes, so nothing real is lost).
- **Shared with Steam, moved out of the Steam branch of `authRoute`:** create,
  link, unlink and accounts become one implementation taking a provider.
- **Secrets:** `XBOX_CLIENT_ID`, `XBOX_CLIENT_SECRET`. Without them the Xbox
  routes answer 503, as Steam's do.

### Client

- `src/services/xboxAuth.js`: PKCE verifier and challenge (reusing
  `appSignIn.js`), `startXboxSignIn({ purpose, from })`, and the Worker calls.
  `state` carries purpose (`signin`, `link`, `import`), `from`, a random nonce
  checked on return, and for the apps `next=lorehaven://...`.
- `/auth/xbox`: one page for every purpose. Sign-in and link reuse the Steam
  page's choice screen and import question, lifted into shared components.
  Import posts to `auth/xbox/library` and moves on to the review with the result
  in memory.
- `/import/xbox`: the Steam review, generalised over a source adapter (rows,
  matching, store and platform). Opened from Your Data.
- `AuthModal`: **Sign In With Xbox** under Steam's button. Profile: an **Xbox
  Accounts** list under the Steam one, same controls.
- `AppLinks.jsx` follows `/auth/xbox` too.

## Testing

- **Worker**: node tests with Microsoft's token endpoint, both Xbox auth hosts,
  titlehub, Firestore and Google all stubbed. The chain's failure at each step,
  every XSTS error code, a foreign `redirectUri`, and a ticket from the wrong
  provider. Mutation-checked, as `test:auth` is.
- **Matching**: pure unit tests over a fixture shaped like the probe's output
  (product ids on `availabilities`, two ids on one title, none on another).
- **Web**: Playwright specs stub `/auth/**`, `/api/**` and Firebase. No spec
  reaches Microsoft, Xbox, IGDB or Firebase.
- **Live**: the owner signs in once on `lorehaven.web.app` after the Worker is
  deployed.

## Owner actions

1. In the Entra app registration: rename to LoreHaven; add a **Web** platform
   with the three return addresses; create a client secret.
2. `npx wrangler secret put XBOX_CLIENT_ID` and `XBOX_CLIENT_SECRET`.
3. After the live check, switch **Allow public client flows** off and retire
   `xbox-signin-probe.mjs`.
4. Optional, later: publisher verification, to remove "unverified" from the
   consent screen (needs a Microsoft partner id; the domain is now in place).

## Build order

1. Worker: generalise the link routes by provider, then `xbox.js` and its tests.
2. Web: `/auth/xbox` sign-in, create, link; Profile; AuthModal.
3. Import: the source adapter, Xbox matching, `/import/xbox`.
4. Apps: `/auth/xbox` in `AppLinks.jsx` and the handoff page.
