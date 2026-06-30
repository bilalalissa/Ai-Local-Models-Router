param(
  [ValidateSet("x64")]
  [string]$Target = "x64"
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows installers must be built on Windows 10/11 x64."
}

if ($Target -ne "x64") {
  throw "Only Windows x64 packaging is supported for Local AI Router."
}

# Optional code signing placeholders:
#   $env:TAURI_SIGNING_PRIVATE_KEY
#   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   Windows Authenticode certificate setup for MSI/NSIS signing.
# See docs/PACKAGING.md and docs/RELEASE_CHECKLIST.md before publishing.

npm --workspace apps/desktop run tauri:build -- --target x86_64-pc-windows-msvc --bundles msi,nsis

Write-Host "Windows artifacts:"
Get-ChildItem -Path "apps/desktop/src-tauri/target" -Recurse -Include *.msi,*.exe |
  Sort-Object FullName |
  ForEach-Object { $_.FullName }
