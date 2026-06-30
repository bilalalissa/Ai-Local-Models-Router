use crate::{
    hardware_probe::HardwareSpecs,
    model_catalog::{
        load_model_catalog, score_model_catalog, CompatibilityLabel, ModelEntry,
        ScoreModelCatalogRequest, UseCase,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const OLLAMA_FIXTURE: &str = include_str!("../../../../fixtures/update_metadata/ollama_tags.json");
const MLX_HF_FIXTURE: &str =
    include_str!("../../../../fixtures/update_metadata/mlx_huggingface.json");
const CUSTOM_CATALOG_FIXTURE: &str =
    include_str!("../../../../fixtures/update_metadata/custom_catalog.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum MetadataSourceKind {
    Ollama,
    MlxHuggingFace,
    CustomJson,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum UpdateCheckStatus {
    Idle,
    Ready,
    PrivacyBlocked,
    SuspendedByPause,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum UpdateActionKind {
    Ignore,
    RemindLater,
    Install,
    InstallAndSwitch,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum UpdateActionStatus {
    Available,
    Ignored,
    RemindLater,
    InstallQueued,
    InstallAndSwitchQueued,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UpdaterSettings {
    pub privacy_mode_enabled: bool,
    pub scheduled_checks_enabled: bool,
    pub include_ollama: bool,
    pub include_mlx_huggingface: bool,
    pub include_custom_json: bool,
    pub remind_later_hours: u32,
}

impl Default for UpdaterSettings {
    fn default() -> Self {
        Self {
            privacy_mode_enabled: false,
            scheduled_checks_enabled: true,
            include_ollama: true,
            include_mlx_huggingface: true,
            include_custom_json: true,
            remind_later_hours: 24,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct UpdateCandidate {
    pub id: String,
    pub model_id: String,
    pub model_name: String,
    pub source_kind: MetadataSourceKind,
    pub source_name: String,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub compatibility_label: CompatibilityLabel,
    pub compatibility_score: u8,
    pub compatibility_notes: Vec<String>,
    pub blocked_reasons: Vec<String>,
    pub action_status: UpdateActionStatus,
    pub ignored: bool,
    pub remind_after_ms: Option<u128>,
    pub checked_at_ms: u128,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UpdateHistoryEntry {
    pub timestamp_ms: u128,
    pub candidate_id: String,
    pub action: UpdateActionKind,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct UpdaterSnapshot {
    pub settings: UpdaterSettings,
    pub status: UpdateCheckStatus,
    pub candidates: Vec<UpdateCandidate>,
    pub history: Vec<UpdateHistoryEntry>,
    pub last_checked_ms: Option<u128>,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CheckUpdatesRequest {
    pub hardware: HardwareSpecs,
    pub app_paused: bool,
    pub manual: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UpdateActionRequest {
    pub candidate_id: String,
    pub action: UpdateActionKind,
}

#[derive(Debug)]
pub struct UpdaterManager {
    path: PathBuf,
    settings: UpdaterSettings,
    candidates: Vec<UpdateCandidate>,
    history: Vec<UpdateHistoryEntry>,
    ignored: HashSet<String>,
    reminders: HashMap<String, u128>,
    last_checked_ms: Option<u128>,
    status: UpdateCheckStatus,
    message: String,
}

impl UpdaterManager {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let persisted = if path.exists() {
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("failed to read updater state: {err}"))?;
            serde_json::from_str::<PersistedUpdaterState>(&raw).unwrap_or_default()
        } else {
            PersistedUpdaterState::default()
        };
        Ok(Self {
            path,
            settings: persisted.settings,
            candidates: Vec::new(),
            history: persisted.history,
            ignored: persisted.ignored.into_iter().collect(),
            reminders: persisted.reminders.into_iter().collect(),
            last_checked_ms: persisted.last_checked_ms,
            status: UpdateCheckStatus::Idle,
            message: "Updater is idle.".to_string(),
        })
    }

    pub fn snapshot(&self) -> UpdaterSnapshot {
        UpdaterSnapshot {
            settings: self.settings.clone(),
            status: self.status.clone(),
            candidates: self.candidates.clone(),
            history: self.history.clone(),
            last_checked_ms: self.last_checked_ms,
            message: self.message.clone(),
        }
    }

    pub fn update_settings(
        &mut self,
        settings: UpdaterSettings,
    ) -> Result<UpdaterSnapshot, String> {
        self.settings = settings;
        if self.settings.privacy_mode_enabled {
            self.candidates.clear();
            self.status = UpdateCheckStatus::PrivacyBlocked;
            self.message = "Privacy mode disables metadata checks.".to_string();
        }
        self.persist()?;
        Ok(self.snapshot())
    }

    pub fn check_updates(
        &mut self,
        request: CheckUpdatesRequest,
    ) -> Result<UpdaterSnapshot, String> {
        if self.settings.privacy_mode_enabled {
            self.candidates.clear();
            self.status = UpdateCheckStatus::PrivacyBlocked;
            self.message = "Privacy mode disables metadata checks.".to_string();
            self.persist()?;
            return Ok(self.snapshot());
        }
        if request.app_paused && !request.manual {
            self.status = UpdateCheckStatus::SuspendedByPause;
            self.message =
                "Scheduled update checks are suspended while the app is paused.".to_string();
            self.persist()?;
            return Ok(self.snapshot());
        }
        if !self.settings.scheduled_checks_enabled && !request.manual {
            self.status = UpdateCheckStatus::Idle;
            self.message = "Scheduled update checks are disabled by settings.".to_string();
            self.persist()?;
            return Ok(self.snapshot());
        }

        let catalog = load_model_catalog()?;
        let mut normalized = Vec::new();
        for source in enabled_sources(&self.settings) {
            normalized.extend(source.fetch()?);
        }

        let scored = score_model_catalog(ScoreModelCatalogRequest {
            hardware: request.hardware,
            use_case: UseCase::GeneralChat,
            preferred_provider: None,
            preference_tags: Vec::new(),
            installed_only: false,
            app_paused: request.app_paused,
        })?;
        let score_by_model = scored
            .into_iter()
            .map(|result| (result.model.id.clone(), result))
            .collect::<HashMap<_, _>>();
        let model_by_id = catalog
            .into_iter()
            .map(|model| (model.id.clone(), model))
            .collect::<HashMap<_, _>>();
        let now = now_ms();
        let mut candidates = normalized
            .into_iter()
            .filter(|entry| entry.current_version != entry.latest_version)
            .filter_map(|entry| {
                let model = model_by_id.get(&entry.model_id)?;
                let score = score_by_model.get(&entry.model_id)?;
                Some(self.candidate_from_entry(entry, model, score, now))
            })
            .collect::<Vec<_>>();

        candidates.sort_by(|a, b| {
            b.compatibility_score
                .cmp(&a.compatibility_score)
                .then_with(|| a.model_name.cmp(&b.model_name))
        });
        self.candidates = candidates;
        self.last_checked_ms = Some(now);
        self.status = UpdateCheckStatus::Ready;
        self.message = format!(
            "{} update candidates loaded from fixtures.",
            self.candidates.len()
        );
        self.persist()?;
        Ok(self.snapshot())
    }

    pub fn apply_action(
        &mut self,
        request: UpdateActionRequest,
    ) -> Result<UpdaterSnapshot, String> {
        let Some(index) = self
            .candidates
            .iter()
            .position(|candidate| candidate.id == request.candidate_id)
        else {
            return Err(format!(
                "unknown update candidate: {}",
                request.candidate_id
            ));
        };

        let now = now_ms();
        let candidate_id = self.candidates[index].id.clone();
        let message = match request.action {
            UpdateActionKind::Ignore => {
                self.ignored.insert(candidate_id.clone());
                self.candidates[index].ignored = true;
                self.candidates[index].action_status = UpdateActionStatus::Ignored;
                "Update ignored.".to_string()
            }
            UpdateActionKind::RemindLater => {
                let remind_after =
                    now + u128::from(self.settings.remind_later_hours) * 60 * 60 * 1_000;
                self.reminders.insert(candidate_id.clone(), remind_after);
                self.candidates[index].remind_after_ms = Some(remind_after);
                self.candidates[index].action_status = UpdateActionStatus::RemindLater;
                "Reminder scheduled.".to_string()
            }
            UpdateActionKind::Install => {
                self.candidates[index].action_status = UpdateActionStatus::InstallQueued;
                "Dry-run install queued for this model update.".to_string()
            }
            UpdateActionKind::InstallAndSwitch => {
                self.candidates[index].action_status = UpdateActionStatus::InstallAndSwitchQueued;
                "Dry-run install-and-switch queued for this model update.".to_string()
            }
        };
        self.history.insert(
            0,
            UpdateHistoryEntry {
                timestamp_ms: now,
                candidate_id,
                action: request.action,
                message,
            },
        );
        self.history.truncate(100);
        self.persist()?;
        Ok(self.snapshot())
    }

    fn candidate_from_entry(
        &self,
        entry: NormalizedMetadataEntry,
        model: &ModelEntry,
        score: &crate::model_catalog::CompatibilityResult,
        now: u128,
    ) -> UpdateCandidate {
        let id = format!("{}::{}", source_key(&entry.source_kind), entry.model_id);
        let remind_after_ms = self.reminders.get(&id).cloned();
        let ignored = self.ignored.contains(&id);
        let action_status = if ignored {
            UpdateActionStatus::Ignored
        } else if remind_after_ms.map(|until| until > now).unwrap_or(false) {
            UpdateActionStatus::RemindLater
        } else {
            UpdateActionStatus::Available
        };
        UpdateCandidate {
            id,
            model_id: entry.model_id,
            model_name: model.display_name.clone(),
            source_kind: entry.source_kind,
            source_name: entry.source_name,
            current_version: entry.current_version,
            latest_version: entry.latest_version,
            release_notes: entry.release_notes,
            compatibility_label: score.label.clone(),
            compatibility_score: score.score,
            compatibility_notes: score.reasons.clone(),
            blocked_reasons: score.blockers.clone(),
            action_status,
            ignored,
            remind_after_ms,
            checked_at_ms: entry.checked_at_ms,
        }
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create updater state directory: {err}"))?;
        }
        let state = PersistedUpdaterState {
            settings: self.settings.clone(),
            history: self.history.clone(),
            ignored: self.ignored.iter().cloned().collect(),
            reminders: self
                .reminders
                .iter()
                .map(|(key, value)| (key.clone(), *value))
                .collect(),
            last_checked_ms: self.last_checked_ms,
        };
        let raw = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("failed to serialize updater state: {err}"))?;
        fs::write(&self.path, raw).map_err(|err| format!("failed to persist updater state: {err}"))
    }
}

pub fn updater_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("updater_state.json")
}

trait MetadataSource {
    fn fetch(&self) -> Result<Vec<NormalizedMetadataEntry>, String>;
}

struct OllamaMetadataSource;
struct MlxHuggingFaceMetadataSource;
struct CustomJsonMetadataSource;

impl MetadataSource for OllamaMetadataSource {
    fn fetch(&self) -> Result<Vec<NormalizedMetadataEntry>, String> {
        let parsed = serde_json::from_str::<OllamaFixture>(OLLAMA_FIXTURE)
            .map_err(|err| format!("invalid Ollama metadata fixture: {err}"))?;
        Ok(parsed
            .models
            .into_iter()
            .map(|item| NormalizedMetadataEntry {
                model_id: item.model_id,
                source_kind: MetadataSourceKind::Ollama,
                source_name: parsed.source_name.clone(),
                current_version: item.current_version,
                latest_version: item.latest_version,
                release_notes: item.release_notes,
                checked_at_ms: parsed.checked_at_ms,
            })
            .collect())
    }
}

impl MetadataSource for MlxHuggingFaceMetadataSource {
    fn fetch(&self) -> Result<Vec<NormalizedMetadataEntry>, String> {
        let parsed = serde_json::from_str::<MlxHfFixture>(MLX_HF_FIXTURE)
            .map_err(|err| format!("invalid MLX Hugging Face metadata fixture: {err}"))?;
        Ok(parsed
            .repositories
            .into_iter()
            .map(|item| NormalizedMetadataEntry {
                model_id: item.model_id,
                source_kind: MetadataSourceKind::MlxHuggingFace,
                source_name: format!("{} ({})", parsed.source_name, item.repo),
                current_version: item.current_revision,
                latest_version: item.latest_revision,
                release_notes: item.release_notes,
                checked_at_ms: parsed.checked_at_ms,
            })
            .collect())
    }
}

impl MetadataSource for CustomJsonMetadataSource {
    fn fetch(&self) -> Result<Vec<NormalizedMetadataEntry>, String> {
        let parsed = serde_json::from_str::<CustomCatalogFixture>(CUSTOM_CATALOG_FIXTURE)
            .map_err(|err| format!("invalid custom update catalog fixture: {err}"))?;
        Ok(parsed
            .updates
            .into_iter()
            .map(|item| NormalizedMetadataEntry {
                model_id: item.model_id,
                source_kind: MetadataSourceKind::CustomJson,
                source_name: format!("{} ({})", parsed.source_name, item.source_url),
                current_version: item.current_version,
                latest_version: item.latest_version,
                release_notes: item.release_notes,
                checked_at_ms: parsed.checked_at_ms,
            })
            .collect())
    }
}

fn enabled_sources(settings: &UpdaterSettings) -> Vec<Box<dyn MetadataSource>> {
    let mut sources: Vec<Box<dyn MetadataSource>> = Vec::new();
    if settings.include_ollama {
        sources.push(Box::new(OllamaMetadataSource));
    }
    if settings.include_mlx_huggingface {
        sources.push(Box::new(MlxHuggingFaceMetadataSource));
    }
    if settings.include_custom_json {
        sources.push(Box::new(CustomJsonMetadataSource));
    }
    sources
}

fn source_key(kind: &MetadataSourceKind) -> &'static str {
    match kind {
        MetadataSourceKind::Ollama => "ollama",
        MetadataSourceKind::MlxHuggingFace => "mlx-hf",
        MetadataSourceKind::CustomJson => "custom-json",
    }
}

#[derive(Clone, Debug)]
struct NormalizedMetadataEntry {
    model_id: String,
    source_kind: MetadataSourceKind,
    source_name: String,
    current_version: String,
    latest_version: String,
    release_notes: String,
    checked_at_ms: u128,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedUpdaterState {
    settings: UpdaterSettings,
    history: Vec<UpdateHistoryEntry>,
    ignored: Vec<String>,
    reminders: Vec<(String, u128)>,
    last_checked_ms: Option<u128>,
}

#[derive(Clone, Debug, Deserialize)]
struct OllamaFixture {
    source_name: String,
    checked_at_ms: u128,
    models: Vec<OllamaFixtureModel>,
}

#[derive(Clone, Debug, Deserialize)]
struct OllamaFixtureModel {
    model_id: String,
    current_version: String,
    latest_version: String,
    release_notes: String,
}

#[derive(Clone, Debug, Deserialize)]
struct MlxHfFixture {
    source_name: String,
    checked_at_ms: u128,
    repositories: Vec<MlxHfFixtureRepo>,
}

#[derive(Clone, Debug, Deserialize)]
struct MlxHfFixtureRepo {
    model_id: String,
    repo: String,
    current_revision: String,
    latest_revision: String,
    release_notes: String,
}

#[derive(Clone, Debug, Deserialize)]
struct CustomCatalogFixture {
    source_name: String,
    checked_at_ms: u128,
    updates: Vec<CustomCatalogUpdate>,
}

#[derive(Clone, Debug, Deserialize)]
struct CustomCatalogUpdate {
    model_id: String,
    current_version: String,
    latest_version: String,
    source_url: String,
    release_notes: String,
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
    use crate::hardware_probe::load_fixture;

    fn manager(name: &str) -> UpdaterManager {
        let path =
            std::env::temp_dir().join(format!("local-ai-router-updater-{name}-{}.json", now_ms()));
        let _ = fs::remove_file(&path);
        UpdaterManager::load(path).expect("manager loads")
    }

    fn request() -> CheckUpdatesRequest {
        CheckUpdatesRequest {
            hardware: load_fixture("apple-silicon-m3-pro-18gb").expect("fixture"),
            app_paused: false,
            manual: true,
        }
    }

    #[test]
    fn fixture_sources_produce_update_candidates() {
        let mut manager = manager("candidates");
        let snapshot = manager.check_updates(request()).expect("check succeeds");

        assert_eq!(snapshot.status, UpdateCheckStatus::Ready);
        assert!(snapshot
            .candidates
            .iter()
            .any(|candidate| candidate.source_kind == MetadataSourceKind::Ollama));
        assert!(snapshot
            .candidates
            .iter()
            .any(|candidate| candidate.source_kind == MetadataSourceKind::MlxHuggingFace));
        assert!(snapshot
            .candidates
            .iter()
            .any(|candidate| candidate.source_kind == MetadataSourceKind::CustomJson));
        assert!(snapshot
            .candidates
            .iter()
            .all(|candidate| candidate.current_version != candidate.latest_version));
    }

    #[test]
    fn privacy_mode_blocks_metadata_checks() {
        let mut manager = manager("privacy");
        let mut settings = UpdaterSettings::default();
        settings.privacy_mode_enabled = true;
        manager.update_settings(settings).expect("settings update");
        let snapshot = manager.check_updates(request()).expect("privacy result");

        assert_eq!(snapshot.status, UpdateCheckStatus::PrivacyBlocked);
        assert!(snapshot.candidates.is_empty());
    }

    #[test]
    fn paused_scheduled_check_is_suspended() {
        let mut manager = manager("paused");
        let mut request = request();
        request.app_paused = true;
        request.manual = false;
        let snapshot = manager.check_updates(request).expect("paused result");

        assert_eq!(snapshot.status, UpdateCheckStatus::SuspendedByPause);
        assert!(snapshot.candidates.is_empty());
    }

    #[test]
    fn actions_update_candidate_state_and_history() {
        let mut manager = manager("actions");
        let snapshot = manager.check_updates(request()).expect("check succeeds");
        let candidate_id = snapshot.candidates[0].id.clone();
        let snapshot = manager
            .apply_action(UpdateActionRequest {
                candidate_id: candidate_id.clone(),
                action: UpdateActionKind::RemindLater,
            })
            .expect("action succeeds");

        let candidate = snapshot
            .candidates
            .iter()
            .find(|candidate| candidate.id == candidate_id)
            .expect("candidate remains");
        assert_eq!(candidate.action_status, UpdateActionStatus::RemindLater);
        assert_eq!(snapshot.history.len(), 1);
    }
}
