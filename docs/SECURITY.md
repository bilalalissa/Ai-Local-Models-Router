# Security

Local AI Router is local-first. Network exposure is explicit and scoped to
trusted local machines.

## Secrets

- API keys and remote pairing tokens must not be committed.
- Stage 14 token storage uses protected local app data for remote pairing.
- Future production releases should migrate all secrets to OS secure storage
  through the planned keyring abstraction.

## Network Defaults

- Local providers default to loopback URLs.
- Windows broker sharing is off by default.
- LAN broker endpoints require pairing tokens.
- Remote discovery is suspended while paused.

## Packaging Secrets

Signing certificates, Apple credentials, Windows PFX files, and notarization
credentials are intentionally excluded from the repository.

## Known Limitations

- Stage 14 has dry-run installers and fixture update metadata.
- Remote broker/client flows are designed for trusted LAN use, not internet
  exposure.
- Public releases still require real signing and notarization credentials.
