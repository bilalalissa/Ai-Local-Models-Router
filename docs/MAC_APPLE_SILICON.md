# macOS Apple Silicon

Apple Silicon is the preferred macOS target for MLX-LM and efficient local
models. Stage 14 supports detection, compatibility scoring, local provider
checks, dry-run installer plans, remote Windows broker pairing, and packaging.

## Build

```bash
npm run build:macos:apple-silicon
```

## Recommended Providers

- MLX-LM for Apple Silicon optimized models.
- Ollama for general local model management.
- LM Studio for manual desktop provider workflows.
- Remote Windows broker when a Windows machine has stronger GPU resources.

## Release Notes

Signed public releases require Apple Developer ID signing and notarization.
Unsigned local bundles are for developer verification only.
