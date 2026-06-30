# Local AI Router Architecture

## 1. Product Shape

Local AI Router is a local-first desktop app for:

- Detecting hardware and current system load.
- Recommending compatible local AI runtimes and models.
- Managing providers, installed models, updates, and logs.
- Routing chat/test requests to the best local or trusted remote model.
- Suspending automation through a visible, persistent pause/resume mode.
- Pairing macOS clients with a Windows LAN machine running a remote broker.

The app must support:

- macOS Apple Silicon, with MLX-LM preferred where practical.
- macOS Intel, with Ollama, LM Studio, and llama.cpp/custom providers preferred.
- Windows 10/11 x64, with Ollama and LM Studio preferred and low-VRAM NVIDIA
  systems treated conservatively.

The repository has since advanced through Stage 14. The architecture still
captures the intended module boundaries, while the current implementation now
contains the Tauri desktop shell, Rust command modules, fixtures, release
scripts, and final documentation.

## 2. Repository Layout

The future repository should use this structure:

```text
local-ai-router/
  apps/
    desktop/
      src/
      src-tauri/
  crates/
    app_state/
    hardware_probe/
    provider_core/
    model_catalog/
    router_core/
    updater/
    remote_broker/
  packages/
    ui/
  fixtures/
    hardware/
    provider_metadata/
    model_catalog/
  docs/
  scripts/
  README.md
```

Stage 14 implements this layout for the desktop app, fixtures, docs, and
scripts. The separate `crates/*` and `packages/ui` extraction remains a future
refactor option; the current implementation keeps Rust modules inside
`apps/desktop/src-tauri/src` and UI modules inside `apps/desktop/src` to avoid
unnecessary workspace churn during the staged build.

## 3. Technology Choices

- Tauri v2 owns desktop packaging, windows, tray/menu-bar integration, command
  bridging, autostart, notifications, filesystem access, and clipboard access.
- React + TypeScript + Vite owns the app shell, navigation, stateful UI, tables,
  forms, model fit maps, settings, logs, and the test chat panel.
- Rust workspace crates own hardware probing, provider adapters, routing,
  installers, updater checks, pause/resume state, secure storage, local broker
  endpoints, process control, and persistence.
- SQLite stores structured app state in the user app-data directory.
- JSON fixtures store deterministic hardware and provider metadata for tests.
- The OS credential store stores API keys, pairing tokens, and remote auth
  tokens through a `keyring`-style Rust abstraction.
- Provider and metadata network calls are explicit, opt-in where they can cause
  downloads or remote access, and disabled by privacy mode where required.

## 4. Frontend App Shell

Planned pages:

- Dashboard
- Machine Specs
- Model Fit Map
- Models
- Providers
- Router
- Remote PCs
- Updates
- Settings
- Logs

Global UI requirements:

- Persistent state badge: Running, Paused, Pausing, Resuming, Error.
- Global Pause/Resume button.
- Tray/menu-bar Pause/Resume actions once native shell integration lands.
- Paused top banner:
  "Local AI Router is paused. Automation, update checks, routing changes, and
  remote discovery are suspended."
- Visual baseline:
  - Light operational desktop utility.
  - Compact side navigation.
  - Dense but readable tables, meters, and panels.
  - Status chips for Smooth, Good, Tight, Avoid.
  - Amber accents for paused state.
  - No marketing page, no decorative hero, no placeholder-only panels.

The frontend must not call provider-specific APIs directly. All provider,
router, hardware, update, remote, and installer actions go through Tauri
commands backed by Rust modules.

## 5. Rust Workspace Modules

### `app_state`

Owns global state and pause/resume:

- App lifecycle state: Running, Paused, Pausing, Resuming, Error.
- Pause request handling and delayed pause behavior.
- Pause timers: 15 minutes, 1 hour, until manual resume.
- Pause persistence and restart behavior.
- A central pause gate queried by background services.
- Pause history and log-event emission.

### `hardware_probe`

Owns platform detection and machine specs:

- macOS: `sysctl`, `system_profiler` where needed, memory stats, disk stats,
  architecture detection, Metal suitability, Apple Silicon vs Intel branching.
- Windows: WMI/CIM, PowerShell fallback, DirectX/GPU fallback, optional
  `nvidia-smi` detection when present.
