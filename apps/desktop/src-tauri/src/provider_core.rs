use crate::model_catalog::ProviderKind;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const REQUEST_TIMEOUT: Duration = Duration::from_millis(900);

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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderSettings {
    pub provider_id: String,
    pub enabled: bool,
    pub base_url: String,
    pub folder: String,
    pub launch_command: Option<String>,
    pub api_key_configured: bool,
    pub notes: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderSettingsPatch {
    pub provider_id: String,
    pub enabled: bool,
    pub base_url: String,
    pub folder: String,
    pub launch_command: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderInstallPlan {
    pub provider_id: String,
    pub dry_run: bool,
    pub summary: String,
    pub commands: Vec<String>,
    pub notes: Vec<String>,
}

pub trait ProviderAdapter {
    fn definition(&self) -> ProviderDefinition;
    fn health(&mut self) -> ProviderStatus;
    fn list_models(&mut self) -> Result<Vec<ProviderModel>, String>;
    fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String>;
    fn start(&mut self) -> ProviderStatus;
    fn stop(&mut self) -> ProviderStatus;
    fn pause_tasks(&mut self, reason: &str) -> ProviderStatus;
    fn resume_tasks(&mut self) -> ProviderStatus;
    fn logs(&self) -> Vec<ProviderLogEntry>;
    fn provider_folder(&self) -> String;
    fn settings(&self) -> ProviderSettings;
    fn update_settings(&mut self, patch: ProviderSettingsPatch) -> ProviderStatus;
    fn install_plan(&self) -> ProviderInstallPlan;
}

#[derive(Debug)]
pub struct ProviderManager {
    providers: Vec<ProviderInstance>,
}

impl ProviderManager {
    pub fn seeded() -> Self {
        Self {
            providers: vec![
                local_provider(
                    "ollama-local",
                    "Ollama",
                    ProviderKind::Ollama,
                    ProviderProtocol::Ollama,
                    "http://127.0.0.1:11434",
                    "~/Library/Application Support/Local AI Router/providers/ollama",
                    Some("llama3.1:8b"),
                    "Ollama local HTTP API at /api/tags and /api/generate.",
                ),
                local_provider(
                    "lm-studio-local",
                    "LM Studio",
                    ProviderKind::LmStudio,
                    ProviderProtocol::OpenAiCompatible,
                    "http://127.0.0.1:1234/v1",
                    "~/Library/Application Support/Local AI Router/providers/lm-studio",
                    Some("local-model"),
                    "LM Studio local server with the OpenAI-compatible API enabled.",
                ),
                local_provider(
                    "openai-compatible-local",
                    "Custom OpenAI-Compatible",
                    ProviderKind::OpenAiCompatible,
                    ProviderProtocol::OpenAiCompatible,
                    "http://127.0.0.1:5001/v1",
                    "~/Library/Application Support/Local AI Router/providers/custom-openai",
                    Some("local-model"),
                    "Custom local OpenAI-compatible endpoint. API key storage is deferred.",
                ),
                local_provider(
                    "mlx-lm-local",
                    "MLX-LM Server",
                    ProviderKind::MlxLm,
                    ProviderProtocol::OpenAiCompatible,
                    "http://127.0.0.1:8080/v1",
                    "~/Library/Application Support/Local AI Router/providers/mlx-lm",
                    Some("mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"),
                    "MLX-LM OpenAI-compatible server for Apple Silicon.",
                ),
                local_provider(
                    "llama-cpp-local",
                    "llama.cpp Server",
                    ProviderKind::LlamaCpp,
                    ProviderProtocol::OpenAiCompatible,
                    "http://127.0.0.1:8081/v1",
                    "~/Library/Application Support/Local AI Router/providers/llama-cpp",
                    Some("local-gguf"),
                    "llama.cpp server with OpenAI-compatible endpoints.",
                ),
            ],
        }
    }

    pub fn statuses(&mut self) -> Vec<ProviderStatus> {
        self.providers
            .iter_mut()
            .map(ProviderInstance::health)
            .collect()
    }

    pub fn start(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id).map(ProviderInstance::start)
    }

    pub fn stop(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id).map(ProviderInstance::stop)
    }

    pub fn pause(&mut self, provider_id: &str, reason: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id)
            .map(|provider| provider.pause_tasks(reason))
    }

    pub fn resume(&mut self, provider_id: &str) -> Result<ProviderStatus, String> {
        self.provider_mut(provider_id)
            .map(ProviderInstance::resume_tasks)
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
            .map(ProviderInstance::resume_tasks)
            .collect()
    }

    pub fn list_models(&mut self, provider_id: &str) -> Result<Vec<ProviderModel>, String> {
        self.provider_mut(provider_id)
            .and_then(ProviderInstance::list_models)
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
                    .map(|id| provider.definition().id == id)
                    .unwrap_or(true)
            })
            .flat_map(ProviderInstance::logs)
            .collect::<Vec<_>>();
        entries.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        entries
    }

    pub fn folder(&self, provider_id: &str) -> Result<String, String> {
        self.provider(provider_id)
            .map(ProviderInstance::provider_folder)
    }

    pub fn settings(&self, provider_id: &str) -> Result<ProviderSettings, String> {
        self.provider(provider_id).map(ProviderInstance::settings)
    }

    pub fn update_settings(
        &mut self,
        patch: ProviderSettingsPatch,
    ) -> Result<ProviderStatus, String> {
        self.provider_mut(&patch.provider_id)
            .map(|provider| provider.update_settings(patch))
    }

    pub fn install_plan(&self, provider_id: &str) -> Result<ProviderInstallPlan, String> {
        self.provider(provider_id)
            .map(ProviderInstance::install_plan)
    }

    fn provider(&self, provider_id: &str) -> Result<&ProviderInstance, String> {
        self.providers
            .iter()
            .find(|provider| provider.definition().id == provider_id)
            .ok_or_else(|| format!("unknown provider: {provider_id}"))
    }

    fn provider_mut(&mut self, provider_id: &str) -> Result<&mut ProviderInstance, String> {
        self.providers
            .iter_mut()
            .find(|provider| provider.definition().id == provider_id)
            .ok_or_else(|| format!("unknown provider: {provider_id}"))
    }
}

