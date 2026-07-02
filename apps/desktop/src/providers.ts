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
  | "UninstallProvider"
  | "UnloadModel"
  | "RemoveModelWeights"
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

export type ProviderSettings = {
  provider_id: string;
  enabled: boolean;
  base_url: string;
  folder: string;
  launch_command: string | null;
  api_key_configured: boolean;
  notes: string;
};

export type ProviderSettingsPatch = {
  provider_id: string;
  enabled: boolean;
  base_url: string;
  folder: string;
  launch_command: string | null;
};

export type ProviderInstallPlan = {
  provider_id: string;
  dry_run: boolean;
  summary: string;
  commands: string[];
  notes: string[];
};

export type ProviderMemoryActionKind = "UnloadFromMemory" | "RemoveWeightsFromDisk";

export type ProviderMemoryActionResult = {
  provider_id: string;
  model_id: string;
  action: ProviderMemoryActionKind;
  status: ProviderStatus;
  freed_memory: boolean;
  freed_disk: boolean;
  requires_redownload: boolean;
  message: string;
};

export type ProviderUninstallResult = {
  provider_id: string;
  status: ProviderStatus;
  app_managed_folder: string;
  app_managed_folder_removed: boolean;
  external_runtime_removed: boolean;
  external_cleanup_commands: string[];
  message: string;
};

type FallbackProvider = {
  definition: ProviderDefinition;
  settings: ProviderSettings;
  models: ProviderModel[];
  running: boolean;
  paused: boolean;
  health: ProviderHealth;
  latency_ms: number | null;
  logs: ProviderLogEntry[];
};

const storageKey = "local-ai-router:stage6-provider-state";

const fallbackProviders: FallbackProvider[] = [
  providerSeed(
    "ollama-local",
    "Ollama",
    "Ollama",
    "http://127.0.0.1:11434",
    "~/Library/Application Support/Local AI Router/providers/ollama",
    [
      providerModel("llama3.1:8b", "llama3.1:8b", "llama / Q4_K_M", 5_368_709_120, true),
      providerModel("nomic-embed-text", "nomic-embed-text", "Ollama / local", 629_145_600, false)
    ],
    "ollama serve",
    "Ollama local HTTP API at /api/tags and /api/generate."
  ),
  providerSeed(
    "lm-studio-local",
    "LM Studio",
    "LmStudio",
    "http://127.0.0.1:1234/v1",
    "~/Library/Application Support/Local AI Router/providers/lm-studio",
    [
      providerModel("local-model", "local-model", "OpenAI-compatible", 4_563_402_752, true),
      providerModel("qwen2.5-coder-local", "qwen2.5-coder-local", "OpenAI-compatible", 5_100_273_664, true)
    ],
    null,
    "LM Studio local server with the OpenAI-compatible API enabled."
  ),
  providerSeed(
    "openai-compatible-local",
    "Custom OpenAI-Compatible",
    "OpenAiCompatible",
    "http://127.0.0.1:5001/v1",
    "~/Library/Application Support/Local AI Router/providers/custom-openai",
    [providerModel("local-chat", "local-chat", "OpenAI-compatible", 0, true)],
    null,
    "Custom local OpenAI-compatible endpoint. API key storage is deferred."
  ),
  providerSeed(
    "mlx-lm-local",
    "MLX-LM Server",
    "MlxLm",
    "http://127.0.0.1:8080/v1",
    "~/Library/Application Support/Local AI Router/providers/mlx-lm",
    [
      providerModel(
        "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
        "Qwen2.5 Coder 7B MLX",
        "OpenAI-compatible",
        4_831_838_208,
        true
      )
    ],
    null,
    "MLX-LM OpenAI-compatible server for Apple Silicon."
  ),
  providerSeed(
    "llama-cpp-local",
    "llama.cpp Server",
    "LlamaCpp",
    "http://127.0.0.1:8081/v1",
    "~/Library/Application Support/Local AI Router/providers/llama-cpp",
    [providerModel("local-gguf", "local-gguf", "OpenAI-compatible", 4_563_402_752, true)],
    null,
    "llama.cpp server with OpenAI-compatible endpoints."
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
    running: provider.settings.enabled && !provider.paused,
    health: provider.settings.enabled
      ? provider.paused
        ? ("Paused" as const)
        : index === 2
          ? ("Degraded" as const)
          : ("Healthy" as const)
      : ("Stopped" as const),
    latency_ms: provider.settings.enabled && !provider.paused ? 34 + index * 9 : null,
    logs: [logEntry(provider.definition.id, "debug", "Browser fallback local health check completed."), ...provider.logs]
  }));
  writeFallbackProviders(providers);
  providers.forEach((provider) => emitProviderStatus(statusFromFallback(provider)));
  return providers.map(statusFromFallback);
}