- Provider process and port discovery.
- LAN IP and hostname detection.
- Fixture mode for tests and UI development.

### `provider_core`

Owns provider adapters and provider task coordination:

- MLX-LM Server.
- Ollama.
- LM Studio.
- llama.cpp/custom OpenAI-compatible server.
- Custom OpenAI-compatible endpoint.
- Remote Provider Broker as a provider-like source for routing.

Providers expose a shared trait and capability model. The frontend sees
normalized provider state rather than provider-specific protocol details.

### `model_catalog`

Owns seeded catalog entries and compatibility scoring:

- Model metadata schema.
- Seed recommendations for Apple Silicon, Intel Mac, and Windows low-VRAM
  machines.
- Compatibility labels: Smooth, Good, Tight, Avoid.
- Scoring inputs: total RAM, available RAM, VRAM, CPU/GPU load, disk free space,
  provider availability, installed status, platform, use case, user preference,
  pause state, and current load.

### `router_core`

Owns routing decisions:

- Modes: Auto, Manual selected model, Forced model, Remote preferred, Local
  only, Remote only, Paused.
- Fallback chain construction.
- Degrade and upgrade decisions with cooldown.
- Active-generation interruption policy.
- Pause-aware routing behavior.
- Router decision explanations for the UI.

### `updater`

Owns metadata checks only:

- Source abstractions for Ollama, MLX/Hugging Face, GGUF/Hugging Face,
  LM Studio-compatible metadata where available, and custom JSON catalogs.
- Last checked metadata, revision/version, compatibility result, update cards,
  ignore/remind-later state, and history.
- No model weight downloads without explicit user approval.
- Privacy mode disables checks.
- Paused mode suspends scheduled checks.

### `remote_broker`

Owns Windows broker server and macOS client logic:

- Windows opt-in LAN broker endpoints.
- Authenticated pairing token/code flow.
- Client list and revoke behavior.
- mDNS/Bonjour service `_localai-router._tcp`.
- Manual IP:port pairing.
- Broker pause behavior: keep online, stop accepting new requests, or fully stop.
- Secure token storage and local-network-only defaults.

## 6. Core Domain Types

These types should be defined as Rust structs/enums with `serde` support and
mirrored in TypeScript through generated bindings or manually maintained API
types.

```text
AppState
  Running | Pausing | Paused | Resuming | Error { message, details? }

PauseSource
  Dashboard | Tray | Settings | Router | SystemStartup | Installer | Provider | RemoteBroker

PauseDuration
  Now | AfterCurrentGeneration | ForMinutes(u32) | UntilManualResume

PauseRequest
  source: PauseSource
  duration: PauseDuration
  reason: string
  active_generation_policy: Wait | CancelAndPause
  active_download_policy: PauseIfSupported | CancelSafely | ContinueThenPause
  broker_policy: KeepOnline | RejectNewRequests | StopUntilResume

HardwareSpecs
  platform, os_name, os_version, arch, cpu, cores, memory, disk, gpu, vram,
  metal, cuda_hint, lan_ip, hostname, provider_ports, current_load

ProviderStatus
  id, display_name, provider_type, platform_support, base_url, detected_version,
  health, installed_models, capabilities, compatibility, task_pause_state

ModelEntry
  model_id, display_name, family, provider, platform, use_cases,
  parameter_size, quantization, package_gb, min_ram_gb, recommended_ram_gb,
  min_vram_gb, context_window, supports_vision, supports_tools, source_family,
  source_url, checked_at, install_steps, compatibility_notes

CompatibilityResult
  label: Smooth | Good | Tight | Avoid
  score: number
  reasons: string[]
  warnings: string[]
  fit_inputs_snapshot

RouterDecision
  mode, selected_provider, selected_model, reason, fallback_candidates,
  load_factors, suspended_by_pause, last_active_model, timestamp

RemoteDevice
  id, hostname, lan_ip, port, platform, specs_summary, paired, token_ref,
  provider_health, installed_models, load, latency_ms, last_seen

UpdateCandidate
  model_id, provider, source_url, version_or_revision, checked_at,
  compatibility, package_gb, notes, actions

LogEvent
  timestamp, level, category, source, message, technical_details?,
  related_task_id?, previous_state?, new_state?, affected_tasks?
```

