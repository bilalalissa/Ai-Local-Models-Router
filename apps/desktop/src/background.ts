import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type BackgroundSettings = {
  native_notifications_enabled: boolean;
  notify_provider_crash: boolean;
  notify_model_install_complete: boolean;
  notify_router_changes: boolean;
  notify_forced_model_pressure: boolean;
  launch_at_login_enabled: boolean;
  start_providers_at_login: boolean;
  tray_menu_enabled: boolean;
  background_health_polling_enabled: boolean;
};

export type NotificationKind =
  | "ProviderCrash"
  | "ModelInstallComplete"
  | "RouterDegraded"
  | "RouterUpgraded"
  | "ForcedModelMemoryPressure"
  | "AppPaused"
  | "AppResumed"
  | "BackgroundTaskSuspended"
  | "Test";

export type NotificationSeverity = "Info" | "Warning" | "Critical";
export type NotificationDelivery = "QueuedForNativeBridge" | "DisabledBySettings" | "SuppressedWhilePaused";

export type NotificationEvent = {
  id: number;
  timestamp_ms: number;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: NotificationSeverity;
  delivery: NotificationDelivery;
};

export type BackgroundTaskKind =
  | "ProviderHealthPolling"
  | "RouterWatch"
  | "UpdateChecker"
  | "RemoteDiscovery"
  | "ProviderStartup";

export type BackgroundTaskStatus = "Idle" | "Running" | "Suspended" | "Failed";
export type NativeSupportStatus = "Available" | "FrontendBridgeRequired" | "NeedsManualSetup";

export type BackgroundTask = {
  kind: BackgroundTaskKind;
  label: string;
  status: BackgroundTaskStatus;
  last_run_ms: number | null;
  next_run_ms: number | null;
  suspended_by_pause: boolean;
  message: string;
};

export type BackgroundSnapshot = {
  settings: BackgroundSettings;
  tasks: BackgroundTask[];
  notifications: NotificationEvent[];
  native_notification_status: NativeSupportStatus;
  autostart_status: NativeSupportStatus;
  tray_available: boolean;
};

const storageKey = "local-ai-router:stage9-background-state";

export const defaultBackgroundSettings: BackgroundSettings = {
  native_notifications_enabled: true,
  notify_provider_crash: true,
  notify_model_install_complete: true,
  notify_router_changes: true,
  notify_forced_model_pressure: true,
  launch_at_login_enabled: false,
  start_providers_at_login: false,
  tray_menu_enabled: true,
  background_health_polling_enabled: true
};

export async function getBackgroundSnapshot(): Promise<BackgroundSnapshot> {
  if (isTauriRuntime()) return invoke<BackgroundSnapshot>("get_background_snapshot");
  return readFallbackSnapshot();
}

export async function updateBackgroundSettings(settings: BackgroundSettings): Promise<BackgroundSnapshot> {
  if (isTauriRuntime()) return invoke<BackgroundSnapshot>("update_background_settings", { settings });
  const snapshot = { ...readFallbackSnapshot(), settings };
  writeFallbackSnapshot(snapshot);
  emitBackgroundSnapshot(snapshot);
  return snapshot;
}

export async function runBackgroundTick(): Promise<BackgroundSnapshot> {
  if (isTauriRuntime()) return invoke<BackgroundSnapshot>("run_background_tick");
  const snapshot = readFallbackSnapshot();
  const now = Date.now();
  const next = {
    ...snapshot,
    tasks: snapshot.tasks.map((task) =>
      task.kind === "UpdateChecker" || task.kind === "RemoteDiscovery"
        ? { ...task, status: "Idle" as const, message: "Scheduled for its later implementation stage." }
        : {
            ...task,
            status: "Running" as const,
            last_run_ms: now,
            next_run_ms: now + 30_000,
            suspended_by_pause: false,
            message: task.kind === "ProviderStartup" && !snapshot.settings.start_providers_at_login
              ? "Provider autostart is disabled."
              : "Background check completed."
          }
    )
  };
  writeFallbackSnapshot(next);
  emitBackgroundSnapshot(next);
  return next;
}

