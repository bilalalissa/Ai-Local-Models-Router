# Local AI Router

Local AI Router is a planned standalone desktop application for macOS Apple
Silicon, macOS Intel, and Windows x64. The app will detect local hardware,
recommend compatible local AI runtimes and models, manage provider health,
route requests between local and trusted LAN machines, and provide a reliable
pause/resume mode for all background automation.

This repository is currently at Stage 14: final testing, documentation, and
polish. The
Tauri desktop shell exists, exposes persisted pause/resume state, includes
native hardware probing and specs export, scores a seeded local model catalog,
includes local HTTP adapters for Ollama, LM Studio, custom OpenAI-compatible
servers, MLX-LM, and llama.cpp, and now includes a dry-run runtime/model
installer with consent, command hook previews, app-managed folders, progress,
logs, pause, resume, and cancel. Router decisions now support Auto, Manual,
Forced, Local only, Remote preferred, Remote only, and Paused modes with
thresholds, fallback chains, decision reasons, local and remote candidates, and
a routed test prompt panel. Notifications and background behavior now include a native
menu/tray path, notification settings, launch-at-login/start-provider-at-login
settings, a pause-aware background task manager, notification event history, and
events for pause/resume, install completion, router changes, provider errors,
and forced-model pressure. Model update metadata checks now use fixture-only
Ollama, MLX/Hugging Face, and custom JSON sources with compatibility labels,
history, ignore/remind-later/install/install-and-switch actions, privacy mode,
and pause-aware scheduled checks. Windows remote broker mode now has opt-in LAN
sharing state, authenticated endpoint definitions, pairing codes, connected
client tokens, revoke controls, firewall guidance, security warnings, and
pause-policy behavior. Mac remote client mode now has Bonjour/mDNS discovery,
manual IP:port pairing, paired-device refresh, protected token-vault storage,
remote specs/models/health/load/latency display, and router integration for
Remote preferred, Remote only, and overloaded-local fallback. Real
installers/downloads remain intentionally dry-run, while release packaging
scripts and documentation now cover macOS Apple Silicon, macOS Intel, optional
universal macOS bundles, and Windows x64 installers.

## Stage Gate Rule

Implementation must proceed one stage at a time. At the end of every stage, the
implementer must stop and report:

- What was completed.
- Files created or changed.
- Tests run and results.
- Known issues or limitations.
- The exact question: "Approve this stage and continue to the next stage?"

No future stage may begin without explicit approval.

## Publishing Rule

This repository's canonical remote is:

`https://github.com/bilalalissa/Ai-Local-Models-Router.git`

After each approved stage is completed, commit the completed stage work and push
it to this repository before reporting final completion for that stage. Do not
start the next implementation stage until the user explicitly approves it.

## Current Deliverables

- [Architecture](docs/development/ARCHITECTURE.md): technology choices, module boundaries,
  data models, provider design, hardware probing, router design, pause/resume
  behavior, persistence, security, and UI baseline.
- [Stage Checklist](docs/development/STAGE_CHECKLIST.md): implementation sequence for
  Stages 1-14 with mandatory stop points.
- Stage 1 desktop shell under `apps/desktop`: Tauri v2, React, TypeScript,
  Vite, main navigation, empty page states, global app-state badge, and
  non-functional Pause UI placeholder.
- Stage 2 pause/resume core: Rust `app_state` module, persisted pause settings,
  pause history logs, Tauri commands, native menu hooks, paused banner, and
  Dashboard/Router/Settings/Logs UI wiring.
- Stage 3 hardware detection: Rust `hardware_probe` module, macOS/Windows probe
  paths, required hardware fixtures, Machine Specs live/fixture UI, and
  JSON/CSV/Markdown export plus copy-to-clipboard controls.
- Stage 4 model compatibility: Rust `model_catalog` module, seeded model
  catalog, Smooth/Good/Tight/Avoid scoring labels, required scoring inputs,
  and Model Fit Map UI with hardware, use case, provider, preference, installed,
  and pause-state filters.
- Stage 5 provider mocks: Rust `provider_core` trait/capability model, seeded
  mock providers, provider health simulation, model listing, mock chat, logs,
  provider folder access, and provider pause/resume task hooks wired to app
  pause state.
- Stage 6 real local providers: Ollama, LM Studio, custom OpenAI-compatible,
  MLX-LM, and llama.cpp local HTTP adapters with health checks, model listing,
  tiny test chat, settings UI, dry-run setup plans, and pause-aware task gates.
