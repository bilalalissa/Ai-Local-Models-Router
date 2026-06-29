import { invoke } from "@tauri-apps/api/core";
import type { HardwareSpecs, PlatformFamily } from "./hardware";

export type ProviderKind = "Ollama" | "LmStudio" | "MlxLm" | "LlamaCpp" | "OpenAiCompatible";
export type UseCase =
  | "GeneralChat"
  | "Coding"
  | "Summarization"
  | "Reasoning"
  | "Embeddings"
  | "Multimodal";
export type PreferenceTag = "Fast" | "Balanced" | "Quality" | "LowMemory" | "LocalOnly" | "Code";
export type CompatibilityLabel = "Smooth" | "Good" | "Tight" | "Avoid";

export type ModelEntry = {
  id: string;
  display_name: string;
  family: string;
  parameters_b: number;
  quantization: string;
  format: string;
  size_bytes: number;
  min_ram_bytes: number;
  recommended_ram_bytes: number;
  min_vram_bytes: number | null;
  recommended_vram_bytes: number | null;
  supported_platforms: PlatformFamily[];
  providers: ProviderKind[];
  use_cases: UseCase[];
  preference_tags: PreferenceTag[];
  installed: boolean;
  notes: string[];
};

export type ScoreInputs = {
  ram: number;
  vram: number;
  cpu_load: number;
  gpu_load: number;
  provider_support: number;
  disk: number;
  platform: number;
  use_case: number;
  preference: number;
  installed_status: number;
  pause_state: number;
};

export type CompatibilityResult = {
  model: ModelEntry;
  label: CompatibilityLabel;
  score: number;
  inputs: ScoreInputs;
  reasons: string[];
  blockers: string[];
};

export type ScoreModelCatalogRequest = {
  hardware: HardwareSpecs;
  use_case: UseCase;
  preferred_provider: ProviderKind | null;
  preference_tags: PreferenceTag[];
  installed_only: boolean;
  app_paused: boolean;
};

export const providerOptions: Array<{ value: ProviderKind | ""; label: string }> = [
  { value: "", label: "Any provider" },
  { value: "Ollama", label: "Ollama" },
  { value: "LmStudio", label: "LM Studio" },
  { value: "MlxLm", label: "MLX-LM" },
  { value: "LlamaCpp", label: "llama.cpp" }
];

export const useCaseOptions: Array<{ value: UseCase; label: string }> = [
  { value: "GeneralChat", label: "General chat" },
  { value: "Coding", label: "Coding" },
  { value: "Summarization", label: "Summarization" },
  { value: "Reasoning", label: "Reasoning" },
  { value: "Embeddings", label: "Embeddings" }
];

export const preferenceOptions: Array<{ value: PreferenceTag; label: string }> = [
  { value: "Fast", label: "Fast" },
  { value: "Balanced", label: "Balanced" },
  { value: "Quality", label: "Quality" },
  { value: "LowMemory", label: "Low memory" },
  { value: "LocalOnly", label: "Local only" },
  { value: "Code", label: "Code" }
];