export async function sendTestNotification(): Promise<NotificationEvent> {
  if (isTauriRuntime()) return invoke<NotificationEvent>("send_test_notification");
  const event = createNotificationEvent(
    "Test",
    "Local AI Router notification test",
    "Native notification bridge is connected.",
    "Info",
    "QueuedForNativeBridge"
  );
  const snapshot = readFallbackSnapshot();
  const next = { ...snapshot, notifications: [event, ...snapshot.notifications].slice(0, 200) };
  writeFallbackSnapshot(next);
  emitNotificationEvent(event);
  emitBackgroundSnapshot(next);
  return event;
}

export async function subscribeBackgroundSnapshot(
  onChange: (snapshot: BackgroundSnapshot) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<BackgroundSnapshot>("background-snapshot-changed", (event) => onChange(event.payload));
  }
  const handler = (event: Event) => onChange((event as CustomEvent<BackgroundSnapshot>).detail);
  window.addEventListener("local-ai-router:background-snapshot-changed", handler);
  return () => window.removeEventListener("local-ai-router:background-snapshot-changed", handler);
}

export async function subscribeNotificationEvents(
  onEvent: (event: NotificationEvent) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<NotificationEvent>("notification-event", (event) => onEvent(event.payload));
  }
  const handler = (event: Event) => onEvent((event as CustomEvent<NotificationEvent>).detail);
  window.addEventListener("local-ai-router:notification-event", handler);
  return () => window.removeEventListener("local-ai-router:notification-event", handler);
}

export async function presentNativeNotification(event: NotificationEvent): Promise<string> {
  if (event.delivery !== "QueuedForNativeBridge") return event.delivery;
  if (!("Notification" in window)) return "Notification API unavailable";
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") return `Permission ${Notification.permission}`;
  new Notification(event.title, { body: event.body });
  return "Shown";
}

function readFallbackSnapshot(): BackgroundSnapshot {
  const raw = window.localStorage.getItem(storageKey);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return {
    settings: defaultBackgroundSettings,
    tasks: seededTasks(),
    notifications: [],
    native_notification_status: "FrontendBridgeRequired",
    autostart_status: "NeedsManualSetup",
    tray_available: false
  };
}

function writeFallbackSnapshot(snapshot: BackgroundSnapshot) {
  window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

function seededTasks(): BackgroundTask[] {
  return [
    task("ProviderHealthPolling", "Provider health polling", "Checks local provider status and emits crash notifications."),
    task("RouterWatch", "Router decision watcher", "Watches route quality and emits degraded/upgraded notifications."),
    task("UpdateChecker", "Model update checker", "Placeholder until Stage 10 metadata checks."),
    task("RemoteDiscovery", "Remote discovery", "Placeholder until remote broker/client stages."),
    task("ProviderStartup", "Provider startup", "Starts configured providers at login when enabled.")
  ];
}

function task(kind: BackgroundTaskKind, label: string, message: string): BackgroundTask {
  return {
    kind,
    label,
    status: "Idle",
    last_run_ms: null,
    next_run_ms: null,
    suspended_by_pause: false,
    message
  };
}

function createNotificationEvent(
  kind: NotificationKind,
  title: string,
  body: string,
  severity: NotificationSeverity,
  delivery: NotificationDelivery
): NotificationEvent {
  return { id: Date.now(), timestamp_ms: Date.now(), kind, title, body, severity, delivery };
}

function emitBackgroundSnapshot(snapshot: BackgroundSnapshot) {
  window.dispatchEvent(new CustomEvent("local-ai-router:background-snapshot-changed", { detail: snapshot }));
}

function emitNotificationEvent(event: NotificationEvent) {
  window.dispatchEvent(new CustomEvent("local-ai-router:notification-event", { detail: event }));
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
