# Final Verification

Stage 14 verification covers static checks, Rust checks, frontend builds,
packaging, and rendered UI smoke testing.

## Required Commands

```bash
npm run typecheck
npm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm --workspace apps/desktop run tauri:build -- --bundles app
```

## Rendered UI Smoke Test

Verify at least:

- Dashboard loads without console errors.
- Machine Specs loading/fixture/export controls render.
- Model Fit Map renders compatibility labels.
- Providers render health and test controls.
- Models render dry-run install state.
- Router renders mode controls, fallback candidates, and test prompt results.
- Remote PCs renders broker and client panels.
- Updates renders update cards and empty/history states.
- Settings and Logs render loading, empty, and error paths.
- Desktop and mobile browser viewports do not show incoherent overlap.

## Known Limitations

- Real model downloads are not implemented.
- Update checks use local fixtures.
- Release signing/notarization requires external credentials.
- Windows installers must be built and signed on Windows.
- Remote broker/client flows are trusted-LAN only.