#[derive(Debug)]
enum ProviderInstance {
    LocalHttp(LocalHttpProvider),
}

impl ProviderAdapter for ProviderInstance {
    fn definition(&self) -> ProviderDefinition {
        match self {
            Self::LocalHttp(provider) => provider.definition(),
        }
    }

    fn health(&mut self) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.health(),
        }
    }

    fn list_models(&mut self) -> Result<Vec<ProviderModel>, String> {
        match self {
            Self::LocalHttp(provider) => provider.list_models(),
        }
    }

    fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String> {
        match self {
            Self::LocalHttp(provider) => provider.chat(request),
        }
    }

    fn start(&mut self) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.start(),
        }
    }

    fn stop(&mut self) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.stop(),
        }
    }

    fn pause_tasks(&mut self, reason: &str) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.pause_tasks(reason),
        }
    }

    fn resume_tasks(&mut self) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.resume_tasks(),
        }
    }

    fn logs(&self) -> Vec<ProviderLogEntry> {
        match self {
            Self::LocalHttp(provider) => provider.logs(),
        }
    }

    fn provider_folder(&self) -> String {
        match self {
            Self::LocalHttp(provider) => provider.provider_folder(),
        }
    }

    fn settings(&self) -> ProviderSettings {
        match self {
            Self::LocalHttp(provider) => provider.settings(),
        }
    }

    fn update_settings(&mut self, patch: ProviderSettingsPatch) -> ProviderStatus {
        match self {
            Self::LocalHttp(provider) => provider.update_settings(patch),
        }
    }

    fn install_plan(&self) -> ProviderInstallPlan {
        match self {
            Self::LocalHttp(provider) => provider.install_plan(),
        }
    }
}

#[derive(Clone, Debug)]
enum ProviderProtocol {
    Ollama,
    OpenAiCompatible,
}

#[derive(Clone, Debug)]
struct LocalHttpProvider {
    definition: ProviderDefinition,
    protocol: ProviderProtocol,
    settings: ProviderSettings,
    default_model_id: Option<String>,
    paused: bool,
    last_health: ProviderHealth,
    last_running: bool,
    last_latency_ms: Option<u32>,
    last_models: Vec<ProviderModel>,
    logs: Vec<ProviderLogEntry>,
}

