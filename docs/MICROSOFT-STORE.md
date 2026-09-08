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
substitutes the identity values into
[`src-tauri/msix/AppxManifest.xml`](../src-tauri/msix/AppxManifest.xml), and runs
`makeappx pack`.

The package is left **unsigned on purpose**. Signing it would only mean
Microsoft replacing that signature during certification.

It is a normal Win32 program in an MSIX container, which the manifest declares
with `EntryPoint="Windows.FullTrustApplication"` and the `runFullTrust`
capability. Without both it builds fine and then fails certification.

## One-time setup

You already have a Partner Center account, so most of this is done. What
LoreHaven still needs:

1. **Reserve the app name** in Partner Center. This produces the **Product ID**
   and the package identity values.
2. **Read the identity** from **Product management → Product identity**. Three
   values, and the package is rejected if any differs by a character:
   - **Package/Identity/Name** — like `12345Publisher.LoreHaven`
   - **Package/Identity/Publisher** — the `CN=…` string
   - **Publisher display name**
3. **Register an application in Microsoft Entra ID**, then add it in Partner
   Center under **Account settings → User management → Microsoft Entra
   applications** with the **Manager** role.
4. **Create the first submission by hand** in Partner Center — listing text,
   screenshots, age rating, and the first MSIX. The automation *updates* an app
   that already exists; it does not create the listing.

## Repository configuration

**Settings → Secrets and variables → Actions.**

Variables (not secret):

| Variable | Where to find it |
|---|---|
| `MS_STORE_PRODUCT_ID` | Partner Center, from the name reservation |
| `MS_STORE_IDENTITY_NAME` | Product identity → Package/Identity/Name |
| `MS_STORE_PUBLISHER` | Product identity → Package/Identity/Publisher (`CN=…`) |
| `MS_STORE_PUBLISHER_DISPLAY_NAME` | Product identity → Publisher display name |

Secrets:

| Secret | Where to find it |
|---|---|
| `AZURE_AD_TENANT_ID` | Entra admin center → Identity → Overview |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Entra → App registrations → your app → Application (client) ID |
| `AZURE_AD_APPLICATION_SECRET` | Entra → your app → Certificates & secrets. **Shown once — copy it immediately.** |
| `SELLER_ID` | Partner Center → Account settings → Identifiers |

Until `MS_STORE_IDENTITY_NAME` exists the release workflow skips the MSIX step
with a warning rather than failing, so releases keep working before the Store is
wired up.

## What happens on a release

1. You tag a version. The Windows job builds the app, packs the MSIX, and
   attaches `LoreHaven-<version>.msix` to the draft release.
2. When every platform succeeds the release is published.
3. **Store — submit release** fires on that event, downloads the MSIX from the
   release, and runs `msstore publish`.

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
