# Local AI Router

Local AI Router is a planned standalone desktop application for macOS Apple
Silicon, macOS Intel, and Windows x64. The app will detect local hardware,
recommend compatible local AI runtimes and models, manage provider health,
route requests between local and trusted LAN machines, and provide a reliable
pause/resume mode for all background automation.

This repository is currently at Stage 2: app state and pause/resume core. The
Tauri desktop shell exists and exposes persisted pause/resume state, settings,
history logging, UI banner state, and native menu pause/resume hooks. Hardware
probing, providers, model routing, installers, remote broker behavior, and
model/update automation are intentionally deferred to later approved stages.

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

- [Architecture](docs/ARCHITECTURE.md): technology choices, module boundaries,
  data models, provider design, hardware probing, router design, pause/resume
  behavior, persistence, security, and UI baseline.
- [Stage Checklist](docs/STAGE_CHECKLIST.md): implementation sequence for
  Stages 1-14 with mandatory stop points.
- Stage 1 desktop shell under `apps/desktop`: Tauri v2, React, TypeScript,
  Vite, main navigation, empty page states, global app-state badge, and
  non-functional Pause UI placeholder.
- Stage 2 pause/resume core: Rust `app_state` module, persisted pause settings,
  pause history logs, Tauri commands, native menu hooks, paused banner, and
  Dashboard/Router/Settings/Logs UI wiring.

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
```

Build the Windows installer from Windows:

```powershell
npm run build:windows
```

Stage 2 note: pause/resume state is real and persisted. Provider, router,
installer, updater, notification, and remote broker workers do not exist yet,
so their paused behavior is represented by the app-state gate and suspended
task summary until those modules are implemented in later stages.

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
- [ ] Stage 3 - Hardware Detection and Specs Export
- [ ] Stage 4 - Model Catalog and Compatibility Scoring
- [ ] Stage 5 - Provider Adapter Layer With Mocked Providers
- [ ] Stage 6 - Real Local Provider Adapters
- [ ] Stage 7 - Runtime and Model Installation Flow
- [ ] Stage 8 - Router Auto/Manual/Forced Model Selection
- [ ] Stage 9 - Notifications and Background Behavior
- [ ] Stage 10 - Model Update Metadata Checker
- [ ] Stage 11 - Windows Remote Provider Broker
- [ ] Stage 12 - Mac Remote Client
- [ ] Stage 13 - Packaging and Installers
- [ ] Stage 14 - Final Testing, Documentation, and Polish

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

### Stage 3 - Hardware Detection and Specs Export

- Implement `hardware_probe`.
- Detect macOS Apple Silicon, macOS Intel, and Windows x64 specs.
- Add hardware fixtures for the required target machines.
- Wire Machine Specs page to real probe plus fixture mode.
- Add export as JSON, CSV, Markdown, and copy-to-clipboard.
- Test all hardware fixtures.
- Stop and ask for approval.

### Stage 4 - Model Catalog and Compatibility Scoring

- Implement `model_catalog`.
- Add seed model catalog for Apple Silicon, Intel Mac, and Windows.
- Add Smooth, Good, Tight, Avoid labels.
- Score RAM, VRAM, CPU load, GPU load, provider support, disk, platform, use
  case, preference, installed status, and pause state.
- Wire Model Fit Map UI.
- Test the required hardware profiles.
- Stop and ask for approval.

### Stage 5 - Provider Adapter Layer With Mocked Providers

- Implement `provider_core`.
- Define the shared provider trait and capability model.
- Add mock provider implementation.
- Wire provider cards, health simulation, model listing simulation, and mock test
  chat.
- Add provider pause/resume task hooks.
- Test provider behavior and pause behavior.
- Stop and ask for approval.

### Stage 6 - Real Local Provider Adapters

- Implement Ollama, LM Studio, custom OpenAI-compatible, MLX-LM Apple Silicon,
  and llama.cpp/custom adapters.
- Add provider health checks, model listing, and tiny test chat fallback.
- Wire provider settings UI.
- Implement pause/resume behavior where providers support it.
- Do not implement model downloads except dry-run hooks.
- Stop and ask for approval.

### Stage 7 - Runtime and Model Installation Flow

- Implement dry-run installer mode and real command hook structure.
- Add consent screens and "Install recommended setup" flow.
- Use app-managed runtime/model folders.
- Show command details, progress, logs, pause, and cancel where practical.
- Add Apple Silicon, Intel Mac, and Windows install plans.
- Use mocks for tests. Do not download real model weights in tests.
- Stop and ask for approval.

### Stage 8 - Router Auto/Manual/Forced Model Selection

- Implement `router_core`.
- Add Auto, Manual, Forced, Local only, Remote preferred placeholder, Remote only
  placeholder, and Paused modes.
- Add degrade/upgrade logic, fallback chain, thresholds, and decision reasons.
- Wire Router page and test prompt panel.
- Test routing decisions, thresholds, fallback behavior, and pause behavior.
- Stop and ask for approval.

### Stage 9 - Notifications and Background Behavior

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

### Stage 10 - Model Update Metadata Checker

- Implement `updater`.
- Add metadata source abstraction.
- Add Ollama metadata checker, MLX/Hugging Face checker where practical, and
  custom JSON catalog checker.
- Wire update cards, history, compatibility labels, ignore, remind later,
  install, and install-and-switch actions.
- Ensure privacy mode disables checks and paused mode suspends scheduled checks.
- Test with metadata fixtures only.
- Stop and ask for approval.

### Stage 11 - Windows Remote Provider Broker

- Implement `remote_broker` server mode on Windows.
- Add opt-in LAN sharing and authenticated endpoints:
  `/api/health`, `/api/specs`, `/api/models`, `/api/provider-status`,
  `/v1/models`, `/v1/chat/completions`.
- Add pairing token/code, connected clients, revoke, firewall guidance, and
  security warnings.
- Add broker pause behavior: keep online, reject new requests, or stop until
  resume.
- Stop and ask for approval.

### Stage 12 - Mac Remote Client

- Wire Remote PCs page to real discovery/client logic.
- Add mDNS/Bonjour discovery for `_localai-router._tcp`.
- Add manual IP:port pairing.
- Show remote specs, models, load, health, and latency.
- Allow Apple Silicon and Intel Mac clients to use Windows remote models.
- Allow router to choose remote models in Remote preferred, Remote only, and
  overloaded/unavailable local fallback cases.
- Store tokens securely and respect pause state.
- Stop and ask for approval.

### Stage 13 - Packaging and Installers

- Add macOS Apple Silicon build.
- Add macOS Intel build.
- Add optional universal macOS build if practical.
- Add Windows x64 installer.
- Add code-signing placeholders/instructions and release checklist.
- Stop and ask for approval.

### Stage 14 - Final Testing, Documentation, and Polish

- Complete full test suite and UI smoke tests.
- Add loading, empty, and error states.
- Complete user and technical docs:
  README, ARCHITECTURE, PROVIDERS, MODEL_CATALOG, MAC_APPLE_SILICON,
  MAC_INTEL, WINDOWS, REMOTE_PAIRING, PAUSE_MODE, SECURITY, USER_GUIDE.
- Run final verification checklist.
- List final known limitations.
- Stop and ask for final approval.

## Stage 0 Verification

Stage 0 verification is documentation/static only:

- Confirm this repo contains no application scaffold or placeholder runtime code.
- Confirm architecture covers the requested platforms and subsystems.
- Confirm later test plans use mocks and fixtures, with no real model downloads.
- Confirm every future stage has a mandatory approval stop.
