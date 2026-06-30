# Remote Pairing

Remote pairing connects a Mac client to a trusted Windows broker on the same
LAN.

## Before You Start

- Mac and Windows PC are on the same trusted network.
- Windows provider software is running if you want real remote model calls.
- Windows Firewall allows the broker port on private/trusted networks.
- The Windows broker has a stable address if you want reliable long-term
  pairing.

## Pair With Bonjour Discovery

1. On Windows, enable LAN sharing and mDNS advertisement.
2. Start the broker and create a pairing code.
3. On Mac, open **Remote PCs**.
4. Click **Discover**.
5. Select the discovered broker and pair with the token/code.
6. Click **Refresh remotes**.

## Pair With A Manual URL

Use this when discovery does not find the broker.

1. Enter a name such as `Studio Windows Broker`.
2. Enter a broker URL such as `http://192.168.1.50:17640`.
3. Enter the pairing token/code.
4. Click **Pair manual broker**.

## Pin A Fixed Broker Address

Use this to avoid communication issues from dynamic IP changes.

1. Reserve the Windows PC IP in your router or configure a static IP in Windows.
2. On Mac, enable **Use fixed broker address**.
3. Enter the fixed broker name and URL.
4. Enable **Prefer fixed address over Bonjour** when this should be primary.
5. Pair or refresh using the fixed broker.

This pins the app connection. It does not configure the router or operating
system IP address for you.

## Troubleshooting

- Discovery empty: use fixed broker address or manual URL.
- Connection refused: confirm broker is running and firewall allows the port.
- Unauthorized: create a fresh pairing code or check token revocation.
- Remote route absent: refresh remotes and confirm Router is allowed to use
  remote models.
- Paused app: resume before discovery, pairing, or remote test prompts.
