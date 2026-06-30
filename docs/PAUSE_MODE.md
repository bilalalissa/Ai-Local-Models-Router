# Pause Mode

Pause mode is a global safety control for background and automation behavior.

## Paused Operations

When paused, the app blocks or suspends:

- Router changes and routed test prompts.
- Installer runs.
- Provider background tasks.
- Update metadata checks.
- Remote discovery and pairing actions.
- Background notifications and scheduled tasks where configured.

## Pause Sources

Pause can be requested from the Dashboard, Router, Settings, tray/menu actions,
installer flow, provider controls, or broker controls.

## Broker Policies

Remote broker pause behavior can:

- Keep the broker online.
- Reject new requests.
- Stop until resume.

The UI keeps a visible amber app-state badge and banner while paused.
