# macOS Intel

Intel Mac support is conservative and prioritizes smaller models, local HTTP
providers, and remote routing when paired Windows hardware is available.

## Build

```bash
npm run build:macos:intel
```

## Recommended Providers

- Ollama.
- LM Studio.
- llama.cpp/custom OpenAI-compatible servers.
- Remote Windows broker for larger models.

## Compatibility Notes

The catalog includes 8 GB, 16 GB, and 32 GB Intel Mac fixtures. Low-memory
machines should expect Tight or Avoid labels for larger models.