impl LocalHttpProvider {
    fn status(&self, message: &str) -> ProviderStatus {
        ProviderStatus {
            definition: self.definition(),
            health: self.last_health.clone(),
            running: self.last_running,
            paused: self.paused,
            model_count: self.last_models.len(),
            active_model: self
                .last_models
                .first()
                .map(|model| model.display_name.clone()),
            latency_ms: self.last_latency_ms,
            last_checked_ms: now_ms(),
            message: message.to_string(),
        }
    }

    fn apply_probe_result(
        &mut self,
        result: Result<(Vec<ProviderModel>, u32), String>,
    ) -> ProviderStatus {
        match result {
            Ok((models, latency_ms)) => {
                let model_count = models.len();
                self.last_models = models;
                self.last_running = true;
                self.last_latency_ms = Some(latency_ms);
                self.last_health = if model_count == 0 {
                    ProviderHealth::Degraded
                } else {
                    ProviderHealth::Healthy
                };
                let message = if model_count == 0 {
                    "Provider endpoint reached, but no models were listed."
                } else {
                    "Provider endpoint healthy."
                };
                self.push_log("debug", message);
                self.status(message)
            }
            Err(err) => {
                self.last_running = false;
                self.last_latency_ms = None;
                self.last_health = ProviderHealth::Stopped;
                self.push_log("warn", &format!("Provider endpoint unavailable: {err}"));
                self.status("Provider endpoint unavailable.")
            }
        }
    }

    fn fetch_models(&self) -> Result<(Vec<ProviderModel>, u32), String> {
        match self.protocol {
            ProviderProtocol::Ollama => {
                let response =
                    local_http_request(&self.settings.base_url, "GET", "/api/tags", None)?;
                if response.status_code >= 400 {
                    return Err(format!(
                        "Ollama model list returned HTTP {}",
                        response.status_code
                    ));
                }
                Ok((parse_ollama_models(&response.body)?, response.latency_ms))
            }
            ProviderProtocol::OpenAiCompatible => {
                let response = local_http_request(&self.settings.base_url, "GET", "/models", None)?;
                if response.status_code >= 400 {
                    return Err(format!(
                        "OpenAI-compatible model list returned HTTP {}",
                        response.status_code
                    ));
                }
                Ok((parse_openai_models(&response.body)?, response.latency_ms))
            }
        }
    }

