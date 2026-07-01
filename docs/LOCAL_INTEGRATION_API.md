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
- `POST /api/integration/recommend`
- `GET /api/integration/providers`
- `GET /v1/models`
- `POST /v1/chat/completions`

`/v1/models` always exposes the stable `local-model` alias for companion apps.
For chat, the router forwards non-streaming requests to the first reachable
local provider in this order:

1. Ollama
2. LM Studio
3. MLX-LM
4. llama.cpp
5. Custom OpenAI-compatible endpoint

## What You Still Need To Run

The router API being reachable does not mean a model server is running. Start at
least one local provider before expecting chat responses:

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

The recommended installer flows are dry-run behavior: they show commands and
folders but do not install runtimes, change package managers, or download model
weights. See [Regular vs Dry-Run Methods](REGULAR_VS_DRY_RUN.md).