export async function startProvider(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("start_provider", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    settings: { ...provider.settings, enabled: true },
    running: true,
    paused: false,
    health: "Healthy",
    latency_ms: 44,
    logs: [logEntry(providerId, "info", "Provider enabled in browser fallback."), ...provider.logs]
  }));
}

export async function stopProvider(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("stop_provider", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    settings: { ...provider.settings, enabled: false },
    running: false,
    paused: false,
    health: "Stopped",
    latency_ms: null,
    logs: [logEntry(providerId, "info", "Provider disabled in browser fallback."), ...provider.logs]
  }));
}

export async function pauseProviderTasks(providerId: string, reason: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("pause_provider_tasks", { providerId, reason });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    paused: provider.settings.enabled,
    running: provider.running,
    health: provider.settings.enabled ? "Paused" : provider.health,
    logs: [logEntry(providerId, "info", `Provider tasks paused: ${reason}`), ...provider.logs]
  }));
}

export async function resumeProviderTasks(providerId: string): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("resume_provider_tasks", { providerId });
  return updateProvider(providerId, (provider) => ({
    ...provider,
    paused: false,
    running: provider.settings.enabled,
    health: provider.settings.enabled ? "Healthy" : "Stopped",
    latency_ms: provider.settings.enabled ? 44 : null,
    logs: [logEntry(providerId, "info", "Provider tasks resumed."), ...provider.logs]
  }));
}

export async function pauseAllProviders(reason: string): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return refreshProviderHealth();
  return Promise.all(readFallbackProviders().map((provider) => pauseProviderTasks(provider.definition.id, reason)));
}

