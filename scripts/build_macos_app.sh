#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Build Local AI Router macOS bundles.

Usage:
  ./scripts/build_macos_app.sh [apple-silicon|intel|universal|host] [bundles]

Targets:
  apple-silicon  Build aarch64-apple-darwin bundles.
  intel          Build x86_64-apple-darwin bundles.
  universal      Build universal-apple-darwin bundles.
  host           Build for the current Rust host target.

Bundles:
  app            Default. Build the macOS .app bundle.
  app,dmg        Build .app and .dmg. Use on a release machine with signing and
                 notarization prerequisites available.

Signing:
  Set APPLE_SIGNING_IDENTITY before running to request Tauri/macOS signing.
  Notarization still requires Apple credentials and is documented in
  docs/PACKAGING.md and docs/RELEASE_CHECKLIST.md.
USAGE
}

target="${1:-host}"
bundles="${2:-app}"

case "$bundles" in
  app|app,dmg)
    ;;
  *)
    echo "Unsupported bundle list: $bundles" >&2
    usage >&2
    exit 2
    ;;
esac

case "$target" in
  apple-silicon)
    rust_target="aarch64-apple-darwin"
    rustup_targets=("aarch64-apple-darwin")
    ;;
  intel)
    rust_target="x86_64-apple-darwin"
    rustup_targets=("x86_64-apple-darwin")
    ;;
  universal)
    rust_target="universal-apple-darwin"
    rustup_targets=("aarch64-apple-darwin" "x86_64-apple-darwin")
    ;;
  host)
    rust_target=""
    rustup_targets=()
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS bundles must be built on macOS." >&2
  exit 1
fi

if [[ -n "$rust_target" ]]; then
  for required_target in "${rustup_targets[@]}"; do
    rustup target add "$required_target" >/dev/null
  done
  npm --workspace apps/desktop run tauri:build -- --target "$rust_target" --bundles "$bundles"
else
  npm --workspace apps/desktop run tauri:build -- --bundles "$bundles"
fi

echo "macOS artifacts:"
find apps/desktop/src-tauri/target -path "*bundle/macos/*.app" -o -path "*bundle/dmg/*.dmg" | sort
