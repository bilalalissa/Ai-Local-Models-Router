$ErrorActionPreference = "Stop"

npm --workspace apps/desktop run tauri:build -- --bundles msi,nsis