    fn selected_model_id(&mut self, request: &ProviderChatRequest) -> String {
        request
            .model_id
            .clone()
            .or_else(|| {
                self.last_models
                    .iter()
                    .find(|model| model.supports_chat)
                    .map(|model| model.id.clone())
            })
            .or_else(|| self.default_model_id.clone())
            .unwrap_or_else(|| "local-model".to_string())
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

impl ProviderAdapter for LocalHttpProvider {
    fn definition(&self) -> ProviderDefinition {
        let mut definition = self.definition.clone();
        definition.base_url = self.settings.base_url.clone();
        definition.folder = self.settings.folder.clone();
        definition
    }

    fn health(&mut self) -> ProviderStatus {
        if !self.settings.enabled {
            self.last_running = false;
            self.last_latency_ms = None;
            self.last_health = ProviderHealth::Stopped;
            return self.status("Provider disabled in settings.");
        }
        if self.paused {
            self.last_health = ProviderHealth::Paused;
            return self.status("Provider tasks are paused.");
        }
        let result = self.fetch_models();
        self.apply_probe_result(result)
    }

    fn list_models(&mut self) -> Result<Vec<ProviderModel>, String> {
        if !self.settings.enabled {
            return Ok(Vec::new());
        }
        if self.paused {
            return Ok(self.last_models.clone());
        }
        match self.fetch_models() {
            Ok((models, latency_ms)) => {
                self.last_models = models.clone();
                self.last_running = true;
                self.last_latency_ms = Some(latency_ms);
                self.last_health = if models.is_empty() {
                    ProviderHealth::Degraded
                } else {
                    ProviderHealth::Healthy
                };
                self.push_log("debug", "Provider model list refreshed.");
                Ok(models)
            }
            Err(err) => {
                self.last_running = false;
                self.last_latency_ms = None;
                self.last_health = ProviderHealth::Stopped;
                self.push_log("warn", &format!("Provider model list failed: {err}"));
                Ok(self.last_models.clone())
            }
        }
    }

    fn chat(&mut self, request: ProviderChatRequest) -> Result<ProviderChatResponse, String> {
        if !self.settings.enabled {
            self.push_log("warn", "Rejected test chat because provider is disabled.");
            return Err("provider is disabled".to_string());
        }
        if self.paused {
            self.push_log(
                "warn",
                "Rejected test chat while provider tasks are paused.",
            );
            return Err("provider tasks are paused".to_string());
        }

        let model_id = self.selected_model_id(&request);
        let prompt = request.prompt.trim();
        let body = match self.protocol {
            ProviderProtocol::Ollama => json!({
                "model": model_id,
                "prompt": if prompt.is_empty() { "Say ready." } else { prompt },
                "stream": false
            }),
            ProviderProtocol::OpenAiCompatible => json!({
                "model": model_id,
                "messages": [
                    {
                        "role": "user",
                        "content": if prompt.is_empty() { "Say ready." } else { prompt }
                    }
                ],
                "stream": false,
                "max_tokens": 64
            }),
        };
        let path = match self.protocol {
            ProviderProtocol::Ollama => "/api/generate",
            ProviderProtocol::OpenAiCompatible => "/chat/completions",
        };
        let response = local_http_request(&self.settings.base_url, "POST", path, Some(body))?;
        if response.status_code >= 400 {
            self.push_log(
                "warn",
                &format!("Provider test chat returned HTTP {}", response.status_code),
            );
            return Err(format!("provider returned HTTP {}", response.status_code));
        }

        let text = match self.protocol {
            ProviderProtocol::Ollama => parse_ollama_chat(&response.body)?,
            ProviderProtocol::OpenAiCompatible => parse_openai_chat(&response.body)?,
        };
        self.last_running = true;
        self.last_latency_ms = Some(response.latency_ms);
        self.last_health = ProviderHealth::Healthy;
        self.push_log("info", "Local provider test chat completed.");
        Ok(ProviderChatResponse {
            provider_id: self.definition.id.clone(),
            model_id,
            response: text,
            tokens_in: prompt.split_whitespace().count() as u32,
            tokens_out: 64,
            latency_ms: response.latency_ms,
        })
    }

    fn start(&mut self) -> ProviderStatus {
        if !self.settings.enabled {
            self.settings.enabled = true;
            self.push_log("info", "Provider enabled from start action.");
        } else {
            self.push_log(
                "info",
                "Start action refreshed endpoint health; process launch is a Stage 7 hook.",
            );
        }
        self.health()
    }

    fn stop(&mut self) -> ProviderStatus {
        self.settings.enabled = false;
        self.paused = false;
        self.last_running = false;
        self.last_health = ProviderHealth::Stopped;
        self.last_latency_ms = None;
        self.push_log(
            "info",
            "Provider disabled. External process stop remains a Stage 7 hook.",
        );
        self.status("Provider disabled in settings.")
    }

    fn pause_tasks(&mut self, reason: &str) -> ProviderStatus {
        if self.settings.enabled {
            self.paused = true;
            self.last_health = ProviderHealth::Paused;
            self.push_log("info", &format!("Provider tasks paused: {reason}"));
            self.status("Provider tasks paused.")
        } else {
            self.status("Provider disabled in settings.")
        }
    }

    fn resume_tasks(&mut self) -> ProviderStatus {
        if self.settings.enabled {
            self.paused = false;
            self.push_log("info", "Provider tasks resumed.");
            self.health()
        } else {
            self.status("Provider disabled in settings.")
        }
    }

    fn logs(&self) -> Vec<ProviderLogEntry> {
        self.logs.clone()
    }

    fn provider_folder(&self) -> String {
        self.settings.folder.clone()
    }

    fn settings(&self) -> ProviderSettings {
        self.settings.clone()
    }

    fn update_settings(&mut self, patch: ProviderSettingsPatch) -> ProviderStatus {
        self.settings.enabled = patch.enabled;
        self.settings.base_url = normalize_base_url(&patch.base_url);
        self.settings.folder = patch.folder;
        self.settings.launch_command = patch
            .launch_command
            .filter(|command| !command.trim().is_empty());
        self.definition.base_url = self.settings.base_url.clone();
        self.definition.folder = self.settings.folder.clone();
        self.paused = false;
        self.push_log("info", "Provider settings updated.");
        self.health()
    }

    fn install_plan(&self) -> ProviderInstallPlan {
        install_plan_for(&self.definition, &self.settings)
    }
}

#[derive(Debug)]
struct HttpResponse {
    status_code: u16,
    body: String,
    latency_ms: u32,
}

#[derive(Debug)]
struct UrlParts {
    host: String,
    port: u16,
    prefix: String,
}

fn local_provider(
    id: &str,
    name: &str,
    kind: ProviderKind,
    protocol: ProviderProtocol,
    base_url: &str,
    folder: &str,
    default_model_id: Option<&str>,
    notes: &str,
) -> ProviderInstance {
    let definition = ProviderDefinition {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        base_url: normalize_base_url(base_url),
        folder: folder.to_string(),
        capabilities: vec![
            ProviderCapability::Health,
            ProviderCapability::ListModels,
            ProviderCapability::Chat,
            ProviderCapability::StreamingChat,
            ProviderCapability::StartStop,
            ProviderCapability::InstallModel,
            ProviderCapability::PauseResumeTasks,
            ProviderCapability::Logs,
            ProviderCapability::ProviderFolder,
        ],
    };
    let settings = ProviderSettings {
        provider_id: id.to_string(),
        enabled: true,
        base_url: definition.base_url.clone(),
        folder: folder.to_string(),
        launch_command: None,
        api_key_configured: false,
        notes: notes.to_string(),
    };
    let mut provider = LocalHttpProvider {
        definition,
        protocol,
        settings,
        default_model_id: default_model_id.map(str::to_string),
        paused: false,
        last_health: ProviderHealth::Stopped,
        last_running: false,
        last_latency_ms: None,
        last_models: Vec::new(),
        logs: Vec::new(),
    };
    provider.push_log("info", "Local provider adapter initialized.");
    ProviderInstance::LocalHttp(provider)
}

fn install_plan_for(
    definition: &ProviderDefinition,
    settings: &ProviderSettings,
) -> ProviderInstallPlan {
    let mut notes = vec![
        "Dry-run only: no commands are executed and no model weights are downloaded.".to_string(),
        format!("Configured endpoint: {}", settings.base_url),
    ];
    let commands = match definition.kind {
        ProviderKind::Ollama => vec![
            "brew install ollama".to_string(),
            "ollama serve".to_string(),
            "ollama pull llama3.1:8b".to_string(),
        ],
        ProviderKind::LmStudio => vec![
            "Install LM Studio desktop app manually.".to_string(),
            "Enable Local Server in LM Studio on port 1234.".to_string(),
            "Confirm http://127.0.0.1:1234/v1/models responds.".to_string(),
        ],
        ProviderKind::MlxLm => vec![
            "python3 -m venv .venv-mlx-lm".to_string(),
            ".venv-mlx-lm/bin/pip install mlx-lm".to_string(),
            ".venv-mlx-lm/bin/python -m mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080".to_string(),
        ],
        ProviderKind::LlamaCpp => vec![
            "brew install llama.cpp".to_string(),
            "llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8081".to_string(),
            "Confirm http://127.0.0.1:8081/v1/models responds.".to_string(),
        ],
        ProviderKind::OpenAiCompatible => vec![
            "Start your local OpenAI-compatible server.".to_string(),
            "Set the Base URL to the server's /v1 endpoint.".to_string(),
            "Confirm the /models and /chat/completions endpoints respond.".to_string(),
        ],
    };
    if let Some(command) = &settings.launch_command {
        notes.push(format!("Configured launch command for Stage 7: {command}"));
    }
    ProviderInstallPlan {
        provider_id: definition.id.clone(),
        dry_run: true,
        summary: format!("Dry-run setup plan for {}", definition.name),
        commands,
        notes,
    }
}

fn parse_ollama_models(body: &str) -> Result<Vec<ProviderModel>, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|err| format!("invalid Ollama JSON: {err}"))?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| "Ollama response missing models array".to_string())?;
    Ok(models
        .iter()
        .filter_map(|item| {
            let id = item
                .get("name")
                .or_else(|| item.get("model"))
                .and_then(Value::as_str)?;
            let details = item.get("details").unwrap_or(&Value::Null);
            let family = details
                .get("family")
                .and_then(Value::as_str)
                .unwrap_or("Ollama");
            let quant = details
                .get("quantization_level")
                .and_then(Value::as_str)
                .unwrap_or("local");
            Some(model(
                id,
                id,
                &format!("{family} / {quant}"),
                item.get("size").and_then(Value::as_u64).unwrap_or_default(),
                true,
                !id.to_ascii_lowercase().contains("embed"),
            ))
        })
        .collect())
}

