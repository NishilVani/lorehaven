# Publishing to the Microsoft Store

LoreHaven ships to the Store as an **MSI/EXE app**, not an MSIX. The Store does
not host the binary in that model: you host it, and Partner Center stores a URL
pointing at it. That URL is a GitHub Release asset produced by
[the release workflow](../.github/workflows/release.yml).

## Why a versioned URL, not `latest`

Microsoft's rule is explicit: *the binary associated with a submitted URL must
not change after submission*, and every update needs a **new versioned URL**
([app package requirements][reqs]).

So the submission points at:

```
https://github.com/NishilVani/lorehaven/releases/download/v0.1.0/LoreHaven_0.1.0_x64_en-US.msi
```

and **not** at `/releases/latest/download/...`. The `latest` form is a moving
target — the same URL would serve a different binary after every release, which
is the thing the requirement forbids. Each new version instead gets a fresh
immutable asset URL and a fresh submission, which
[store-submission.yml](../.github/workflows/store-submission.yml) does
automatically when a release is published.

## What the installer has to satisfy

| Requirement | How LoreHaven meets it |
|---|---|
| `.msi` or `.exe` only | Tauri's WiX bundle produces `LoreHaven_<version>_x64_en-US.msi` |
| Authenticode signed, chaining to a CA in the Microsoft Trusted Root Program — **self-signed is rejected** | The release workflow signs when `WINDOWS_CERTIFICATE_BASE64` is set |
| Silent install — no installer UI (a UAC prompt is allowed) | MSI: `/quiet`. Declare it in Partner Center |
| Standalone, not a downloader stub | The Tauri MSI is self-contained |

[reqs]: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements

### Code signing certificate

This is the one hard cost and the most common thing to get stuck on. A
self-signed certificate will not pass certification. The options:

- **Azure Trusted Signing** — around $10/month, no hardware token, the cheapest
  route for an individual publisher. Requires an Azure subscription and an
  identity validation.
- **OV / EV code signing certificate** from a CA (DigiCert, Sectigo, SSL.com) —
  roughly $200–600/year, usually shipped on a hardware token, which makes CI
  signing awkward unless the CA offers a cloud signing service.

See [Microsoft's comparison of the options][signing].

[signing]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options

## One-time setup

These steps need your identity and your money, so they are yours to do — none of
them can be automated away.

1. **Register as a Windows app developer** at
   https://partner.microsoft.com/dashboard. There is a one-time registration
   fee and an identity verification step.
2. **Reserve the app name** in Partner Center. This produces a **Product ID** —
   the value the workflows call `MS_STORE_PRODUCT_ID`.
3. **Obtain a code signing certificate** (see above) and export it as a
   password-protected `.pfx`.
4. **Associate a Microsoft Entra tenant** with the Partner Center account, then
   [register an application][entra] in it.
5. In Partner Center, under **Account settings → User management → Microsoft
   Entra applications**, add that application and give it the **Manager** role.
6. **Create the first submission by hand** in Partner Center: listing text,
   screenshots, age rating, the installer URL from the first GitHub Release, and
   the silent install/uninstall parameters. The automation below only *updates*
   an app that is already live.

[entra]: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

## Repository configuration

**Settings → Secrets and variables → Actions.**

Secrets:

| Secret | Where it comes from |
|---|---|
| `AZURE_AD_TENANT_ID` | Entra admin center → Identity → Overview → Tenant ID |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Entra → App registrations → your app → Application (client) ID |
| `AZURE_AD_APPLICATION_SECRET` | Entra → your app → Certificates & secrets → New client secret. **Copy it immediately; it is shown once.** |
| `SELLER_ID` | Partner Center → Account settings → Identifiers → Seller ID |
| `WINDOWS_CERTIFICATE_BASE64` | Your `.pfx`, base64-encoded (see below) |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` password |

Variables (these are not secret):

| Variable | Value |
|---|---|
| `MS_STORE_PRODUCT_ID` | The Product ID from the name reservation |

To base64 the certificate:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx")) | Set-Clipboard
```

## Wiring up the automation

Once the app is live in the Store:

1. Run the **Store — fetch base submission** workflow from the Actions tab. It
   calls `msstore submission get` and prints the submission JSON that Partner
   Center currently holds.
2. Copy that JSON into `store/package.json` and commit it. This is the real
   schema for your app — the automation patches it rather than inventing one.
3. Done. From the next release onward, **Store — submit release** fires when a
   release is published, rewrites `packageUrl` to that release's immutable
   installer URL, and calls `msstore submission update` + `publish`.

The workflow checks the installer URL with a HEAD request before submitting, so
a failed Windows build surfaces immediately instead of as a certification
rejection days later.

## Known limits

- Microsoft currently supports GitHub Actions app updates **for free products
  only**. A paid listing has to be updated through Partner Center by hand.
- Every submission still goes through certification, which takes hours to days.
  A published workflow run means *submitted*, not *live*.

## References

- [App package requirements for MSI/EXE apps](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [Create an app submission for your MSI/EXE app](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission)
- [Publish app updates to Microsoft Store with GitHub Actions](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions)
- [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
