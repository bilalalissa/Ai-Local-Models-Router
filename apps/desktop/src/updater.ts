import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HardwareSpecs } from "./hardware";
import type { CompatibilityLabel } from "./modelCatalog";
import { getModelCatalog, scoreModels } from "./modelCatalog";

export type MetadataSourceKind = "Ollama" | "MlxHuggingFace" | "CustomJson";
export type UpdateCheckStatus = "Idle" | "Ready" | "PrivacyBlocked" | "SuspendedByPause" | "Error";
export type UpdateActionKind = "Ignore" | "RemindLater" | "Install" | "InstallAndSwitch";
export type UpdateActionStatus = "Available" | "Ignored" | "RemindLater" | "InstallQueued" | "InstallAndSwitchQueued";

export type UpdaterSettings = {
  privacy_mode_enabled: boolean;
  scheduled_checks_enabled: boolean;
  include_ollama: boolean;
  include_mlx_huggingface: boolean;
  include_custom_json: boolean;
  remind_later_hours: number;
};

export type UpdateCandidate = {
  id: string;
  model_id: string;
  model_name: string;
  source_kind: MetadataSourceKind;
  source_name: string;
  current_version: string;
  latest_version: string;
  release_notes: string;
  compatibility_label: CompatibilityLabel;
  compatibility_score: number;
  compatibility_notes: string[];
  blocked_reasons: string[];
  action_status: UpdateActionStatus;
  ignored: boolean;
  remind_after_ms: number | null;
  checked_at_ms: number;
};

export type UpdateHistoryEntry = {
  timestamp_ms: number;
  candidate_id: string;
  action: UpdateActionKind;
  message: string;
};

export type UpdaterSnapshot = {
  settings: UpdaterSettings;
  status: UpdateCheckStatus;
  candidates: UpdateCandidate[];
  history: UpdateHistoryEntry[];
  last_checked_ms: number | null;
  message: string;
};

export type CheckUpdatesRequest = {
  hardware: HardwareSpecs;
  app_paused: boolean;
  manual: boolean;
};

export type UpdateActionRequest = {
  candidate_id: string;
  action: UpdateActionKind;
};

const storageKey = "local-ai-router:stage10-updater-state";

export const defaultUpdaterSettings: UpdaterSettings = {
  privacy_mode_enabled: false,
  scheduled_checks_enabled: true,
  include_ollama: true,
  include_mlx_huggingface: true,
  include_custom_json: true,
  remind_later_hours: 24
};

export async function getUpdaterSnapshot(): Promise<UpdaterSnapshot> {
  if (isTauriRuntime()) return invoke<UpdaterSnapshot>("get_updater_snapshot");
  return readFallbackSnapshot();
}

export async function updateUpdaterSettings(settings: UpdaterSettings): Promise<UpdaterSnapshot> {
  if (isTauriRuntime()) return invoke<UpdaterSnapshot>("update_updater_settings", { settings });
  const snapshot = { ...readFallbackSnapshot(), settings };
  const next = settings.privacy_mode_enabled
    ? { ...snapshot, status: "PrivacyBlocked" as const, candidates: [], message: "Privacy mode disables metadata checks." }
    : snapshot;
  writeFallbackSnapshot(next);
  emitUpdaterSnapshot(next);
  return next;
}

