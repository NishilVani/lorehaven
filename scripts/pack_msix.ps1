<#
.SYNOPSIS
  Packs the built Tauri executable into an unsigned MSIX for the Microsoft Store.

.DESCRIPTION
  Unsigned is correct here. The Store re-signs MSIX packages with a Microsoft
  certificate after certification, which is why an MSIX listing needs no
  code-signing certificate at all — see docs/MICROSOFT-STORE.md. A package
  signed by us would just have that signature replaced.

  Three identity values come from Partner Center and must match the reservation
  exactly, or the upload is rejected.

.PARAMETER Version
  Three-part version, e.g. 0.1.0. The fourth field is appended as 0 because the
  Store reserves it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$IdentityName,
  [Parameter(Mandatory = $true)][string]$Publisher,
  [Parameter(Mandatory = $true)][string]$PublisherDisplayName,
  [string]$ExePath = "src-tauri/target/release/LoreHaven.exe",
  [string]$OutDir = "msix-out"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExePath)) {
  throw "No executable at $ExePath. Run the Tauri build first."
}

# makeappx ships with the Windows SDK. Take the highest version present rather
# than pinning one, since the runner image moves.
$sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$makeappx = Get-ChildItem -Path $sdkRoot -Filter 'makeappx.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found under $sdkRoot. Is the Windows SDK installed?" }
Write-Host "Using $($makeappx.FullName)"

$stage = Join-Path $env:RUNNER_TEMP 'msix-stage'
if (-not $env:RUNNER_TEMP) { $stage = Join-Path ([IO.Path]::GetTempPath()) 'msix-stage' }
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null

# The payload: the executable, plus anything sitting beside it that it needs at
# runtime. Tauri statically links most of this, but a WebView2 loader shows up
# on some toolchains and its absence is a crash on launch, not a build error.
Copy-Item $ExePath (Join-Path $stage 'LoreHaven.exe')
Get-ChildItem (Split-Path $ExePath -Parent) -Filter '*.dll' -File -ErrorAction SilentlyContinue |
  ForEach-Object { Copy-Item $_.FullName (Join-Path $stage $_.Name) }

# Every logo the manifest names has to exist in the package.
$required = @(
  'Square44x44Logo.png', 'Square71x71Logo.png', 'Square150x150Logo.png',
  'Square310x310Logo.png', 'StoreLogo.png'
)
foreach ($asset in $required) {
  $src = Join-Path 'src-tauri/icons' $asset
  if (-not (Test-Path $src)) { throw "Missing icon $src. Regenerate with: npm run tauri icon" }
  Copy-Item $src (Join-Path $stage "Assets\$asset")
}

$manifest = Get-Content 'src-tauri/msix/AppxManifest.xml' -Raw
$manifest = $manifest.
  Replace('{{IDENTITY_NAME}}', $IdentityName).
  Replace('{{PUBLISHER}}', $Publisher).
  Replace('{{PUBLISHER_DISPLAY_NAME}}', $PublisherDisplayName).
  Replace('{{VERSION}}', "$Version.0")
Set-Content -Path (Join-Path $stage 'AppxManifest.xml') -Value $manifest -Encoding UTF8

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$out = Join-Path $OutDir "LoreHaven-$Version.msix"

& $makeappx.FullName pack /d $stage /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }

Write-Host "Packed $out ($([math]::Round((Get-Item $out).Length / 1MB, 2)) MB)"
"msix=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
