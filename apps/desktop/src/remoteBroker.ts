import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HardwareSpecs } from "./hardware";
import { refreshHardwareSpecs } from "./hardware";
import type { ProviderModel, ProviderStatus } from "./providers";
import { listProviderModels, listProviderStatuses } from "./providers";

export type RemoteBrokerPlatform = "WindowsX64" | "NonWindowsPreview";
export type RemoteBrokerStatus =
  | "Stopped"
  | "Running"
  | "SharingDisabled"
  | "PlatformBlocked"
  | "PausedOnline"
  | "PausedRejectingRequests"
  | "StoppedByPause";
export type BrokerPausePolicy = "KeepOnline" | "RejectNewRequests" | "StopUntilResume";
export type PairingSessionStatus = "Active" | "Consumed" | "Expired";

export type RemoteBrokerSettings = {
  lan_sharing_enabled: boolean;
  bind_host: string;
  port: number;
  advertise_mdns: boolean;
  require_bearer_token: boolean;
  pause_policy: BrokerPausePolicy;
};

export type RemoteBrokerEndpoint = {
  method: string;
  path: string;
  auth_required: boolean;
  description: string;
};

export type PairingSession = {
  id: string;
  code: string;
  created_at_ms: number;
  expires_at_ms: number;
  status: PairingSessionStatus;
};

export type RemoteDevice = {
  id: string;
  name: string;
  address: string;
  token_fingerprint: string;
  connected_at_ms: number;
  last_seen_ms: number;
  revoked: boolean;
  scopes: string[];
};

export type RemoteBrokerSnapshot = {
  platform: RemoteBrokerPlatform;
  status: RemoteBrokerStatus;
  settings: RemoteBrokerSettings;
  endpoints: RemoteBrokerEndpoint[];
  connected_clients: RemoteDevice[];
  pairing_sessions: PairingSession[];
  firewall_guidance: string[];
  security_warnings: string[];
  listen_url: string | null;
  message: string;
};

export type PairingStartResult = {
  snapshot: RemoteBrokerSnapshot;
  session: PairingSession;
};

export type RegisterPairingRequest = {
  code: string;
  client_name: string;
  address: string;
};

export type PairingRegistration = {
  snapshot: RemoteBrokerSnapshot;
  device: RemoteDevice;
  token: string;
};

export type BrokerEndpointRequest = {
  method: string;
  path: string;
  bearer_token: string | null;
  body: unknown | null;
};

export type BrokerEndpointResponse = {
  status_code: number;
  body: unknown;
};

type FallbackBrokerState = {
  snapshot: RemoteBrokerSnapshot;
  tokenByClientId: Record<string, string>;
};

const storageKey = "local-ai-router:stage11-remote-broker-state";

const defaultSettings: RemoteBrokerSettings = {
  lan_sharing_enabled: false,
  bind_host: "127.0.0.1",
  port: 17640,
  advertise_mdns: false,
  require_bearer_token: true,
  pause_policy: "RejectNewRequests"
};

const endpoints: RemoteBrokerEndpoint[] = [
  endpoint("GET", "/api/health", "Broker health and pause status."),
  endpoint("GET", "/api/specs", "Windows host hardware specs."),
  endpoint("GET", "/api/models", "Flattened provider model list."),
  endpoint("GET", "/api/provider-status", "Provider health, active model, and latency."),
  endpoint("GET", "/v1/models", "OpenAI-compatible model list."),
  endpoint("POST", "/v1/chat/completions", "Authenticated OpenAI-compatible chat proxy.")
];

export async function getRemoteBrokerSnapshot(): Promise<RemoteBrokerSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteBrokerSnapshot>("get_remote_broker_snapshot");
  return readFallbackState().snapshot;
}

export async function updateRemoteBrokerSettings(settings: RemoteBrokerSettings): Promise<RemoteBrokerSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteBrokerSnapshot>("update_remote_broker_settings", { settings });
  const state = readFallbackState();
  const snapshot = normalizeSnapshot({
    ...state.snapshot,
    settings,
    status: settings.lan_sharing_enabled ? state.snapshot.status : "SharingDisabled"
  });
  return writeFallbackState({ ...state, snapshot });
}

export async function startRemoteBroker(): Promise<RemoteBrokerSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteBrokerSnapshot>("start_remote_broker");
  const state = readFallbackState();
  const status: RemoteBrokerStatus = state.snapshot.settings.lan_sharing_enabled ? "Running" : "SharingDisabled";
  return writeFallbackState({ ...state, snapshot: normalizeSnapshot({ ...state.snapshot, status }) });
}

export async function stopRemoteBroker(): Promise<RemoteBrokerSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteBrokerSnapshot>("stop_remote_broker");
  const state = readFallbackState();
  return writeFallbackState({ ...state, snapshot: normalizeSnapshot({ ...state.snapshot, status: "Stopped" }) });
}

