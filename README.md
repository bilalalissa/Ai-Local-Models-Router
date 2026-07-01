# Local AI Router

Local AI Router is a desktop app for choosing, testing, and routing local AI
models across one machine or a trusted local network. It helps you inspect
hardware, compare model fit, manage local providers, pause automation, and route
requests to either local models or a paired Windows broker machine.

## Who This Is For

- Mac users who want a clear way to choose local models for Apple Silicon or
  Intel hardware.
- Windows users who want to expose a trusted LAN machine as a remote model
  provider for Macs.
- Developers testing local AI provider workflows with Ollama, LM Studio,
  MLX-LM, llama.cpp, or OpenAI-compatible local servers.

## Current Status

The app is functional as a local-first desktop shell with hardware detection,
model scoring, provider checks, dry-run installers, router decisions, remote
broker/client pairing, pause mode, update metadata fixtures, and macOS/Windows
packaging scripts.

Current limitations:

- Runtime/model installers are dry-run only and do not download model weights.
- Update metadata checks use local fixtures.
- Public releases still require external signing/notarization credentials.
- Windows MSI/NSIS installers must be built and signed on Windows.
- Remote broker/client mode is intended for trusted LAN use, not internet
  exposure.

For a plain-language explanation, see
[Regular vs Dry-Run Methods](docs/REGULAR_VS_DRY_RUN.md).

## Platform Setup

Start with the guide for your machine:

- [macOS Apple Silicon](docs/MAC_APPLE_SILICON.md)
- [macOS Intel](docs/MAC_INTEL.md)
- [Windows x64](docs/WINDOWS.md)

For remote routing, read:

- [Remote Pairing](docs/REMOTE_PAIRING.md)

## Install And Run

### Use A Packaged macOS App

On macOS, build a local `.app` bundle:

```bash
npm install
npm run build:macos:apple-silicon
```

For Intel Mac:

```bash
npm run build:macos:intel
```

The app bundle is created under:

```text
apps/desktop/src-tauri/target/<target>/release/bundle/macos/Local AI Router.app
```

Unsigned local builds are for development and local verification. Signed public
builds require Apple Developer ID signing and notarization.

### Run From Source

Requirements:

- Node.js 20 or newer.
- Rust stable toolchain.
- Tauri system prerequisites for your platform.

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri:dev
```

Run the browser preview:

```bash
npm run dev
```

### Build Windows Installers

Run on Windows 10/11 x64 with Visual Studio Build Tools, Rust, Node.js, WebView2,
and PowerShell:

```powershell
npm install
npm run build:windows
```

## What You Need To Set Up Outside The App

Local AI Router does not install real model runtimes yet. Before local routing
can call real models, install and run one or more providers yourself:

- Ollama.
- LM Studio.
- MLX-LM server on Apple Silicon.
- llama.cpp or another OpenAI-compatible local server.

For remote routing:

- Keep the Windows broker and Mac client on the same trusted LAN.
- Enable broker sharing on Windows.
- Allow the broker port through Windows Firewall for the trusted network.
- Use a router DHCP reservation or OS static IP for the Windows broker when you
  want stable communication.
- In the app, use the fixed broker address option to pin that stable URL, for
  example `http://192.168.1.50:17640`.

## How To Use The App

- [User Guide](docs/USER_GUIDE.md): task-based guide with annotated screenshots.
- [Scenario Walkthroughs](docs/SCENARIOS.md): end-to-end setup and troubleshooting flows.
- [Regular vs Dry-Run Methods](docs/REGULAR_VS_DRY_RUN.md): what changes your machine and what only previews work.
- [Providers](docs/PROVIDERS.md): provider expectations and limitations.
- [Local Integration API](docs/LOCAL_INTEGRATION_API.md): how companion apps such as LLM Agent Learning Boost connect to the localhost router endpoint.
- [Model Catalog](docs/MODEL_CATALOG.md): how compatibility labels work.
- [Pause Mode](docs/PAUSE_MODE.md): what pause/resume affects.
- [Security](docs/SECURITY.md): local-network and token guidance.

## Developer Documentation

Development history and implementation details are archived under
[docs/development](docs/development/):

- [Architecture](docs/development/ARCHITECTURE.md)
- [Stage Checklist](docs/development/STAGE_CHECKLIST.md)
- [Final Verification](docs/development/FINAL_VERIFICATION.md)
- [Stage History](docs/development/STAGE_HISTORY.md)

## Packaging And Release

- [Packaging](docs/PACKAGING.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)

## License

MIT License. See [LICENSE](LICENSE).
