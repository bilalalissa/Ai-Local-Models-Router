import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProviderKind } from "./modelCatalog";

export type ProviderHealth = "Healthy" | "Starting" | "Stopped" | "Paused" | "Degraded" | "Error";
export type ProviderCapability =
  | "Health"
  | "ListModels"
  | "Chat"
  | "StreamingChat"
  | "StartStop"
  | "InstallModel"
  | "UninstallModel"
  | "PauseResumeTasks"
  | "Logs"
  | "ProviderFolder";

export type ProviderDefinition = {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  folder: string;
  capabilities: ProviderCapability[];
};

export type ProviderStatus = {
  definition: ProviderDefinition;
  health: ProviderHealth;
  running: boolean;
  paused: boolean;
  model_count: number;
  active_model: string | null;
  latency_ms: number | null;
  last_checked_ms: number;
  message: string;
};

export type ProviderModel = {
  id: string;
  display_name: string;
  format: string;
  size_bytes: number;
  installed: boolean;
  supports_chat: boolean;
};

export type ProviderLogEntry = {
  timestamp_ms: number;
  provider_id: string;
  level: string;
  message: string;
};

export type ProviderChatRequest = {
  provider_id: string;
  model_id: string | null;
  prompt: string;
};

export type ProviderChatResponse = {
  provider_id: string;
  model_id: string;
  response: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
};

const storageKey = "local-ai-router:stage5-provider-state";

const fallbackProviders: Array<{
  definition: ProviderDefinition;
  models: ProviderModel[];
  running: boolean;
  paused: boolean;
  health: ProviderHealth;
  latency_ms: number | null;
  logs: ProviderLogEntry[];
}> = [
  providerSeed(
    "mock-mlx",
    "MLX-LM Server",
    "MlxLm",
    "http://127.0.0.1:8080",
    "~/Library/Application Support/Local AI Router/providers/mlx-lm",
    [
      providerModel("qwen2-5-coder-7b-mlx", "Qwen2.5 Coder 7B MLX", "MLX / 4-bit", 4_831_838_208, true),
      providerModel("phi-3-5-mini-q4", "Phi-3.5 Mini", "GGUF / Q4_K_M", 2_684_354_560, true)
    ],
    true
  ),
  providerSeed(
    "mock-ollama",
    "Ollama",
    "Ollama",
    "http://127.0.0.1:11434",
    "~/Library/Application Support/Local AI Router/providers/ollama",
    [
      providerModel("llama-3-1-8b-q4", "Llama 3.1 8B Instruct Q4", "GGUF / Q4_K_M", 5_368_709_120, true),
      providerModel("phi-3-5-mini-q4", "Phi-3.5 Mini Instruct Q4", "GGUF / Q4_K_M", 2_684_354_560, true),
      providerModel("nomic-embed-text", "Nomic Embed Text", "GGUF / F16", 629_145_600, true)
    ],
    true
  ),
  providerSeed(
    "mock-lm-studio",
    "LM Studio",
    "LmStudio",
    "http://127.0.0.1:1234",
    "~/Library/Application Support/Local AI Router/providers/lm-studio",
    [
      providerModel("mistral-7b-instruct-q4", "Mistral 7B Instruct Q4", "GGUF / Q4_K_M", 4_563_402_752, false),
      providerModel("qwen2-5-coder-7b-q4", "Qwen2.5 Coder 7B Q4", "GGUF / Q4_K_M", 5_100_273_664, false)
    ],
    false
  ),
  providerSeed(
    "mock-openai-compatible",
    "Custom OpenAI-Compatible",
    "OpenAiCompatible",
    "http://127.0.0.1:5001/v1",
    "~/Library/Application Support/Local AI Router/providers/custom-openai",
    [providerModel("custom-local-chat", "Custom Local Chat", "OpenAI-compatible", 0, true)],
    false
  )
];

