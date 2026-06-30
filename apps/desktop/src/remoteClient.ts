import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HardwareSpecs } from "./hardware";
import type { ProviderModel, ProviderStatus } from "./providers";
import type { RouteCandidate } from "./router";

export const localAiRouterMdnsService = "_localai-router._tcp";

export type RemoteDiscoverySource = "MdnsBonjour" | "Manual" | "FixedAddress" | "Fixture";
export type RemoteClientStatus = "Discovered" | "Paired" | "Online" | "Offline" | "AuthFailed" | "Paused" | "Error";
export type RemoteClientTokenStorage = "ProtectedAppDataFile" | "BrowserPreviewStorage";

export type RemoteClientSettings = {
  discovery_enabled: boolean;
  include_fixture_discovery: boolean;
  allow_router_remote_models: boolean;
  mdns_service: string;
  fixed_broker_enabled: boolean;
  fixed_broker_name: string;
  fixed_broker_base_url: string;
  prefer_fixed_broker_over_mdns: boolean;
};

export type RemoteDiscoveryResult = {
  id: string;
  name: string;
  source: RemoteDiscoverySource;
  service_type: string;
  address: string;
  port: number;
  base_url: string;
  discovered_at_ms: number;
  latency_ms: number | null;
  message: string;
};

export type RemoteClientDevice = {
  id: string;
  name: string;
  source: RemoteDiscoverySource;
  base_url: string;
  token_fingerprint: string;
  status: RemoteClientStatus;
  paired_at_ms: number;
  last_seen_ms: number | null;
  latency_ms: number | null;
  health: unknown | null;
  specs: HardwareSpecs | null;
  provider_statuses: ProviderStatus[];
  models: ProviderModel[];
  message: string;
};

export type RemoteClientSnapshot = {
  settings: RemoteClientSettings;
  status: RemoteClientStatus;
  discovered: RemoteDiscoveryResult[];
  paired_devices: RemoteClientDevice[];
  token_storage: RemoteClientTokenStorage;
  route_candidates: RouteCandidate[];
  last_discovery_ms: number | null;
  message: string;
};

export type ManualPairRequest = {
  name: string;
  base_url: string;
  token: string;
};

export type PairDiscoveredRequest = {
  discovery_id: string;
  token: string;
};

type FallbackState = {
  snapshot: RemoteClientSnapshot;
  tokens: Record<string, string>;
};

const storageKey = "local-ai-router:stage12-remote-client-state";

const defaultSettings: RemoteClientSettings = {
  discovery_enabled: true,
  include_fixture_discovery: true,
  allow_router_remote_models: true,
  mdns_service: localAiRouterMdnsService,
  fixed_broker_enabled: false,
  fixed_broker_name: "Studio Windows Broker",
  fixed_broker_base_url: "http://192.168.1.50:17640",
  prefer_fixed_broker_over_mdns: true
};

export async function getRemoteClientSnapshot(): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("get_remote_client_snapshot");
  return readFallbackState().snapshot;
}

export async function updateRemoteClientSettings(settings: RemoteClientSettings): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("update_remote_client_settings", { settings });
  const state = readFallbackState();
  return writeFallbackState({ ...state, snapshot: normalizeSnapshot({ ...state.snapshot, settings }) });
}

export async function discoverRemoteClients(): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("discover_remote_clients");
  const state = readFallbackState();
  if (!state.snapshot.settings.discovery_enabled && !state.snapshot.settings.fixed_broker_enabled) {
    return writeFallbackState({
      ...state,
      snapshot: normalizeSnapshot({ ...state.snapshot, status: "Discovered", message: "Remote discovery is disabled." })
    });
  }
  const fixed = state.snapshot.settings.fixed_broker_enabled ? fixedDiscovery(state.snapshot.settings) : null;
  const discovered = state.snapshot.settings.include_fixture_discovery ? [fixtureDiscovery()] : [];
  if (fixed) {
    if (state.snapshot.settings.prefer_fixed_broker_over_mdns) discovered.unshift(fixed);
    else discovered.push(fixed);
  }
  const deduped = dedupeDiscovery(discovered);
  return writeFallbackState({
    ...state,
    snapshot: normalizeSnapshot({
      ...state.snapshot,
      status: "Discovered",
      discovered: deduped,
      last_discovery_ms: Date.now(),
      message: `${deduped.length} remote broker candidates discovered.`
    })
  });
}

