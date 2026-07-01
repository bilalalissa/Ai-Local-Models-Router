# Providers

Local AI Router normalizes provider behavior behind a shared adapter boundary.
The frontend does not call provider APIs directly; it uses Tauri commands that
delegate to Rust provider modules.

## Included Providers

- Ollama local HTTP adapter.
- LM Studio local HTTP adapter.
- Custom OpenAI-compatible endpoint adapter.
- MLX-LM Apple Silicon adapter.
- llama.cpp/custom OpenAI-compatible adapter.
- Windows remote broker as a remote provider source.

## Provider Responsibilities

Each provider reports:

- Health: healthy, starting, stopped, paused, degraded, or error.
- Capabilities: chat, streaming, model listing, install support, logs, and
  provider folder access where supported.
- Models available to the router.
- Tiny test chat behavior for local verification.
- Pause/resume hooks for provider-owned tasks.

Stage 14 remains conservative: real model downloads are not performed by tests,
and installer execution remains dry-run unless a later release explicitly adds
live downloads.

For users, the practical difference is:

- Provider health checks, model listing, and test chat are regular/live actions
  against providers you already run.
- Recommended setup/install flows are dry-run actions that preview commands and
  folders without installing runtimes or downloading model weights.

Companion apps can connect through the localhost
[Local Integration API](LOCAL_INTEGRATION_API.md). That API is regular/live for
health checks and chat routing, but it still depends on a provider process such
as Ollama, LM Studio, MLX-LM, or llama.cpp being started separately.