export async function listProviderStatuses(): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return invoke<ProviderStatus[]>("list_provider_statuses");
  return readFallbackProviders().map(statusFromFallback);
}

export async function refreshProviderHealth(): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return invoke<ProviderStatus[]>("refresh_provider_health");
  const providers = readFallbackProviders().map((provider, index) => ({
    ...provider,
    health: provider.running && !provider.paused ? (index === 2 ? "Degraded" as const : "Healthy" as const) : provider.health,
    latency_ms: provider.running && !provider.paused ? 38 + index * 13 : null,
    logs: [
      logEntry(provider.definition.id, "debug", "Mock health check completed."),
      ...provider.logs
    ]
  }));
  writeFallbackProviders(providers);
  providers.forEach((provider) => emitProviderStatus(statusFromFallback(provider)));
  return providers.map(statusFromFallback);
}

export async function startProvider(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("start_provider", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    running: true,
    paused: false,
    health: "Healthy",
    latency_ms: 48,
    logs: [logEntry(providerId, "info", "Mock provider started."), ...provider.logs]
  }));
}

export async function stopProvider(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("stop_provider", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    running: false,
    paused: false,
    health: "Stopped",
    latency_ms: null,
    logs: [logEntry(providerId, "info", "Mock provider stopped."), ...provider.logs]
  }));
}

export async function pauseProviderTasks(providerId: string, reason: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("pause_provider_tasks", { providerId, reason });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    paused: provider.running,
    health: provider.running ? "Paused" : provider.health,
    logs: [logEntry(providerId, "info", `Provider tasks paused: ${reason}`), ...provider.logs]
  }));
}

export async function resumeProviderTasks(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("resume_provider_tasks", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    paused: false,
    health: provider.running ? "Healthy" : "Stopped",
    latency_ms: provider.running ? 48 : null,
    logs: [logEntry(providerId, "info", "Provider tasks resumed."), ...provider.logs]
  }));
}

export async function pauseAllProviders(reason: string): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return refreshProviderHealth();
  const statuses = await Promise.all(
    readFallbackProviders().map((provider) => pauseProviderTasks(provider.definition.id, reason))
  );
  return statuses;
}

export async function resumeAllProviders(): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return refreshProviderHealth();
  const statuses = await Promise.all(
    readFallbackProviders().map((provider) => resumeProviderTasks(provider.definition.id))
  );
  return statuses;
}

export async function listProviderModels(providerId: string): Promise<ProviderModel[]> {
  if (isTauriRuntime()) return invoke<ProviderModel[]>("list_provider_models", { providerId });
  return providerById(providerId).models;
}

export async function sendProviderTestChat(
  request: ProviderChatRequest
): Promise<ProviderChatResponse> {
  if (isTauriRuntime()) return invoke<ProviderChatResponse>("send_provider_test_chat", { request });
  const provider = providerById(request.provider_id);
  if (!provider.running) throw new Error("provider is stopped");
  if (provider.paused) throw new Error("provider tasks are paused");
  const model = provider.models.find((item) => item.id === request.model_id) ?? provider.models[0];
  const response = {
    provider_id: provider.definition.id,
    model_id: model.id,
    response: `[mock:${provider.definition.name}] ${model.display_name} is ready. Echo: ${
      request.prompt.trim() || "(empty prompt)"
    }`,
    tokens_in: request.prompt.trim().split(/\s+/).filter(Boolean).length,
    tokens_out: 24,
    latency_ms: provider.latency_ms ?? 55
  };
  updateProvider(request.provider_id, (current) => ({
    ...current,
    logs: [logEntry(request.provider_id, "info", "Mock test chat completed."), ...current.logs]
  }));
  return response;
}

export async function getProviderLogs(providerId?: string): Promise<ProviderLogEntry[]> {
  if (isTauriRuntime()) return invoke<ProviderLogEntry[]>("get_provider_logs", { providerId });
  return readFallbackProviders()
    .filter((provider) => !providerId || provider.definition.id === providerId)
    .flatMap((provider) => provider.logs)
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms);
}