- Stage 7 installer flow: dry-run installer state machine, real command hook
  records, consent-gated recommended setup UI, app-managed runtime/model/cache
  folders, progress, logs, pause/resume/cancel, and Apple Silicon, Intel Mac,
  and Windows x64 install plans.
- Stage 8 router flow: Rust `router_core`, Auto/Manual/Forced/Local only/Remote
  preferred/Remote only/Paused modes, compatibility thresholds, fallback and
  degrade/upgrade reasons, routed test prompt execution for local providers, and
  Router page controls.
- Stage 9 notifications and background behavior: Rust `background_core`,
  persisted notification/background/autostart settings, native menu/tray setup,
  notification events, frontend desktop notification bridge, pause-aware
  background task table, Settings controls, and notification logs.
- Stage 10 updater flow: Rust `updater_core`, fixture-only Ollama,
  MLX/Hugging Face, and custom JSON metadata sources, compatibility-scored
  update candidates, privacy and pause gates, update cards, history, ignore,
  remind later, dry-run install, and dry-run install-and-switch actions.
- Stage 11 Windows remote provider broker: Rust `remote_broker_core`, opt-in LAN
  sharing, Windows-only broker start gate, authenticated endpoint catalog,
  pairing code and token flow, connected-client revoke, firewall/security
  guidance, pause-policy handling, Remote PCs broker UI, and endpoint previews.
- Stage 12 Mac remote client: Rust `remote_client_core`, Bonjour/mDNS service
  query for `_localai-router._tcp`, manual broker pairing, protected token
  vault, remote health/spec/model/provider-status refresh, remote route
  candidates, routed remote chat test prompts, pause gates, and Remote PCs
  client UI.
- Stage 13 packaging: release scripts for macOS Apple Silicon, macOS Intel,
  optional universal macOS, and Windows x64 MSI/NSIS installers, plus signing
  placeholders and a release checklist.
- Stage 14 final documentation and verification: user guide, platform guides,
  provider/model catalog/security/pause/remote docs, final verification plan,
  loading/empty/error state audit, and known limitations.

## Planned Stack

- Desktop shell: Tauri v2.
- Frontend: React, TypeScript, Vite.
- Native integration: Rust workspace crates.
- Persistence: SQLite in app data for structured state and logs.
- Secure storage: OS keychain or credential store through Rust `keyring`.
- Test data: JSON fixtures for hardware specs, provider metadata, and model
  catalogs.

## Development

Install dependencies:

```bash
npm install
```

Run the React/Vite shell in a browser:

```bash
npm run dev
```

Run the Tauri desktop shell:

```bash
npm run tauri:dev
```

Build the frontend:

```bash
npm run build
```

Build the macOS desktop bundle from macOS:

```bash
npm run build:macos
npm run build:macos:apple-silicon
npm run build:macos:intel
npm run build:macos:universal
```

Build the Windows installer from Windows:

```powershell
npm run build:windows
```

Stage 14 note: the installer is dry-run only. It records realistic command hooks
and app-managed folder paths, but never executes commands or downloads model
weights. Router decisions and routed test prompts exist for local providers.
Remote preferred and remote-only routing can now select paired Windows remote
models when available. Stage 10 update checks read local fixtures only; live
metadata calls and real downloads do not exist yet. Stage 11 broker mode includes
a Windows-gated LAN HTTP listener plus command-driven endpoint previews for local
verification. Stage 12 includes fixture-backed local verification for remote
client flows; real LAN pairing requires a running Windows broker and token.
Public distribution additionally requires macOS signing/notarization and Windows
Authenticode signing outside this repository.

## Documentation

- [Architecture](docs/development/ARCHITECTURE.md)
- [Stage Checklist](docs/development/STAGE_CHECKLIST.md)
- [Packaging](docs/PACKAGING.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Final Verification](docs/development/FINAL_VERIFICATION.md)
- [User Guide](docs/USER_GUIDE.md)
- [Providers](docs/PROVIDERS.md)
- [Model Catalog](docs/MODEL_CATALOG.md)
- [macOS Apple Silicon](docs/MAC_APPLE_SILICON.md)
- [macOS Intel](docs/MAC_INTEL.md)
- [Windows](docs/WINDOWS.md)
- [Remote Pairing](docs/REMOTE_PAIRING.md)
- [Pause Mode](docs/PAUSE_MODE.md)
- [Security](docs/SECURITY.md)

