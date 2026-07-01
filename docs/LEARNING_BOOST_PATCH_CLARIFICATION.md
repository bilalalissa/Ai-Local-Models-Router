# Learning Boost Patch Clarification

This note is for the LLM Agent Learning Boost operator or developer applying
the Local AI Router integration patch.

## What Changed In Local AI Router

Local AI Router now exposes a localhost integration contract that Learning
Boost can use without talking directly to Ollama, LM Studio, MLX-LM, or
llama.cpp.

Use this endpoint as the stable OpenAI-compatible base URL:

```text
http://127.0.0.1:17640/v1
```

Use this model name from Learning Boost:

```text
local-model
```

`local-model` is an alias. Local AI Router maps it to the currently selected
provider runtime model, for example Ollama `llama3.1:8b`.

## Required Learning Boost Settings

Use these values in:

```text
/Users/ba/Library/Application Support/LLM Agent Learning Boost/config.env
```

```env
DEFAULT_AI_PROVIDER=openai_compat
DEFAULT_AI_MODEL=local-model
OPENAI_COMPAT_BASE_URL=http://127.0.0.1:17640/v1
OPENAI_COMPAT_AUTH_METHOD=none
LOCAL_AI_ROUTER_AUTOSTART=true
LOCAL_AI_ROUTER_BASE_URL=http://127.0.0.1:17640
LOCAL_AI_ROUTER_AUTO_APPLY=true
LOCAL_AI_ROUTER_AUTO_START_PROVIDER=true
LOCAL_AI_ROUTER_AUTO_INSTALL=true
```

If Learning Boost launches a development build of Local AI Router, also set:

```env
LOCAL_AI_ROUTER_COMMAND=/Users/ba/Code/Local-Ai-Model-Router/apps/desktop/src-tauri/target/debug/local-ai-router-desktop
```

## What Learning Boost Should Call

On startup or settings refresh:

```bash
curl http://127.0.0.1:17640/api/integration/config
```

Before each workflow, ask Local AI Router to choose the runtime behind
`local-model`.

Quick chat:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{"task":"quick_chat","needs":["low_latency"],"prefer_local":true}'
```

Source ingest or transcript summarization:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{"task":"summarize_sources","context_size":"large","needs":["summarization"],"prefer_local":true}'
```

Arabic planning or reasoning:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{"task":"plan_drafting","needs":["arabic","reasoning"],"prefer_local":true}'
```

Explicit override:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{"model":"llama-3-1-8b-q4"}'
```

Then send normal chat to:

```text
POST http://127.0.0.1:17640/v1/chat/completions
```

with:

```json
{
  "model": "local-model",
  "stream": false,
  "messages": [
    { "role": "user", "content": "Say ready." }
  ]
}
```

## Important Behavior

- Learning Boost should keep using `local-model`; it should not send Ollama
  runtime names directly.
- Local AI Router owns provider/model switching.
- `select-model` and `select-runtime` are equivalent in this stage.
- If the preferred model for a workflow is not installed, Local AI Router falls
  back to the first reachable chat model.
- `LOCAL_AI_ROUTER_AUTO_INSTALL=true` means Learning Boost may request an
  install-capable recommendation. Local AI Router still requires in-app user
  consent before package-manager commands or model downloads run.
- Streaming is not supported by the localhost integration API in this stage.

## Verification Checklist

1. `curl http://127.0.0.1:17640/api/health` returns `200`.
2. `curl http://127.0.0.1:17640/api/integration/manifest` includes
   `model_switching: true`.
3. `curl http://127.0.0.1:17640/api/integration/config` includes
   `LOCAL_AI_ROUTER_AUTO_INSTALL=true`.
4. `POST /api/integration/select-model` returns `ok: true`, `provider_id`, and
   `runtime_model`.
5. `POST /v1/chat/completions` with `model: local-model` returns
   `choices[0].message.content`.

## Why This Patch Was Needed

The earlier failure happened because Learning Boost was configured correctly but
Local AI Router forwarded catalog model IDs such as `llama-3-1-8b-q4` to Ollama.
Ollama had the runtime model installed as `llama3.1:8b`, so the provider returned
HTTP `404`. Local AI Router now maps catalog IDs to provider runtime names and
keeps a selected runtime model behind the stable `local-model` alias.
