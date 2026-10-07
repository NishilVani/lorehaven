# Android-native features

What the Android app does that the website cannot, how each piece is wired,
and what has to be checked on a real phone. Tiers 1 and 2 of the list agreed
on 2026-10-06, plus two items from tier 3: QR codes and the Quick Settings
tile.

## What ships

### Tier 1

| Feature | Where | How |
|---|---|---|
| Release-day reminders | Account menu > **On This Phone** | `tauri-plugin-notification`. `services/native/reminders.js` plans one local notification per dated game on the chosen shelves (Wishlist and Unreleased by default; Backlog optional), at 10:00 on release day or 18:00 the evening before. `components/layout/NativeBridge.jsx` re-syncs on launch and after any library or settings change; a tap opens the game. |
| Haptic feedback | Game page, card menus, library drag and shelf swipe, back gesture | `tauri-plugin-haptics`, system patterns only (raw vibrate is not granted). `services/native/haptics.js`. On by default, off under **On This Phone**. |
| Native share sheet | Game page > More > Share Link | `tauri-plugin-sharekit` (`services/native/share.js`). The Android WebView has no Web Share API, which is why it used to copy. |
| Launcher shortcuts | Long-press the app icon | `res/xml/shortcuts.xml`: Search, Playing, Library, Pick For Me, each `lorehaven://shortcut/<name>`. `services/native/links.js` maps the name to one fixed route. Debug builds carry their own copy (`src/debug/res/xml/shortcuts.xml`): the `.debug` package suffix changes the target. |
| Verified App Links | `https://lorehaven.app/game/<id>`, `/franchise/<id>` | `tauri.conf.json` deep-link entry with `appLink: true`; `public/well-known-assetlinks.json` served at `/.well-known/assetlinks.json` by a Firebase rewrite (dot-folders are in Hosting's ignore list). |

### Tier 2

| Feature | Where | How |
|---|---|---|
| Home-screen widgets | Launcher widget picker, or **On This Phone** > Home Screen Widgets | `Widgets.kt`: Now Playing (note or last played), Up Next (Next Up backlog games), Releasing Soon (countdown worked out at render time, so it stays current with the app closed). Plain RemoteViews, Android 7 up. The page sends a snapshot after every library change (`services/native/widgets.js`); covers are IGDB's 90x128 size, cached in the app's files. Rows open `lorehaven://game/<id>`; headers open Playing, Backlog and Schedule. "Add" buttons use `requestPinAppWidget` where the launcher supports it. |
| Share into LoreHaven | Any app's share sheet > LoreHaven | A `text/plain` SEND filter on MainActivity; `LoreHavenPlugin.takeShared` hands the text over once. `services/native/shareIn.js`: a LoreHaven link opens its page, a Steam link is matched exactly by app id (`matchSteamApps`), any other store link searches the slug of its URL, plain text is searched as is. |
| Library-update notifications | **On This Phone** > Library Updates | `services/native/libraryDigest.js`. The changes Explore's "In Your Library" already finds, gathered while the app is open, and posted as one digest at the next 18:00 by the notification plugin's own alarm (fires with the app closed, survives a reboot). Each sync replaces or cancels it. No server: a phone that never opens the app gets no news. |
| Set as wallpaper | Wallpapers > open a plate > **Set As** | `LoreHavenPlugin.setWallpaper`: WallpaperManager, home, lock or both. IGDB image host only. `SET_WALLPAPER` is a normal permission, so no prompt. |
| Predictive back, edge-to-edge | Everywhere | `services/native/back.js` + `LoreHavenPlugin`: back closes the top menu, dialog, drawer or search first (as Escape), then goes back a page, then leaves the app. The native callback is enabled only while there is something to go back from, so Android's back-to-home preview plays at the root. While the gesture is held the top layer follows the finger (`--lh-back`, `index.css`). Status and navigation bar icons follow the theme (`setSystemBars`): they used to be dark on the black page whenever the phone itself was in light mode. |

### Tier 3 (the two picked)

| Feature | Where | How |
|---|---|---|
| QR codes | Account menu > **Scan QR Code**; game page > More > **Show QR Code** | `tauri-plugin-barcode-scanner` (camera permission asked on first scan). A scan is routed by the same rules as a share (`services/native/qr.js`); a code that is not about a game says so. Showing a code works everywhere (`components/ui/QrCodeDialog.jsx`, encoder `uqr` loaded on open), always dark on light. |
| Quick Settings tile | Pull down Quick Settings > edit > **Pick For Me** | `PickTileService.kt`. Opens Pick For Me; the subtitle names the top Up Next game from the widget snapshot. |

## Design decisions

- **Device-only settings.** Reminders, the digest and haptics live in
  `localStorage['lorehaven_device_settings']`, not in synced prefs: each needs
  this phone's notification permission.
- **Feature-detected, not version-gated.** Every native call is behind
  `isAndroidApp()` and a lazy `import()` or `nativeCall`; a missing plugin or
  method (an older APK on a newer OTA bundle) fails quietly. So
  `ota-min-shell.json` was not raised and older phones keep getting OTA.
- **One app command for the app's own Kotlin.** Plugin commands are checked
  against capability files, and a plugin defined in the app has none. The web
  code calls `native_call` (`src-tauri/src/android_native.rs`), which forwards
  only a fixed list of methods to `LoreHavenPlugin.kt`. App commands are open
  to the app's own pages and closed to remote ones.
- **No exact-alarm permission.** The notification plugin falls back to an
  inexact, Doze-allowed alarm when exact alarms are not permitted (Android 14+
  denies them by default). Minutes of slack are fine for "out today". It re-arms
  reminders after a reboot.
- **Narrow link allowlists.** The sign-in allowlist in `appSignIn.js` is
  unchanged. Shortcuts pass nothing from the link to the router; App Links and
  `lorehaven://game/<id>` take numeric ids on read-only routes only.
- **lorehaven:// links are parsed by hand** (`parseAppUrl`). The WHATWG URL
  parser gives a non-special scheme a host only from Chromium 130; on WebView
  124 (the API 35 emulator image) every app link, the Steam sign-in return
  included, read as unknown.
- **A launch link is followed once per WebView session.** `getCurrent` keeps
  returning it after a reload; following it again made the search shortcut
  reload the page forever.

## Versions

The plugins' npm bindings must match their crates on major.minor, and
`@tauri-apps/api` must match the `tauri` crate (2.11). The Tauri CLI refuses to
build otherwise. Pinned: notification 2.4.0, haptics 2.3.3, barcode-scanner
2.4.6, sharekit 0.4.0-rc.7 exactly, api `~2.11.0`. Barcode-scanner 2.5 needs
tauri 2.12; the 3.0 alphas are for the next Tauri major. Do not take either.

## App Links fingerprint

`sha256_cert_fingerprints` is the release signing certificate, read from the
published APK, not from the keystore:

    apksigner verify --print-certs LoreHaven-<version>-universal.apk

If the release keystore is ever replaced, update the file or links stop
opening the app (they fall back to the browser; nothing breaks).

## Verified on the emulator (API 35, WebView 124)

Install, launch, the four shortcuts registered, the search shortcut opens
search (and no longer reload-loops), App Link to `/game/1942` opens the game,
status bar icons visible, back closes search, share text opens search, the
tile opens the library, the widget snapshot and covers reach native storage,
release reminders schedule alarms, set as wallpaper changes the home screen,
`native_call` refuses an unknown method and a non-IGDB image.

## Verified on a real phone (Pixel 6a, Android 17, WebView 153), 2026-10-07

Driven over USB (`scripts/phone_cdp.mjs` attaches to the debug build's
WebView; adb for the native side). Screens in `qa/phone/` (local; `qa/` is
not committed).

Works: all four launcher shortcuts; share-in (Steam link, LoreHaven link,
plain text, other store link), warm and from a killed process; Share Link
opens the Android sheet; Show QR Code; the three widgets (real data, covers,
countdowns), a row opens its game, headers open Backlog and Schedule; the
Quick Settings tile opens Pick For Me; release reminders scheduled at the
right dates, a reminder tapped opens its game (app in the background and
from a killed process); the digest tapped opens Library Updates; Set As
Wallpaper (home only, lock untouched); haptics recorded by the vibrator
service; predictive back peek (menu follows the finger, release closes it),
back through history, back at the root leaves the app; scanner opens the
camera with the permission already granted.

Found and fixed on the phone:

| Bug | Cause | Fix |
|---|---|---|
| Library shortcut opened a blank page, then navigated in a loop | AppLinks re-ran its effect on every navigation (navigate changes identity) and re-followed the launch link; /library only redirects, so it never read as "already there" | `AppLinks.jsx`: navigate through a ref, effect runs once |
| Second visit to /library blank | The page stack kept the redirect route, whose Navigate had already fired | `PageStack.jsx`: redirect routes are never kept |
| A kept page rewrote the address | Hidden pages could still navigate (Library syncing its sort) | `PageStack.jsx`: hidden pages get a navigator that ignores push/replace/go |
| Back on a dialog also went back a page (or quit at the root) | Dialog plays a 170ms exit; back.js checks after two frames and read it as an Escape that did nothing | `Dialog.jsx` marks `data-closing`; `back.js` counts it closed |
| Cancelling the share sheet toasted "Could not copy the link" | sharekit rejects "Share cancelled"; share.js took that as no plugin and fell back to the clipboard | `share.js`: a cancel is not a failure |
| A tapped reminder opened the app, never the game | tauri-plugin-notification 2.4.0 never sets `sourceJson`, so the tap carries no `extra` | `LoreHavenPlugin.takeNotificationTap` keeps the tap intent's id; `links.js routeFromNotificationTap`; NativeBridge takes it on foreground and on the tap event |
| ...and from a killed process, still Explore | Android recreated the activity from the task's launcher intent and handed the tap to onNewIntent before any plugin loaded | `MainActivity.onNewIntent` adopts the intent (`setIntent`) |
| Back during a QR scan quit the app | At the root nothing claimed Back; the scanner has no controls | `qr.js` marks the scan an overlay, claims Back at once (`syncBackClaim`), Escape cancels the scan |

Still open (not fixed):

- The scanner is the plugin's bare full-screen camera: no frame, hint or
  Cancel button. Back is the only way out. A windowed scan with our own
  overlay would fix it.
- Links from outside (shortcut, tile, notification) do not close an open
  dialog: the Pick For Me tile opened over On This Phone.
- Back after closing Pick For Me goes to the `?pick=1` entry and reopens it.
- On This Phone scrolls its content under the status bar.
- In Your Library can show an "Out Now" badge over a "TBA" date (Wolverine).
- Not testable on the debug build: App Link verification (debug signature;
  `lorehaven.app: 1024`). QR decoding needs a code in front of the camera.

## Check on a real phone

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
7. On This Phone > Add Now Playing: the launcher asks where; the widget shows
   your Playing games with covers. Change a game's status: it updates.
8. Share a Steam store page to LoreHaven: the game opens.
9. On This Phone > Library Updates > Evening Digest. With something new in
   Explore > In Your Library, a notification arrives at 18:00.
10. Wallpapers > a plate > Set As > Both: home and lock screens change.
11. Swipe back slowly with a menu open: the menu follows the finger; release
    and it closes. At the home page, swiping back shows Android's preview of
    the home screen.
12. Scan QR Code, point at another phone showing a game's Show QR Code: that
    game opens.
13. Quick Settings > edit > drag Pick For Me in; tap it: Pick For Me opens.
