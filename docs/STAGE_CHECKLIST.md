# Stage Checklist

Every stage must end with a stop, summary, changed-file list, test results,
known issues or limitations, and the exact question:

"Approve this stage and continue to the next stage?"

Do not continue automatically. Do not pre-build future stages. Do not create
placeholder-only future-stage code unless required for compilation and clearly
marked as a stub.

## Stage 1 - App Shell and Navigation

- Create the Tauri v2 + React + TypeScript + Vite desktop app shell.
- Add main navigation pages: Dashboard, Machine Specs, Model Fit Map, Models,
  Providers, Router, Remote PCs, Updates, Settings, Logs.
- Implement global app-state badge and initial Pause/Resume button as UI only.
- Apply the approved light operational UI baseline.
- Add initial build scripts for macOS and Windows.
- Add initial README run/build notes.
- Stop and ask for approval.

## Stage 2 - App State and Pause/Resume Core

- Implement `app_state`.
- Add Running, Paused, Pausing, Resuming, Error states.
- Expose pause/resume commands to the frontend.
- Persist pause settings and pause state.
- Log pause history.
- Add paused banner and practical tray/menu hooks where available.
- Test pause/resume transitions and persistence.
- Stop and ask for approval.

## Stage 3 - Hardware Detection and Specs Export

- Implement `hardware_probe`.
- Detect macOS Apple Silicon, macOS Intel, and Windows x64 specs.
- Add hardware fixtures for the required target machines.
- Wire Machine Specs page to real probe plus fixture mode.
- Add export as JSON, CSV, Markdown, and copy-to-clipboard.
- Test all hardware fixtures.
- Stop and ask for approval.

## Stage 4 - Model Catalog and Compatibility Scoring

- Implement `model_catalog`.
- Add seed model catalog for Apple Silicon, Intel Mac, and Windows.
- Add Smooth, Good, Tight, Avoid labels.
- Score RAM, VRAM, CPU load, GPU load, provider support, disk, platform, use
  case, preference, installed status, and pause state.
- Wire Model Fit Map UI.
- Test the required hardware profiles.
- Stop and ask for approval.

## Stage 5 - Provider Adapter Layer With Mocked Providers

- Implement `provider_core`.
- Define the shared provider trait and capability model.
- Add mock provider implementation.
- Wire provider cards, health simulation, model listing simulation, and mock test
  chat.
- Add provider pause/resume task hooks.
- Test provider behavior and pause behavior.
- Stop and ask for approval.

## Stage 6 - Real Local Provider Adapters

- Implement Ollama, LM Studio, custom OpenAI-compatible, MLX-LM Apple Silicon,
  and llama.cpp/custom adapters.
- Add provider health checks, model listing, and tiny test chat fallback.
- Wire provider settings UI.
- Implement pause/resume behavior where providers support it.
- Do not implement model downloads except dry-run hooks.
- Stop and ask for approval.

## Stage 7 - Runtime and Model Installation Flow

- Implement dry-run installer mode and real command hook structure.
- Add consent screens and "Install recommended setup" flow.
- Use app-managed runtime/model folders.
- Show command details, progress, logs, pause, and cancel where practical.
- Add Apple Silicon, Intel Mac, and Windows install plans.
- Use mocks for tests. Do not download real model weights in tests.
- Stop and ask for approval.

## Stage 8 - Router Auto/Manual/Forced Model Selection

- Implement `router_core`.
- Add Auto, Manual, Forced, Local only, Remote preferred placeholder, Remote only
  placeholder, and Paused modes.
- Add degrade/upgrade logic, fallback chain, thresholds, and decision reasons.
- Wire Router page and test prompt panel.
- Test routing decisions, thresholds, fallback behavior, and pause behavior.
- Stop and ask for approval.

## Stage 9 - Notifications and Background Behavior

- Add native notifications.
- Add notification settings.
- Add tray/menu-bar mode.
- Add launch-at-login toggle and start-providers-at-login toggle.
- Add background task manager that respects pause state.
- Add notification events for provider crash, model install completion, router
  degraded/upgraded, forced model memory pressure, and app paused/resumed.
- Test where automated checks are practical and provide manual verification for
  OS-native behavior.
- Stop and ask for approval.

## Stage 10 - Model Update Metadata Checker

- Implement `updater`.
- Add metadata source abstraction.
- Add Ollama metadata checker, MLX/Hugging Face checker where practical, and
  custom JSON catalog checker.
- Wire update cards, history, compatibility labels, ignore, remind later,
  install, and install-and-switch actions.
- Ensure privacy mode disables checks and paused mode suspends scheduled checks.
- Test with metadata fixtures only.
- Stop and ask for approval.

## Stage 11 - Windows Remote Provider Broker

- Implement `remote_broker` server mode on Windows.
- Add opt-in LAN sharing and authenticated endpoints:
  `/api/health`, `/api/specs`, `/api/models`, `/api/provider-status`,
  `/v1/models`, `/v1/chat/completions`.
- Add pairing token/code, connected clients, revoke, firewall guidance, and
  security warnings.
- Add broker pause behavior: keep online, reject new requests, or stop until
  resume.
- Stop and ask for approval.

## Stage 12 - Mac Remote Client

- Wire Remote PCs page to real discovery/client logic.
- Add mDNS/Bonjour discovery for `_localai-router._tcp`.
- Add manual IP:port pairing.
- Show remote specs, models, load, health, and latency.
- Allow Apple Silicon and Intel Mac clients to use Windows remote models.
- Allow router to choose remote models in Remote preferred, Remote only, and
  overloaded/unavailable local fallback cases.
- Store tokens securely and respect pause state.
- Stop and ask for approval.

## Stage 13 - Packaging and Installers

- Add macOS Apple Silicon build.
- Add macOS Intel build.
- Add optional universal macOS build if practical.
- Add Windows x64 installer.
- Add code-signing placeholders/instructions and release checklist.
- Stop and ask for approval.

## Stage 14 - Final Testing, Documentation, and Polish

- Complete full test suite and UI smoke tests.
- Add loading, empty, and error states.
- Complete user and technical docs:
  README, ARCHITECTURE, PROVIDERS, MODEL_CATALOG, MAC_APPLE_SILICON,
  MAC_INTEL, WINDOWS, REMOTE_PAIRING, PAUSE_MODE, SECURITY, USER_GUIDE.
- Run final verification checklist.
- List final known limitations.
- Stop and ask for final approval.