## 7. Provider Adapter Design

The shared provider trait should expose:

```text
id()
display_name()
platform_support()
base_url()
list_models()
health_check()
chat_completion()
stream_chat_completion()
install_runtime()
install_model()
uninstall_model()
start_provider()
stop_provider()
pause_provider_tasks()
resume_provider_tasks()
open_provider_folder()
get_logs()
```

Provider capabilities must be explicit:

- Supports streaming.
- Supports runtime install.
- Supports model install/uninstall.
- Supports pausable downloads.
- Supports OpenAI-compatible `/v1/models`.
- Supports OpenAI-compatible `/v1/chat/completions`.
- Supports local process start/stop.
- Supports custom base URL.
- Supports GPU or Metal acceleration hints.

Provider rules:

- MLX-LM is Apple Silicon only by default and hidden or marked incompatible on
  Intel Mac and Windows unless manually enabled as experimental/custom.
- Ollama and LM Studio are preferred for Intel Mac and Windows.
- llama.cpp/custom is advanced fallback, especially for GGUF paths and older
  machines.
- GET `/models` is used where available; otherwise a tiny test chat request is
  the fallback health/model validation path.

## 8. Hardware Probe Design

Hardware probing must return normalized specs and raw technical details.

macOS Apple Silicon:

- Detect `arm64`, chip name, unified memory, Metal availability, MLX-LM
  suitability, RAM pressure, CPU load, disk free space, LAN IP, and provider
  ports.
- Prefer MLX-LM availability checks but do not install anything during probing.

macOS Intel:

- Detect `x86_64`, Intel CPU, RAM, GPU/VRAM where available, Metal availability,
  Rosetta where relevant, provider installs, and CPU-heavy inference warning.
- MLX-LM is incompatible by default.

Windows:

- Detect OS version, CPU, RAM, GPU, VRAM, NVIDIA driver status when available,
  CUDA hint, provider installs, LAN IP, and provider ports.
- `nvidia-smi` is optional and must not be required.
- GTX 1060 3 GB class machines are treated as low-VRAM.

Fixture tests later must include:

- MacBook M3 Pro 18 GB.
- Intel Mac 8 GB.
- Intel Mac 16 GB.
- Intel Mac 32 GB.
- Windows 30 GB usable RAM / GTX 1060 3 GB / i5-7400.

## 9. Router Design

Routing inputs:

- User mode.
- Selected use case.
- User preference: fastest, balanced, highest quality, lowest memory, manual.
- Installed models.
- Provider health.
- Compatibility scores.
- Current CPU/RAM/GPU/VRAM load.
- Latency and provider queue health.
- Remote device availability.
- Pause state.

Routing modes:

- Auto: choose best installed compatible model.
- Manual: use selected installed model with warnings.
- Forced: persist selected model until reset, with warnings.
- Remote preferred: prefer paired remote when healthy and appropriate.
- Local only: exclude remote models.
- Remote only: exclude local models.
- Paused: no automatic router decisions or model starts.

Auto behavior:

- Degrade to smaller/faster models under load.
- Upgrade only after load normalizes for the configured cooldown.
- Never interrupt active generation unless the user cancels or enables the
  explicit future "switch during long jobs" behavior.
- Always emit a user-readable decision reason and fallback chain.

Paused behavior:

- Manual and forced selections may change.
- No automatic start, degrade, upgrade, remote discovery, or background test job.
- Test prompt defaults disabled with a "Run once while paused" override.

## 10. Pause/Resume State Machine

States:

- Running
- Pausing
- Paused
- Resuming
- Error

Pause must be respected by:

- Router.
- Updater.
- Provider manager.
- Installer/downloader.
- Remote broker.
- Remote discovery.
- Notifications.
- Background health monitor.
- Tray/menu-bar mode.
- Launch-at-login startup behavior.

Required gates:

- `pause_gate.can_start_automation(task_kind)` for scheduled/background work.
- `pause_gate.can_start_manual_action(action_kind)` for user-triggered overrides.
- `pause_gate.on_active_generation()` for delayed or cancel-now behavior.
- `pause_gate.on_active_install()` for pause/cancel/continue-then-pause choices.
- `pause_gate.broker_policy()` for remote broker behavior.

Resume behavior:

