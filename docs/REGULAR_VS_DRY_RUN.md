# Regular vs Dry-Run Methods

Local AI Router uses two kinds of actions: regular/live actions and dry-run
actions. The difference matters most for installers and model setup.

## Regular Or Live Methods

A regular/live method actually talks to a local provider, remote broker, or
operating system feature.

Examples in the current app:

- Refreshing live machine specs.
- Checking whether Ollama, LM Studio, MLX-LM, llama.cpp, or a custom local
  endpoint is reachable.
- Listing models from a running provider.
- Sending a provider or router test prompt.
- Starting or stopping supported provider tasks.
- Pairing with a Windows broker.
- Refreshing remote broker health, specs, models, and latency.
- Building a local `.app` bundle with the packaging scripts.

What to expect:

- The action can succeed or fail based on the real machine, network, provider,
  port, token, firewall, or operating system state.
- The action may change app state, provider state, paired-device state, or logs.
- Live installer mode may install packages, start a provider, and download model
  weights after explicit consent.

## Dry-Run Methods

A dry-run method previews what would happen without performing the risky or
large side effect.

Examples in the current app:

- **Models** recommended setup flow when **Dry run** is selected.
- Runtime/model installer command plans before you approve live execution.
- Update actions that preview fixture metadata instead of downloading model
  weights.

What dry-run does:

- Shows planned folders, commands, consent items, progress, and logs.
- Lets you step through the setup flow safely.
- Records what live installer mode would attempt.

What dry-run does not do:

- It does not install runtimes.
- It does not download model weights.
- It does not modify system package managers.
- It does not create real provider services.

## Which One Should I Use?

Use regular/live provider checks after you manually install and start a provider
such as Ollama or LM Studio.

Use dry-run installer flows when you want to understand the recommended setup
without changing your machine or downloading large files.

Use **Live install and run** when you want the app to execute the runnable
macOS Ollama setup. The app runs one command per **Run next step** click, so you
can stop between package install, provider startup, model pull, and probe steps.