export async function createRemotePairingCode(): Promise<PairingStartResult> {
  if (isTauriRuntime()) return invoke<PairingStartResult>("create_remote_pairing_code");
  const state = readFallbackState();
  if (!["Running", "PausedOnline"].includes(state.snapshot.status)) {
    throw new Error("broker must be running before pairing clients");
  }
  const now = Date.now();
  const session: PairingSession = {
    id: `pairing-${now}`,
    code: String((now % 900000) + 100000),
    created_at_ms: now,
    expires_at_ms: now + 10 * 60 * 1000,
    status: "Active"
  };
  const snapshot = normalizeSnapshot({
    ...state.snapshot,
    pairing_sessions: [session, ...state.snapshot.pairing_sessions].slice(0, 8)
  });
  return { snapshot: writeFallbackState({ ...state, snapshot }), session };
}

export async function registerRemoteBrokerClient(
  request: RegisterPairingRequest
): Promise<PairingRegistration> {
  if (isTauriRuntime()) return invoke<PairingRegistration>("register_remote_broker_client", { request });
  const state = readFallbackState();
  const session = state.snapshot.pairing_sessions.find(
    (candidate) => candidate.code === request.code && candidate.status === "Active"
  );
  if (!session) throw new Error("pairing code is invalid or expired");
  const now = Date.now();
  const token = `lar_browser_${now.toString(36)}`;
  const device: RemoteDevice = {
    id: `remote-client-${now}`,
    name: request.client_name,
    address: request.address,
    token_fingerprint: `${token.slice(0, 6)}...${token.slice(-4)}`,
    connected_at_ms: now,
    last_seen_ms: now,
    revoked: false,
    scopes: ["health", "specs", "models", "provider-status", "chat"]
  };
  const snapshot = normalizeSnapshot({
    ...state.snapshot,
    connected_clients: [device, ...state.snapshot.connected_clients],
    pairing_sessions: state.snapshot.pairing_sessions.map((candidate) =>
      candidate.id === session.id ? { ...candidate, status: "Consumed" } : candidate
    )
  });
  return {
    snapshot: writeFallbackState({
      snapshot,
      tokenByClientId: { ...state.tokenByClientId, [device.id]: token }
    }),
    device,
    token
  };
}

export async function revokeRemoteBrokerClient(clientId: string): Promise<RemoteBrokerSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteBrokerSnapshot>("revoke_remote_broker_client", { clientId });
  const state = readFallbackState();
  const snapshot = normalizeSnapshot({
    ...state.snapshot,
    connected_clients: state.snapshot.connected_clients.map((client) =>
      client.id === clientId ? { ...client, revoked: true } : client
    )
  });
  const { [clientId]: _removed, ...tokenByClientId } = state.tokenByClientId;
  return writeFallbackState({ snapshot, tokenByClientId });
}

export async function previewRemoteBrokerEndpoint(
  request: BrokerEndpointRequest
): Promise<BrokerEndpointResponse> {
  if (isTauriRuntime()) return invoke<BrokerEndpointResponse>("preview_remote_broker_endpoint", { request });
  const state = readFallbackState();
  if (!["Running", "PausedOnline"].includes(state.snapshot.status)) {
    return { status_code: 503, body: { error: "broker_unavailable", status: state.snapshot.status } };
  }
  if (state.snapshot.settings.require_bearer_token && !validFallbackToken(state, request.bearer_token)) {
    return { status_code: 401, body: { error: "unauthorized" } };
  }
  const [hardware, provider_statuses] = await Promise.all([refreshHardwareSpecs(), listProviderStatuses()]);
  const models = (await Promise.all(provider_statuses.map((status) => listProviderModels(status.definition.id))))
    .flat()
    .filter((model) => model.supports_chat);
  return responseForEndpoint(request, hardware, provider_statuses, models);
}

export function subscribeRemoteBrokerSnapshot(onChange: (snapshot: RemoteBrokerSnapshot) => void): () => void {
  if (isTauriRuntime()) {
    let unlisten: UnlistenFn | null = null;
    listen<RemoteBrokerSnapshot>("remote-broker-snapshot-changed", (event) => onChange(event.payload))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }
  const handler = (event: Event) => onChange((event as CustomEvent<RemoteBrokerSnapshot>).detail);
  window.addEventListener("local-ai-router:remote-broker-snapshot-changed", handler);
  return () => window.removeEventListener("local-ai-router:remote-broker-snapshot-changed", handler);
}

function endpoint(method: string, path: string, description: string): RemoteBrokerEndpoint {
  return { method, path, description, auth_required: true };
}

