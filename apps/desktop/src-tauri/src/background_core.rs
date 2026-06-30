use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackgroundSettings {
    pub native_notifications_enabled: bool,
    pub notify_provider_crash: bool,
    pub notify_model_install_complete: bool,
    pub notify_router_changes: bool,
    pub notify_forced_model_pressure: bool,
    pub launch_at_login_enabled: bool,
    pub start_providers_at_login: bool,
    pub tray_menu_enabled: bool,
    pub background_health_polling_enabled: bool,
}

impl Default for BackgroundSettings {
    fn default() -> Self {
        Self {
            native_notifications_enabled: true,
            notify_provider_crash: true,
            notify_model_install_complete: true,
            notify_router_changes: true,
            notify_forced_model_pressure: true,
            launch_at_login_enabled: false,
            start_providers_at_login: false,
            tray_menu_enabled: true,
            background_health_polling_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum NotificationKind {
    ProviderCrash,
    ModelInstallComplete,
    RouterDegraded,
    RouterUpgraded,
    ForcedModelMemoryPressure,
    AppPaused,
    AppResumed,
    BackgroundTaskSuspended,
    Test,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum NotificationSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum NotificationDelivery {
    QueuedForNativeBridge,
    DisabledBySettings,
    SuppressedWhilePaused,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NotificationEvent {
    pub id: u128,
    pub timestamp_ms: u128,
    pub kind: NotificationKind,
    pub title: String,
    pub body: String,
    pub severity: NotificationSeverity,
    pub delivery: NotificationDelivery,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum BackgroundTaskKind {
    ProviderHealthPolling,
    RouterWatch,
    UpdateChecker,
    RemoteDiscovery,
    ProviderStartup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum BackgroundTaskStatus {
    Idle,
    Running,
    Suspended,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackgroundTask {
    pub kind: BackgroundTaskKind,
    pub label: String,
    pub status: BackgroundTaskStatus,
    pub last_run_ms: Option<u128>,
    pub next_run_ms: Option<u128>,
    pub suspended_by_pause: bool,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum NativeSupportStatus {
    Available,
    FrontendBridgeRequired,
    NeedsManualSetup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BackgroundSnapshot {
    pub settings: BackgroundSettings,
    pub tasks: Vec<BackgroundTask>,
    pub notifications: Vec<NotificationEvent>,
    pub native_notification_status: NativeSupportStatus,
    pub autostart_status: NativeSupportStatus,
    pub tray_available: bool,
}

#[derive(Debug)]
pub struct BackgroundManager {
    path: PathBuf,
    settings: BackgroundSettings,
    tasks: Vec<BackgroundTask>,
    notifications: Vec<NotificationEvent>,
    autostart_status: NativeSupportStatus,
    tray_available: bool,
}

impl BackgroundManager {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let persisted = if path.exists() {
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("failed to read background state: {err}"))?;
            serde_json::from_str::<PersistedBackgroundState>(&raw).unwrap_or_default()
        } else {
            PersistedBackgroundState::default()
        };

        Ok(Self {
            path,
            settings: persisted.settings,
            tasks: seeded_tasks(),
            notifications: persisted.notifications,
            autostart_status: NativeSupportStatus::NeedsManualSetup,
            tray_available: false,
        })
    }

    pub fn snapshot(&mut self, app_paused: bool) -> BackgroundSnapshot {
        self.apply_pause_gate(app_paused);
        self.to_snapshot()
    }

    pub fn update_settings(
        &mut self,
        settings: BackgroundSettings,
        executable_path: Option<PathBuf>,
    ) -> Result<BackgroundSnapshot, String> {
        self.autostart_status =
            apply_launch_at_login(settings.launch_at_login_enabled, executable_path.as_deref());
        self.settings = settings;
        self.persist()?;
        Ok(self.to_snapshot())
    }

    pub fn mark_tray_available(&mut self, available: bool) -> Result<BackgroundSnapshot, String> {
        self.tray_available = available;
        self.persist()?;
        Ok(self.to_snapshot())
    }

    pub fn run_tick(&mut self, app_paused: bool) -> Result<BackgroundSnapshot, String> {
        self.apply_pause_gate(app_paused);
        if !app_paused {
            let now = now_ms();
            for task in &mut self.tasks {
                if task.kind == BackgroundTaskKind::UpdateChecker
                    || task.kind == BackgroundTaskKind::RemoteDiscovery
                {
                    task.status = BackgroundTaskStatus::Idle;
                    task.message = "Scheduled for its later implementation stage.".to_string();
                    continue;
                }
                task.status = BackgroundTaskStatus::Running;
                task.last_run_ms = Some(now);
                task.next_run_ms = Some(now + task_interval_ms(&task.kind));
                task.suspended_by_pause = false;
                task.message = running_message(&task.kind, &self.settings);
            }
        }
        self.persist()?;
        Ok(self.to_snapshot())
    }

    pub fn record_notification(
        &mut self,
        kind: NotificationKind,
        title: impl Into<String>,
        body: impl Into<String>,
        severity: NotificationSeverity,
        app_paused: bool,
        allow_critical_while_paused: bool,
    ) -> Result<NotificationEvent, String> {
        let delivery = notification_delivery(
            &self.settings,
            &kind,
            &severity,
            app_paused,
            allow_critical_while_paused,
        );
        let event = NotificationEvent {
            id: now_ms(),
            timestamp_ms: now_ms(),
            kind,
            title: title.into(),
            body: body.into(),
            severity,
            delivery,
        };
        self.notifications.insert(0, event.clone());
        self.notifications.truncate(200);
        self.persist()?;
        Ok(event)
    }

    fn to_snapshot(&self) -> BackgroundSnapshot {
        BackgroundSnapshot {
            settings: self.settings.clone(),
            tasks: self.tasks.clone(),
            notifications: self.notifications.clone(),
            native_notification_status: if self.settings.native_notifications_enabled {
                NativeSupportStatus::FrontendBridgeRequired
            } else {
                NativeSupportStatus::NeedsManualSetup
            },
            autostart_status: self.autostart_status.clone(),
            tray_available: self.tray_available,
        }
    }

    fn apply_pause_gate(&mut self, app_paused: bool) {
        if !app_paused {
            return;
        }
        for task in &mut self.tasks {
            task.status = BackgroundTaskStatus::Suspended;
            task.next_run_ms = None;
            task.suspended_by_pause = true;
            task.message = "Suspended by global pause state.".to_string();
        }
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create background state directory: {err}"))?;
        }
        let raw = serde_json::to_string_pretty(&PersistedBackgroundState {
            settings: self.settings.clone(),
            notifications: self.notifications.clone(),
        })
        .map_err(|err| format!("failed to serialize background state: {err}"))?;
        fs::write(&self.path, raw)
            .map_err(|err| format!("failed to persist background state: {err}"))
    }
}

pub fn background_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("background_state.json")
}

fn seeded_tasks() -> Vec<BackgroundTask> {
    vec![
        task(
            BackgroundTaskKind::ProviderHealthPolling,
            "Provider health polling",
            "Checks local provider status and emits crash notifications.",
        ),
        task(
            BackgroundTaskKind::RouterWatch,
            "Router decision watcher",
            "Watches route quality and emits degraded/upgraded notifications.",
        ),
        task(
            BackgroundTaskKind::UpdateChecker,
            "Model update checker",
            "Placeholder until Stage 10 metadata checks.",
        ),
        task(
            BackgroundTaskKind::RemoteDiscovery,
            "Remote discovery",
            "Placeholder until remote broker/client stages.",
        ),
        task(
            BackgroundTaskKind::ProviderStartup,
            "Provider startup",
            "Starts configured providers at login when enabled.",
        ),
    ]
}

fn task(kind: BackgroundTaskKind, label: &str, message: &str) -> BackgroundTask {
    BackgroundTask {
        kind,
        label: label.to_string(),
        status: BackgroundTaskStatus::Idle,
        last_run_ms: None,
        next_run_ms: None,
        suspended_by_pause: false,
        message: message.to_string(),
    }
}

fn running_message(kind: &BackgroundTaskKind, settings: &BackgroundSettings) -> String {
    match kind {
        BackgroundTaskKind::ProviderHealthPolling => {
            if settings.background_health_polling_enabled {
                "Health polling completed.".to_string()
            } else {
                "Health polling disabled by settings.".to_string()
            }
        }
        BackgroundTaskKind::RouterWatch => {
            "Router watcher checked the current decision.".to_string()
        }
        BackgroundTaskKind::ProviderStartup => {
            if settings.start_providers_at_login {
                "Provider autostart is enabled for next login.".to_string()
            } else {
                "Provider autostart is disabled.".to_string()
            }
        }
        BackgroundTaskKind::UpdateChecker => "Scheduled for Stage 10.".to_string(),
        BackgroundTaskKind::RemoteDiscovery => "Scheduled for Stages 11-12.".to_string(),
    }
}

fn task_interval_ms(kind: &BackgroundTaskKind) -> u128 {
    match kind {
        BackgroundTaskKind::ProviderHealthPolling => 30_000,
        BackgroundTaskKind::RouterWatch => 15_000,
        BackgroundTaskKind::ProviderStartup => 300_000,
        BackgroundTaskKind::UpdateChecker => 3_600_000,
        BackgroundTaskKind::RemoteDiscovery => 60_000,
    }
}

fn notification_delivery(
    settings: &BackgroundSettings,
    kind: &NotificationKind,
    severity: &NotificationSeverity,
    app_paused: bool,
    allow_critical_while_paused: bool,
) -> NotificationDelivery {
    if !settings.native_notifications_enabled || !notification_kind_enabled(settings, kind) {
        return NotificationDelivery::DisabledBySettings;
    }
    if app_paused
        && !(allow_critical_while_paused && matches!(severity, NotificationSeverity::Critical))
    {
        return NotificationDelivery::SuppressedWhilePaused;
    }
    NotificationDelivery::QueuedForNativeBridge
}

fn notification_kind_enabled(settings: &BackgroundSettings, kind: &NotificationKind) -> bool {
    match kind {
        NotificationKind::ProviderCrash => settings.notify_provider_crash,
        NotificationKind::ModelInstallComplete => settings.notify_model_install_complete,
        NotificationKind::RouterDegraded | NotificationKind::RouterUpgraded => {
            settings.notify_router_changes
        }
        NotificationKind::ForcedModelMemoryPressure => settings.notify_forced_model_pressure,
        NotificationKind::AppPaused
        | NotificationKind::AppResumed
        | NotificationKind::BackgroundTaskSuspended
        | NotificationKind::Test => true,
    }
}

fn apply_launch_at_login(enabled: bool, executable_path: Option<&Path>) -> NativeSupportStatus {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = std::env::var_os("HOME") else {
            return NativeSupportStatus::NeedsManualSetup;
        };
        let launch_agents = PathBuf::from(home).join("Library/LaunchAgents");
        let plist_path = launch_agents.join("com.bilalalissa.local-ai-router.plist");
        if !enabled {
            if !plist_path.exists() || fs::remove_file(plist_path).is_ok() {
                return NativeSupportStatus::Available;
            }
            return NativeSupportStatus::NeedsManualSetup;
        }
        let Some(executable_path) = executable_path else {
            return NativeSupportStatus::NeedsManualSetup;
        };
        if fs::create_dir_all(&launch_agents).is_err() {
            return NativeSupportStatus::NeedsManualSetup;
        }
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.bilalalissa.local-ai-router</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
            executable_path.display()
        );
        if fs::write(plist_path, plist).is_ok() {
            NativeSupportStatus::Available
        } else {
            NativeSupportStatus::NeedsManualSetup
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = if enabled {
            let Some(executable_path) = executable_path else {
                return NativeSupportStatus::NeedsManualSetup;
            };
            std::process::Command::new("reg")
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "Local AI Router",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &executable_path.display().to_string(),
                    "/f",
                ])
                .status()
        } else {
            std::process::Command::new("reg")
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "Local AI Router",
                    "/f",
                ])
                .status()
        };
        if matches!(status, Ok(status) if status.success()) {
            NativeSupportStatus::Available
        } else {
            NativeSupportStatus::NeedsManualSetup
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = enabled;
        let _ = executable_path;
        NativeSupportStatus::NeedsManualSetup
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedBackgroundState {
    settings: BackgroundSettings,
    notifications: Vec<NotificationEvent>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_path(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "local-ai-router-background-{name}-{}.json",
            now_ms()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn pause_gate_suspends_all_background_tasks() {
        let mut manager = BackgroundManager::load(state_path("pause")).expect("manager loads");
        let snapshot = manager.snapshot(true);

        assert!(snapshot.tasks.iter().all(|task| task.suspended_by_pause));
        assert!(snapshot
            .tasks
            .iter()
            .all(|task| task.status == BackgroundTaskStatus::Suspended));
    }

    #[test]
    fn critical_notifications_can_bypass_pause_when_allowed() {
        let mut manager = BackgroundManager::load(state_path("critical")).expect("manager loads");
        let event = manager
            .record_notification(
                NotificationKind::ProviderCrash,
                "Provider crashed",
                "Ollama stopped responding.",
                NotificationSeverity::Critical,
                true,
                true,
            )
            .expect("event records");

        assert_eq!(event.delivery, NotificationDelivery::QueuedForNativeBridge);
    }

    #[test]
    fn non_critical_notifications_are_suppressed_while_paused() {
        let mut manager = BackgroundManager::load(state_path("suppressed")).expect("manager loads");
        let event = manager
            .record_notification(
                NotificationKind::RouterUpgraded,
                "Router upgraded",
                "A better route is available.",
                NotificationSeverity::Info,
                true,
                true,
            )
            .expect("event records");

        assert_eq!(event.delivery, NotificationDelivery::SuppressedWhilePaused);
    }

    #[test]
    fn settings_persist_across_reload() {
        let path = state_path("settings");
        let mut manager = BackgroundManager::load(path.clone()).expect("manager loads");
        let settings = BackgroundSettings {
            launch_at_login_enabled: true,
            start_providers_at_login: true,
            ..BackgroundSettings::default()
        };
        manager
            .update_settings(settings.clone(), None)
            .expect("settings update");
        let mut reloaded = BackgroundManager::load(path).expect("manager reloads");
        assert_eq!(reloaded.snapshot(false).settings, settings);
    }
}
