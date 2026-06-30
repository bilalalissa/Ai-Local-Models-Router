use crate::{
    hardware_probe::{load_fixture, HardwareSpecs},
    model_catalog::{CompatibilityLabel, ProviderKind},
    provider_core::{
        ProviderCapability, ProviderChatResponse, ProviderDefinition, ProviderHealth,
        ProviderModel, ProviderStatus,
    },
    router_core::RouteCandidate,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs, UdpSocket},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const LOCAL_AI_ROUTER_MDNS_SERVICE: &str = "_localai-router._tcp";
const DEFAULT_REMOTE_PORT: u16 = 17_640;
const REQUEST_TIMEOUT: Duration = Duration::from_millis(900);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteDiscoverySource {
    MdnsBonjour,
    Manual,
    Fixture,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteClientStatus {
    Discovered,
    Paired,
    Online,
    Offline,
    AuthFailed,
    Paused,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteClientTokenStorage {
    ProtectedAppDataFile,
    BrowserPreviewStorage,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteClientSettings {
    pub discovery_enabled: bool,
    pub include_fixture_discovery: bool,
    pub allow_router_remote_models: bool,
    pub mdns_service: String,
}

impl Default for RemoteClientSettings {
    fn default() -> Self {
        Self {
            discovery_enabled: true,
            include_fixture_discovery: true,
            allow_router_remote_models: true,
            mdns_service: LOCAL_AI_ROUTER_MDNS_SERVICE.to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteDiscoveryResult {
    pub id: String,
    pub name: String,
    pub source: RemoteDiscoverySource,
    pub service_type: String,
    pub address: String,
    pub port: u16,
    pub base_url: String,
    pub discovered_at_ms: u128,
    pub latency_ms: Option<u32>,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteClientDevice {
    pub id: String,
    pub name: String,
    pub source: RemoteDiscoverySource,
    pub base_url: String,
    pub token_fingerprint: String,
    pub status: RemoteClientStatus,
    pub paired_at_ms: u128,
    pub last_seen_ms: Option<u128>,
    pub latency_ms: Option<u32>,
    pub health: Option<Value>,
    pub specs: Option<HardwareSpecs>,
    pub provider_statuses: Vec<ProviderStatus>,
    pub models: Vec<ProviderModel>,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RemoteClientSnapshot {
    pub settings: RemoteClientSettings,
    pub status: RemoteClientStatus,
    pub discovered: Vec<RemoteDiscoveryResult>,
    pub paired_devices: Vec<RemoteClientDevice>,
    pub token_storage: RemoteClientTokenStorage,
    pub route_candidates: Vec<RouteCandidate>,
    pub last_discovery_ms: Option<u128>,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ManualPairRequest {
    pub name: String,
    pub base_url: String,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PairDiscoveredRequest {
    pub discovery_id: String,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteClientChatRequest {
    pub device_id: String,
    pub model_id: String,
    pub prompt: String,
    pub app_paused: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct PersistedRemoteClientState {
    settings: RemoteClientSettings,
    discovered: Vec<RemoteDiscoveryResult>,
    paired_devices: Vec<RemoteClientDevice>,
    last_discovery_ms: Option<u128>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedTokenVault {
    tokens: Vec<PersistedRemoteToken>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedRemoteToken {
    device_id: String,
    token: String,
}

#[derive(Debug)]
pub struct RemoteClientManager {
    state_path: PathBuf,
    token_path: PathBuf,
    settings: RemoteClientSettings,
    discovered: Vec<RemoteDiscoveryResult>,
    paired_devices: Vec<RemoteClientDevice>,
    tokens: Vec<PersistedRemoteToken>,
    last_discovery_ms: Option<u128>,
}

impl RemoteClientManager {
    pub fn load(app_data_dir: PathBuf) -> Result<Self, String> {
        let state_path = remote_client_file_path(&app_data_dir);
        let token_path = remote_client_token_file_path(&app_data_dir);
        let (settings, discovered, paired_devices, last_discovery_ms) = if state_path.exists() {
            let raw = fs::read_to_string(&state_path)
                .map_err(|err| format!("failed to read remote client state: {err}"))?;
            let persisted = serde_json::from_str::<PersistedRemoteClientState>(&raw)
                .map_err(|err| format!("invalid remote client state: {err}"))?;
            (
                persisted.settings,
                persisted.discovered,
                persisted.paired_devices,
                persisted.last_discovery_ms,
            )
        } else {
            (
                RemoteClientSettings::default(),
                Vec::new(),
                Vec::new(),
                None,
            )
        };
        let tokens = if token_path.exists() {
            let raw = fs::read_to_string(&token_path)
                .map_err(|err| format!("failed to read remote client token vault: {err}"))?;
            serde_json::from_str::<PersistedTokenVault>(&raw)
                .map_err(|err| format!("invalid remote client token vault: {err}"))?
                .tokens
        } else {
            Vec::new()
        };

        Ok(Self {
            state_path,
            token_path,
            settings,
            discovered,
            paired_devices,
            tokens,
            last_discovery_ms,
        })
    }

    pub fn snapshot(&self, app_paused: bool) -> RemoteClientSnapshot {
        self.build_snapshot(
            if app_paused {
                RemoteClientStatus::Paused
            } else if self.paired_devices.iter().any(|device| {
                matches!(
                    device.status,
                    RemoteClientStatus::Online | RemoteClientStatus::Paired
                )
            }) {
                RemoteClientStatus::Online
            } else {
                RemoteClientStatus::Discovered
            },
            if app_paused {
                "Remote discovery and refresh are suspended while the app is paused.".to_string()
            } else {
                "Remote client state ready.".to_string()
            },
        )
    }

    pub fn update_settings(
        &mut self,
        settings: RemoteClientSettings,
        app_paused: bool,
    ) -> Result<RemoteClientSnapshot, String> {
        self.settings = settings;
        self.persist_state()?;
        Ok(self.snapshot(app_paused))
    }

    pub fn discover(&mut self, app_paused: bool) -> Result<RemoteClientSnapshot, String> {
        if app_paused {
            return Ok(self.build_snapshot(
                RemoteClientStatus::Paused,
                "Remote discovery is suspended while the app is paused.".to_string(),
            ));
        }
        if !self.settings.discovery_enabled {
            return Ok(self.build_snapshot(
                RemoteClientStatus::Discovered,
                "Remote discovery is disabled in settings.".to_string(),
            ));
        }
        let mut results = discover_mdns(&self.settings.mdns_service);
        if self.settings.include_fixture_discovery {
            results.push(fixture_discovery());
        }
        dedupe_discovery(&mut results);
        self.discovered = results;
        self.last_discovery_ms = Some(now_ms());
        self.persist_state()?;
        Ok(self.build_snapshot(
            RemoteClientStatus::Discovered,
            format!(
                "{} remote broker candidates discovered.",
                self.discovered.len()
            ),
        ))
    }

    pub fn pair_manual(
        &mut self,
        request: ManualPairRequest,
        app_paused: bool,
    ) -> Result<RemoteClientSnapshot, String> {
        if app_paused {
            return Ok(self.build_snapshot(
                RemoteClientStatus::Paused,
                "Remote pairing is suspended while the app is paused.".to_string(),
            ));
        }
        let base_url = normalize_base_url(&request.base_url)?;
        let id = device_id(&request.name, &base_url);
        self.upsert_token(&id, request.token.clone())?;
        let mut device = RemoteClientDevice {
            id: id.clone(),
            name: request.name.trim().to_string(),
            source: RemoteDiscoverySource::Manual,
            base_url,
            token_fingerprint: token_fingerprint(&request.token),
            status: RemoteClientStatus::Paired,
            paired_at_ms: now_ms(),
            last_seen_ms: None,
            latency_ms: None,
            health: None,
            specs: None,
            provider_statuses: Vec::new(),
            models: Vec::new(),
            message: "Manual remote broker paired. Refresh to load specs and models.".to_string(),
        };
        self.refresh_device_snapshot(&mut device, &request.token);
        self.upsert_device(device);
        self.persist_state()?;
        Ok(self.build_snapshot(
            RemoteClientStatus::Paired,
            "Manual remote broker paired.".to_string(),
        ))
    }

    pub fn pair_discovered(
        &mut self,
        request: PairDiscoveredRequest,
        app_paused: bool,
    ) -> Result<RemoteClientSnapshot, String> {
        let discovery = self
            .discovered
            .iter()
            .find(|candidate| candidate.id == request.discovery_id)
            .cloned()
            .ok_or_else(|| format!("unknown discovery result: {}", request.discovery_id))?;
        self.pair_manual(
            ManualPairRequest {
                name: discovery.name,
                base_url: discovery.base_url,
                token: request.token,
            },
            app_paused,
        )
    }

    pub fn refresh_devices(&mut self, app_paused: bool) -> Result<RemoteClientSnapshot, String> {
        if app_paused {
            for device in &mut self.paired_devices {
                device.status = RemoteClientStatus::Paused;
                device.message = "Refresh suspended while the app is paused.".to_string();
            }
            self.persist_state()?;
            return Ok(self.build_snapshot(
                RemoteClientStatus::Paused,
                "Remote device refresh is suspended while the app is paused.".to_string(),
            ));
        }
        let tokens = self.tokens.clone();
        for index in 0..self.paired_devices.len() {
            let device_id = self.paired_devices[index].id.clone();
            let Some(token) = tokens
                .iter()
                .find(|token| token.device_id == device_id)
                .map(|token| token.token.clone())
            else {
                self.paired_devices[index].status = RemoteClientStatus::AuthFailed;
                self.paired_devices[index].message =
                    "No token is available for this remote broker.".to_string();
                continue;
            };
            let mut device = self.paired_devices[index].clone();
            self.refresh_device_snapshot(&mut device, &token);
            self.paired_devices[index] = device;
        }
        self.persist_state()?;
        Ok(self.build_snapshot(
            RemoteClientStatus::Online,
            "Remote device refresh completed.".to_string(),
        ))
    }

    pub fn remove_device(
        &mut self,
        device_id: &str,
        app_paused: bool,
    ) -> Result<RemoteClientSnapshot, String> {
        self.paired_devices.retain(|device| device.id != device_id);
        self.tokens.retain(|token| token.device_id != device_id);
        self.persist_state()?;
        self.persist_tokens()?;
        Ok(self.build_snapshot(
            if app_paused {
                RemoteClientStatus::Paused
            } else {
                RemoteClientStatus::Paired
            },
            "Remote client removed.".to_string(),
        ))
    }

    pub fn route_candidates(&self, app_paused: bool) -> Vec<RouteCandidate> {
        if app_paused || !self.settings.allow_router_remote_models {
            return Vec::new();
        }
        self.paired_devices
            .iter()
            .filter(|device| matches!(device.status, RemoteClientStatus::Online))
            .flat_map(remote_device_route_candidates)
            .collect()
    }

    pub fn chat(
        &mut self,
        request: RemoteClientChatRequest,
    ) -> Result<ProviderChatResponse, String> {
        if request.app_paused {
            return Err("remote chat is suspended while the app is paused".to_string());
        }
        let device = self
            .paired_devices
            .iter()
            .find(|device| device.id == request.device_id)
            .cloned()
            .ok_or_else(|| format!("unknown remote device: {}", request.device_id))?;
        let token = self
            .tokens
            .iter()
            .find(|token| token.device_id == device.id)
            .map(|token| token.token.clone())
            .ok_or_else(|| "no token is available for remote device".to_string())?;
        let started = Instant::now();
        let response = broker_request_json(
            &device.base_url,
            "POST",
            "/v1/chat/completions",
            &token,
            Some(json!({
                "model": request.model_id,
                "messages": [{"role": "user", "content": request.prompt}]
            })),
        )?;
        let latency_ms = elapsed_ms(started);
        let text = response
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("Remote broker returned no message content.")
            .to_string();
        Ok(ProviderChatResponse {
            provider_id: format!("remote-client:{}", device.id),
            model_id: request.model_id,
            response: text,
            tokens_in: 0,
            tokens_out: 0,
            latency_ms,
        })
    }

    fn build_snapshot(&self, status: RemoteClientStatus, message: String) -> RemoteClientSnapshot {
        RemoteClientSnapshot {
            settings: self.settings.clone(),
            status,
            discovered: self.discovered.clone(),
            paired_devices: self.paired_devices.clone(),
            token_storage: RemoteClientTokenStorage::ProtectedAppDataFile,
            route_candidates: self.route_candidates(false),
            last_discovery_ms: self.last_discovery_ms,
            message,
        }
    }

    fn refresh_device_snapshot(&self, device: &mut RemoteClientDevice, token: &str) {
        if device.base_url.starts_with("fixture://") {
            apply_fixture_device_snapshot(device);
            return;
        }
        let started = Instant::now();
        let health = broker_request_json(&device.base_url, "GET", "/api/health", token, None);
        match health {
            Ok(health) => {
                device.health = Some(health);
                device.latency_ms = Some(elapsed_ms(started));
                device.last_seen_ms = Some(now_ms());
                device.status = RemoteClientStatus::Online;
                device.message = "Remote broker is online.".to_string();
                device.specs =
                    broker_request_json(&device.base_url, "GET", "/api/specs", token, None)
                        .ok()
                        .and_then(|value| serde_json::from_value::<HardwareSpecs>(value).ok());
                device.models =
                    broker_request_json(&device.base_url, "GET", "/api/models", token, None)
                        .ok()
                        .and_then(|value| serde_json::from_value::<Vec<ProviderModel>>(value).ok())
                        .unwrap_or_default();
                device.provider_statuses = broker_request_json(
                    &device.base_url,
                    "GET",
                    "/api/provider-status",
                    token,
                    None,
                )
                .ok()
                .and_then(|value| serde_json::from_value::<Vec<ProviderStatus>>(value).ok())
                .unwrap_or_default();
            }
            Err(err) if err.contains("HTTP 401") => {
                device.status = RemoteClientStatus::AuthFailed;
                device.message = "Remote broker rejected the saved token.".to_string();
            }
            Err(err) => {
                device.status = RemoteClientStatus::Offline;
                device.message = format!("Remote broker unavailable: {err}");
            }
        }
    }

    fn upsert_device(&mut self, device: RemoteClientDevice) {
        if let Some(existing) = self
            .paired_devices
            .iter_mut()
            .find(|existing| existing.id == device.id)
        {
            *existing = device;
        } else {
            self.paired_devices.insert(0, device);
        }
    }

    fn upsert_token(&mut self, device_id: &str, token: String) -> Result<(), String> {
        if let Some(existing) = self
            .tokens
            .iter_mut()
            .find(|existing| existing.device_id == device_id)
        {
            existing.token = token;
        } else {
            self.tokens.push(PersistedRemoteToken {
                device_id: device_id.to_string(),
                token,
            });
        }
        self.persist_tokens()
    }

    fn persist_state(&self) -> Result<(), String> {
        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create remote client state directory: {err}"))?;
        }
        let raw = serde_json::to_string_pretty(&PersistedRemoteClientState {
            settings: self.settings.clone(),
            discovered: self.discovered.clone(),
            paired_devices: self.paired_devices.clone(),
            last_discovery_ms: self.last_discovery_ms,
        })
        .map_err(|err| format!("failed to serialize remote client state: {err}"))?;
        fs::write(&self.state_path, raw)
            .map_err(|err| format!("failed to persist remote client state: {err}"))
    }

    fn persist_tokens(&self) -> Result<(), String> {
        if let Some(parent) = self.token_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create remote client token directory: {err}"))?;
        }
        let raw = serde_json::to_string_pretty(&PersistedTokenVault {
            tokens: self.tokens.clone(),
        })
        .map_err(|err| format!("failed to serialize remote client token vault: {err}"))?;
        fs::write(&self.token_path, raw)
            .map_err(|err| format!("failed to persist remote client token vault: {err}"))?;
        protect_token_file(&self.token_path)
    }
}

pub fn remote_client_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("remote_client_state.json")
}

pub fn remote_client_token_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("remote_client_tokens.json")
}

fn discover_mdns(service_type: &str) -> Vec<RemoteDiscoveryResult> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        return Vec::new();
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(350)));
    let query = mdns_query_packet(service_type);
    let _ = socket.send_to(&query, "224.0.0.251:5353");
    let started = Instant::now();
    let mut results = Vec::new();
    while started.elapsed() < Duration::from_millis(450) {
        let mut buffer = [0_u8; 1500];
        match socket.recv_from(&mut buffer) {
            Ok((len, _)) => results.extend(parse_mdns_response(service_type, &buffer[..len])),
            Err(_) => break,
        }
    }
    results
}

fn mdns_query_packet(service_type: &str) -> Vec<u8> {
    let mut packet = vec![
        0, 0, // transaction id
        0, 0, // flags
        0, 1, // questions
        0, 0, // answers
        0, 0, // authorities
        0, 0, // additionals
    ];
    for label in service_type.split('.').filter(|label| !label.is_empty()) {
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    packet.push(5);
    packet.extend_from_slice(b"local");
    packet.push(0);
    packet.extend_from_slice(&[0, 12, 0, 1]); // PTR IN
    packet
}

fn parse_mdns_response(service_type: &str, packet: &[u8]) -> Vec<RemoteDiscoveryResult> {
    if packet.len() < 12 {
        return Vec::new();
    }
    let answer_count = u16::from_be_bytes([packet[6], packet[7]]) as usize;
    let mut offset = 12;
    let question_count = u16::from_be_bytes([packet[4], packet[5]]) as usize;
    for _ in 0..question_count {
        if read_dns_name(packet, &mut offset).is_none() || offset + 4 > packet.len() {
            return Vec::new();
        }
        offset += 4;
    }
    let mut results = Vec::new();
    for index in 0..answer_count {
        let Some(name) = read_dns_name(packet, &mut offset) else {
            break;
        };
        if offset + 10 > packet.len() {
            break;
        }
        let record_type = u16::from_be_bytes([packet[offset], packet[offset + 1]]);
        let data_len = u16::from_be_bytes([packet[offset + 8], packet[offset + 9]]) as usize;
        offset += 10;
        if offset + data_len > packet.len() {
            break;
        }
        if record_type == 12 && name.contains(service_type) {
            let mut data_offset = offset;
            if let Some(target) = read_dns_name(packet, &mut data_offset) {
                let host = target.trim_end_matches(".local").replace(' ', "-");
                results.push(RemoteDiscoveryResult {
                    id: format!("mdns-{index}-{}", stable_id(&target)),
                    name: target.trim_end_matches('.').to_string(),
                    source: RemoteDiscoverySource::MdnsBonjour,
                    service_type: service_type.to_string(),
                    address: format!("{host}.local"),
                    port: DEFAULT_REMOTE_PORT,
                    base_url: format!("http://{host}.local:{DEFAULT_REMOTE_PORT}"),
                    discovered_at_ms: now_ms(),
                    latency_ms: None,
                    message: "Discovered from Bonjour service response.".to_string(),
                });
            }
        }
        offset += data_len;
    }
    results
}

fn read_dns_name(packet: &[u8], offset: &mut usize) -> Option<String> {
    let mut labels = Vec::new();
    let mut cursor = *offset;
    let mut jumped = false;
    for _ in 0..32 {
        let len = *packet.get(cursor)?;
        if len & 0b1100_0000 == 0b1100_0000 {
            let next = *packet.get(cursor + 1)?;
            let pointer = (((len & 0b0011_1111) as usize) << 8) | next as usize;
            if !jumped {
                *offset = cursor + 2;
            }
            cursor = pointer;
            jumped = true;
            continue;
        }
        cursor += 1;
        if len == 0 {
            if !jumped {
                *offset = cursor;
            }
            return Some(labels.join("."));
        }
        let end = cursor + len as usize;
        let label = std::str::from_utf8(packet.get(cursor..end)?).ok()?;
        labels.push(label.to_string());
        cursor = end;
    }
    None
}

fn fixture_discovery() -> RemoteDiscoveryResult {
    RemoteDiscoveryResult {
        id: "fixture-studio-win11".to_string(),
        name: "Studio-Win11 Broker".to_string(),
        source: RemoteDiscoverySource::Fixture,
        service_type: LOCAL_AI_ROUTER_MDNS_SERVICE.to_string(),
        address: "192.168.1.50".to_string(),
        port: DEFAULT_REMOTE_PORT,
        base_url: "fixture://studio-win11".to_string(),
        discovered_at_ms: now_ms(),
        latency_ms: Some(24),
        message: "Fixture remote broker used for Stage 12 tests and browser preview.".to_string(),
    }
}

fn apply_fixture_device_snapshot(device: &mut RemoteClientDevice) {
    let specs = load_fixture("windows-gtx-1060-30gb").ok();
    device.status = RemoteClientStatus::Online;
    device.last_seen_ms = Some(now_ms());
    device.latency_ms = Some(42);
    device.health = Some(json!({
        "status": "ok",
        "broker": "Local AI Router Windows remote provider broker",
        "fixture": true
    }));
    device.specs = specs;
    device.provider_statuses = vec![fixture_provider_status()];
    device.models = vec![
        ProviderModel {
            id: "llama-3-1-8b-q4".to_string(),
            display_name: "Llama 3.1 8B Instruct Q4".to_string(),
            format: "GGUF / OpenAI-compatible".to_string(),
            size_bytes: 5_368_709_120,
            installed: true,
            supports_chat: true,
        },
        ProviderModel {
            id: "qwen2-5-14b-q4".to_string(),
            display_name: "Qwen2.5 14B Instruct Q4".to_string(),
            format: "GGUF / OpenAI-compatible".to_string(),
            size_bytes: 9_663_676_416,
            installed: true,
            supports_chat: true,
        },
    ];
    device.message = "Fixture Windows broker is online.".to_string();
}

fn fixture_provider_status() -> ProviderStatus {
    ProviderStatus {
        definition: ProviderDefinition {
            id: "remote-openai-compatible".to_string(),
            name: "Remote OpenAI-compatible Broker".to_string(),
            kind: ProviderKind::OpenAiCompatible,
            base_url: "fixture://studio-win11/v1".to_string(),
            folder: "Remote Windows broker".to_string(),
            capabilities: vec![
                ProviderCapability::Health,
                ProviderCapability::ListModels,
                ProviderCapability::Chat,
                ProviderCapability::StreamingChat,
            ],
        },
        health: ProviderHealth::Healthy,
        running: true,
        paused: false,
        model_count: 2,
        active_model: Some("Qwen2.5 14B Instruct Q4".to_string()),
        latency_ms: Some(42),
        last_checked_ms: now_ms(),
        message: "Remote broker fixture healthy.".to_string(),
    }
}

fn remote_device_route_candidates(device: &RemoteClientDevice) -> Vec<RouteCandidate> {
    device
        .models
        .iter()
        .filter(|model| model.supports_chat)
        .map(|model| {
            let latency = device.latency_ms.unwrap_or(250);
            let score = if latency <= 80 {
                90
            } else if latency <= 180 {
                84
            } else {
                74
            };
            RouteCandidate {
                model_id: model.id.clone(),
                model_name: model.display_name.clone(),
                provider: ProviderKind::OpenAiCompatible,
                provider_id: format!("remote-client:{}", device.id),
                provider_name: format!("Remote: {}", device.name),
                score,
                label: if score >= 88 {
                    CompatibilityLabel::Smooth
                } else if score >= 80 {
                    CompatibilityLabel::Good
                } else {
                    CompatibilityLabel::Tight
                },
                latency_ms: Some(latency),
                installed: model.installed,
                reasons: vec![
                    "Remote Windows broker is paired and online.".to_string(),
                    "Remote models are allowed for Apple Silicon and Intel Mac clients."
                        .to_string(),
                ],
                blockers: Vec::new(),
            }
        })
        .collect()
}

fn broker_request_json(
    base_url: &str,
    method: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    if base_url.starts_with("fixture://") {
        return fixture_response(method, path, body);
    }
    let parsed = parse_http_base_url(base_url)?;
    let address = format!("{}:{}", parsed.host, parsed.port);
    let mut addrs = address
        .to_socket_addrs()
        .map_err(|err| format!("failed to resolve remote broker {address}: {err}"))?;
    let addr = addrs
        .next()
        .ok_or_else(|| format!("remote broker address did not resolve: {address}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, REQUEST_TIMEOUT)
        .map_err(|err| format!("failed to connect to remote broker: {err}"))?;
    stream
        .set_read_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|err| format!("failed to set remote broker read timeout: {err}"))?;
    stream
        .set_write_timeout(Some(REQUEST_TIMEOUT))
        .map_err(|err| format!("failed to set remote broker write timeout: {err}"))?;
    let body_raw = body.map(|value| value.to_string()).unwrap_or_default();
    let request_path = format!("{}{}", parsed.prefix, path);
    let request = format!(
        "{method} {request_path} HTTP/1.1\r\nhost: {}\r\nauthorization: Bearer {token}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        parsed.host,
        body_raw.len(),
        body_raw
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("failed to write remote broker request: {err}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| format!("failed to read remote broker response: {err}"))?;
    parse_http_json_response(&response)
}

fn fixture_response(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    match (method, path) {
        ("GET", "/api/health") => Ok(json!({"status": "ok", "broker": "fixture"})),
        ("GET", "/api/specs") => Ok(serde_json::to_value(
            load_fixture("windows-gtx-1060-30gb").map_err(|err| err.to_string())?,
        )
        .map_err(|err| format!("failed to serialize fixture specs: {err}"))?),
        ("GET", "/api/provider-status") => Ok(json!([fixture_provider_status()])),
        ("GET", "/api/models") => Ok(json!([
            {
                "id": "llama-3-1-8b-q4",
                "display_name": "Llama 3.1 8B Instruct Q4",
                "format": "GGUF / OpenAI-compatible",
                "size_bytes": 5368709120u64,
                "installed": true,
                "supports_chat": true
            },
            {
                "id": "qwen2-5-14b-q4",
                "display_name": "Qwen2.5 14B Instruct Q4",
                "format": "GGUF / OpenAI-compatible",
                "size_bytes": 9663676416u64,
                "installed": true,
                "supports_chat": true
            }
        ])),
        ("POST", "/v1/chat/completions") => {
            let model = body
                .as_ref()
                .and_then(|body| body.get("model"))
                .and_then(Value::as_str)
                .unwrap_or("remote-model");
            Ok(json!({
                "choices": [{
                    "message": {
                        "content": format!("Fixture remote broker answered with {model}.")
                    }
                }]
            }))
        }
        _ => Err(format!("unknown fixture endpoint: {method} {path}")),
    }
}

#[derive(Debug)]
struct ParsedBaseUrl {
    host: String,
    port: u16,
    prefix: String,
}

fn parse_http_base_url(base_url: &str) -> Result<ParsedBaseUrl, String> {
    let without_scheme = base_url
        .strip_prefix("http://")
        .ok_or_else(|| "remote broker base URL must start with http://".to_string())?;
    let (authority, prefix) = without_scheme
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((without_scheme, String::new()));
    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
        .unwrap_or((authority, 80));
    Ok(ParsedBaseUrl {
        host: host.to_string(),
        port,
        prefix,
    })
}

fn parse_http_json_response(response: &str) -> Result<Value, String> {
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "remote broker response was not valid HTTP".to_string())?;
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "remote broker response had no HTTP status".to_string())?;
    if status_code >= 400 {
        return Err(format!("HTTP {status_code}: {body}"));
    }
    serde_json::from_str(body).map_err(|err| format!("remote broker JSON parse failed: {err}"))
}

fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.starts_with("fixture://") {
        return Ok(trimmed.to_string());
    }
    if !trimmed.starts_with("http://") {
        return Err("remote broker URL must start with http://".to_string());
    }
    Ok(trimmed.to_string())
}

fn dedupe_discovery(results: &mut Vec<RemoteDiscoveryResult>) {
    let mut seen = Vec::<String>::new();
    results.retain(|result| {
        if seen.contains(&result.base_url) {
            false
        } else {
            seen.push(result.base_url.clone());
            true
        }
    });
}

fn device_id(name: &str, base_url: &str) -> String {
    format!("{}-{}", slug(name), stable_id(base_url))
}

fn slug(value: &str) -> String {
    value
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() {
                Some(ch.to_ascii_lowercase())
            } else if ch.is_whitespace() || ch == '-' || ch == '_' {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn stable_id(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn token_fingerprint(token: &str) -> String {
    let hash = stable_id(token);
    format!("{}...{}", &hash[..6], &hash[hash.len() - 4..])
}

fn protect_token_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions)
            .map_err(|err| format!("failed to protect remote client token vault: {err}"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn elapsed_ms(started: Instant) -> u32 {
    started.elapsed().as_millis().try_into().unwrap_or(u32::MAX)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
impl RemoteClientManager {
    fn new_for_test(path: PathBuf) -> Self {
        Self {
            state_path: path.join("remote_client_state.json"),
            token_path: path.join("remote_client_tokens.json"),
            settings: RemoteClientSettings::default(),
            discovered: Vec::new(),
            paired_devices: Vec::new(),
            tokens: Vec::new(),
            last_discovery_ms: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("local-ai-router-remote-client-{name}-{}", now_ms()))
    }

    #[test]
    fn fixture_discovery_uses_bonjour_service_name() {
        let mut manager = RemoteClientManager::new_for_test(temp_dir("discover"));
        let snapshot = manager.discover(false).expect("discover");

        assert!(snapshot
            .discovered
            .iter()
            .any(|result| result.service_type == LOCAL_AI_ROUTER_MDNS_SERVICE));
        assert!(snapshot
            .discovered
            .iter()
            .any(|result| result.source == RemoteDiscoverySource::Fixture));
    }

    #[test]
    fn manual_pair_stores_token_outside_snapshot_and_loads_remote_fixture() {
        let dir = temp_dir("pair");
        let mut manager = RemoteClientManager::new_for_test(dir.clone());
        let snapshot = manager
            .pair_manual(
                ManualPairRequest {
                    name: "Studio Win11".to_string(),
                    base_url: "fixture://studio-win11".to_string(),
                    token: "lar_test_token".to_string(),
                },
                false,
            )
            .expect("pair");

        assert_eq!(snapshot.paired_devices.len(), 1);
        assert_eq!(
            snapshot.paired_devices[0].status,
            RemoteClientStatus::Online
        );
        assert!(!serde_json::to_string(&snapshot)
            .expect("serialize snapshot")
            .contains("lar_test_token"));
        assert!(manager.token_path.exists());
    }

    #[test]
    fn route_candidates_are_available_for_online_remote_models() {
        let mut manager = RemoteClientManager::new_for_test(temp_dir("routes"));
        manager
            .pair_manual(
                ManualPairRequest {
                    name: "Studio Win11".to_string(),
                    base_url: "fixture://studio-win11".to_string(),
                    token: "lar_test_token".to_string(),
                },
                false,
            )
            .expect("pair");

        let candidates = manager.route_candidates(false);
        assert!(candidates
            .iter()
            .any(|candidate| candidate.provider_id.starts_with("remote-client:")));
    }

    #[test]
    fn pause_suspends_discovery_refresh_and_chat() {
        let mut manager = RemoteClientManager::new_for_test(temp_dir("pause"));
        let snapshot = manager.discover(true).expect("paused discover");
        assert_eq!(snapshot.status, RemoteClientStatus::Paused);
        let err = manager
            .chat(RemoteClientChatRequest {
                device_id: "missing".to_string(),
                model_id: "model".to_string(),
                prompt: "hello".to_string(),
                app_paused: true,
            })
            .expect_err("paused chat fails");
        assert!(err.contains("suspended"));
    }

    #[test]
    fn fixture_remote_chat_returns_provider_response() {
        let mut manager = RemoteClientManager::new_for_test(temp_dir("chat"));
        manager
            .pair_manual(
                ManualPairRequest {
                    name: "Studio Win11".to_string(),
                    base_url: "fixture://studio-win11".to_string(),
                    token: "lar_test_token".to_string(),
                },
                false,
            )
            .expect("pair");
        let device_id = manager.paired_devices[0].id.clone();
        let response = manager
            .chat(RemoteClientChatRequest {
                device_id,
                model_id: "qwen2-5-14b-q4".to_string(),
                prompt: "hello".to_string(),
                app_paused: false,
            })
            .expect("chat");
        assert!(response.response.contains("Fixture remote broker answered"));
    }
}