export async function pairManualRemoteClient(request: ManualPairRequest): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("pair_manual_remote_client", { request });
  const state = readFallbackState();
  const baseUrl = normalizeBaseUrl(request.base_url);
  const device = fixtureDevice(request.name || "Studio-Win11 Broker", baseUrl, request.token);
  return writeFallbackState({
    snapshot: normalizeSnapshot({
      ...state.snapshot,
      status: "Online",
      paired_devices: [device, ...state.snapshot.paired_devices.filter((item) => item.id !== device.id)],
      message: "Manual remote broker paired."
    }),
    tokens: { ...state.tokens, [device.id]: request.token }
  });
}

export async function pairDiscoveredRemoteClient(request: PairDiscoveredRequest): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("pair_discovered_remote_client", { request });
  const state = readFallbackState();
  const discovery = state.snapshot.discovered.find((item) => item.id === request.discovery_id);
  if (!discovery) throw new Error(`unknown discovery result: ${request.discovery_id}`);
  return pairManualRemoteClient({ name: discovery.name, base_url: discovery.base_url, token: request.token });
}

export async function refreshRemoteClients(): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("refresh_remote_clients");
  const state = readFallbackState();
  return writeFallbackState({
    ...state,
    snapshot: normalizeSnapshot({
      ...state.snapshot,
      status: "Online",
      paired_devices: state.snapshot.paired_devices.map((device) => ({
        ...fixtureDevice(device.name, device.base_url, state.tokens[device.id] ?? "lar_browser_token"),
        id: device.id,
        paired_at_ms: device.paired_at_ms
      })),
      message: "Remote device refresh completed."
    })
  });
}

export async function removeRemoteClient(deviceId: string): Promise<RemoteClientSnapshot> {
  if (isTauriRuntime()) return invoke<RemoteClientSnapshot>("remove_remote_client", { deviceId });
  const state = readFallbackState();
  const { [deviceId]: _removed, ...tokens } = state.tokens;
  return writeFallbackState({
    tokens,
    snapshot: normalizeSnapshot({
      ...state.snapshot,
      paired_devices: state.snapshot.paired_devices.filter((device) => device.id !== deviceId),
      message: "Remote client removed."
    })
  });
}

export async function getRemoteRouteCandidates(): Promise<RouteCandidate[]> {
  if (isTauriRuntime()) return invoke<RouteCandidate[]>("get_remote_route_candidates");
  return readFallbackState().snapshot.route_candidates;
}

export function subscribeRemoteClientSnapshot(onChange: (snapshot: RemoteClientSnapshot) => void): () => void {
  if (isTauriRuntime()) {
    let unlisten: UnlistenFn | null = null;
    listen<RemoteClientSnapshot>("remote-client-snapshot-changed", (event) => onChange(event.payload))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }
  const handler = (event: Event) => onChange((event as CustomEvent<RemoteClientSnapshot>).detail);
  window.addEventListener("local-ai-router:remote-client-snapshot-changed", handler);
  return () => window.removeEventListener("local-ai-router:remote-client-snapshot-changed", handler);
}

function readFallbackState(): FallbackState {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as FallbackState;
      return { ...parsed, snapshot: normalizeSnapshot(parsed.snapshot) };
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  return {
    tokens: {},
    snapshot: normalizeSnapshot({
      settings: defaultSettings,
      status: "Discovered",
      discovered: [],
      paired_devices: [],
      token_storage: "BrowserPreviewStorage",
      route_candidates: [],
      last_discovery_ms: null,
      message: "Remote client state ready."
    })
  };
}

function writeFallbackState(state: FallbackState): RemoteClientSnapshot {
  const snapshot = normalizeSnapshot(state.snapshot);
  const next = { ...state, snapshot };
  localStorage.setItem(storageKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("local-ai-router:remote-client-snapshot-changed", { detail: snapshot }));
  return snapshot;
}

function normalizeSnapshot(snapshot: RemoteClientSnapshot): RemoteClientSnapshot {
  const settings = { ...defaultSettings, ...snapshot.settings };
  const route_candidates = settings.allow_router_remote_models
    ? snapshot.paired_devices.filter((device) => device.status === "Online").flatMap(routeCandidatesForDevice)
    : [];
  return { ...snapshot, settings, route_candidates };
}

function fixtureDiscovery(): RemoteDiscoveryResult {
  return {
    id: "fixture-studio-win11",
    name: "Studio-Win11 Broker",
    source: "Fixture",
    service_type: localAiRouterMdnsService,
    address: "192.168.1.50",
    port: 17640,
    base_url: "fixture://studio-win11",
    discovered_at_ms: Date.now(),
    latency_ms: 24,
    message: "Fixture remote broker used for browser preview and local verification."
  };
}

