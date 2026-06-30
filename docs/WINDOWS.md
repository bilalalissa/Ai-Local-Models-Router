# Windows x64 Setup

Windows support targets Windows 10/11 x64. The app can run local provider
workflows and can act as an opt-in LAN broker for trusted Mac clients.

## What You Need

- Windows 10/11 x64.
- Microsoft Edge WebView2 runtime.
- Node.js 20 or newer, Rust stable, and Visual Studio Build Tools if building
  from source.
- Optional providers:
  - Ollama.
  - LM Studio.
  - llama.cpp or another OpenAI-compatible local server.

## Build Windows Installers

Run on Windows:

```powershell
npm install
npm run build:windows
```

The script builds MSI and NSIS installers for `x86_64-pc-windows-msvc`.

## Use Broker Mode

![Windows broker controls](assets/screenshots/remote-pcs.png)

| Callout | What to check |
| --- | --- |
| 1 | LAN sharing must be enabled before broker endpoints listen on the network. |
| 2 | Bind host and port define the URL Mac clients use. |
| 3 | Pairing creates short-lived codes and revocable client tokens. |
| 4 | Endpoint previews help verify broker responses during setup. |

Broker mode lets trusted Mac clients route to models on the Windows PC.

1. Open **Remote PCs**.
2. Enable **LAN sharing**.
3. Choose a bind host:
   - `127.0.0.1` for local-only testing.
   - A LAN IP such as `192.168.1.50` for trusted network sharing.
   - `0.0.0.0` only when you understand the firewall scope.
4. Confirm the broker port, default `17640`.
5. Start the broker.
6. Create a pairing code for the Mac client.
7. Allow the broker port through Windows Firewall for private/trusted networks.

## Stable IP Recommendation

To prevent communication failures after router DHCP changes:

- Prefer a DHCP reservation on your router for the Windows PC.
- Or configure a static IPv4 address in Windows network settings.
- Then enter that stable URL in the Mac app fixed broker address field, for
  example `http://192.168.1.50:17640`.
- In Local AI Router, enable **Prefer fixed address over Bonjour** when the
  reserved/static IP should be used before dynamic discovery results.

## Expected Result

Paired Mac clients can refresh Windows specs, provider status, model lists, and
route candidates. Endpoints require bearer-token authentication after pairing.