## Visual Baseline

The Stage 1 app shell should follow the generated light operational UI concepts:

- Dashboard concept:
  `/Users/ba/.codex/generated_images/019f14b5-8e2d-7830-9ad3-7bcc16dccad1/ig_0f3ca985b479451a016a42be31d868819b9984b8aef15c4685.png`
- Paused Router concept:
  `/Users/ba/.codex/generated_images/019f14b5-8e2d-7830-9ad3-7bcc16dccad1/ig_0f3ca985b479451a016a42beaf0120819ba4aef6ef82610c72.png`

UI direction: dense, readable, operational desktop utility; light neutral
surfaces; compact tables and panels; 8px-or-less radii; persistent app-state
badge; amber paused states; no marketing hero treatment.

## Implementation Stages

### Stages List:
- [x] Stage 0 - Project Definition and Architecture
- [x] Stage 1 - App Shell and Navigation
- [x] Stage 2 - App State and Pause/Resume Core
- [x] Stage 3 - Hardware Detection and Specs Export
- [x] Stage 4 - Model Catalog and Compatibility Scoring
- [x] Stage 5 - Provider Adapter Layer With Mocked Providers
- [x] Stage 6 - Real Local Provider Adapters
- [x] Stage 7 - Runtime and Model Installation Flow
- [x] Stage 8 - Router Auto/Manual/Forced Model Selection
- [x] Stage 9 - Notifications and Background Behavior
- [x] Stage 10 - Model Update Metadata Checker
- [x] Stage 11 - Windows Remote Provider Broker
- [x] Stage 12 - Mac Remote Client
- [x] Stage 13 - Packaging and Installers
- [x] Stage 14 - Final Testing, Documentation, and Polish

Every stage must end with a stop, summary, changed-file list, test results,
known issues or limitations, and the exact question:

"Approve this stage and continue to the next stage?"

Do not continue automatically. Do not pre-build future stages. Do not create
placeholder-only future-stage code unless required for compilation and clearly
marked as a stub.

### [x] Stage 0 - Project Definition and Architecture

- Produce the final architecture proposal.
- Document technology choices, directory structure, data models, provider
  adapter design, hardware probe design, router design, pause/resume app-state
  design, security model, and the full staged checklist.
- Do not scaffold the Tauri app or write provider/runtime implementation.
- Stop and ask for approval.

### [x] Stage 1 - App Shell and Navigation

- Create the Tauri v2 + React + TypeScript + Vite desktop app shell.
- Add main navigation pages: Dashboard, Machine Specs, Model Fit Map, Models,
  Providers, Router, Remote PCs, Updates, Settings, Logs.
- Implement global app-state badge and initial Pause/Resume button as UI only.
- Apply the approved light operational UI baseline.
- Add initial build scripts for macOS and Windows.
- Add initial README run/build notes.
- Stop and ask for approval.

### [x] Stage 2 - App State and Pause/Resume Core

- Implement `app_state`.
- Add Running, Paused, Pausing, Resuming, Error states.
- Expose pause/resume commands to the frontend.
- Persist pause settings and pause state.
- Log pause history.
- Add paused banner and practical tray/menu hooks where available.
- Test pause/resume transitions and persistence.
- Stop and ask for approval.

### [x] Stage 3 - Hardware Detection and Specs Export

- Implement `hardware_probe`.
- Detect macOS Apple Silicon, macOS Intel, and Windows x64 specs.
- Add hardware fixtures for the required target machines.
- Wire Machine Specs page to real probe plus fixture mode.
- Add export as JSON, CSV, Markdown, and copy-to-clipboard.
- Test all hardware fixtures.
- Stop and ask for approval.

### [x] Stage 4 - Model Catalog and Compatibility Scoring

- Implement `model_catalog`.
- Add seed model catalog for Apple Silicon, Intel Mac, and Windows.
- Add Smooth, Good, Tight, Avoid labels.
- Score RAM, VRAM, CPU load, GPU load, provider support, disk, platform, use
  case, preference, installed status, and pause state.
- Wire Model Fit Map UI.
- Test the required hardware profiles.
- Stop and ask for approval.

### [x] Stage 5 - Provider Adapter Layer With Mocked Providers

- Implement `provider_core`.
- Define the shared provider trait and capability model.
- Add mock provider implementation.
- Wire provider cards, health simulation, model listing simulation, and mock test
  chat.
