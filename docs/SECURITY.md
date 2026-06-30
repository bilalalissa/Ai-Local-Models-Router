# Security

Local AI Router is local-first. Network exposure is explicit and intended only
for trusted local networks.

## Remote Broker Defaults

- Broker sharing is off by default.
- Broker endpoints require paired-client bearer tokens.
- Pairing tokens can be revoked from the broker UI.
- Pause mode can keep the broker online, reject new requests, or stop broker
  service until resume.

## Fixed Broker Address Safety

The fixed broker address option pins the app to a URL such as
`http://192.168.1.50:17640`. It does not configure the operating system network
adapter or router.

For stable and safer remote use:

- Use a router DHCP reservation or OS static IP for the Windows broker.
- Keep the broker on a private/trusted LAN.
- Do not expose the broker port to the internet.
- Revoke tokens if a Mac is lost or no longer trusted.

## Secrets

- Do not commit API keys, pairing tokens, signing keys, or certificates.
- Stage 14 stores remote pairing tokens in protected local app data.
- Future production releases should move all secrets to OS secure storage
  through the planned keyring abstraction.

## Packaging Secrets

Apple certificates, notarization credentials, Windows PFX files, and timestamp
credentials are intentionally excluded from the repository.

## Known Limitations

- Runtime/model installers are dry-run only.
- Update metadata uses local fixtures.
- Remote broker/client flows are trusted-LAN only.
