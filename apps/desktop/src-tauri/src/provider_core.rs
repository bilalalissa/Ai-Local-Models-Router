use crate::model_catalog::ProviderKind;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ProviderHealth {
    Healthy,
    Starting,
    Stopped,
    Paused,
    Degraded,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ProviderCapability {
    Health,
    ListModels,
    Chat,
    StreamingChat,
    StartStop,
    InstallModel,
    UninstallModel,
    PauseResumeTasks,
    Logs,
    ProviderFolder,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderDefinition {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub folder: String,
    pub capabilities: Vec<ProviderCapability>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderStatus {
    pub definition: ProviderDefinition,
    pub health: ProviderHealth,
    pub running: bool,
    pub paused: bool,
    pub model_count: usize,
    pub active_model: Option<String>,
    pub latency_ms: Option<u32>,
    pub last_checked_ms: u128,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderModel {
    pub id: String,
    pub display_name: String,
    pub format: String,
    pub size_bytes: u64,
    pub installed: bool,
    pub supports_chat: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderLogEntry {
    pub timestamp_ms: u128,
    pub provider_id: String,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderChatRequest {
    pub provider_id: String,
    pub model_id: Option<String>,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderChatResponse {
    pub provider_id: String,
    pub model_id: String,
    pub response: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub latency_ms: u32,
}

pub trait ProviderAdapter {
    fn definition(&self) -> ProviderDefinition;
    fn health(&mut self) -> ProviderStatus;
    fn list_models(&self) -> Vec<ProviderModel>;
    fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String>;
    fn start(&mut self) -> ProviderStatus;
    fn stop(&mut self) -> ProviderStatus;
    fn pause_tasks(&mut self, reason: &str) -> ProviderStatus;
    fn resume_tasks(&mut self) -> ProviderStatus;
    fn logs(&self) -> Vec<ProviderLogEntry>;
    fn provider_folder(&self) -> String;
}

#[derive(Debug)]
pub struct ProviderManager {
    providers: Vec<MockProvider>,
}

impl ProviderManager {
    pub fn seeded() -> Self {
        Self {
            providers: vec![
                MockProvider::new(
                    "mock-mlx",
                    "MLX-LM Server",
                    ProviderKind::MlxLm,
                    "http://127.0.0.1:8080",
                    "~/Library/Application Support/Local AI Router/providers/mlx-lm",
                    vec![
                        model(
                            "qwen2-5-coder-7b-mlx",
                            "Qwen2.5 Coder 7B MLX",
                            "MLX / 4-bit",
                            4_831_838_208,
                            true,
                        ),
                        model(
                            "phi-3-5-mini-q4",
                            "Phi-3.5 Mini",
                            "GGUF / Q4_K_M",
                            2_684_354_560,
                            true,
                        ),
                    ],
                    true,
                ),
                MockProvider::new(
                    "mock-ollama",
                    "Ollama",
                    ProviderKind::Ollama,
                    "http://127.0.0.1:11434",
                    "~/Library/Application Support/Local AI Router/providers/ollama",
                    vec![
                        model(
                            "llama-3-1-8b-q4",
                            "Llama 3.1 8B Instruct Q4",
                            "GGUF / Q4_K_M",
                            5_368_709_120,
                            true,
                        ),
                        model(
                            "phi-3-5-mini-q4",
                            "Phi-3.5 Mini Instruct Q4",
                            "GGUF / Q4_K_M",
                            2_684_354_560,
                            true,
                        ),
                        model(
                            "nomic-embed-text",
                            "Nomic Embed Text",
                            "GGUF / F16",
                            629_145_600,
                            true,
                        ),
                    ],
                    true,
                ),
                MockProvider::new(
                    "mock-lm-studio",
                    "LM Studio",
                    ProviderKind::LmStudio,
                    "http://127.0.0.1:1234",
                    "~/Library/Application Support/Local AI Router/providers/lm-studio",
                    vec![
                        model(
                            "mistral-7b-instruct-q4",
                            "Mistral 7B Instruct Q4",
                            "GGUF / Q4_K_M",
                            4_563_402_752,
                            false,
                        ),
                        model(
                            "qwen2-5-coder-7b-q4",
                            "Qwen2.5 Coder 7B Q4",
                            "GGUF / Q4_K_M",
                            5_100_273_664,
                            false,
                        ),
                    ],
                    false,
                ),
                MockProvider::new(
                    "mock-openai-compatible",
                    "Custom OpenAI-Compatible",
                    ProviderKind::OpenAiCompatible,
                    "http://127.0.0.1:5001/v1",
                    "~/Library/Application Support/Local AI Router/providers/custom-openai",
                    vec![model(
                        "custom-local-chat",
                        "Custom Local Chat",
                        "OpenAI-compatible",
                        0,
                        true,
                    )],
                    false,
                ),
            ],
        }
    }

    pub fn statuses(&mut self) -> Vec<ProviderStatus> {
        self.providers
            .iter_mut()
            .map(MockProvider::health)
            .collect()
    }

    pub fn start(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id).map(MockProvider::start)
    }

    pub fn stop(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id).map(MockProvider::stop)
    }

    pub fn pause(&mut self, provider_id: &str, reason: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id)
            .map(|provider| provider.pause_tasks(reason))
    }

    pub fn resume(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id)
            .map(MockProvider::resume_tasks)
    }

    pub fn pause_all(&mut self, reason: &str) -> Vec<ProviderStatus> {
        self.providers
            .iter_mut()
            .map(|provider| provider.pause_tasks(reason))
            .collect()
    }

    pub fn resume_all(&mut self) -> Vec<ProviderStatus> {
        self.providers
            .iter_mut()
            .map(MockProvider::resume_tasks)
            .collect()
    }

    pub fn list_models(&self, provider_id: &str) -> Result<Vec<ProviderModel>, String> {
        self.provider(provider_id).map(MockProvider::list_models)
    }

    pub fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String> {
        self.provider_mut(&request.provider_id)
            .and_then(|provider| provider.chat(request))
    }

    pub fn logs(&self, provider_id: Option<&str>) -> Vec<ProviderLogEntry> {
        let mut entries = self
            .providers
            .iter()
            .filter(|provider| {
                provider_id
                    .map(|id| provider.definition.id == id)
                    .unwrap_or(true)
            })
            .flat_map(MockProvider::logs)
            .collect::<Vec<_>>();
        entries.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        entries
    }

    pub fn folder(&self, provider_id: &str) -> Result<String, String> {
        self.provider(provider_id)
            .map(|provider| provider.provider_folder())
    }

    fn provider(&self, provider_id: &str) -> Result<&MockProvider, String> {
        self.providers
            .iter()
            .find(|provider| provider.definition.id == provider_id)
            .ok_or_else(|| format!("unknown provider: {provider_id}"))
    }

    fn provider_mut(&mut self, provider_id: &str) -> Result<&mut MockProvider, String> {
        self.providers
            .iter_mut()
            .find(|provider| provider.definition.id == provider_id)
            .ok_or_else(|| format!("unknown provider: {provider_id}"))
    }
}

#[derive(Clone, Debug)]
struct MockProvider {
    definition: ProviderDefinition,
    models: Vec<ProviderModel>,
    running: bool,
    paused: bool,
    health: ProviderHealth,
    latency_ms: Option<u32>,
    health_tick: u32,
    logs: Vec<ProviderLogEntry>,
}

impl MockProvider {
    fn new(
        id: &str,
        name: &str,
        kind: ProviderKind,
        base_url: &str,
        folder: &str,
        models: Vec<ProviderModel>,
        running: bool,
    ) -> Self {
        let health = if running {
            ProviderHealth::Healthy
        } else {
            ProviderHealth::Stopped
        };
        let mut provider = Self {
            definition: ProviderDefinition {
                id: id.to_string(),
                name: name.to_string(),
                kind,
                base_url: base_url.to_string(),
                folder: folder.to_string(),
                capabilities: vec![
                    ProviderCapability::Health,
                    ProviderCapability::ListModels,
                    ProviderCapability::Chat,
                    ProviderCapability::StreamingChat,
                    ProviderCapability::StartStop,
                    ProviderCapability::InstallModel,
                    ProviderCapability::UninstallModel,
                    ProviderCapability::PauseResumeTasks,
                    ProviderCapability::Logs,
                    ProviderCapability::ProviderFolder,
                ],
            },
            models,
            running,
            paused: false,
            health,
            latency_ms: if running { Some(42) } else { None },
            health_tick: 0,
            logs: Vec::new(),
        };
        provider.push_log("info", "Mock provider initialized.");
        provider
    }

    fn status(&self, message: &str) -> ProviderStatus {
        ProviderStatus {
            definition: self.definition(),
            health: self.health.clone(),
            running: self.running,
            paused: self.paused,
            model_count: self.models.len(),
            active_model: self.models.first().map(|model| model.display_name.clone()),
            latency_ms: self.latency_ms,
            last_checked_ms: now_ms(),
            message: message.to_string(),
        }
    }

    fn push_log(&mut self, level: &str, message: &str) {
        self.logs.push(ProviderLogEntry {
            timestamp_ms: now_ms(),
            provider_id: self.definition.id.clone(),
            level: level.to_string(),
            message: message.to_string(),
        });
    }
}

impl ProviderAdapter for MockProvider {
    fn definition(&self) -> ProviderDefinition {
        self.definition.clone()
    }

    fn health(&mut self) -> ProviderStatus {
        self.health_tick = self.health_tick.saturating_add(1);
        if self.running && !self.paused {
            self.health = if self.health_tick % 5 == 0 {
                ProviderHealth::Degraded
            } else {
                ProviderHealth::Healthy
            };
            self.latency_ms = Some(35 + (self.health_tick % 4) * 11);
            self.push_log("debug", "Mock health check completed.");
        }
        self.status("Mock health status refreshed.")
    }

    fn list_models(&self) -> Vec<ProviderModel> {
        self.models.clone()
    }

    fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String> {
        if !self.running {
            self.push_log("warn", "Rejected mock chat while provider is stopped.");
            return Err("provider is stopped".to_string());
        }
        if self.paused {
            self.push_log(
                "warn",
                "Rejected mock chat while provider tasks are paused.",
            );
            return Err("provider tasks are paused".to_string());
        }

        let model = request
            .model_id
            .as_deref()
            .and_then(|id| self.models.iter().find(|model| model.id == id))
            .or_else(|| self.models.iter().find(|model| model.supports_chat))
            .ok_or_else(|| "provider has no chat-capable model".to_string())?
            .clone();
        let prompt = request.prompt.trim();
        let response = format!(
            "[Mock:{}] {} is ready. Echo: {}",
            self.definition.name,
            model.display_name,
            if prompt.is_empty() {
                "(empty prompt)"
            } else {
                prompt
            }
        );
        self.push_log("info", "Mock test chat completed.");
        Ok(ProviderChatResponse {
            provider_id: self.definition.id.clone(),
            model_id: model.id,
            response,
            tokens_in: prompt.split_whitespace().count() as u32,
            tokens_out: 24,
            latency_ms: self.latency_ms.unwrap_or(55),
        })
    }

    fn start(&mut self) -> ProviderStatus {
        self.running = true;
        self.paused = false;
        self.health = ProviderHealth::Healthy;
        self.latency_ms = Some(48);
        self.push_log("info", "Mock provider started.");
        self.status("Provider started.")
    }

    fn stop(&mut self) -> ProviderStatus {
        self.running = false;
        self.paused = false;
        self.health = ProviderHealth::Stopped;
        self.latency_ms = None;
        self.push_log("info", "Mock provider stopped.");
        self.status("Provider stopped.")
    }

    fn pause_tasks(&mut self, reason: &str) -> ProviderStatus {
        if self.running {
            self.paused = true;
            self.health = ProviderHealth::Paused;
            self.push_log("info", &format!("Provider tasks paused: {reason}"));
            self.status("Provider tasks paused.")
        } else {
            self.push_log("debug", "Pause ignored because provider is stopped.");
            self.status("Provider is stopped.")
        }
    }

    fn resume_tasks(&mut self) -> ProviderStatus {
        if self.running {
            self.paused = false;
            self.health = ProviderHealth::Healthy;
            self.push_log("info", "Provider tasks resumed.");
            self.status("Provider tasks resumed.")
        } else {
            self.status("Provider is stopped.")
        }
    }

    fn logs(&self) -> Vec<ProviderLogEntry> {
        self.logs.clone()
    }

    fn provider_folder(&self) -> String {
        self.definition.folder.clone()
    }
}

fn model(
    id: &str,
    display_name: &str,
    format: &str,
    size_bytes: u64,
    installed: bool,
) -> ProviderModel {
    ProviderModel {
        id: id.to_string(),
        display_name: display_name.to_string(),
        format: format.to_string(),
        size_bytes,
        installed,
        supports_chat: true,
    }
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

    #[test]
    fn seeded_manager_exposes_mock_provider_capabilities() {
        let mut manager = ProviderManager::seeded();
        let statuses = manager.statuses();

        assert_eq!(statuses.len(), 4);
        assert!(statuses.iter().all(|status| status
            .definition
            .capabilities
            .contains(&ProviderCapability::PauseResumeTasks)));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::MlxLm));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::Ollama));
    }

    #[test]
    fn mock_provider_lists_models_and_completes_chat() {
        let mut manager = ProviderManager::seeded();
        let models = manager
            .list_models("mock-ollama")
            .expect("models should list");
        let response = manager
            .chat(ProviderChatRequest {
                provider_id: "mock-ollama".to_string(),
                model_id: Some("llama-3-1-8b-q4".to_string()),
                prompt: "hello local model".to_string(),
            })
            .expect("chat should succeed");

        assert!(models.len() >= 2);
        assert_eq!(response.model_id, "llama-3-1-8b-q4");
        assert!(response.response.contains("Mock"));
        assert!(manager
            .logs(Some("mock-ollama"))
            .iter()
            .any(|entry| entry.message.contains("Mock test chat completed")));
    }

    #[test]
    fn pause_blocks_chat_and_resume_allows_it_again() {
        let mut manager = ProviderManager::seeded();
        let paused = manager
            .pause("mock-mlx", "test pause")
            .expect("pause succeeds");
        let blocked = manager.chat(ProviderChatRequest {
            provider_id: "mock-mlx".to_string(),
            model_id: None,
            prompt: "blocked".to_string(),
        });
        let resumed = manager.resume("mock-mlx").expect("resume succeeds");
        let response = manager
            .chat(ProviderChatRequest {
                provider_id: "mock-mlx".to_string(),
                model_id: None,
                prompt: "resume works".to_string(),
            })
            .expect("chat works after resume");

        assert_eq!(paused.health, ProviderHealth::Paused);
        assert!(blocked.expect_err("paused chat fails").contains("paused"));
        assert_eq!(resumed.health, ProviderHealth::Healthy);
        assert!(response.response.contains("resume works"));
    }

    #[test]
    fn stop_blocks_chat_and_start_restores_health() {
        let mut manager = ProviderManager::seeded();
        let stopped = manager.stop("mock-ollama").expect("stop succeeds");
        let blocked = manager.chat(ProviderChatRequest {
            provider_id: "mock-ollama".to_string(),
            model_id: None,
            prompt: "blocked".to_string(),
        });
        let started = manager.start("mock-ollama").expect("start succeeds");

        assert_eq!(stopped.health, ProviderHealth::Stopped);
        assert!(blocked.expect_err("stopped chat fails").contains("stopped"));
        assert_eq!(started.health, ProviderHealth::Healthy);
    }
}
