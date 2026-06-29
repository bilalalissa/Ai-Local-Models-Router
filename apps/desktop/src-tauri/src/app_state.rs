use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum LifecycleState {
    Running,
    Pausing,
    Paused,
    Resuming,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PauseSource {
    Dashboard,
    Tray,
    Settings,
    Router,
    SystemStartup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PauseDuration {
    Now,
    AfterCurrentGeneration,
    ForMinutes(u32),
    UntilManualResume,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PauseRequest {
    pub source: PauseSource,
    pub duration: PauseDuration,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PauseSettings {
    pub remember_pause_state_after_restart: bool,
    pub allow_critical_health_security_notifications_while_paused: bool,
}

impl Default for PauseSettings {
    fn default() -> Self {
        Self {
            remember_pause_state_after_restart: true,
            allow_critical_health_security_notifications_while_paused: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SuspendedTasks {
    pub routing_changes: u32,
    pub update_checks: u32,
    pub model_installs: u32,
    pub remote_discovery: u32,
    pub health_polling: u32,
}

impl SuspendedTasks {
    pub fn paused_defaults() -> Self {
        Self {
            routing_changes: 1,
            update_checks: 1,
            model_installs: 0,
            remote_discovery: 1,
            health_polling: 1,
        }
    }

    #[cfg(test)]
    pub fn total(&self) -> u32 {
        self.routing_changes
            + self.update_checks
            + self.model_installs
            + self.remote_discovery
            + self.health_polling
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PauseHistoryEntry {
    pub timestamp_ms: u128,
    pub source: PauseSource,
    pub previous_state: LifecycleState,
    pub new_state: LifecycleState,
    pub reason: String,
    pub active_tasks_affected: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AppStateSnapshot {
    pub lifecycle_state: LifecycleState,
    pub settings: PauseSettings,
    pub paused_until_ms: Option<u128>,
    pub pause_reason: Option<String>,
    pub suspended_tasks: SuspendedTasks,
    pub pause_history: Vec<PauseHistoryEntry>,
}

impl Default for AppStateSnapshot {
    fn default() -> Self {
        Self {
            lifecycle_state: LifecycleState::Running,
            settings: PauseSettings::default(),
            paused_until_ms: None,
            pause_reason: None,
            suspended_tasks: SuspendedTasks::default(),
            pause_history: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct AppStateStore {
    path: PathBuf,
    snapshot: AppStateSnapshot,
}

impl AppStateStore {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let snapshot = if path.exists() {
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("failed to read app state: {err}"))?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            AppStateSnapshot::default()
        };

        let mut store = Self { path, snapshot };
        store.apply_restart_policy()?;
        Ok(store)
    }

    pub fn snapshot(&mut self) -> Result<AppStateSnapshot, String> {
        self.resume_if_timer_elapsed(PauseSource::SystemStartup)?;
        Ok(self.snapshot.clone())
    }

    pub fn pause(&mut self, request: PauseRequest) -> Result<AppStateSnapshot, String> {
        self.resume_if_timer_elapsed(PauseSource::SystemStartup)?;
        let previous_state = self.snapshot.lifecycle_state.clone();
        self.snapshot.lifecycle_state = LifecycleState::Pausing;
        self.snapshot.lifecycle_state = LifecycleState::Paused;
        self.snapshot.paused_until_ms = paused_until_ms(&request.duration);
        self.snapshot.pause_reason = Some(request.reason.clone());
        self.snapshot.suspended_tasks = SuspendedTasks::paused_defaults();
        let reason = normalized_pause_reason(&request);
        self.snapshot.pause_history.push(PauseHistoryEntry {
            timestamp_ms: now_ms(),
            source: request.source,
            previous_state,
            new_state: LifecycleState::Paused,
            reason,
            active_tasks_affected: active_tasks_for_pause(),
        });
        self.persist()?;
        Ok(self.snapshot.clone())
    }

    pub fn resume(&mut self, source: PauseSource) -> Result<AppStateSnapshot, String> {
        let previous_state = self.snapshot.lifecycle_state.clone();
        self.snapshot.lifecycle_state = LifecycleState::Resuming;
        self.snapshot.lifecycle_state = LifecycleState::Running;
        self.snapshot.paused_until_ms = None;
        self.snapshot.pause_reason = None;
        self.snapshot.suspended_tasks = SuspendedTasks::default();
        self.snapshot.pause_history.push(PauseHistoryEntry {
            timestamp_ms: now_ms(),
            source,
            previous_state,
            new_state: LifecycleState::Running,
            reason: "Resume now".to_string(),
            active_tasks_affected: vec![
                "background services can restart".to_string(),
                "health checks can resume".to_string(),
                "routing checks can resume".to_string(),
            ],
        });
        self.persist()?;
        Ok(self.snapshot.clone())
    }

    pub fn update_settings(&mut self, settings: PauseSettings) -> Result<AppStateSnapshot, String> {
        self.snapshot.settings = settings;
        self.persist()?;
        Ok(self.snapshot.clone())
    }

    pub fn history(&self) -> Vec<PauseHistoryEntry> {
        self.snapshot.pause_history.clone()
    }

    fn apply_restart_policy(&mut self) -> Result<(), String> {
        if self.snapshot.lifecycle_state == LifecycleState::Paused
            && !self.snapshot.settings.remember_pause_state_after_restart
        {
            self.snapshot.lifecycle_state = LifecycleState::Running;
            self.snapshot.paused_until_ms = None;
            self.snapshot.pause_reason = None;
            self.snapshot.suspended_tasks = SuspendedTasks::default();
            self.snapshot.pause_history.push(PauseHistoryEntry {
                timestamp_ms: now_ms(),
                source: PauseSource::SystemStartup,
                previous_state: LifecycleState::Paused,
                new_state: LifecycleState::Running,
                reason: "Pause state not remembered after restart".to_string(),
                active_tasks_affected: vec!["startup restored running state".to_string()],
            });
            self.persist()?;
        } else {
            self.resume_if_timer_elapsed(PauseSource::SystemStartup)?;
        }

        Ok(())
    }

    fn resume_if_timer_elapsed(&mut self, source: PauseSource) -> Result<(), String> {
        let Some(paused_until_ms) = self.snapshot.paused_until_ms else {
            return Ok(());
        };

        if self.snapshot.lifecycle_state == LifecycleState::Paused && now_ms() >= paused_until_ms {
            self.resume(source)?;
        }

        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create app state directory: {err}"))?;
        }

        let raw = serde_json::to_string_pretty(&self.snapshot)
            .map_err(|err| format!("failed to serialize app state: {err}"))?;
        fs::write(&self.path, raw).map_err(|err| format!("failed to persist app state: {err}"))
    }
}

pub fn state_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("app_state.json")
}

fn normalized_pause_reason(request: &PauseRequest) -> String {
    match request.duration {
        PauseDuration::AfterCurrentGeneration => {
            format!(
                "{}; no active generation is tracked in Stage 2, so pause completed immediately",
                request.reason
            )
        }
        _ => request.reason.clone(),
    }
}

fn paused_until_ms(duration: &PauseDuration) -> Option<u128> {
    match duration {
        PauseDuration::ForMinutes(minutes) => Some(now_ms() + u128::from(*minutes) * 60_000),
        _ => None,
    }
}

fn active_tasks_for_pause() -> Vec<String> {
    vec![
        "automatic model switching suspended".to_string(),
        "scheduled update checks suspended".to_string(),
        "automatic provider startup suspended".to_string(),
        "remote discovery suspended".to_string(),
        "background health polling suspended".to_string(),
    ]
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

    fn store_path(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("local-ai-router-{name}-{}.json", now_ms()));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn pause_transitions_to_paused_and_logs_history() {
        let mut store = AppStateStore::load(store_path("pause")).expect("store loads");
        let snapshot = store
            .pause(PauseRequest {
                source: PauseSource::Dashboard,
                duration: PauseDuration::UntilManualResume,
                reason: "User paused from dashboard".to_string(),
            })
            .expect("pause succeeds");

        assert_eq!(snapshot.lifecycle_state, LifecycleState::Paused);
        assert_eq!(snapshot.suspended_tasks.total(), 4);
        assert_eq!(snapshot.pause_history.len(), 1);
        assert_eq!(
            snapshot.pause_history[0].previous_state,
            LifecycleState::Running
        );
        assert_eq!(snapshot.pause_history[0].new_state, LifecycleState::Paused);
    }

    #[test]
    fn resume_transitions_to_running_and_clears_suspended_tasks() {
        let mut store = AppStateStore::load(store_path("resume")).expect("store loads");
        store
            .pause(PauseRequest {
                source: PauseSource::Settings,
                duration: PauseDuration::UntilManualResume,
                reason: "Pause for settings test".to_string(),
            })
            .expect("pause succeeds");

        let snapshot = store
            .resume(PauseSource::Settings)
            .expect("resume succeeds");

        assert_eq!(snapshot.lifecycle_state, LifecycleState::Running);
        assert_eq!(snapshot.suspended_tasks.total(), 0);
        assert_eq!(snapshot.pause_history.len(), 2);
        assert_eq!(
            snapshot.pause_history[1].previous_state,
            LifecycleState::Paused
        );
    }

    #[test]
    fn pause_state_persists_across_reload_when_remembered() {
        let path = store_path("persist");
        let mut store = AppStateStore::load(path.clone()).expect("store loads");
        store
            .pause(PauseRequest {
                source: PauseSource::Router,
                duration: PauseDuration::UntilManualResume,
                reason: "Persist pause".to_string(),
            })
            .expect("pause succeeds");

        let mut reloaded = AppStateStore::load(path).expect("store reloads");
        let snapshot = reloaded.snapshot().expect("snapshot loads");

        assert_eq!(snapshot.lifecycle_state, LifecycleState::Paused);
        assert_eq!(snapshot.pause_reason, Some("Persist pause".to_string()));
    }

    #[test]
    fn disabled_restart_memory_restores_running_state() {
        let path = store_path("restart-policy");
        let mut store = AppStateStore::load(path.clone()).expect("store loads");
        store
            .update_settings(PauseSettings {
                remember_pause_state_after_restart: false,
                allow_critical_health_security_notifications_while_paused: true,
            })
            .expect("settings update succeeds");
        store
            .pause(PauseRequest {
                source: PauseSource::Dashboard,
                duration: PauseDuration::UntilManualResume,
                reason: "Do not remember".to_string(),
            })
            .expect("pause succeeds");

        let mut reloaded = AppStateStore::load(path).expect("store reloads");
        let snapshot = reloaded.snapshot().expect("snapshot loads");

        assert_eq!(snapshot.lifecycle_state, LifecycleState::Running);
        assert_eq!(snapshot.suspended_tasks.total(), 0);
    }

    #[test]
    fn timed_pause_auto_resumes_when_expired() {
        let path = store_path("timer");
        let expired_snapshot = AppStateSnapshot {
            lifecycle_state: LifecycleState::Paused,
            paused_until_ms: Some(1),
            pause_reason: Some("Expired timer".to_string()),
            suspended_tasks: SuspendedTasks::paused_defaults(),
            ..AppStateSnapshot::default()
        };
        fs::write(&path, serde_json::to_string(&expired_snapshot).unwrap()).unwrap();

        let mut store = AppStateStore::load(path).expect("store reloads");
        let snapshot = store.snapshot().expect("snapshot loads");

        assert_eq!(snapshot.lifecycle_state, LifecycleState::Running);
        assert_eq!(snapshot.pause_history.len(), 1);
        assert_eq!(snapshot.pause_history[0].source, PauseSource::SystemStartup);
    }
}
