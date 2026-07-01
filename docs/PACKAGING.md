# Packaging and Installers

Stage 13 adds repeatable packaging commands for macOS Apple Silicon, macOS
Intel, optional universal macOS builds, and Windows x64 installers. Packaging is
scripted, but public distribution still requires signing credentials that are
not stored in this repository.

## macOS

Run from a macOS host:

```bash
npm run build:macos:apple-silicon
npm run build:macos:intel
npm run build:macos:universal
```

The scripts call Tauri with these Rust targets:

- Apple Silicon: `aarch64-apple-darwin`
- Intel Mac: `x86_64-apple-darwin`
- Universal: `universal-apple-darwin`

Artifacts are emitted under `apps/desktop/src-tauri/target/**/bundle/`.

The default script builds `.app` bundles because they are deterministic in local
CI/developer environments. DMG output is available for release machines:

```bash
./scripts/build_macos_app.sh apple-silicon app,dmg
./scripts/build_macos_app.sh intel app,dmg
./scripts/build_macos_app.sh universal app,dmg
```

If DMG packaging fails after the `.app` is produced, verify signing,
notarization prerequisites, Finder/AppleScript access, and `hdiutil`
availability on the release machine.

## Windows

Run from Windows 10/11 x64 with Node, Rust, WebView2, Visual Studio Build Tools,
and PowerShell:

```powershell
npm run build:windows
```

The script builds `x86_64-pc-windows-msvc` MSI and NSIS bundles.

## Signing Placeholders

The repository intentionally does not contain certificates, private keys, Apple
IDs, app-specific passwords, Windows PFX files, or timestamp credentials.

macOS release signing requires:

- Apple Developer ID Application certificate.
- Hardened runtime enabled through Tauri/macOS signing configuration.
- Notarization credentials managed outside the repository.
- Stapling, `codesign --verify --deep --strict`, and Gatekeeper verification
  before publishing.

Windows release signing requires:

- Authenticode certificate or hardware-backed signing provider.
- Timestamp server configuration.
- MSI and NSIS signature verification on a clean Windows machine.

Unsigned artifacts are suitable for local verification only.

## Packaging vs Dry-Run Installers

Packaging commands are regular build commands: they compile the app and create
local app/installer artifacts.

The in-app **Models** installer flow is separate from packaging. It defaults to
dry-run previews. Live install mode can execute runnable macOS Ollama setup
steps after explicit consent.
