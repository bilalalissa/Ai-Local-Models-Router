# Scenario Walkthroughs

Use these flows when you want a concrete path through the app.

## First Launch And Hardware Check

Goal: confirm the app understands your machine before choosing models.

Before you start: open Local AI Router and keep the app state `Running`.

Steps:

1. Open **Machine Specs**.
2. Click refresh/load live specs.
3. Confirm CPU, memory, GPU, storage, OS, and provider ports.
4. Export JSON or Markdown if you need a support snapshot.

Expected result: hardware details load without errors.

Common problems and fixes:

- No live specs: use a fixture to compare behavior, then restart the app.
- Missing provider ports: start the provider outside the app and refresh again.

## Pick A Compatible Local Model

Goal: choose a model that fits the current machine.

Before you start: refresh Machine Specs or select the closest hardware fixture.

Steps:

1. Open **Model Fit Map**.
2. Select the target use case.
3. Filter by provider if you already know which runtime you want.
4. Prefer `Smooth` or `Good` labels.
5. Select a model and read the score breakdown.

Expected result: the model table explains fit and blockers.

Common problems and fixes:

- Too many `Tight` results: choose a smaller model or a more aggressive quantization.
- Provider mismatch: install/start the provider that supports the selected model.

## Set Up Ollama Or LM Studio

Goal: make a local provider available for routing.

Before you start: install Ollama or LM Studio outside Local AI Router.

Steps:

1. Start the provider app/server.
2. Open **Providers** in Local AI Router.
3. Refresh provider health.
4. Check or update the provider base URL.
5. List models.
6. Send a tiny test chat.

Expected result: the provider is healthy and returns a test response.

Common problems and fixes:

- Connection refused: start the provider and confirm the port.
- No models listed: install/load a model inside the provider first.

## Use The Recommended Installer

Goal: preview setup commands or run the macOS Ollama setup automatically with
explicit consent.

Before you start: choose **Dry run** for a preview or **Live install and run**
when you want the desktop app to execute runnable macOS Ollama setup steps. For
the full distinction, read [Regular vs Dry-Run Methods](REGULAR_VS_DRY_RUN.md).

Steps:

1. Open **Models**.
2. Select the recommended setup for your platform.
3. Review runtime, model, and cache folders.
4. Check the consent box.
5. Click **Preview recommended setup** for dry-run review, **Start live install**
   for supervised step-by-step execution, or **Auto install and run** to run all
   supported live steps.
6. Inspect logs and provider probe status.

Expected result: dry-run command hooks advance without executing downloads.
Live mode can install Ollama, start it, pull the recommended model, and probe
the endpoint on supported macOS plans.

Common problems and fixes:

- Button disabled: check the consent box.
- Expecting real install from dry-run: switch to **Live install and run**, check
  consent, then use **Auto install and run**.

## Route A Test Prompt Locally

Goal: verify the router can choose a local provider/model.

Before you start: have at least one healthy local provider.

Steps:

1. Open **Router**.
2. Choose **Auto** or **Local only**.
3. Review active decision and fallback candidates.
4. Run the test prompt.

Expected result: the router chooses an executable local model or explains why it
cannot.

Common problems and fixes:

- No executable route: refresh providers and lower model requirements.
- Paused route: resume the app.

## Use A Windows PC As A Remote Broker

Goal: let a trusted Mac use models available on a Windows PC.

Before you start: keep both machines on the same trusted LAN.

Steps:

1. On Windows, open **Remote PCs**.
2. Enable **LAN sharing**.
3. Set bind host and port.
4. Start the broker.
5. Create a pairing code.
6. Confirm Windows Firewall allows the broker port.

Expected result: the broker listens on the chosen trusted LAN address.

Common problems and fixes:

- Broker blocked: confirm Windows x64 and LAN sharing are enabled.
- Mac cannot connect: check firewall, IP, and port.

## Pair A Mac Client With The Windows Broker

Goal: connect the Mac router to the Windows broker.

Before you start: broker is running and you have a pairing code/token.

Steps:

1. On Mac, open **Remote PCs**.
2. Try **Discover**.
3. If discovery fails, use manual URL or fixed broker address.
4. Pair with the token/code.
5. Click **Refresh remotes**.
6. Open **Router** and choose **Remote preferred** or **Remote only**.

Expected result: remote specs, provider status, models, and route candidates
appear.

Common problems and fixes:

- Unauthorized: create a fresh code and confirm token was not revoked.
- Remote models absent: refresh remotes and check Windows provider health.

## Pin A Fixed Broker Address

Goal: avoid dynamic IP or Bonjour discovery issues.

Before you start: reserve the Windows PC IP in your router or set a static IP in
Windows.

Steps:

1. On Mac, open **Remote PCs**.
2. Enable **Use fixed broker address**.
3. Enter a name such as `Studio Windows Broker`.
4. Enter a URL such as `http://192.168.1.50:17640`.
5. Enable **Prefer fixed address over Bonjour**.
6. Enter the pairing token/code.
7. Click **Pair fixed address** or run **Discover**.

Expected result: the fixed broker candidate appears first and remains stable
across discovery refreshes.

Common problems and fixes:

- Invalid URL: include `http://`, host, and port.
- IP changes again: configure the router/Windows static IP; the app only pins
  the URL you enter.

## Pause And Resume All Automation

Goal: stop background automation while keeping the app visible.

Before you start: decide whether the broker should stay online, reject new
requests, or stop until resume.

Steps:

1. Click **Pause** from the top bar or Dashboard.
2. Confirm the amber paused state.
3. Try update checks, discovery, or routing and confirm they are suspended.
4. Click **Resume**.

Expected result: suspended tasks resume only after the app returns to `Running`.

Common problems and fixes:

- Remote pairing blocked: resume the app.
- Broker behavior unexpected: check broker pause policy.

## Troubleshoot Remote Connection Failures

Goal: isolate why a Mac cannot use a Windows broker.

Before you start: keep both machines awake and on the same trusted network.

Steps:

1. Confirm the Windows broker is running.
2. Confirm the broker URL in **Remote PCs**.
3. Confirm Windows Firewall allows the broker port.
4. Use fixed broker address if Bonjour discovery fails.
5. Create a fresh pairing code.
6. Refresh remotes.
7. Review **Logs**.

Expected result: the failure narrows to firewall, URL, token, pause state, or
provider health.

Common problems and fixes:

- Connection refused: broker stopped or firewall blocked.
- DNS/Bonjour failure: use fixed broker address.
- Auth failed: revoke the old client and pair again.