export async function resumeAllProviders(): Promise<ProviderStatus[]> {
  if (isTauriRuntime()) return refreshProviderHealth();
  return Promise.all(readFallbackProviders().map((provider) => resumeProviderTasks(provider.definition.id)));
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
  if (!provider.settings.enabled) throw new Error("provider is disabled");
  if (provider.paused) throw new Error("provider tasks are paused");
  const model = provider.models.find((item) => item.id === request.model_id) ?? provider.models[0];
  const response = {
    provider_id: provider.definition.id,
    model_id: model.id,
    response: `[local-fallback:${provider.definition.name}] ${model.display_name} is reachable. Echo: ${
      request.prompt.trim() || "Say ready."
    }`,
    tokens_in: request.prompt.trim().split(/\s+/).filter(Boolean).length,
    tokens_out: 32,
    latency_ms: provider.latency_ms ?? 55
  };
  updateProvider(request.provider_id, (current) => ({
    ...current,
    logs: [logEntry(request.provider_id, "info", "Local provider test chat completed."), ...current.logs]
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
  return providerById(providerId).settings.folder;
}

export async function getProviderSettings(providerId: string): Promise<ProviderSettings> {
  if (isTauriRuntime()) return invoke<ProviderSettings>("get_provider_settings", { providerId });
  return providerById(providerId).settings;
}

export async function updateProviderSettings(patch: ProviderSettingsPatch): Promise<ProviderStatus> {
  if (isTauriRuntime()) return invoke<ProviderStatus>("update_provider_settings", { patch });
  return updateProvider(patch.provider_id, (provider) => {
    const baseUrl = normalizeBaseUrl(patch.base_url);
    return {
      ...provider,
      definition: { ...provider.definition, base_url: baseUrl, folder: patch.folder },
      settings: {
        ...provider.settings,
        enabled: patch.enabled,
        base_url: baseUrl,
        folder: patch.folder,
        launch_command: patch.launch_command?.trim() ? patch.launch_command.trim() : null
      },
      running: patch.enabled,
      paused: false,
      health: patch.enabled ? "Healthy" : "Stopped",
      latency_ms: patch.enabled ? provider.latency_ms ?? 44 : null,
      logs: [logEntry(patch.provider_id, "info", "Provider settings updated."), ...provider.logs]
    };
  });
}

export async function previewProviderInstallPlan(providerId: string): Promise<ProviderInstallPlan> {
  if (isTauriRuntime()) return invoke<ProviderInstallPlan>("preview_provider_install_plan", { providerId });
  return installPlanFor(providerById(providerId));
}

export async function uninstallProvider(providerId: string): Promise<ProviderUninstallResult> {
  if (isTauriRuntime()) {
    return invoke<ProviderUninstallResult>("uninstall_provider", { providerId });
  }
  return uninstallFallbackProvider(providerId);
}

export async function unloadProviderModel(providerId: string, modelId: string): Promise<ProviderMemoryActionResult> {
  if (isTauriRuntime()) {
    return invoke<ProviderMemoryActionResult>("unload_provider_model", { providerId, modelId });
  }
  return updateProviderModelMemory(providerId, modelId, "UnloadFromMemory");
}

export async function removeProviderModelWeights(providerId: string, modelId: string): Promise<ProviderMemoryActionResult> {
  if (isTauriRuntime()) {
    return invoke<ProviderMemoryActionResult>("remove_provider_model_weights", { providerId, modelId });
  }
  return updateProviderModelMemory(providerId, modelId, "RemoveWeightsFromDisk");
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

function updateProvider(providerId: string, update: (provider: FallbackProvider) => FallbackProvider): ProviderStatus {
  const providers = readFallbackProviders();
  const index = providers.findIndex((provider) => provider.definition.id === providerId);
  if (index === -1) throw new Error(`unknown provider: ${providerId}`);
  providers[index] = update(providers[index]);
  writeFallbackProviders(providers);
  const status = statusFromFallback(providers[index]);
  emitProviderStatus(status);
  return status;
}

function uninstallFallbackProvider(providerId: string): ProviderUninstallResult {
  let folder = "";
  const status = updateProvider(providerId, (provider) => {
    folder = provider.settings.folder;
    return {
      ...provider,
      settings: { ...provider.settings, enabled: false },
      running: false,
      paused: false,
      health: "Stopped",
      latency_ms: null,
      models: [],
      logs: [
        logEntry(
          providerId,
          "warn",
          "Provider adapter uninstalled from Local AI Router. Runtime software was not removed automatically."
        ),
        ...provider.logs
      ]
    };
  });
  return {
    provider_id: providerId,
    status,
    app_managed_folder: folder,
    app_managed_folder_removed: false,
    external_runtime_removed: false,
    external_cleanup_commands: externalCleanupCommands(status.definition.kind),
    message:
      "Provider adapter uninstalled from Local AI Router. Runtime software was not removed automatically."
  };
}

function updateProviderModelMemory(
  providerId: string,
  modelId: string,
  action: ProviderMemoryActionKind
): ProviderMemoryActionResult {
  let resolvedModel = modelId;
  const status = updateProvider(providerId, (provider) => {
    const requiredCapability =
      action === "RemoveWeightsFromDisk" ? "RemoveModelWeights" : "UnloadModel";
    if (!provider.definition.capabilities.includes(requiredCapability)) {
      throw new Error("memory cleanup is not supported for this provider adapter yet");
    }
    const model = provider.models.find((item) => item.id === modelId) ?? provider.models[0];
    if (!model) throw new Error(`no provider model available for ${providerId}`);
    resolvedModel = model.id;
    const nextModels =
      action === "RemoveWeightsFromDisk"
        ? provider.models.filter((item) => item.id !== model.id)
        : provider.models;
    return {
      ...provider,
      models: nextModels,
      logs: [
        logEntry(
          providerId,
          action === "RemoveWeightsFromDisk" ? "warn" : "info",
          action === "RemoveWeightsFromDisk"
            ? `Browser fallback removed model weights for ${model.id}.`
            : `Browser fallback unloaded ${model.id} from memory.`
        ),
        ...provider.logs
      ]
    };
  });
  return {
    provider_id: providerId,
    model_id: resolvedModel,
    action,
    status,
    freed_memory: true,
    freed_disk: action === "RemoveWeightsFromDisk",
    requires_redownload: action === "RemoveWeightsFromDisk",
    message:
      action === "RemoveWeightsFromDisk"
        ? "Model weights removed from disk; re-download is required before reuse."
        : "Model unloaded from memory; weights remain installed."
  };
}

function readFallbackProviders(): FallbackProvider[] {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return cloneProviders(fallbackProviders);
  try {
    return JSON.parse(raw);
  } catch {
    return cloneProviders(fallbackProviders);
  }
}

function writeFallbackProviders(providers: FallbackProvider[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(providers));
}

function providerById(providerId: string) {
  const provider = readFallbackProviders().find((item) => item.definition.id === providerId);
  if (!provider) throw new Error(`unknown provider: ${providerId}`);
  return provider;
}

function statusFromFallback(provider: FallbackProvider): ProviderStatus {
  return {
    definition: {
      ...provider.definition,
      base_url: provider.settings.base_url,
      folder: provider.settings.folder
    },
    health: provider.health,
    running: provider.running,
    paused: provider.paused,
    model_count: provider.models.length,
    active_model: provider.models.find((model) => model.supports_chat)?.display_name ?? provider.models[0]?.display_name ?? null,
    latency_ms: provider.latency_ms,
    last_checked_ms: Date.now(),
    message: provider.settings.enabled
      ? "Browser fallback simulates local provider endpoint."
      : "Provider disabled in settings."
  };
}

function emitProviderStatus(status: ProviderStatus) {
  window.dispatchEvent(new CustomEvent("local-ai-router:provider-health-changed", { detail: status }));
}

function providerSeed(
  id: string,
  name: string,
  kind: ProviderKind,
  baseUrl: string,
  folder: string,
  models: ProviderModel[],
  launchCommand: string | null,
  notes: string
): FallbackProvider {
  const definition = {
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
      "UninstallProvider",
      ...(kind === "Ollama" ? (["UnloadModel", "RemoveModelWeights"] as ProviderCapability[]) : []),
      "PauseResumeTasks",
      "Logs",
      "ProviderFolder"
    ] as ProviderCapability[]
  };
  return {
    definition,
    settings: {
      provider_id: id,
      enabled: true,
      base_url: baseUrl,
      folder,
      launch_command: launchCommand,
      api_key_configured: false,
      notes
    },
    models,
    running: true,
    paused: false,
    health: "Healthy",
    latency_ms: 42,
    logs: [logEntry(id, "info", "Local provider adapter initialized.")]
  };
}

function providerModel(
  id: string,
  displayName: string,
  format: string,
  sizeBytes: number,
  supportsChat: boolean
): ProviderModel {
  return {
    id,
    display_name: displayName,
    format,
    size_bytes: sizeBytes,
    installed: true,
    supports_chat: supportsChat
  };
}

function externalCleanupCommands(kind: ProviderKind): string[] {
  const commands: Record<ProviderKind, string[]> = {
    Ollama: [
      "Use Providers > Model Listing > Remove weights for downloaded models.",
      "brew uninstall ollama"
    ],
    LmStudio: [
      "Quit LM Studio.",
      "Remove LM Studio from /Applications manually if it is no longer needed."
    ],
    MlxLm: [
      "Stop the MLX-LM server process.",
      "Remove the Python virtual environment you created for mlx-lm."
    ],
    LlamaCpp: ["Stop llama-server.", "brew uninstall llama.cpp"],
    OpenAiCompatible: [
      "Stop the custom OpenAI-compatible server outside Local AI Router.",
      "Remove its runtime files using that server's own uninstall instructions."
    ]
  };
  return commands[kind];
}

function installPlanFor(provider: FallbackProvider): ProviderInstallPlan {
  const sharedNotes = [
    "Dry-run only: no commands are executed and no model weights are downloaded.",
    `Configured endpoint: ${provider.settings.base_url}`
  ];
  const commandsByKind: Record<ProviderKind, string[]> = {
    Ollama: ["brew install ollama", "ollama serve", "ollama pull llama3.1:8b"],
    LmStudio: [
      "Install LM Studio desktop app manually.",
      "Enable Local Server in LM Studio on port 1234.",
      "Confirm http://127.0.0.1:1234/v1/models responds."
    ],
    MlxLm: [
      "python3 -m venv .venv-mlx-lm",
      ".venv-mlx-lm/bin/pip install mlx-lm",
      ".venv-mlx-lm/bin/python -m mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080"
    ],
    LlamaCpp: [
      "brew install llama.cpp",
      "llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8081",
      "Confirm http://127.0.0.1:8081/v1/models responds."
    ],
    OpenAiCompatible: [
      "Start your local OpenAI-compatible server.",
      "Set the Base URL to the server's /v1 endpoint.",
      "Confirm the /models and /chat/completions endpoints respond."
    ]
  };
  return {
    provider_id: provider.definition.id,
    dry_run: true,
    summary: `Dry-run setup plan for ${provider.definition.name}`,
    commands: commandsByKind[provider.definition.kind],
    notes: provider.settings.launch_command
      ? [...sharedNotes, `Configured launch command for Stage 7: ${provider.settings.launch_command}`]
      : sharedNotes
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

function cloneProviders(providers: FallbackProvider[]): FallbackProvider[] {
  return JSON.parse(JSON.stringify(providers));
}

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