- Restart enabled background services.
- Resume scheduled update checks according to settings.
- Resume provider health checks.
- Resume remote discovery if enabled.
- Recalculate machine load and router decision.
- Do not auto-switch away from a user-forced model.
- Write a "Resumed" log event.

Pause persistence:

- Store pause state locally.
- If manually paused and "Remember pause state after restart" is enabled, reopen
  in Paused state.
- Log SystemStartup as the pause source when restoring paused state.

Pause logs must include timestamp, source, previous state, new state, reason, and
active tasks affected.

## 11. Tauri Command Surface

Future commands should be grouped by domain:

```text
get_app_state()
pause_app(request)
resume_app(source)
get_pause_history()

refresh_hardware_specs()
get_hardware_specs()
export_specs(format)
copy_specs_to_clipboard(format)

list_providers()
get_provider_status(provider_id)
start_provider(provider_id)
stop_provider(provider_id)
test_provider(provider_id)
update_provider_config(provider_id, config)

list_model_catalog(filters)
score_models(input)
list_installed_models()
install_model_plan(model_id)
install_model(request)
uninstall_model(model_id)

get_router_state()
set_router_mode(mode)
force_model(model_id)
reset_router_to_auto()
test_route_prompt(request)

list_updates()
check_updates_now(source)
ignore_update(update_id)
remind_update_later(update_id)

list_remote_devices()
discover_remote_devices(source)
pair_remote_device(request)
revoke_remote_device(device_id)
test_remote_device(device_id)

get_settings()
update_settings(patch)
list_logs(filters)
export_logs(format)
```

Frontend subscription events:

```text
app-state-changed
provider-health-changed
router-decision-changed
install-progress
update-found
remote-device-changed
log-appended
settings-changed
hardware-specs-updated
```

## 12. Persistence Design

SQLite tables:

- `settings`
- `machine_spec_snapshots`
- `provider_configs`
- `provider_status_history`
- `installed_models`
- `model_catalog_entries`
- `compatibility_results`
- `router_preferences`
- `router_decisions`
- `update_checks`
- `update_candidates`
- `remote_paired_devices`
- `logs`
- `pause_state`
- `pause_history`
- `suspended_tasks`

Secure storage references:

- Custom provider API keys.
- Remote pairing tokens.
- Broker auth tokens.

The database stores references to secrets, never plaintext secret values.

## 13. Security and Privacy

Defaults:

- Provider endpoints are localhost.
- Remote broker is off.
- No telemetry.
- No cloud calls except user-approved metadata checks/downloads.
- No hidden downloads.
- No public internet exposure.

Remote broker:

- Opt-in only.
- Bind to LAN IP when possible.
- Pairing required before access.
- Auth required on all remote endpoints.
- Firewall rule creation only after explicit approval.
- Warn if broker or provider listens on public interfaces or `0.0.0.0`
  without authentication.
- Paused mode is not a security boundary; if broker remains online while paused,
  the UI must say so clearly.

Installers:

- Never install Python packages globally.
- Use app-managed runtime folders.
- Show shell commands before first install in advanced details.
- Require explicit user consent before runtimes or model weights.
- Validate paths and prevent path traversal.
- Verify downloads when hashes/signatures are available.

Privacy mode:

- Disables metadata checks.
- Disables remote discovery.
- Prevents automatic outbound catalog requests.

## 14. Error Handling Contract

Every user-visible error should include:

- User-readable message.
- Expandable technical details.
- Suggested fix.
- Copy diagnostics action.

Required error classes include provider missing/not running/no models, no
internet, interrupted download, low disk, incompatible model, port conflict,
firewall blocked, remote unavailable, authentication failed, GPU detection
unavailable, WMI failure, macOS permission denied, unsupported OS/architecture,
MLX requested on Intel, Intel Mac CPU-heavy warning, low memory, public provider
binding, pause/resume failure, active-generation delay, install cannot safely
pause, and restart while previously paused.

## 15. Stage 0 Acceptance Check

Stage 0 is complete when:

- Architecture and staged checklist are documented.
- No Tauri app scaffold exists.
- No Rust crates or provider implementations exist.
- Public interfaces and event names are defined at planning level.
- Pause/resume and security behavior are explicit enough for implementation.
- Future tests are fixture/mock based and never download model weights.