fn parse_openai_models(body: &str) -> Result<Vec<ProviderModel>, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|err| format!("invalid OpenAI-compatible JSON: {err}"))?;
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenAI-compatible response missing data array".to_string())?;
    Ok(models
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?;
            Some(model(
                id,
                id,
                "OpenAI-compatible",
                item.get("size").and_then(Value::as_u64).unwrap_or_default(),
                true,
                !id.to_ascii_lowercase().contains("embed"),
            ))
        })
        .collect())
}

fn parse_ollama_chat(body: &str) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|err| format!("invalid Ollama chat JSON: {err}"))?;
    value
        .get("response")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Ollama chat response missing response text".to_string())
}

fn parse_openai_chat(body: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|err| format!("invalid OpenAI-compatible chat JSON: {err}"))?;
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            "OpenAI-compatible chat response missing choices[0].message.content".to_string()
        })
}

fn local_http_request(
    base_url: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<HttpResponse, String> {
    let url = parse_http_url(base_url)?;
    let request_path = join_paths(&url.prefix, path);
    let body_text = body.map(|value| value.to_string()).unwrap_or_default();
    let mut addrs = (url.host.as_str(), url.port)
        .to_socket_addrs()
        .map_err(|err| format!("could not resolve {}:{}: {err}", url.host, url.port))?;
    let addr = addrs
        .next()
        .ok_or_else(|| format!("no socket address for {}:{}", url.host, url.port))?;
    let start = Instant::now();
    let mut stream = TcpStream::connect_timeout(&addr, REQUEST_TIMEOUT)
        .map_err(|err| format!("connect failed: {err}"))?;
    stream
        .set_read_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|err| format!("read timeout setup failed: {err}"))?;
    stream
        .set_write_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|err| format!("write timeout setup failed: {err}"))?;
    let request = format!(
        "{method} {request_path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        url.host,
        body_text.len(),
        body_text
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("request write failed: {err}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| format!("response read failed: {err}"))?;
    let latency_ms = start.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response".to_string())?;
    let status_code = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "malformed HTTP status line".to_string())?;
    Ok(HttpResponse {
        status_code,
        body: body.to_string(),
        latency_ms,
    })
}

