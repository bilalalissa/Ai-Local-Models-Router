# macOS Intel Setup

Intel Mac support is conservative. Prefer smaller models locally and use a
Windows broker for heavier models when available.

## What You Need

- macOS on Intel hardware.
- Node.js 20 or newer and Rust stable if running from source.
- Optional local providers:
  - Ollama.
  - LM Studio.
  - llama.cpp or another OpenAI-compatible local server.
- Optional Windows broker on the same LAN.

## Run From Source

```bash
npm install
npm run tauri:dev
```

## Build A Local App Bundle

```bash
npm run build:macos:intel
```

Open the generated app bundle:

```text
apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Local AI Router.app
```

## Recommended First Flow

1. Open **Machine Specs** and confirm RAM.
2. In **Model Fit Map**, avoid models marked `Tight` or `Avoid` on 8 GB Macs.
3. Start Ollama, LM Studio, or llama.cpp outside the app.
4. Refresh **Providers**.
5. Use **Router** in Local only or Auto mode for smaller models.

## Remote Windows Models

For larger models, pair a Windows broker:

1. Reserve or set a stable Windows broker IP.
2. Start broker sharing on Windows.
3. On the Mac, use **Remote PCs** to pin the fixed broker URL.
4. Use **Remote preferred** or **Remote only** in Router.