const seedModels: ModelEntry[] = [
  {
    id: "phi-3-5-mini-q4",
    display_name: "Phi-3.5 Mini Instruct Q4",
    family: "Phi",
    parameters_b: 3.8,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 2684354560,
    min_ram_bytes: 6442450944,
    recommended_ram_bytes: 8589934592,
    min_vram_bytes: null,
    recommended_vram_bytes: null,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["GeneralChat", "Summarization"],
    preference_tags: ["Fast", "LowMemory", "LocalOnly"],
    installed: true,
    notes: ["Small general model for constrained machines."]
  },
  {
    id: "llama-3-1-8b-q4",
    display_name: "Llama 3.1 8B Instruct Q4",
    family: "Llama",
    parameters_b: 8,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 5368709120,
    min_ram_bytes: 12884901888,
    recommended_ram_bytes: 17179869184,
    min_vram_bytes: 4294967296,
    recommended_vram_bytes: 6442450944,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["GeneralChat", "Summarization", "Reasoning"],
    preference_tags: ["Balanced", "LocalOnly"],
    installed: true,
    notes: ["Balanced local chat model for 16 GB+ systems."]
  },
  {
    id: "qwen2-5-coder-7b-q4",
    display_name: "Qwen2.5 Coder 7B Q4",
    family: "Qwen Coder",
    parameters_b: 7,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 5100273664,
    min_ram_bytes: 12884901888,
    recommended_ram_bytes: 17179869184,
    min_vram_bytes: 4294967296,
    recommended_vram_bytes: 6442450944,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["Coding", "GeneralChat"],
    preference_tags: ["Code", "Balanced", "LocalOnly"],
    installed: false,
    notes: ["Coding-focused GGUF model for local providers."]
  },
  {
    id: "qwen2-5-coder-7b-mlx",
    display_name: "Qwen2.5 Coder 7B MLX",
    family: "Qwen Coder",
    parameters_b: 7,
    quantization: "4-bit",
    format: "MLX",
    size_bytes: 4831838208,
    min_ram_bytes: 12884901888,
    recommended_ram_bytes: 17179869184,
    min_vram_bytes: null,
    recommended_vram_bytes: null,
    supported_platforms: ["MacAppleSilicon"],
    providers: ["MlxLm"],
    use_cases: ["Coding", "GeneralChat"],
    preference_tags: ["Code", "Fast", "LocalOnly"],
    installed: true,
    notes: ["Apple Silicon MLX variant optimized for unified memory."]
  },
  {
    id: "mistral-7b-instruct-q4",
    display_name: "Mistral 7B Instruct Q4",
    family: "Mistral",
    parameters_b: 7,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 4563402752,
    min_ram_bytes: 10737418240,
    recommended_ram_bytes: 17179869184,
    min_vram_bytes: 3221225472,
    recommended_vram_bytes: 6442450944,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["GeneralChat", "Summarization"],
    preference_tags: ["Fast", "Balanced"],
    installed: false,
    notes: ["Efficient instruction model for general chat."]
  },
  {
    id: "nomic-embed-text",
    display_name: "Nomic Embed Text",
    family: "Nomic",
    parameters_b: 0.14,
    quantization: "F16",
    format: "GGUF",
    size_bytes: 629145600,
    min_ram_bytes: 2147483648,
    recommended_ram_bytes: 4294967296,
    min_vram_bytes: null,
    recommended_vram_bytes: null,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio"],
    use_cases: ["Embeddings"],
    preference_tags: ["Fast", "LowMemory", "LocalOnly"],
    installed: false,
    notes: ["Small embedding model for local retrieval workflows."]
  },
  {
    id: "qwen2-5-14b-q4",
    display_name: "Qwen2.5 14B Instruct Q4",
    family: "Qwen",
    parameters_b: 14,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 9663676416,
    min_ram_bytes: 21474836480,
    recommended_ram_bytes: 34359738368,
    min_vram_bytes: 8589934592,
    recommended_vram_bytes: 12884901888,
    supported_platforms: ["MacAppleSilicon", "MacIntel", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["GeneralChat", "Reasoning", "Summarization"],
    preference_tags: ["Quality", "Balanced"],
    installed: false,
    notes: ["Larger model that prefers 32 GB+ machines."]
  },
  {
    id: "llama-3-1-70b-q4",
    display_name: "Llama 3.1 70B Instruct Q4",
    family: "Llama",
    parameters_b: 70,
    quantization: "Q4_K_M",
    format: "GGUF",
    size_bytes: 48318382080,
    min_ram_bytes: 68719476736,
    recommended_ram_bytes: 103079215104,
    min_vram_bytes: 25769803776,
    recommended_vram_bytes: 51539607552,
    supported_platforms: ["MacAppleSilicon", "WindowsX64"],
    providers: ["Ollama", "LmStudio", "LlamaCpp"],
    use_cases: ["Reasoning", "GeneralChat"],
    preference_tags: ["Quality"],
    installed: false,
    notes: ["Included to make Avoid cases explicit on current target hardware."]
  }
];

export async function getModelCatalog(): Promise<ModelEntry[]> {
  if (isTauriRuntime()) {
    return invoke<ModelEntry[]>("get_model_catalog");
  }
  return seedModels;
}

export async function scoreModels(
  request: ScoreModelCatalogRequest
): Promise<CompatibilityResult[]> {
  if (isTauriRuntime()) {
    return invoke<CompatibilityResult[]>("score_models", { request });
  }

  return seedModels
    .map((model) => scoreModel(request, model))
    .filter((result) => !request.installed_only || result.model.installed)
    .sort((a, b) => b.score - a.score || labelRank(b.label) - labelRank(a.label));
}

function scoreModel(request: ScoreModelCatalogRequest, model: ModelEntry): CompatibilityResult {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const platform = model.supported_platforms.includes(request.hardware.platform.family)
    ? withReason(100, reasons, `Platform supported: ${request.hardware.platform.family}.`)
    : withBlocker(0, blockers, `Platform unsupported: ${request.hardware.platform.family}.`);
  const ram = scoreCapacity(
    request.hardware.memory.total_bytes,
    model.min_ram_bytes,
    model.recommended_ram_bytes,
    "RAM",
    reasons,
    blockers
  );
  const availableVram = request.hardware.memory.unified_memory
    ? request.hardware.memory.total_bytes
    : Math.max(0, ...request.hardware.gpus.map((gpu) => gpu.memory_bytes ?? 0));
  const vram =
    model.min_vram_bytes === null
      ? withReason(100, reasons, "Model does not require dedicated VRAM.")
      : scoreCapacity(
          availableVram,
          model.min_vram_bytes,
          model.recommended_vram_bytes ?? model.min_vram_bytes,
          "VRAM/unified memory",
          reasons,
          blockers
        );
  const cpu_load = scoreLoad(request.hardware.load.cpu_percent, "CPU", reasons);
  const gpu_load =
    request.hardware.load.gpu_percent === null
      ? withReason(75, reasons, "GPU load is not reported.")
      : scoreLoad(request.hardware.load.gpu_percent, "GPU", reasons);
  const provider_support = request.preferred_provider
    ? model.providers.includes(request.preferred_provider)
      ? withReason(100, reasons, `Preferred provider supported: ${request.preferred_provider}.`)
      : withBlocker(25, blockers, `Preferred provider unsupported: ${request.preferred_provider}.`)
    : withReason(90, reasons, "At least one planned local provider supports this model.");
  const availableDisk = Math.max(0, ...request.hardware.storage.map((volume) => volume.available_bytes));
  const disk =
    availableDisk >= model.size_bytes * 2
      ? withReason(100, reasons, "Disk space can hold model plus working margin.")
      : availableDisk >= model.size_bytes
        ? withReason(70, reasons, "Disk space can hold model but margin is limited.")
        : withBlocker(20, blockers, "Disk space is below model artifact size.");
  const use_case = model.use_cases.includes(request.use_case)
    ? withReason(100, reasons, `Use case matched: ${request.use_case}.`)
    : withReason(55, reasons, `${request.use_case} is not a primary catalog tag.`);
  const matches = request.preference_tags.filter((tag) => model.preference_tags.includes(tag)).length;
  const preference =
    request.preference_tags.length === 0
      ? withReason(80, reasons, "No preference tag selected.")
      : matches === request.preference_tags.length
        ? withReason(100, reasons, "All selected preference tags matched.")
        : matches > 0
          ? withReason(75, reasons, "Some selected preference tags matched.")
          : withReason(45, reasons, "Selected preference tags did not match.");
  const installed_status = model.installed
    ? withReason(100, reasons, "Model is marked installed in the seed catalog.")
    : withReason(request.installed_only ? 0 : 65, reasons, "Model is not installed yet.");
  const pause_state = request.app_paused
    ? withReason(70, reasons, "App is paused; recommendations remain visible but actions are gated.")
    : withReason(100, reasons, "App is running; model actions are not pause-gated.");
  const inputs = {
    ram,
    vram,
    cpu_load,
    gpu_load,
    provider_support,
    disk,
    platform,
    use_case,
    preference,
    installed_status,
    pause_state
  };
  const baseScore = weightedScore(inputs);
  const score = hasCriticalBlocker(blockers) ? Math.min(baseScore, 44) : baseScore;
  const label = compatibilityLabel(score, blockers);

  return { model, label, score, inputs, reasons, blockers };
}

function scoreCapacity(
  available: number,
  minimum: number,
  recommended: number,
  label: string,
  reasons: string[],
  blockers: string[]
): number {
  if (available >= recommended) return withReason(100, reasons, `${label} meets recommended target.`);
  if (available >= minimum) return withReason(70, reasons, `${label} meets minimum target.`);
  return withBlocker(15, blockers, `${label} is below model minimum.`);
}

function scoreLoad(value: number, label: string, reasons: string[]): number {
  if (value <= 45) return withReason(100, reasons, `${label} load has comfortable headroom.`);
  if (value <= 70) return withReason(78, reasons, `${label} load is moderate.`);
  if (value <= 85) return withReason(52, reasons, `${label} load is high.`);
  return withReason(25, reasons, `${label} load is near saturation.`);
}

function weightedScore(inputs: ScoreInputs): number {
  const weighted =
    inputs.platform * 2 +
    inputs.ram * 2 +
    inputs.vram * 1.5 +
    inputs.cpu_load +
    inputs.gpu_load * 0.75 +
    inputs.provider_support * 1.25 +
    inputs.disk * 0.75 +
    inputs.use_case * 0.75 +
    inputs.preference * 0.5 +
    inputs.installed_status * 0.5 +
    inputs.pause_state * 0.25;
  return Math.max(0, Math.min(100, Math.round(weighted / 11.25)));
}

function compatibilityLabel(score: number, blockers: string[]): CompatibilityLabel {
  if (score < 45 || hasCriticalBlocker(blockers)) {
    return "Avoid";
  }
  if (score >= 86) return "Smooth";
  if (score >= 70) return "Good";
  return "Tight";
}

function hasCriticalBlocker(blockers: string[]): boolean {
  return blockers.some(
    (blocker) => blocker.includes("unsupported") || blocker.includes("below model minimum")
  );
}

function withReason(score: number, reasons: string[], reason: string): number {
  reasons.push(reason);
  return score;
}

function withBlocker(score: number, blockers: string[], blocker: string): number {
  blockers.push(blocker);
  return score;
}

function labelRank(label: CompatibilityLabel): number {
  if (label === "Smooth") return 4;
  if (label === "Good") return 3;
  if (label === "Tight") return 2;
  return 1;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
