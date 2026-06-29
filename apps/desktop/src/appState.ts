import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LifecycleState = "Running" | "Pausing" | "Paused" | "Resuming" | "Error";
export type PauseSource = "Dashboard" | "Tray" | "Settings" | "Router" | "SystemStartup";
export type PauseDuration =
  | "Now"
  | "AfterCurrentGeneration"
  | { ForMinutes: number }
  | "UntilManualResume";

export type PauseRequest = {
  source: PauseSource;
  duration: PauseDuration;
  reason: string;
};

export type PauseSettings = {
  remember_pause_state_after_restart: boolean;
  allow_critical_health_security_notifications_while_paused: boolean;
};

export type SuspendedTasks = {
  routing_changes: number;
  update_checks: number;
  model_installs: number;
  remote_discovery: number;
  health_polling: number;
};

export type PauseHistoryEntry = {
  timestamp_ms: number;
  source: PauseSource;
  previous_state: LifecycleState;
  new_state: LifecycleState;
  reason: string;
  active_tasks_affected: string[];
};

export type AppStateSnapshot = {
  lifecycle_state: LifecycleState;
  settings: PauseSettings;
  paused_until_ms: number | null;
  pause_reason: string | null;
  suspended_tasks: SuspendedTasks;
  pause_history: PauseHistoryEntry[];
};

const fallbackStorageKey = "local-ai-router:stage2-app-state";

export async function getAppState(): Promise<AppStateSnapshot> {
  if (isTauriRuntime()) {
    return invoke<AppStateSnapshot>("get_app_state");
  }

  return readFallbackSnapshot();
}

export async function pauseApp(request: PauseRequest): Promise<AppStateSnapshot> {
  if (isTauriRuntime()) {
    return invoke<AppStateSnapshot>("pause_app", { request });
  }

  const snapshot = readFallbackSnapshot();
  const next: AppStateSnapshot = {
    ...snapshot,
    lifecycle_state: "Paused",
    pause_reason: request.reason,
    paused_until_ms:
      typeof request.duration === "object" && "ForMinutes" in request.duration
        ? Date.now() + request.duration.ForMinutes * 60_000
        : null,
    suspended_tasks: pausedTasks(),
    pause_history: [
      ...snapshot.pause_history,
      {
        timestamp_ms: Date.now(),
        source: request.source,
        previous_state: snapshot.lifecycle_state,
        new_state: "Paused",
        reason: request.reason,
        active_tasks_affected: [
          "automatic model switching suspended",
          "scheduled update checks suspended",
          "automatic provider startup suspended",
          "remote discovery suspended",
          "background health polling suspended"
        ]
      }
    ]
  };
  writeFallbackSnapshot(next);
  emitFallback(next);
  return next;
}

export async function resumeApp(source: PauseSource): Promise<AppStateSnapshot> {
  if (isTauriRuntime()) {
    return invoke<AppStateSnapshot>("resume_app", { source });
  }

  const snapshot = readFallbackSnapshot();
  const next: AppStateSnapshot = {
    ...snapshot,
    lifecycle_state: "Running",
    pause_reason: null,
    paused_until_ms: null,
    suspended_tasks: emptyTasks(),
    pause_history: [
      ...snapshot.pause_history,
      {
        timestamp_ms: Date.now(),
        source,
        previous_state: snapshot.lifecycle_state,
        new_state: "Running",
        reason: "Resume now",
        active_tasks_affected: [
          "background services can restart",
          "health checks can resume",
          "routing checks can resume"
        ]
      }
    ]
  };
  writeFallbackSnapshot(next);
  emitFallback(next);
  return next;
}

export async function updatePauseSettings(
  settings: PauseSettings
): Promise<AppStateSnapshot> {
  if (isTauriRuntime()) {
    return invoke<AppStateSnapshot>("update_pause_settings", { settings });
  }

  const snapshot = readFallbackSnapshot();
  const next = { ...snapshot, settings };
  writeFallbackSnapshot(next);
  emitFallback(next);
  return next;
}

export async function getPauseHistory(): Promise<PauseHistoryEntry[]> {
  if (isTauriRuntime()) {
    return invoke<PauseHistoryEntry[]>("get_pause_history");
  }

  return readFallbackSnapshot().pause_history;
}

export async function subscribeAppState(
  onChange: (snapshot: AppStateSnapshot) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<AppStateSnapshot>("app-state-changed", (event) => onChange(event.payload));
  }

  const handler = (event: Event) => {
    onChange((event as CustomEvent<AppStateSnapshot>).detail);
  };
  window.addEventListener("local-ai-router:app-state-changed", handler);
  return () => window.removeEventListener("local-ai-router:app-state-changed", handler);
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function readFallbackSnapshot(): AppStateSnapshot {
  const raw = window.localStorage.getItem(fallbackStorageKey);
  if (!raw) {
    return defaultSnapshot();
  }

  try {
    const snapshot = JSON.parse(raw) as AppStateSnapshot;
    if (snapshot.lifecycle_state === "Paused" && hasExpired(snapshot.paused_until_ms)) {
      const resumed = {
        ...snapshot,
        lifecycle_state: "Running" as const,
        paused_until_ms: null,
        pause_reason: null,
        suspended_tasks: emptyTasks(),
        pause_history: [
          ...snapshot.pause_history,
          {
            timestamp_ms: Date.now(),
            source: "SystemStartup" as const,
            previous_state: "Paused" as const,
            new_state: "Running" as const,
            reason: "Timed pause elapsed",
            active_tasks_affected: ["timer restored running state"]
          }
        ]
      };
      writeFallbackSnapshot(resumed);
      return resumed;
    }

    return snapshot;
  } catch {
    return defaultSnapshot();
  }
}

function writeFallbackSnapshot(snapshot: AppStateSnapshot) {
  window.localStorage.setItem(fallbackStorageKey, JSON.stringify(snapshot));
}

function emitFallback(snapshot: AppStateSnapshot) {
  window.dispatchEvent(
    new CustomEvent("local-ai-router:app-state-changed", { detail: snapshot })
  );
}

function defaultSnapshot(): AppStateSnapshot {
  return {
    lifecycle_state: "Running",
    settings: {
      remember_pause_state_after_restart: true,
      allow_critical_health_security_notifications_while_paused: true
    },
    paused_until_ms: null,
    pause_reason: null,
    suspended_tasks: emptyTasks(),
    pause_history: []
  };
}

function emptyTasks(): SuspendedTasks {
  return {
    routing_changes: 0,
    update_checks: 0,
    model_installs: 0,
    remote_discovery: 0,
    health_polling: 0
  };
}

function pausedTasks(): SuspendedTasks {
  return {
    routing_changes: 1,
    update_checks: 1,
    model_installs: 0,
    remote_discovery: 1,
    health_polling: 1
  };
}

function hasExpired(pausedUntilMs: number | null): boolean {
  return pausedUntilMs !== null && Date.now() >= pausedUntilMs;
}