- Add provider pause/resume task hooks.
- Test provider behavior and pause behavior.
- Stop and ask for approval.

### [x] Stage 6 - Real Local Provider Adapters

- Implement Ollama, LM Studio, custom OpenAI-compatible, MLX-LM Apple Silicon,
  and llama.cpp/custom adapters.
- Add provider health checks, model listing, and tiny test chat fallback.
- Wire provider settings UI.
- Implement pause/resume behavior where providers support it.
- Do not implement model downloads except dry-run hooks.
- Stop and ask for approval.

### [x] Stage 7 - Runtime and Model Installation Flow

- Implement dry-run installer mode and real command hook structure.
- Add consent screens and "Install recommended setup" flow.
- Use app-managed runtime/model folders.
- Show command details, progress, logs, pause, and cancel where practical.
- Add Apple Silicon, Intel Mac, and Windows install plans.
- Use mocks for tests. Do not download real model weights in tests.
- Stop and ask for approval.

### [x] Stage 8 - Router Auto/Manual/Forced Model Selection

- Implement `router_core`.
- Add Auto, Manual, Forced, Local only, Remote preferred placeholder, Remote only
  placeholder, and Paused modes.
- Add degrade/upgrade logic, fallback chain, thresholds, and decision reasons.
- Wire Router page and test prompt panel.
- Test routing decisions, thresholds, fallback behavior, and pause behavior.
- Stop and ask for approval.

### [x] Stage 9 - Notifications and Background Behavior

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

### [x] Stage 10 - Model Update Metadata Checker

- Implement `updater`.
- Add metadata source abstraction.
- Add Ollama metadata checker, MLX/Hugging Face checker where practical, and
  custom JSON catalog checker.
- Wire update cards, history, compatibility labels, ignore, remind later,
  install, and install-and-switch actions.
- Ensure privacy mode disables checks and paused mode suspends scheduled checks.
- Test with metadata fixtures only.
- Stop and ask for approval.

### [x] Stage 11 - Windows Remote Provider Broker

- Implement `remote_broker` server mode on Windows.
- Add opt-in LAN sharing and authenticated endpoints:
  `/api/health`, `/api/specs`, `/api/models`, `/api/provider-status`,
  `/v1/models`, `/v1/chat/completions`.
- Add pairing token/code, connected clients, revoke, firewall guidance, and
  security warnings.
- Add broker pause behavior: keep online, reject new requests, or stop until
  resume.
- Stop and ask for approval.

### [x] Stage 12 - Mac Remote Client

- Wire Remote PCs page to real discovery/client logic.
- Add mDNS/Bonjour discovery for `_localai-router._tcp`.
- Add manual IP:port pairing.
- Show remote specs, models, load, health, and latency.
- Allow Apple Silicon and Intel Mac clients to use Windows remote models.
- Allow router to choose remote models in Remote preferred, Remote only, and
  overloaded/unavailable local fallback cases.
- Store tokens securely and respect pause state.
- Stop and ask for approval.

### [x] Stage 13 - Packaging and Installers

- Add macOS Apple Silicon build.
- Add macOS Intel build.
- Add optional universal macOS build if practical.
- Add Windows x64 installer.
- Add code-signing placeholders/instructions and release checklist.
- Stop and ask for approval.

### [x] Stage 14 - Final Testing, Documentation, and Polish

- Complete full test suite and UI smoke tests.
- Add loading, empty, and error states.
- Complete user and technical docs:
  README, ARCHITECTURE, PROVIDERS, MODEL_CATALOG, MAC_APPLE_SILICON,
  MAC_INTEL, WINDOWS, REMOTE_PAIRING, PAUSE_MODE, SECURITY, USER_GUIDE.
- Run final verification checklist.
- List final known limitations.
- Stop and ask for final approval.

## Final Known Limitations

- Runtime/model installers are dry-run only and do not download model weights.
- Update metadata checks use local fixtures only.
- Public releases require external signing/notarization credentials.
- Windows MSI/NSIS artifacts must be built and signed on Windows.
- Remote broker/client mode is designed for trusted LAN use, not internet
  exposure.

## Stage 0 Verification

Stage 0 verification is documentation/static only:

- Confirm this repo contains no application scaffold or placeholder runtime code.
- Confirm architecture covers the requested platforms and subsystems.
- Confirm later test plans use mocks and fixtures, with no real model downloads.
- Confirm every future stage has a mandatory approval stop.
