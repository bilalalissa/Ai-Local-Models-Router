# Local Integration API

Local AI Router exposes a localhost-only integration API for companion apps such
as LLM Agent Learning Boost.

## Base URLs

Use these settings on the same Mac:

```env
LOCAL_AI_ROUTER_BASE_URL=http://127.0.0.1:17640
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:17640/v1
OPENAI_COMPAT_AUTH_METHOD=none
DEFAULT_AI_PROVIDER=openai_compat
DEFAULT_AI_MODEL=local-model
LOCAL_AI_ROUTER_AUTO_INSTALL=true
```

The localhost API does not require a bearer token because it binds to
`127.0.0.1` only. It is separate from the Windows LAN broker, which is intended
for trusted-network pairing and can require bearer tokens.

## Health Checks

Check the router itself:

```bash
curl http://127.0.0.1:17640/api/health
```

Check OpenAI-compatible model discovery:

```bash
curl http://127.0.0.1:17640/v1/models
```

If these fail with connection refused, Local AI Router is not running or another
process is using port `17640`.

## What The Router Provides

The integration API answers:

- `GET /api/health`
- `GET /api/integration/manifest`
- `GET /api/integration/config`
- `POST /api/integration/recommend`
- `POST /api/integration/select-model`
- `POST /api/integration/select-runtime`
- `GET /api/integration/providers`
- `GET /v1/models`
- `POST /v1/chat/completions`

`/api/integration/config` returns a copy/export-friendly JSON payload with the
current router URL, OpenAI-compatible URL, Learning Boost environment values,
installer capabilities, memory cleanup capabilities, selected runtime if one is
reachable, and provider health states.

`/v1/models` always exposes the stable `local-model` alias for companion apps.
`/api/integration/select-model` and `/api/integration/select-runtime` let a
companion app choose the runtime behind that alias before sending chat. The
manifest advertises this with `capabilities.model_switching: true`.

The manifest and config also advertise memory cleanup support:

- `capabilities.unload_model_from_memory`
- `capabilities.remove_model_weights`
- `memory_capabilities.remove_model_weights_supported_providers`

In this stage, Local AI Router supports memory unload and disk weight removal
for Ollama through provider-native APIs. Removing weights requires user
confirmation in the desktop UI and the model must be downloaded again before
reuse.

Selection requests can include:

```json
{
  "task": "summarize_sources",
  "context_size": "large",
  "needs": ["arabic", "reasoning", "low_latency"],
  "prefer_local": true,
  "model": "llama-3-1-8b-q4"
}
```

`model` is optional. When it is absent, Local AI Router maps common workflows to
candidate local models:

- quick chat: fast model first
- source ingest and transcript summarization: balanced summarization model first
- Arabic content and planning/reasoning: stronger reasoning model first
- code/card generation: coding model first

For chat, the router forwards non-streaming requests to the selected runtime or
the first reachable local provider in this order:

1. Ollama
2. LM Studio
3. MLX-LM
4. llama.cpp
5. Custom OpenAI-compatible endpoint

## What You Still Need To Run

The router API being reachable does not mean a model server is running. You can
start at least one local provider manually, or use the desktop app's supported
macOS automatic setup from **Models > Live install and run > Auto install and
run**:

- Ollama: `http://127.0.0.1:11434`
- LM Studio local server: `http://127.0.0.1:1234/v1`
- MLX-LM server: `http://127.0.0.1:8080/v1`
- llama.cpp server: `http://127.0.0.1:8081/v1`

When no provider answers, `/v1/chat/completions` returns an OpenAI-compatible
`503` error with code `no_local_provider`. That means the Learning Boost
configuration is pointed at the router correctly, but no underlying local model
server is available yet.

## Regular vs Dry-Run Behavior

The localhost integration API is regular/live behavior: health checks and chat
requests contact real processes running on your Mac.

The recommended installer flows can run in dry-run or live mode. Dry-run shows
commands and folders without changing the machine. Live mode can install
Ollama, start it, and pull the recommended model after explicit consent.
**Auto install and run** executes the supported live plan from the desktop app;
the localhost API advertises that capability but does not run package-manager
commands without the user's in-app consent. See [Regular vs Dry-Run
Methods](REGULAR_VS_DRY_RUN.md).
