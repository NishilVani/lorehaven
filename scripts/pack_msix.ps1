<#
.SYNOPSIS
  Packs the built Tauri executable into an unsigned MSIX for the Microsoft Store.

.DESCRIPTION
  Unsigned is correct here. The Store re-signs MSIX packages with a Microsoft
  certificate after certification, which is why an MSIX listing needs no
  code-signing certificate at all — see docs/MICROSOFT-STORE.md. A package
  signed by us would just have that signature replaced.

  The Partner Center identity lives in src-tauri/msix/AppxManifest.xml. It is
  fixed for the life of the app and is not secret, so it is not passed in.

.PARAMETER Version
  Three-part version, e.g. 0.1.0. The fourth field is appended as 0 because the
  Store reserves it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  # The Cargo package is named "app" (src-tauri/Cargo.toml), so cargo emits
  # app.exe. Tauri only renames it to productName while bundling, and the MSIX
  # is packed from the raw target directory — so app.exe is what is there.
  # It is copied in as LoreHaven.exe, which is what AppxManifest declares.
  [string]$ExePath = "src-tauri/target/release/app.exe",
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

# RUNNER_TEMP only exists on a GitHub runner; fall back for local runs.
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$stage = Join-Path $tempRoot 'msix-stage'
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
  'StoreLogo.png'
)
foreach ($asset in $required) {
  $src = Join-Path 'src-tauri/icons' $asset
  if (-not (Test-Path $src)) { throw "Missing icon $src. Regenerate with: npm run tauri icon" }
  Copy-Item $src (Join-Path $stage "Assets\$asset")
}

$manifest = (Get-Content 'src-tauri/msix/AppxManifest.xml' -Raw).Replace('{{VERSION}}', "$Version.0")
if ($manifest -match '\{\{') {
  throw "AppxManifest.xml still has an unsubstituted placeholder."
}
Set-Content -Path (Join-Path $stage 'AppxManifest.xml') -Value $manifest -Encoding UTF8

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$out = Join-Path $OutDir "LoreHaven-$Version.msix"

& $makeappx.FullName pack /d $stage /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }

Write-Host "Packed $out ($([math]::Round((Get-Item $out).Length / 1MB, 2)) MB)"
if ($env:GITHUB_OUTPUT) {
  "msix=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
}
