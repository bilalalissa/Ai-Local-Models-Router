# Remote Pairing

Remote pairing connects macOS clients to a trusted Windows broker on the same
LAN.

## Discovery

Clients discover brokers through Bonjour/mDNS service
`_localai-router._tcp`. Manual `host:port` pairing is also available.

## Pairing Flow

1. Enable broker sharing on the Windows machine.
2. Generate a pairing code.
3. Discover or manually enter the broker address on the Mac.
4. Submit the pairing code.
5. Store the returned token in protected app data.
6. Refresh remote health, specs, models, provider status, load, and latency.

## Security Defaults

- Broker sharing is off by default.
- Endpoints require bearer-token authentication after pairing.
- Tokens can be revoked from the broker UI.
- Remote routing is disabled by pause gates where configured.
