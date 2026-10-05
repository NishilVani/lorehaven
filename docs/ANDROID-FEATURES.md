# Android-native features

What the Android app does that the website cannot, how each piece is wired,
and what has to be checked on a real phone. Tier 1 of the list agreed on
2026-10-06; widgets, share-into-the-app and library-update notifications are
the next tiers.

## What ships

| Feature | Where | How |
|---|---|---|
| Release-day reminders | Account menu > **On This Phone** | `tauri-plugin-notification`. `services/native/reminders.js` plans one local notification per dated game on the chosen shelves (Wishlist and Unreleased by default; Backlog optional), at 10:00 on release day or 18:00 the evening before. `components/layout/NativeBridge.jsx` re-syncs on launch and after any library or settings change; a tap opens the game. |
| Haptic feedback | Game page, card menus, library drag and shelf swipe | `tauri-plugin-haptics`, system patterns only (raw vibrate is not granted). `services/native/haptics.js`. On by default, off under **On This Phone**. |
| Native share sheet | Game page > More > Share Link | `tauri-plugin-sharekit` (`services/native/share.js`). The Android WebView has no Web Share API, which is why it used to copy. |
| Launcher shortcuts | Long-press the app icon | `res/xml/shortcuts.xml`: Search, Playing, Library, Pick For Me, each `lorehaven://shortcut/<name>`. `services/native/links.js` maps the name to one fixed route. |
| Verified App Links | `https://lorehaven.app/game/<id>`, `/franchise/<id>` | `tauri.conf.json` deep-link entry with `appLink: true`; `public/well-known-assetlinks.json` served at `/.well-known/assetlinks.json` by a Firebase rewrite (dot-folders are in Hosting's ignore list). |

## Design decisions

- **Device-only settings.** Reminders and haptics live in
  `localStorage['lorehaven_device_settings']`, not in synced prefs: a reminder
  needs this phone's notification permission.
- **Feature-detected, not version-gated.** Every native call is behind
  `isAndroidApp()` and a lazy `import()`; a missing plugin (an older APK on a
  newer OTA bundle) fails quietly. So `ota-min-shell.json` was not raised and
  older phones keep getting OTA.
- **No exact-alarm permission.** The notification plugin falls back to an
  inexact, Doze-allowed alarm when exact alarms are not permitted (Android 14+
  denies them by default). Minutes of slack are fine for "out today". It re-arms
  reminders after a reboot.
- **Narrow link allowlists.** The sign-in allowlist in `appSignIn.js` is
  unchanged. Shortcuts pass nothing from the link to the router; App Links take
  numeric ids on two read-only routes only.

## Versions

The plugins' npm bindings must match their crates on major.minor, and
`@tauri-apps/api` must match the `tauri` crate (2.11). The Tauri CLI refuses to
build otherwise. Pinned: notification 2.4.0, haptics 2.3.3, sharekit
0.4.0-rc.7 exactly, api `~2.11.0`. The newest official plugin releases are 3.0
alphas for the next Tauri major; do not take them.

## App Links fingerprint

`sha256_cert_fingerprints` is the release signing certificate, read from the
published APK, not from the keystore:

    apksigner verify --print-certs LoreHaven-<version>-universal.apk

If the release keystore is ever replaced, update the file or links stop
opening the app (they fall back to the browser; nothing breaks).

## Check on a real phone

Not verifiable in CI or an emulator-free build:

1. On This Phone > Release Reminders > On Release Day: Android asks for
   notification permission; allow. Wishlist a game releasing in the next day
   or two, wait, and the notification arrives; tapping it opens the game.
2. Deny the permission instead: the dialog says so and the setting stays Off.
3. Change a priority, rating or status: a short buzz. Long-press a library
   card: a firmer one. Turn haptics off: none.
4. Game page > More > Share Link: the Android share sheet opens.
5. Long-press the app icon: four shortcuts; each opens its screen.
6. After installing the release APK, open `https://lorehaven.app/game/1942`
   from another app: it opens in LoreHaven. Check verification with
   `adb shell pm get-app-links com.lorehaven.games` (lorehaven.app: verified).
