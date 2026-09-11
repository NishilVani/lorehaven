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
rejected package. It is also the name shown as the publisher on the listing.
The listing is now live, so treat the identity as fixed: every update has to
carry exactly these values. Changing the publisher display name in Partner
Center later would mean updating `PublisherDisplayName` in the manifest too, and
the `Package/Identity/Name` prefix, derived from the publisher name at
reservation, may not follow the rename.

## Status

LoreHaven is **live** at https://apps.microsoft.com/detail/9N7FD5QBSMBB, with
`0.1.0` submitted by hand through Partner Center. That first submission was
always going to be manual: the automation *updates* a listing that already
exists, it does not create one.

## Connecting the pipeline to the Store

It needs one Microsoft Entra application with access to the Partner Center
account, and four secrets.

### 1. Partner Center: an Entra application with the Manager role

1. Sign in to Partner Center with an account that is a **Manager** *and* a
   **global administrator** of the Entra tenant. Partner Center requires both
   before it lets you manage applications. The account also has to be associated
   with a Microsoft Entra tenant; if it is not, associate or create one first
   ([how][tenant]).
2. **Account settings → User management → Microsoft Entra applications → Add
   Microsoft Entra application → Create Microsoft Entra application.** Give it a
   display name such as `LoreHaven GitHub Actions`. Partner Center also asks for a
   reply URL; this application never signs anyone in, so the site URL
   (`https://moctalegames.web.app/`) is fine.
3. Assign the **Manager** role. It is broad, and it is what Microsoft's GitHub
   Actions guide requires. That breadth is why the key below lives behind the
   `production` approval rather than in a repository secret.
4. Open the application and choose **Add new key**. Copy the **Client ID** and
   the **Key** before leaving the page; the key is never shown again. The same
   application page shows the **Tenant ID**.
5. Find the **Seller ID** under **Account settings**, on the developer settings
   or identifiers page. When this account was first set up that page returned
   "Access restricted", so it may need the Manager sign-in from step 1.

[tenant]: https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/associate-existing-azure-ad-tenant-with-partner-center-account

### 2. GitHub: four environment secrets

Add them on the **production** environment
(https://github.com/NishilVani/lorehaven/settings/environments, then
**production**, then **Add environment secret**), the same place as
`FIREBASE_CONFIG_WRITER`:

| Secret | Value |
|---|---|
| `AZURE_AD_TENANT_ID` | Tenant ID |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Client ID |
| `AZURE_AD_APPLICATION_SECRET` | The key |
| `SELLER_ID` | Seller ID |

Environment secrets, not repository secrets: with the Manager role this
application can change anything in the Partner Center account, and an
environment secret is only handed to a job after you approve it. Both jobs that
read these, `store` in `release.yml` and `store-submission.yml`, declare
`environment: production`.

**The key expires.** The application page in Partner Center shows each key's
expiry date. When it lapses the `store` job stops authenticating; add a new key
and replace `AZURE_AD_APPLICATION_SECRET`.

## What happens on a release

1. `release.yml` builds every platform. The Windows leg packs
   `LoreHaven-<version>.msix` and attaches it to the draft release.
2. `publish` makes the release public. `app-config` and `store` run after it,
   each once you approve.
3. `store` downloads that MSIX from the release, configures the Store CLI, and
   runs `msstore publish <file> -id 9N7FD5QBSMBB -v`, which uploads the package
   and commits a new submission. It then logs the submission's status.
4. Certification takes hours to days. **A green `store` job means submitted, not
   live.**

Without the four secrets `store` fails on purpose, after the release is already
public. A green run that submitted nothing is the failure this path already had
once, when it hung off `release: published`, which a `GITHUB_TOKEN` action never
raises, and it sat at zero runs looking healthy.

To submit a release that already exists (a failed submission, or a release cut
before the secrets existed), run **Store — resubmit a release** from the Actions
tab with the tag.

**Submitting replaces any unsubmitted draft.** When the app already has a
published submission, `msstore publish` deletes the pending draft and starts a
new one from the last published submission, discarding changes staged in that
draft. Submit listing edits in Partner Center before the next release goes out,
or they are lost.

Version numbering: the manifest uses four fields and the Store reserves the
last, so `0.2.0` is packed as `0.2.0.0`. The packing script appends the zero.

## Known limits

- Microsoft supports Store CLI and GitHub Actions app updates **for free products
  only**. A paid listing has to be updated through Partner Center by hand.
- The pipeline updates the **package** only. Listing text, screenshots and
  release notes stay as the last published submission had them; change those in
  Partner Center.

## References

- [App package requirements for MSIX apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Publish app updates to Microsoft Store with GitHub Actions](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions)
- [Microsoft Store Developer CLI commands](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/commands)
- [Manage Microsoft Entra applications in Partner Center](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/manage-azure-ad-applications-in-partner-center)
- [microsoft/microsoft-store-apppublisher](https://github.com/microsoft/microsoft-store-apppublisher)
