# Sign in to LoreHaven with Steam

2026-09-16. Follows `2026-09-15-steam-import-design.md`, which built the import
and the Worker's `/steam` routes.

## What this adds

- **Sign in with Steam** as a second way into a LoreHaven account, beside email
  and password.
- **Linking** an existing account to Steam, and unlinking it again, in Profile.
- **An import prompt** after the first Steam sign-in on an account, and after
  linking.
- **Deep links**, so the desktop and Android apps can finish a Steam sign-in
  that happens in the system browser.

## Decisions

- **A Steam account with no link offers both roads.** The return page says the
  Steam account is not linked yet and offers: sign in with email to link it, or
  start a new LoreHaven account with Steam. Nobody ends up with a second account
  by accident.
- **Unlinking needs another way in.** Refused only when the link being removed
  is the last way into the account: an account with an email and password, or
  with a second linked account, may always unlink.
- **One LoreHaven account, several store accounts.** A main Steam account and a
  family one, and later an Epic or Xbox account beside them, all sign in to the
  same LoreHaven account. The other direction stays one-to-one: a store account
  belongs to a single LoreHaven account, or signing in would be ambiguous.
  Profile lists them; the Steam import asks which one to read when there is more
  than one.
- **The import prompt appears once per link**, and the answer is remembered in
  the synced preferences. Import from Steam stays in Your Data either way.
- **A new account takes the Steam display name**, editable afterwards like any
  name.
- **The Worker holds the secrets and does the deciding.** It verifies the Steam
  assertion and the Firebase ID token, reads and writes the link table, and
  mints the Firebase custom token. The client never sees a service-account key
  and never writes a link.
- **`jose` does the token work.** Signing a custom token and verifying an ID
  token against Google's published keys are not things to hand-roll. It is the
  Worker's first dependency.
- **Every Steam sign-in goes through `https://lorehaven.app`.** The owner
  found that Steam only returns to the site's own address in practice: first
  `lorehaven.web.app`, and `lorehaven.app` since the domain was connected on
  2026-09-16. The old address stays an allowed destination and an allowed
  return origin in the Worker. A short return page
  there hands the result back to wherever the sign-in started: a dev server, or
  an app through a deep link.

## Architecture

### The link table

One document per external account: `account_links/{provider}_{externalId}` ->
`{ uid, provider, externalId, label, linkedAt }`. Keyed by the external account,
so a LoreHaven account may hold many and no external account can be claimed
twice.

- Written only by the Worker, through the Firestore REST API with a
  service-account token.
- `firestore.rules` denies every client read and write on that collection. There
  is no rule for it today, so the default already refuses; the rule is written
  down so the intent is not an accident of omission.
- The Worker also sets a `links` custom claim on the Firebase account --
  `{ "links": { "steam": ["7656...", "7656..."] } }` -- so the app can show what
  is linked without reading Firestore. Claims are capped at 1000 bytes, so the
  claim holds the first twenty per service and the table stays the authority.
- One external account signs in to one LoreHaven account. A LoreHaven account
  holds as many external accounts as its owner has.

### Worker routes (`functions/auth.js`, mounted at `/auth/*`)

| Route | Takes | Does |
|---|---|---|
| `auth/steam/signin` | the OpenID assertion, an optional PKCE-style `verifier` | Verifies with Steam. Linked: returns a Firebase custom token. Not linked: returns a ticket and the Steam persona name. |
| `auth/steam/create` | a ticket | Creates a uid, writes the link if none exists, sets the claim, returns a custom token. |
| `auth/steam/link` | a ticket, `Authorization: Bearer <Firebase ID token>` | Adds that Steam account to the signed-in account. Refuses only a Steam account another LoreHaven account holds. |
| `auth/steam/unlink` | `{ steamid }` and that header | Removes the named link, unless it is the last way into the account. |
| `auth/steam/accounts` | that header | Lists the Steam accounts this LoreHaven account holds, with their Steam names. |

- **The ticket** is a JWT signed with `STEAM_TICKET_SECRET`, holding the Steam id
  and persona name, good for ten minutes. It exists because Steam checks a
  sign-in assertion once only: the choice screen needs to act after that check.
- **Secrets**: `FIREBASE_SERVICE_ACCOUNT` (JSON), `STEAM_TICKET_SECRET`,
  `STEAM_API_KEY`. All three are already set on the Worker.
- **CORS** gains `authorization` in the allowed headers.

### The web flow

1. The sign-in modal gains **Sign In With Steam** above the email form.
2. It sends the browser to Steam with `return_to` on `https://lorehaven.app`,
   carrying where it started.
3. `/auth/steam` reads the assertion, posts it to the Worker and:
   - **linked** -> `signInWithCustomToken`, then back where the person was;
   - **not linked** -> the choice screen (email form to link, or create a new
     account with Steam);
   - **cancelled, expired, already linked elsewhere** -> a message that names the
     way out.
4. Signing in merges the local library into the account, exactly as email
   sign-in does today.

### Profile

- Under the email, every linked Steam account by its Steam name, each with its
  own **Unlink**, and **Link Another Steam Account** below them.
- Unlink asks for confirmation and names the account.
- The last way into an account is never offered for removal: an account with no
  password and one Steam account is told to add an email and password first.

### The import prompt

- A dialog after the first Steam sign-in on an account, and after linking:
  import the Steam library and wishlist now, or not.
- The answer is stored in the synced `prefs` domain, keyed by Steam id.
- Accepting opens `/import/steam`, which skips the connect step when the account
  holds one Steam account, and asks which to read when it holds several.

### The apps

- The app opens Steam in the system browser with a random verifier it keeps, and
  sends only that verifier's SHA-256 to Steam inside `return_to`.
- `https://lorehaven.app/auth/steam` hands the result back through a
  `lorehaven://auth/steam` link, on desktop and Android alike, and shows an
  **Open LoreHaven** button in case the browser will not open another program
  without a tap.
  - **Desktop** needs `tauri-plugin-deep-link`, the single-instance plugin (so a
    second launch hands its link to the running app), and a protocol entry in
    the MSIX manifest, which Tauri's bundler does not build.
  - **Android** uses the same custom scheme (`appLink: false`), which the plugin
    writes into the manifest at build time. That was chosen over a verified App
    Link: no `assetlinks.json`, no keystore fingerprint, and the verifier below
    already stops another app that catches the link from using it.
- The Worker only accepts a sign-in whose verifier hashes to the `state` Steam
  signed, so another app that intercepts the link cannot use it.
- Both apps need a new release for this. The web part ships before that.

## Testing

- **Worker**: node tests with a throwaway RSA key; Steam, Google's JWKS, the
  Google token endpoint and Firestore all stubbed. Mutation-checked.
- **Web**: Playwright specs stub `/auth/**`, `/steam/**` and Firebase's sign-in
  endpoints. No spec reaches a live service.
- **Apps**: the build proves the native wiring compiles; the owner checks the
  real sign-in on a device.

## Owner actions

- Deploy the Worker after the routes land, and deploy `firestore.rules`.
- Release new desktop and Android builds; the app links only exist in a build.

## Build order

1. Worker routes and their tests.
2. Web sign-in, the choice screen, Profile, the prompt.
3. Desktop and Android app links (built 2026-09-16).
