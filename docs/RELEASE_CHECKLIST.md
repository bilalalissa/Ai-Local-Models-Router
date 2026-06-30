# Release Checklist

Use this checklist before publishing a Stage 14 build.

## Source State

- `git status --short` is clean.
- `origin` points to `https://github.com/bilalalissa/Ai-Local-Models-Router.git`.
- `README.md` lists the completed stage and known limitations.
- `LICENSE` is present and uses the MIT License.

## Automated Verification

- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm --workspace apps/desktop run tauri:build -- --bundles app`
- Rendered UI smoke test across desktop and mobile browser viewports.

## Packaging

- macOS Apple Silicon `.app` built with `npm run build:macos:apple-silicon`.
- macOS Intel `.app` built with `npm run build:macos:intel`.
- macOS universal `.app` built with `npm run build:macos:universal` when
  practical.
- macOS DMG built with `./scripts/build_macos_app.sh <target> app,dmg` on a
  signed release machine.
- Windows x64 MSI/NSIS built with `npm run build:windows` on Windows.
- Artifact names include app name, platform, architecture, and version.

## Signing and Distribution

- macOS app is signed with a Developer ID certificate.
- macOS app is notarized and stapled.
- `spctl` and `codesign --verify --deep --strict` pass on a clean Mac.
- Windows MSI/NSIS artifacts are Authenticode signed and timestamped.
- Windows installer passes SmartScreen/manual install smoke testing.
- Release notes call out dry-run installers, fixture update metadata, and local
  broker security limits.
