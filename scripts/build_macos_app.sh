#!/usr/bin/env bash
set -euo pipefail

npm --workspace apps/desktop run tauri:build -- --bundles app,dmg
