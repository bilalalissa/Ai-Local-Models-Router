# Memory-Wise Operations

Use this guide when Local AI Router, Learning Boost, and local model providers
are competing for memory on the same machine.

## Immediate Operator Steps

1. Use one local model at a time.
2. Prefer smaller quantized models when memory pressure is high:
   - Quick chat: `phi-3-5-mini-q4` or another 3-4B class model.
   - Balanced local work: `llama-3-1-8b-q4`.
   - Larger reasoning models only when the machine has enough free memory.
3. Avoid running multiple provider servers at once. Keep only the active provider
   running unless you are testing.
4. Keep Learning Boost workflow batches small:
   - fewer source files per ingest batch,
   - shorter transcript chunks,
   - fewer parallel card-generation jobs,
   - lower chat context size.
5. Pause background automation in Local AI Router before a heavy ingest or long
   model call.
6. Use a Windows broker or another LAN machine for large models when the Mac is
   already under pressure.
7. Remove unused model weights from disk when storage is low, but unload the
   model from memory first if it is currently running.

## Ollama Memory Controls

Ollama can keep models loaded after a request for faster follow-up responses.
That improves latency but can fill memory. When memory is tight, unload models
so the operating system can reclaim RAM.

Unload a model with the Ollama CLI:

```bash
ollama stop llama3.1:8b
```

Unload through the Ollama API:

```bash
curl http://127.0.0.1:11434/api/generate \
  -H 'content-type: application/json' \
  --data '{"model":"llama3.1:8b","keep_alive":0}'
```

For chat-style unload:

```bash
curl http://127.0.0.1:11434/api/chat \
  -H 'content-type: application/json' \
  --data '{"model":"llama3.1:8b","messages":[],"keep_alive":0}'
```

When starting Ollama for memory-constrained operation, prefer a short keep-alive
policy so models unload quickly after use:

```bash
OLLAMA_KEEP_ALIVE=30s ollama serve
```

Use longer keep-alive only when the machine has enough free RAM and you need
faster repeated responses.

## Remove Model Weights From Disk

Removing model weights is useful when disk space is low or when a large model
should not be available on this machine anymore. It is different from unloading
from memory:

- **Unload from memory** frees RAM now but keeps the model installed.
- **Remove weights from disk** frees storage and requires re-download before the
  model can be used again.
- **Uninstall the provider** removes the runtime application itself.

For Ollama, list installed models first:

```bash
ollama ls
```

Stop the model if it is loaded:

```bash
ollama stop llama3.1:8b
```

Remove the model weights:

```bash
ollama rm llama3.1:8b
```

Or use the Ollama API:

```bash
curl -X DELETE http://127.0.0.1:11434/api/delete \
  -H 'content-type: application/json' \
  --data '{"model":"llama3.1:8b"}'
```

Recommended app behavior for a future **Remove from disk** action:

1. Show model name, provider, disk size, and last-used time.
2. Warn that the model must be downloaded again before future use.
3. Block deletion if a workflow is actively using the model.
4. Stop/unload the model first when the provider supports it.
5. Delete through the provider API or CLI, not by manually deleting random files.
6. Refresh the model list and router decision after deletion.

Use this option for large models you rarely need, old versions, duplicate
quantizations, or models that should run on the remote broker instead of the
local Mac.

## Local AI Router Settings To Prefer

Use **Router > Routing mode**:

- **Auto** for normal use.
- **Local only** when the machine has memory headroom.
- **Remote preferred** when a Windows broker has more memory or VRAM.
- **Paused** before closing apps, freeing memory, installing models, or changing
  providers.

Use **Router thresholds**:

- Lower **Memory max** to force fallback earlier, for example 70-75%.
- Lower **Latency max** only when you prefer fast smaller models.
- Keep **Forced** mode off during memory pressure; it can select a model that is
  too large for the current machine state.

Use **Models**:

- Run dry-run first when testing a new setup.
- Use live install only when enough disk and memory are available.
- Install small and balanced models before larger models.

## Learning Boost Workflow Guidance

Learning Boost should call Local AI Router's model-selection endpoint before
each workflow:

```text
POST /api/integration/select-model
```

Recommended workflow hints:

| Workflow | Suggested request |
| --- | --- |
| Quick chat | `{"task":"quick_chat","needs":["low_latency"]}` |
| Source ingest | `{"task":"summarize_sources","context_size":"large","needs":["summarization"]}` |
| Transcript summarization | `{"task":"summarize_transcript","context_size":"large","needs":["summarization"]}` |
| Arabic content | `{"task":"target_language","needs":["arabic"]}` |
| Planning/reasoning | `{"task":"plan_drafting","needs":["reasoning"]}` |
| Card generation | `{"task":"card_generation","needs":["code"]}` if structured output is required, otherwise use summarization hints. |

Learning Boost should still send chat to `/v1/chat/completions` with
`model: local-model`. Local AI Router will map that alias to the selected
runtime model.

## App Safeguards To Build Next

These are the recommended product changes for memory-wise operation.

1. **Memory budget mode**
   - Add a setting such as **Conservative**, **Balanced**, and **Performance**.
   - Conservative mode should prefer smaller models, lower context size, and
     short provider keep-alive.

2. **Single loaded model policy**
   - Before switching models, unload the previous Ollama model when supported.
   - Record the unload in provider logs.

3. **Provider memory pressure gate**
   - Block or warn before starting a provider/model when system memory is above
     the configured threshold.
   - Offer **Use smaller model**, **Use remote broker**, or **Continue anyway**.

4. **Context-size governor**
   - Cap prompt/context size based on free memory.
   - Ask Learning Boost to chunk large source ingest instead of sending one
     large prompt.

5. **Queue and concurrency limits**
   - Run one local model request at a time by default.
   - Queue background tasks while chat or source ingest is active.

6. **Automatic unload after idle**
   - Add per-provider idle unload settings.
   - For Ollama, use `keep_alive` or `ollama stop` when the active workflow ends.

7. **Storage cleanup actions**
   - Add **Remove from disk** for installed models.
   - Show expected freed disk size and require confirmation.
   - Prefer provider-native commands such as `ollama rm` or `DELETE /api/delete`.
   - Keep a reinstall action next to removed recommended models.

8. **Memory-aware model scoring**
   - Penalize models whose estimated working set would leave too little free
     memory.
   - Prefer remote candidates when local memory is above threshold.

9. **Learning Boost backpressure**
   - Return clear `memory_pressure` guidance from Local AI Router so Learning
     Boost can reduce batch size or pause optional work.

## Practical Default For This Machine

When the machine is full and main apps must stay running:

1. Use `local-model` through Local AI Router.
2. Ask the router for `quick_chat` or `summarize_sources` before each workflow.
3. Prefer `llama3.1:8b` only when enough memory is free.
4. Use a 3-4B model for quick chat and smaller follow-up work.
5. Stop unused model servers.
6. Unload Ollama models after large tasks.
7. Remove unused large model weights from disk when storage is low.
8. Use remote broker mode for larger models or long summarization jobs.