function readFallbackState(): FallbackBrokerState {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as FallbackBrokerState;
      return { ...parsed, snapshot: normalizeSnapshot(parsed.snapshot) };
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  return {
    snapshot: normalizeSnapshot({
      platform: "WindowsX64",
      status: "SharingDisabled",
      settings: defaultSettings,
      endpoints,
      connected_clients: [],
      pairing_sessions: [],
      firewall_guidance: [],
      security_warnings: [],
      listen_url: null,
      message: ""
    }),
    tokenByClientId: {}
  };
}

function writeFallbackState(state: FallbackBrokerState): RemoteBrokerSnapshot {
  localStorage.setItem(storageKey, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("local-ai-router:remote-broker-snapshot-changed", { detail: state.snapshot }));
  return state.snapshot;
}

function normalizeSnapshot(snapshot: RemoteBrokerSnapshot): RemoteBrokerSnapshot {
  const listen_url =
    snapshot.status === "Running" || snapshot.status === "PausedOnline"
      ? `http://${snapshot.settings.bind_host === "0.0.0.0" ? "LAN-interface" : snapshot.settings.bind_host}:${snapshot.settings.port}`
      : null;
  return {
    ...snapshot,
    endpoints,
    listen_url,
    firewall_guidance: firewallGuidance(snapshot.settings, snapshot.platform),
    security_warnings: securityWarnings(snapshot.settings),
    message: brokerMessage(snapshot.status, snapshot.platform, snapshot.settings)
  };
}

function firewallGuidance(settings: RemoteBrokerSettings, platform: RemoteBrokerPlatform): string[] {
  return [
    ...(platform === "WindowsX64"
      ? []
      : ["Broker listen mode only starts on Windows x64 hosts; this machine shows a preview."]),
    `Allow inbound TCP ${settings.port} only on trusted Private networks.`,
    `Bind host is ${settings.bind_host}; use 127.0.0.1 for local-only testing or a LAN interface after consent.`,
    "Revoke paired clients immediately if a device or token is lost."
  ];
}

function securityWarnings(settings: RemoteBrokerSettings): string[] {
  return [
    "LAN sharing is opt-in and should stay disabled on public or untrusted networks.",
    "Every broker endpoint requires a paired client bearer token.",
    "Pairing codes expire quickly and can only be consumed once.",
    ...(settings.lan_sharing_enabled && settings.bind_host !== "127.0.0.1"
      ? ["This broker is configured for LAN exposure; verify Windows Firewall scope before starting."]
      : [])
  ];
}

function brokerMessage(
  status: RemoteBrokerStatus,
  platform: RemoteBrokerPlatform,
  settings: RemoteBrokerSettings
): string {
  if (status === "PlatformBlocked") {
    return platform === "WindowsX64"
      ? "Broker is blocked by platform configuration."
      : "Windows remote broker mode can only listen on Windows x64.";
  }
  if (status === "SharingDisabled") return "LAN sharing is disabled. Enable it before starting broker mode.";
  if (status === "Stopped") return "Broker is stopped.";
  if (status === "Running") return `Broker is accepting authenticated requests at ${settings.bind_host}:${settings.port}.`;
  if (status === "PausedOnline") return "App is paused; broker stays online according to pause policy.";
  if (status === "PausedRejectingRequests") return "App is paused; broker is rejecting new authenticated requests.";
  return "App is paused; broker is stopped until resume.";
}

function validFallbackToken(state: FallbackBrokerState, token: string | null): boolean {
  return !!token && Object.values(state.tokenByClientId).includes(token);
}

function responseForEndpoint(
  request: BrokerEndpointRequest,
  hardware: HardwareSpecs,
  providerStatuses: ProviderStatus[],
  models: ProviderModel[]
): BrokerEndpointResponse {
  if (request.method === "GET" && request.path === "/api/health") {
    return { status_code: 200, body: { status: "ok", broker: "Local AI Router Windows remote provider broker" } };
  }
  if (request.method === "GET" && request.path === "/api/specs") return { status_code: 200, body: hardware };
  if (request.method === "GET" && request.path === "/api/provider-status") {
    return { status_code: 200, body: providerStatuses };
  }
  if (request.method === "GET" && request.path === "/api/models") return { status_code: 200, body: models };
  if (request.method === "GET" && request.path === "/v1/models") {
    return {
      status_code: 200,
      body: { object: "list", data: models.map((model) => ({ id: model.id, object: "model", owned_by: "local-ai-router" })) }
    };
  }
  if (request.method === "POST" && request.path === "/v1/chat/completions") {
    return {
      status_code: 200,
      body: {
        id: `chatcmpl-stage11-${Date.now()}`,
        object: "chat.completion",
        model: "local-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "Broker endpoint accepted the authenticated chat request. Paired Mac clients can route to this provider when remote routing is enabled."
            },
            finish_reason: "stop"
          }
        ]
      }
    };
  }
  return { status_code: 404, body: { error: "not_found" } };
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