export async function checkUpdatesNow(request: CheckUpdatesRequest): Promise<UpdaterSnapshot> {
  if (isTauriRuntime()) return invoke<UpdaterSnapshot>("check_updates_now", { request });
  const snapshot = readFallbackSnapshot();
  if (snapshot.settings.privacy_mode_enabled) {
    const next = { ...snapshot, status: "PrivacyBlocked" as const, candidates: [], message: "Privacy mode disables metadata checks." };
    writeFallbackSnapshot(next);
    emitUpdaterSnapshot(next);
    return next;
  }
  if (request.app_paused && !request.manual) {
    const next = { ...snapshot, status: "SuspendedByPause" as const, message: "Scheduled update checks are suspended while the app is paused." };
    writeFallbackSnapshot(next);
    emitUpdaterSnapshot(next);
    return next;
  }

  const [catalog, scored] = await Promise.all([
    getModelCatalog(),
    scoreModels({
      hardware: request.hardware,
      use_case: "GeneralChat",
      preferred_provider: null,
      preference_tags: [],
      installed_only: false,
      app_paused: request.app_paused
    })
  ]);
  const models = new Map(catalog.map((model) => [model.id, model]));
  const scores = new Map(scored.map((result) => [result.model.id, result]));
  const now = Date.now();
  const candidates = fallbackMetadata(snapshot.settings)
    .filter((entry) => entry.current_version !== entry.latest_version)
    .flatMap((entry) => {
      const model = models.get(entry.model_id);
      const score = scores.get(entry.model_id);
      if (!model || !score) return [];
      const reminder = snapshot.reminders?.[entry.id] ?? null;
      const ignored = snapshot.ignored?.includes(entry.id) ?? false;
      return [{
        id: entry.id,
        model_id: entry.model_id,
        model_name: model.display_name,
        source_kind: entry.source_kind,
        source_name: entry.source_name,
        current_version: entry.current_version,
        latest_version: entry.latest_version,
        release_notes: entry.release_notes,
        compatibility_label: score.label,
        compatibility_score: score.score,
        compatibility_notes: score.reasons,
        blocked_reasons: score.blockers,
        action_status: ignored ? "Ignored" : reminder && reminder > now ? "RemindLater" : "Available",
        ignored,
        remind_after_ms: reminder,
        checked_at_ms: entry.checked_at_ms
      } satisfies UpdateCandidate];
    })
    .sort((a, b) => b.compatibility_score - a.compatibility_score || a.model_name.localeCompare(b.model_name));
  const next = {
    ...snapshot,
    status: "Ready" as const,
    candidates,
    last_checked_ms: now,
    message: `${candidates.length} update candidates loaded from fixtures.`
  };
  writeFallbackSnapshot(next);
  emitUpdaterSnapshot(next);
  candidates.forEach(emitUpdateFound);
  return next;
}

export async function applyUpdateAction(request: UpdateActionRequest): Promise<UpdaterSnapshot> {
  if (isTauriRuntime()) return invoke<UpdaterSnapshot>("apply_update_action", { request });
  const snapshot = readFallbackSnapshot();
  const now = Date.now();
  const candidate = snapshot.candidates.find((item) => item.id === request.candidate_id);
  if (!candidate) throw new Error(`unknown update candidate: ${request.candidate_id}`);
  const ignored = new Set(snapshot.ignored ?? []);
  const reminders = { ...(snapshot.reminders ?? {}) };
  const messageByAction: Record<UpdateActionKind, string> = {
    Ignore: "Update ignored.",
    RemindLater: "Reminder scheduled.",
    Install: "Dry-run install queued for this model update.",
    InstallAndSwitch: "Dry-run install-and-switch queued for this model update."
  };
  if (request.action === "Ignore") ignored.add(request.candidate_id);
  if (request.action === "RemindLater") reminders[request.candidate_id] = now + snapshot.settings.remind_later_hours * 60 * 60 * 1000;
  const statusByAction: Record<UpdateActionKind, UpdateActionStatus> = {
    Ignore: "Ignored",
    RemindLater: "RemindLater",
    Install: "InstallQueued",
    InstallAndSwitch: "InstallAndSwitchQueued"
  };
  const next = {
    ...snapshot,
    ignored: Array.from(ignored),
    reminders,
    candidates: snapshot.candidates.map((item) =>
      item.id === request.candidate_id
        ? {
            ...item,
            ignored: request.action === "Ignore" ? true : item.ignored,
            remind_after_ms: request.action === "RemindLater" ? reminders[request.candidate_id] : item.remind_after_ms,
            action_status: statusByAction[request.action]
          }
        : item
    ),
    history: [
      {
        timestamp_ms: now,
        candidate_id: request.candidate_id,
        action: request.action,
        message: messageByAction[request.action]
      },
      ...snapshot.history
    ].slice(0, 100)
  };
  writeFallbackSnapshot(next);
  emitUpdaterSnapshot(next);
  return next;
}