export async function getProviderFolder(providerId: string): Promise<string> {
  if (isTauriRuntime()) return invoke<string>("get_provider_folder", { providerId });
  return providerById(providerId).definition.folder;
}

export async function subscribeProviderHealth(
  onChange: (status: ProviderStatus) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<ProviderStatus>("provider-health-changed", (event) => onChange(event.payload));
  }
  const handler = (event: Event) => onChange((event as CustomEvent<ProviderStatus>).detail);
  window.addEventListener("local-ai-router:provider-health-changed", handler);
  return () => window.removeEventListener("local-ai-router:provider-health-changed", handler);
}

function updateProvider(
  providerId: string,
  update: (provider: ReturnType<typeof readFallbackProviders>[number]) => ReturnType<typeof readFallbackProviders>[number]
): ProviderStatus {
  const providers = readFallbackProviders();
  const index = providers.findIndex((provider) => provider.definition.id === providerId);
  if (index === -1) throw new Error(`unknown provider: ${providerId}`);
  providers[index] = update(providers[index]);
  writeFallbackProviders(providers);
  const status = statusFromFallback(providers[index]);
  emitProviderStatus(status);
  return status;
}

function readFallbackProviders(): typeof fallbackProviders {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return cloneProviders(fallbackProviders);
  try {
    return JSON.parse(raw);
  } catch {
    return cloneProviders(fallbackProviders);
  }
}

function writeFallbackProviders(providers: typeof fallbackProviders) {
  window.localStorage.setItem(storageKey, JSON.stringify(providers));
}

function providerById(providerId: string) {
  const provider = readFallbackProviders().find((item) => item.definition.id === providerId);
  if (!provider) throw new Error(`unknown provider: ${providerId}`);
  return provider;
}

function statusFromFallback(provider: ReturnType<typeof readFallbackProviders>[number]): ProviderStatus {
  return {
    definition: provider.definition,
    health: provider.health,
    running: provider.running,
    paused: provider.paused,
    model_count: provider.models.length,
    active_model: provider.models[0]?.display_name ?? null,
    latency_ms: provider.latency_ms,
    last_checked_ms: Date.now(),
    message: "Mock provider state loaded."
  };
}

function emitProviderStatus(status: ProviderStatus) {
  window.dispatchEvent(
    new CustomEvent("local-ai-router:provider-health-changed", { detail: status })
  );
}

function providerSeed(
  id: string,
  name: string,
  kind: ProviderKind,
  baseUrl: string,
  folder: string,
  models: ProviderModel[],
  running: boolean
) {
  return {
    definition: {
      id,
      name,
      kind,
      base_url: baseUrl,
      folder,
      capabilities: [
        "Health",
        "ListModels",
        "Chat",
        "StreamingChat",
        "StartStop",
        "InstallModel",
        "UninstallModel",
        "PauseResumeTasks",
        "Logs",
        "ProviderFolder"
      ] as ProviderCapability[]
    },
    models,
    running,
    paused: false,
    health: running ? "Healthy" as const : "Stopped" as const,
    latency_ms: running ? 42 : null,
    logs: [logEntry(id, "info", "Mock provider initialized.")]
  };
}

function providerModel(
  id: string,
  displayName: string,
  format: string,
  sizeBytes: number,
  installed: boolean
): ProviderModel {
  return {
    id,
    display_name: displayName,
    format,
    size_bytes: sizeBytes,
    installed,
    supports_chat: true
  };
}

function logEntry(providerId: string, level: string, message: string): ProviderLogEntry {
  return {
    timestamp_ms: Date.now(),
    provider_id: providerId,
    level,
    message
  };
}

function cloneProviders(providers: typeof fallbackProviders): typeof fallbackProviders {
  return JSON.parse(JSON.stringify(providers));
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
