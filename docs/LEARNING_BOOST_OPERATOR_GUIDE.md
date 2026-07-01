# LLM Agent Learning Boost Operator Guide

Use this guide when LLM Agent Learning Boost needs to communicate with Local AI
Router on the same Mac.

## What Connects To What

Learning Boost talks to Local AI Router through the localhost OpenAI-compatible
endpoint:

```text
Learning Boost -> http://127.0.0.1:17640/v1 -> Local AI Router -> local provider -> model
```

Local AI Router is the control plane and router. The actual model still runs in
a provider such as Ollama, LM Studio, MLX-LM, llama.cpp, or a custom
OpenAI-compatible server.

## Recommended Learning Boost Settings

Set these values in:

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

`LOCAL_AI_ROUTER_AUTO_INSTALL=true` lets Learning Boost ask the router for an
install-capable recommendation. Local AI Router still requires user consent in
the desktop app before it runs package-manager commands or downloads model
weights. To run the setup, open **Models**, choose **Live install and run**,
check the consent box, then click **Auto install and run**.

If you launch Local AI Router from a development binary, also set:

```env
LOCAL_AI_ROUTER_COMMAND=/Users/ba/Code/Local-Ai-Model-Router/apps/desktop/src-tauri/target/debug/local-ai-router-desktop
```

## Copy The Current Router JSON

In Local AI Router:

1. Open **Router**.
2. Find **Manual configuration JSON**.
3. Click **Copy JSON** or **Export JSON**.
4. Use the `learning_boost_env` block for manual Learning Boost setup.
5. Use `provider_runtime` to see which provider server and model are actually
   active.

You can also fetch the same style of configuration from the local API:

```bash
curl http://127.0.0.1:17640/api/integration/config
```

## Verify The Router API

Router health:

```bash
curl http://127.0.0.1:17640/api/health
```

Router model alias:

```bash
curl http://127.0.0.1:17640/v1/models
```

Learning Boost recommendation:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/recommend \
  -H 'content-type: application/json' \
  --data '{"use_case":"learning_boost_local","local_first":true}'
```

Expected result: all three commands return HTTP `200`.

## Select A Model For A Workflow

Learning Boost can ask Local AI Router to select the best currently available
runtime model before a workflow starts. The app then keeps using
`model: local-model`; Local AI Router maps that alias to the selected runtime
model.

Quick chat:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{
    "task": "quick_chat",
    "needs": ["low_latency"],
    "prefer_local": true
  }'
```

Source ingest or transcript summarization:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{
    "task": "summarize_sources",
    "context_size": "large",
    "needs": ["summarization"],
    "prefer_local": true
  }'
```

Arabic planning or reasoning:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{
    "task": "plan_drafting",
    "needs": ["arabic", "reasoning"],
    "prefer_local": true
  }'
```

Explicit model override:

```bash
curl -X POST http://127.0.0.1:17640/api/integration/select-model \
  -H 'content-type: application/json' \
  --data '{"model":"llama-3-1-8b-q4"}'
```

Expected result: HTTP `200` with `provider_id`, `runtime_model`, and
`chat_model: "local-model"`. If the preferred task model is not installed, the
router falls back to the first available chat model from a reachable provider.
The equivalent endpoint `/api/integration/select-runtime` is also available.

## Start A Model Provider

If chat returns `no_local_provider`, Local AI Router is reachable but no model
server is answering yet. You can let Local AI Router handle the supported macOS
Ollama setup from **Models > Live install and run > Auto install and run**, or
start a provider manually.

Choose one provider:

### Ollama

```bash
brew install ollama
ollama serve
ollama pull llama3.1:8b
```

Then verify:

```bash
curl http://127.0.0.1:11434/api/tags
```

Local AI Router can attempt `ollama serve` from the provider **Start provider**
action when Ollama is installed.

### LM Studio

1. Install LM Studio.
2. Download a chat model.
3. Open the Local Server panel.
4. Start the OpenAI-compatible server on port `1234`.
5. Verify:

```bash
curl http://127.0.0.1:1234/v1/models
```

### MLX-LM

```bash
python3 -m venv .venv-mlx-lm
.venv-mlx-lm/bin/pip install mlx-lm
.venv-mlx-lm/bin/python -m mlx_lm.server \
  --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit \
  --port 8080
```

Then verify:

```bash
curl http://127.0.0.1:8080/v1/models
```

## Send A Test Chat

After a provider is running:

```bash
curl -X POST http://127.0.0.1:17640/v1/chat/completions \
  -H 'content-type: application/json' \
  --data '{
    "model": "local-model",
    "stream": false,
    "messages": [{"role": "user", "content": "Say ready."}]
  }'
```

Expected result: HTTP `200` with an OpenAI-compatible `choices[0].message`.

## Common States

| State | Meaning | Fix |
| --- | --- | --- |
| Connection refused on `17640` | Local AI Router is not exposing the local API. | Start or rebuild Local AI Router. |
| Router health is `200`, chat is `no_local_provider` | Router is running, but no model provider is running. | Start Ollama, LM Studio, MLX-LM, or llama.cpp. |
| Provider launch failed: `ollama: No such file` | Ollama is not installed or not on PATH. | Install Ollama or update the provider launch command. |
| `/v1/models` returns only `local-model` | This is the stable router alias for companion apps. | Check provider runtime in Router JSON for the actual model. |
| Streaming request rejected | Local API supports non-streaming chat in this stage. | Set `stream:false` in Learning Boost. |

## Regular vs Dry-Run

Health checks, provider starts, and chat requests are regular/live actions.
They contact real local processes.

Installer recommendations can run in dry-run or live mode. Dry-run shows what
commands would be used. Live mode can install Ollama, start the provider, and
download the recommended model after explicit consent.