export async function subscribeUpdaterSnapshot(onChange: (snapshot: UpdaterSnapshot) => void): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<UpdaterSnapshot>("updater-snapshot-changed", (event) => onChange(event.payload));
  }
  const handler = (event: Event) => onChange((event as CustomEvent<UpdaterSnapshot>).detail);
  window.addEventListener("local-ai-router:updater-snapshot-changed", handler);
  return () => window.removeEventListener("local-ai-router:updater-snapshot-changed", handler);
}

type FallbackSnapshot = UpdaterSnapshot & {
  ignored?: string[];
  reminders?: Record<string, number>;
};

type FallbackMetadata = {
  id: string;
  model_id: string;
  source_kind: MetadataSourceKind;
  source_name: string;
  current_version: string;
  latest_version: string;
  release_notes: string;
  checked_at_ms: number;
};

function readFallbackSnapshot(): FallbackSnapshot {
  const raw = window.localStorage.getItem(storageKey);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return {
    settings: defaultUpdaterSettings,
    status: "Idle",
    candidates: [],
    history: [],
    last_checked_ms: null,
    message: "Updater is idle.",
    ignored: [],
    reminders: {}
  };
}

function writeFallbackSnapshot(snapshot: FallbackSnapshot) {
  window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

function fallbackMetadata(settings: UpdaterSettings): FallbackMetadata[] {
  return [
    ...(settings.include_ollama
      ? [
          metadata("ollama::llama-3-1-8b-q4", "llama-3-1-8b-q4", "Ollama", "Ollama local metadata fixture", "2026.04-q4_k_m", "2026.06-q4_k_m", "Refreshed quantization metadata and prompt template."),
          metadata("ollama::phi-3-5-mini-q4", "phi-3-5-mini-q4", "Ollama", "Ollama local metadata fixture", "2026.03-q4_k_m", "2026.05-q4_k_m", "Updated tokenizer metadata for local chat use.")
        ]
      : []),
    ...(settings.include_mlx_huggingface
      ? [
          metadata("mlx-hf::qwen2-5-coder-7b-mlx", "qwen2-5-coder-7b-mlx", "MlxHuggingFace", "MLX Hugging Face metadata fixture", "a13f4c2", "f92b8a1", "New MLX weights with lower memory spikes during coding prompts.")
        ]
      : []),
    ...(settings.include_custom_json
      ? [
          metadata("custom-json::qwen3-8b-q4", "qwen3-8b-q4", "CustomJson", "Custom JSON update catalog fixture", "2026.02-q4_k_m", "2026.06-q4_k_m", "Custom catalog marks this as the preferred balanced local chat refresh."),
          metadata("custom-json::llama-3-1-70b-q4", "llama-3-1-70b-q4", "CustomJson", "Custom JSON update catalog fixture", "2026.01-q4_k_m", "2026.06-q4_k_m", "Large model update remains constrained on smaller local machines.")
        ]
      : [])
  ];
}

function metadata(
  id: string,
  model_id: string,
  source_kind: MetadataSourceKind,
  source_name: string,
  current_version: string,
  latest_version: string,
  release_notes: string
): FallbackMetadata {
  return { id, model_id, source_kind, source_name, current_version, latest_version, release_notes, checked_at_ms: 1782794000000 };
}

function emitUpdaterSnapshot(snapshot: UpdaterSnapshot) {
  window.dispatchEvent(new CustomEvent("local-ai-router:updater-snapshot-changed", { detail: snapshot }));
}

function emitUpdateFound(candidate: UpdateCandidate) {
  window.dispatchEvent(new CustomEvent("local-ai-router:update-found", { detail: candidate }));
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
