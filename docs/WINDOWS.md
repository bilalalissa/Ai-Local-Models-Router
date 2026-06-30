# Windows

Windows support targets Windows 10/11 x64. The app can run as a local desktop
router and can also act as an opt-in LAN broker for trusted macOS clients.

## Build

Run on Windows:

```powershell
npm run build:windows
```

The script builds MSI and NSIS installers for `x86_64-pc-windows-msvc`.

## Broker Mode

Broker mode is opt-in and exposes authenticated local-network endpoints for:

- Health.
- Specs.
- Models.
- Provider status.
- OpenAI-compatible model listing and chat completions.

Pause policy can keep the broker online, reject new requests, or stop broker
service until resume.
