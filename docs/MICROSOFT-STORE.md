# Publishing to the Microsoft Store

LoreHaven ships to the Store as an **MSIX**, and that choice is the whole reason
this costs nothing.

## Why MSIX and not the MSI

The Store accepts two shapes, and they are not equivalent:

| | MSIX | MSI / EXE |
|---|---|---|
| Who signs it | **Microsoft**, after certification | **You**, before submission |
| Certificate needed | **None** | Authenticode, from a CA in the Microsoft Trusted Root Program. Self-signed is rejected |
| Who hosts the download | Microsoft's CDN | You, at a URL you keep alive forever |
| Updating | Upload a new package | Submit a new **immutable, versioned** URL each time |

Microsoft's own words: *"Your MSIX and AppX packages don't have to be signed
with a certificate rooted in a trusted certificate authority when submitting to
the Microsoft Store. The Microsoft Store will automatically re-sign your
MSIX/AppX packages with a Microsoft certificate during the publishing process."*
And the counterpart: *"If you are submitting an MSI or EXE installer to the
Store, the Store does not re-sign those files."* ([app package requirements][msix])

So MSIX means no certificate, no hosting, no URL to maintain. The MSI and NSIS
installers still go into every GitHub Release for people who want a direct
download outside the Store — they are simply not what the Store listing uses.

[msix]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements

## How the package is built

Tauri has no MSIX bundle target, so [`scripts/pack_msix.ps1`](../scripts/pack_msix.ps1)
does it: it takes the `LoreHaven.exe` that `tauri build` produced, stages it
alongside the Store logos Tauri already generates in `src-tauri/icons/`,
substitutes the version into
[`src-tauri/msix/AppxManifest.xml`](../src-tauri/msix/AppxManifest.xml), and runs
`makeappx pack`.

The package is left **unsigned on purpose**. Signing it would only mean
Microsoft replacing that signature during certification.

It is a normal Win32 program in an MSIX container, which the manifest declares
with `EntryPoint="Windows.FullTrustApplication"` and the `runFullTrust`
capability. Without both it builds fine and then fails certification.

## Identity — already known

LoreHaven is reserved. These came from **Product management → Product identity**
and are baked into
[`AppxManifest.xml`](../src-tauri/msix/AppxManifest.xml) and the submission
workflow. They are fixed for the life of the app and are not secret — every
published package carries them and the listing URL is public — so there is
nothing to configure:

| | |
|---|---|
| Store ID / Product ID | `9N7FD5QBSMBB` |
| `Package/Identity/Name` | `LoreHeaven.LoreHaven` |
| `Package/Identity/Publisher` | `CN=CEEF9C0A-EDC7-4AE4-9AC3-FA2F4AC45FD8` |
| `PublisherDisplayName` | `LoreHeaven` |
| Package Family Name | `LoreHeaven.LoreHaven_hgh23a52snpg8` |
| Listing URL | https://apps.microsoft.com/detail/9N7FD5QBSMBB |

**The publisher is spelled `LoreHeaven`, the app `LoreHaven`.** That is what
Partner Center holds, so that is what the manifest must say — a mismatch is a
rejected package. It is also the name shown as the publisher on the listing. If
the extra "e" is not deliberate, change it in Partner Center *before* the first
submission and update the manifest to match. Be aware the `Package/Identity/Name`
prefix is derived from the publisher name at reservation and may not follow a
later rename.

## What still needs doing

The first submission is **done**: `LoreHaven-0.1.0.msix` went through Partner
Center by hand with the full listing, and is in certification. That was always
going to be manual — the automation *updates* an app that already exists, it
does not create a listing.

What is left is the automation for later releases:

1. **Register an application in Microsoft Entra ID**, then add it in Partner
   Center under **Account settings → User management → Microsoft Entra
   applications** with the **Manager** role.
2. **Add the four secrets below.** Until they exist, `store-submission.yml`
   fails on a tagged release. That is deliberate: a green run that submitted
   nothing is worse than a red one.

## Repository secrets

Four, under **Settings → Secrets and variables → Actions → Secrets**. No
variables, and no certificate.

| Secret | Where to find it |
|---|---|
| `AZURE_AD_TENANT_ID` | Entra admin center → Identity → Overview |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Entra → App registrations → your app → Application (client) ID |
| `AZURE_AD_APPLICATION_SECRET` | Entra → your app → Certificates & secrets. **Shown once — copy it immediately.** |
| `SELLER_ID` | Partner Center → Account settings → Identifiers. This page returned "Access restricted" when I looked, so it may need the account-admin role or a different entry point for this account type. |

The release workflow packs and attaches the MSIX regardless; only the submission
step needs these.

## What happens on a release

1. You tag a version. The Windows job builds the app, packs the MSIX, and
   attaches `LoreHaven-<version>.msix` to the draft release.
2. When every platform succeeds the release is published.
3. **Store — submit release** fires when the whole **Release** workflow
   completes, downloads the MSIX from the release, and runs `msstore publish`.

Step 3 keys off the *workflow* finishing rather than the release being
published, and that is not a stylistic choice. The `publish` job undrafts the
release using `GITHUB_TOKEN`, and GitHub will not let an action authenticated
with `GITHUB_TOKEN` raise events that start further workflow runs — the rule
that stops a workflow from triggering itself forever. A `release: published`
trigger here therefore never fires. It looked correct and sat at zero runs.

Version numbering: the manifest uses four fields and the Store reserves the
last, so `0.2.0` is packed as `0.2.0.0`. The packing script appends the zero.

## Known limits

- Microsoft supports GitHub Actions app updates **for free products only**. A
  paid listing has to be updated through Partner Center by hand.
- Every submission still goes through certification, which takes hours to days.
  A green workflow means *submitted*, not *live*.

## References

- [App package requirements for MSIX apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Publish app updates to Microsoft Store with GitHub Actions](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions)
- [Microsoft Store Developer CLI](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview)
