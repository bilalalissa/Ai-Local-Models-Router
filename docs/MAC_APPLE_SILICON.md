# macOS Apple Silicon Setup

Apple Silicon is the preferred Mac target for MLX-LM and efficient local
models.

## What You Need

- macOS on Apple Silicon.
- Node.js 20 or newer and Rust stable if running from source.
- Optional local providers:
  - MLX-LM for Apple Silicon optimized models.
  - Ollama for general local model workflows.
  - LM Studio for GUI-managed local providers.
- Optional Windows broker on the same LAN for larger remote models.

## Run From Source

```bash
npm install
npm run tauri:dev
```

## Build A Local App Bundle

```bash
npm run build:macos:apple-silicon
```

Open the generated app bundle:

```text
apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Local AI Router.app
```

Unsigned local bundles may require macOS security approval. Public distribution
requires Developer ID signing and notarization.

## Recommended First Flow

1. Open **Machine Specs** and refresh live hardware.
2. Open **Model Fit Map** and look for `Smooth` or `Good` Apple Silicon models.
3. Start MLX-LM, Ollama, or LM Studio outside the app.
4. Open **Providers** and refresh health.
5. Open **Router** and run a local test prompt.

## Remote Windows Models

Use remote routing when a Windows machine has stronger GPU resources:

1. Enable broker mode on Windows.
2. Pair from the Mac through **Remote PCs**.
3. Use fixed broker address if the Windows PC has a reserved/static LAN IP.
4. Choose **Remote preferred** or **Remote only** in Router.
