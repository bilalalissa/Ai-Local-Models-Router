# User Guide

This guide is organized by task.

## First Launch

1. Open Local AI Router.
2. Confirm the state badge says `Running`.
3. Open **Machine Specs** and refresh the live hardware probe.
4. Export specs if you want a record for troubleshooting.

Expected result: the app shows your OS, CPU, memory, GPU, storage, provider
ports, and current load.

## Choose A Compatible Model

1. Open **Model Fit Map**.
2. Select your hardware profile or use live hardware.
3. Choose a use case such as chat, coding, or reasoning.
4. Review labels:
   - `Smooth`: preferred.
   - `Good`: acceptable.
   - `Tight`: may work with pressure.
   - `Avoid`: likely unsupported or too heavy.

Expected result: the model table explains why each model fits or does not fit.

## Connect Local Providers

1. Install and start a provider outside the app: Ollama, LM Studio, MLX-LM, or
   an OpenAI-compatible local server.
2. Open **Providers**.
3. Refresh health.
4. Update base URLs if your provider does not use the default local port.
5. Run a small test chat from the provider panel.

Expected result: a healthy provider lists models and can answer a tiny test
prompt. If a provider is stopped, start it outside the app or use the provider
start controls where available.

## Use The Dry-Run Installer

1. Open **Models**.
2. Choose a recommended setup plan.
3. Read the runtime, model, and cache folders.
4. Confirm the dry-run consent checkbox.
5. Click **Install recommended setup**.
6. Use **Advance dry run** to step through the command plan.

Expected result: commands and logs are shown, but no runtime or model weights
are downloaded.

## Route A Test Prompt

1. Open **Router**.
2. Choose Auto, Manual, Forced, Local only, Remote preferred, Remote only, or
   Paused.
3. Review the selected route, candidate list, and decision reasons.
4. Run the test prompt.

Expected result: the router explains which provider/model was selected and why.

## Use A Windows Remote Broker

1. On the Windows PC, open **Remote PCs**.
2. Enable LAN sharing.
3. Choose a bind host and port.
4. Start the broker.
5. Create a pairing code.
6. On the Mac, open **Remote PCs** and pair by Bonjour discovery, manual URL, or
   fixed broker address.

Expected result: the Mac shows remote specs, provider health, remote models, and
route candidates.

## Pin A Fixed Broker Address

Use this when Bonjour discovery is unreliable or the Windows PC IP changes.

1. Reserve the Windows PC IP in your router or set a static IP in Windows.
2. Open **Remote PCs** on the Mac.
3. Enable **Use fixed broker address**.
4. Enter a broker name and URL, for example `http://192.168.1.50:17640`.
5. Enable **Prefer fixed address over Bonjour** if this should be the primary
   remote connection.
6. Click **Pair fixed address** with a valid pairing token/code.

Expected result: the fixed broker appears as a stable discovery candidate and is
used before dynamic Bonjour results when preferred.

## Pause And Resume

Use pause mode when you want all automation to stop changing state.

Paused mode blocks or suspends routing changes, update checks, installer runs,
provider background tasks, remote discovery, and broker behavior according to
the selected broker pause policy.

## Troubleshooting

- Provider not found: confirm the provider is running and the base URL is
  correct.
- Remote broker not found: use fixed broker address instead of Bonjour.
- Pairing fails: create a fresh pairing code and confirm the Mac can reach the
  Windows broker URL.
- Remote route unavailable: refresh remotes, verify the broker token was not
  revoked, and check pause mode.
- App cannot install a model: Stage 14 installer flows are dry-run only.