fn parse_http_url(input: &str) -> Result<UrlParts, String> {
    let trimmed = normalize_base_url(input);
    let without_scheme = trimmed.strip_prefix("http://").ok_or_else(|| {
        "only local http:// provider endpoints are supported in Stage 6".to_string()
    })?;
    let (authority, prefix) = without_scheme
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((without_scheme, "/".to_string()));
    if authority.is_empty() {
        return Err("provider URL missing host".to_string());
    }
    let (host, port) = if let Some((host, port)) = authority.rsplit_once(':') {
        let parsed_port = port
            .parse::<u16>()
            .map_err(|_| format!("invalid provider port: {port}"))?;
        (host.to_string(), parsed_port)
    } else {
        (authority.to_string(), 80)
    };
    Ok(UrlParts { host, port, prefix })
}

fn join_paths(prefix: &str, path: &str) -> String {
    let normalized_prefix = if prefix == "/" {
        ""
    } else {
        prefix.trim_end_matches('/')
    };
    format!("{normalized_prefix}/{}", path.trim_start_matches('/'))
}

fn normalize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

fn model(
    id: &str,
    display_name: &str,
    format: &str,
    size_bytes: u64,
    installed: bool,
    supports_chat: bool,
) -> ProviderModel {
    ProviderModel {
        id: id.to_string(),
        display_name: display_name.to_string(),
        format: format.to_string(),
        size_bytes,
        installed,
        supports_chat,
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
    fn seeded_manager_exposes_real_local_provider_adapters() {
        let mut manager = ProviderManager::seeded();
        let statuses = manager.statuses();

        assert_eq!(statuses.len(), 5);
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::Ollama));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::LmStudio));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::OpenAiCompatible));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::MlxLm));
        assert!(statuses
            .iter()
            .any(|status| status.definition.kind == ProviderKind::LlamaCpp));
    }

    #[test]
    fn parses_ollama_model_listing() {
        let models = parse_ollama_models(
            r#"{"models":[{"name":"llama3.1:8b","size":5368709120,"details":{"family":"llama","quantization_level":"Q4_K_M"}},{"name":"nomic-embed-text","size":629145600}]}"#,
        )
        .expect("ollama models parse");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].format, "llama / Q4_K_M");
        assert!(!models[1].supports_chat);
    }

    #[test]
    fn parses_openai_model_listing() {
        let models = parse_openai_models(
            r#"{"object":"list","data":[{"id":"local-chat"},{"id":"local-embed"}]}"#,
        )
        .expect("openai models parse");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].display_name, "local-chat");
        assert!(!models[1].supports_chat);
    }

    #[test]
    fn parses_openai_chat_response() {
        let text = parse_openai_chat(
            r#"{"choices":[{"message":{"role":"assistant","content":"ready"}}]}"#,
        )
        .expect("chat response parses");

        assert_eq!(text, "ready");
    }

    #[test]
    fn url_parser_preserves_openai_prefix() {
        let url = parse_http_url("http://127.0.0.1:1234/v1/").expect("url parses");

        assert_eq!(url.host, "127.0.0.1");
        assert_eq!(url.port, 1234);
        assert_eq!(join_paths(&url.prefix, "/models"), "/v1/models");
    }

    #[test]
    fn pause_blocks_chat_without_touching_network() {
        let mut manager = ProviderManager::seeded();
        let paused = manager
            .pause("ollama-local", "test pause")
            .expect("pause succeeds");
        let blocked = manager.chat(ProviderChatRequest {
            provider_id: "ollama-local".to_string(),
            model_id: Some("llama3.1:8b".to_string()),
            prompt: "blocked".to_string(),
        });

        assert_eq!(paused.health, ProviderHealth::Paused);
        assert!(blocked.expect_err("paused chat fails").contains("paused"));
    }

    #[test]
    fn settings_update_changes_base_url_and_enabled_state() {
        let mut manager = ProviderManager::seeded();
        let status = manager
            .update_settings(ProviderSettingsPatch {
                provider_id: "lm-studio-local".to_string(),
                enabled: false,
                base_url: "http://127.0.0.1:9999/v1/".to_string(),
                folder: "/tmp/lm-studio".to_string(),
                launch_command: Some("lm-studio --server".to_string()),
            })
            .expect("settings update succeeds");
        let settings = manager
            .settings("lm-studio-local")
            .expect("settings should load");

        assert_eq!(status.health, ProviderHealth::Stopped);
        assert_eq!(settings.base_url, "http://127.0.0.1:9999/v1");
        assert_eq!(settings.folder, "/tmp/lm-studio");
        assert_eq!(
            settings.launch_command.as_deref(),
            Some("lm-studio --server")
        );
    }

    #[test]
    fn install_plan_is_dry_run_only() {
        let manager = ProviderManager::seeded();
        let plan = manager
            .install_plan("mlx-lm-local")
            .expect("plan should be available");

        assert!(plan.dry_run);
        assert!(plan
            .commands
            .iter()
            .any(|command| command.contains("mlx-lm")));
        assert!(plan
            .notes
            .iter()
            .any(|note| note.contains("no commands are executed")));
    }
}