function fixedDiscovery(settings: RemoteClientSettings): RemoteDiscoveryResult {
  const baseUrl = normalizeBaseUrl(settings.fixed_broker_base_url);
  const parsed = parseHttpBaseUrl(baseUrl);
  return {
    id: `fixed-${stableId(baseUrl)}`,
    name: settings.fixed_broker_name.trim() || "Fixed Windows Broker",
    source: "FixedAddress",
    service_type: "fixed-address",
    address: parsed.host,
    port: parsed.port,
    base_url: baseUrl,
    discovered_at_ms: Date.now(),
    latency_ms: null,
    message: "Pinned fixed broker address. Configure router DHCP reservation or OS static IP for stability."
  };
}

function fixtureDevice(name: string, baseUrl: string, token: string): RemoteClientDevice {
  const id = `${slug(name)}-${stableId(baseUrl)}`;
  return {
    id,
    name,
    source: baseUrl.startsWith("fixture://") ? "Fixture" : "Manual",
    base_url: baseUrl,
    token_fingerprint: `${stableId(token).slice(0, 6)}...${stableId(token).slice(-4)}`,
    status: "Online",
    paired_at_ms: Date.now(),
    last_seen_ms: Date.now(),
    latency_ms: 42,
    health: { status: "ok", broker: "Local AI Router Windows remote provider broker", fixture: true },
    specs: fixtureWindowsSpecs(),
    provider_statuses: [],
    models: [
      {
        id: "llama-3-1-8b-q4",
        display_name: "Llama 3.1 8B Instruct Q4",
        format: "GGUF / OpenAI-compatible",
        size_bytes: 5368709120,
        installed: true,
        supports_chat: true
      },
      {
        id: "qwen2-5-14b-q4",
        display_name: "Qwen2.5 14B Instruct Q4",
        format: "GGUF / OpenAI-compatible",
        size_bytes: 9663676416,
        installed: true,
        supports_chat: true
      }
    ],
    message: "Fixture Windows broker is online."
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("fixture://")) return trimmed;
  if (!trimmed.startsWith("http://")) throw new Error("remote broker URL must start with http://");
  parseHttpBaseUrl(trimmed);
  return trimmed;
}

function parseHttpBaseUrl(baseUrl: string): { host: string; port: number } {
  const withoutScheme = baseUrl.replace(/^http:\/\//, "");
  const authority = withoutScheme.split("/")[0];
  if (!authority.trim()) throw new Error("remote broker URL must include a host.");
  const [host, portRaw] = authority.includes(":") ? authority.split(":") : [authority, "80"];
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("remote broker URL must include a valid host and port.");
  }
  return { host, port };
}

function dedupeDiscovery(results: RemoteDiscoveryResult[]): RemoteDiscoveryResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.base_url)) return false;
    seen.add(result.base_url);
    return true;
  });
}

function routeCandidatesForDevice(device: RemoteClientDevice): RouteCandidate[] {
  return device.models.filter((model) => model.supports_chat).map((model) => {
    const latency = device.latency_ms ?? 250;
    const score = latency <= 80 ? 90 : latency <= 180 ? 84 : 74;
    return {
      model_id: model.id,
      model_name: model.display_name,
      provider: "OpenAiCompatible",
      provider_id: `remote-client:${device.id}`,
      provider_name: `Remote: ${device.name}`,
      score,
      label: score >= 88 ? "Smooth" : score >= 80 ? "Good" : "Tight",
      latency_ms: latency,
      installed: model.installed,
      reasons: [
        "Remote Windows broker is paired and online.",
        "Remote models are allowed for Apple Silicon and Intel Mac clients."
      ],
      blockers: []
    };
  });
}

function fixtureWindowsSpecs(): HardwareSpecs {
  return {
    id: "windows-gtx-1060-30gb",
    name: "Windows GTX 1060 30 GB",
    source: "Fixture",
    captured_at_ms: 1782768000000,
    platform: { os: "Windows", os_version: "11 Pro", architecture: "x86_64", family: "WindowsX64" },
    cpu: { brand: "Intel Core i7", physical_cores: 8, logical_cores: 16 },
    memory: { total_bytes: 32212254720, unified_memory: false },
    gpus: [{ name: "NVIDIA GTX 1060", vendor: "NVIDIA", memory_bytes: 6442450944, integrated: false }],
    storage: [{ mount: "C:", total_bytes: 1000204886016, available_bytes: 512000000000 }],
    load: { cpu_percent: 22, memory_percent: 44, gpu_percent: 18, vram_percent: 36 },
    notes: ["Fixture used for Windows remote broker tests."]
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
