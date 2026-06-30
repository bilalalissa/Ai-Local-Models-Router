use crate::{
    hardware_probe::HardwareSpecs,
    provider_core::{ProviderModel, ProviderStatus},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DEFAULT_BROKER_PORT: u16 = 17_640;
const PAIRING_TTL_MS: u128 = 10 * 60 * 1_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteBrokerPlatform {
    WindowsX64,
    NonWindowsPreview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoteBrokerStatus {
    Stopped,
    Running,
    SharingDisabled,
    PlatformBlocked,
    PausedOnline,
    PausedRejectingRequests,
    StoppedByPause,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum BrokerPausePolicy {
    KeepOnline,
    RejectNewRequests,
    StopUntilResume,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteBrokerSettings {
    pub lan_sharing_enabled: bool,
    pub bind_host: String,
    pub port: u16,
    pub advertise_mdns: bool,
    pub require_bearer_token: bool,
    pub pause_policy: BrokerPausePolicy,
}

impl Default for RemoteBrokerSettings {
    fn default() -> Self {
        Self {
            lan_sharing_enabled: false,
            bind_host: "127.0.0.1".to_string(),
            port: DEFAULT_BROKER_PORT,
            advertise_mdns: false,
            require_bearer_token: true,
            pause_policy: BrokerPausePolicy::RejectNewRequests,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteBrokerEndpoint {
    pub method: String,
    pub path: String,
    pub auth_required: bool,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PairingSessionStatus {
    Active,
    Consumed,
    Expired,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PairingSession {
    pub id: String,
    pub code: String,
    pub created_at_ms: u128,
    pub expires_at_ms: u128,
    pub status: PairingSessionStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteDevice {
    pub id: String,
    pub name: String,
    pub address: String,
    pub token_fingerprint: String,
    pub connected_at_ms: u128,
    pub last_seen_ms: u128,
    pub revoked: bool,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PairingStartResult {
    pub snapshot: RemoteBrokerSnapshot,
    pub session: PairingSession,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RegisterPairingRequest {
    pub code: String,
    pub client_name: String,
    pub address: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PairingRegistration {
    pub snapshot: RemoteBrokerSnapshot,
    pub device: RemoteDevice,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BrokerEndpointRequest {
    pub method: String,
    pub path: String,
    pub bearer_token: Option<String>,
    pub body: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BrokerEndpointResponse {
    pub status_code: u16,
    pub body: Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RemoteBrokerSnapshot {
    pub platform: RemoteBrokerPlatform,
    pub status: RemoteBrokerStatus,
    pub settings: RemoteBrokerSettings,
    pub endpoints: Vec<RemoteBrokerEndpoint>,
    pub connected_clients: Vec<RemoteDevice>,
    pub pairing_sessions: Vec<PairingSession>,
    pub firewall_guidance: Vec<String>,
    pub security_warnings: Vec<String>,
    pub listen_url: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedRemoteBrokerState {
    settings: RemoteBrokerSettings,
    running_requested: bool,
    clients: Vec<PersistedRemoteDevice>,
    pairing_sessions: Vec<PairingSession>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct PersistedRemoteDevice {
    device: RemoteDevice,
    token_hash: String,
}

pub struct RemoteBrokerManager {
    path: PathBuf,
    platform: RemoteBrokerPlatform,
    settings: RemoteBrokerSettings,
    running_requested: bool,
    clients: Vec<PersistedRemoteDevice>,
    pairing_sessions: Vec<PairingSession>,
    server: Option<BrokerServerHandle>,
}

impl RemoteBrokerManager {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let platform = current_platform();
        if path.exists() {
            let raw = fs::read_to_string(&path)
                .map_err(|err| format!("failed to read remote broker state: {err}"))?;
            let persisted = serde_json::from_str::<PersistedRemoteBrokerState>(&raw)
                .map_err(|err| format!("invalid remote broker state: {err}"))?;
            return Ok(Self {
                path,
                platform,
                settings: persisted.settings,
                running_requested: persisted.running_requested,
                clients: persisted.clients,
                pairing_sessions: persisted.pairing_sessions,
                server: None,
            });
        }

        Ok(Self {
            path,
            platform,
            settings: RemoteBrokerSettings::default(),
            running_requested: false,
            clients: Vec::new(),
            pairing_sessions: Vec::new(),
            server: None,
        })
    }

    pub fn snapshot(&mut self, app_paused: bool) -> RemoteBrokerSnapshot {
        self.expire_pairing_sessions();
        self.build_snapshot(app_paused)
    }

    pub fn update_settings(
        &mut self,
        settings: RemoteBrokerSettings,
        app_paused: bool,
    ) -> Result<RemoteBrokerSnapshot, String> {
        validate_settings(&settings)?;
        self.settings = settings;
        if !self.settings.lan_sharing_enabled {
            self.running_requested = false;
            self.stop_server();
        } else if self.running_requested {
            self.running_requested = false;
            self.stop_server();
        }
        self.persist()?;
        Ok(self.snapshot(app_paused))
    }

    pub fn start(
        &mut self,
        app_paused: bool,
        data: BrokerEndpointData,
    ) -> Result<RemoteBrokerSnapshot, String> {
        if self.platform != RemoteBrokerPlatform::WindowsX64 {
            self.running_requested = false;
            self.stop_server();
            self.persist()?;
            return Ok(self.snapshot(app_paused));
        }
        if !self.settings.lan_sharing_enabled {
            self.running_requested = false;
            self.stop_server();
            self.persist()?;
            return Ok(self.snapshot(app_paused));
        }
        self.stop_server();
        self.server = Some(BrokerServerHandle::start(
            self.settings.clone(),
            app_paused,
            self.server_clients(),
            data,
        )?);
        self.running_requested = true;
        self.persist()?;
        Ok(self.snapshot(app_paused))
    }

    pub fn stop(&mut self, app_paused: bool) -> Result<RemoteBrokerSnapshot, String> {
        self.running_requested = false;
        self.stop_server();
        self.persist()?;
        Ok(self.snapshot(app_paused))
    }

    pub fn update_pause_state(&mut self, app_paused: bool) {
        if let Some(server) = &self.server {
            server.update_pause_state(app_paused);
        }
    }

    pub fn create_pairing_code(&mut self, app_paused: bool) -> Result<PairingStartResult, String> {
        if self.effective_status(app_paused) != RemoteBrokerStatus::Running
            && self.effective_status(app_paused) != RemoteBrokerStatus::PausedOnline
        {
            return Err("broker must be running before pairing clients".to_string());
        }
        let created_at_ms = now_ms();
        let session = PairingSession {
            id: format!(
                "pairing-{created_at_ms}-{}",
                self.pairing_sessions.len() + 1
            ),
            code: pairing_code(created_at_ms, self.pairing_sessions.len()),
            created_at_ms,
            expires_at_ms: created_at_ms + PAIRING_TTL_MS,
            status: PairingSessionStatus::Active,
        };
        self.pairing_sessions.insert(0, session.clone());
        self.pairing_sessions.truncate(8);
        self.persist()?;
        Ok(PairingStartResult {
            snapshot: self.snapshot(app_paused),
            session,
        })
    }

    pub fn register_pairing_client(
        &mut self,
        request: RegisterPairingRequest,
        app_paused: bool,
    ) -> Result<PairingRegistration, String> {
        self.expire_pairing_sessions();
        if self.effective_status(app_paused) == RemoteBrokerStatus::PausedRejectingRequests {
            return Err("broker is rejecting new requests while paused".to_string());
        }
        let session = self
            .pairing_sessions
            .iter_mut()
            .find(|session| {
                session.code == request.code && session.status == PairingSessionStatus::Active
            })
            .ok_or_else(|| "pairing code is invalid or expired".to_string())?;
        session.status = PairingSessionStatus::Consumed;
        let token = device_token(
            session.created_at_ms,
            &request.client_name,
            self.clients.len(),
        );
        let token_hash = token_hash(&token);
        let now = now_ms();
        let device = RemoteDevice {
            id: format!("remote-client-{now}-{}", self.clients.len() + 1),
            name: request.client_name,
            address: request.address,
            token_fingerprint: fingerprint(&token_hash),
            connected_at_ms: now,
            last_seen_ms: now,
            revoked: false,
            scopes: vec![
                "health".to_string(),
                "specs".to_string(),
                "models".to_string(),
                "provider-status".to_string(),
                "chat".to_string(),
            ],
        };
        self.clients.insert(
            0,
            PersistedRemoteDevice {
                device: device.clone(),
                token_hash,
            },
        );
        self.refresh_server_state(app_paused);
        self.persist()?;
        Ok(PairingRegistration {
            snapshot: self.snapshot(app_paused),
            device,
            token,
        })
    }

    pub fn revoke_client(
        &mut self,
        client_id: &str,
        app_paused: bool,
    ) -> Result<RemoteBrokerSnapshot, String> {
        let client = self
            .clients
            .iter_mut()
            .find(|client| client.device.id == client_id)
            .ok_or_else(|| format!("unknown remote client: {client_id}"))?;
        client.device.revoked = true;
        self.refresh_server_state(app_paused);
        self.persist()?;
        Ok(self.snapshot(app_paused))
    }

    pub fn preview_endpoint(
        &mut self,
        request: BrokerEndpointRequest,
        app_paused: bool,
        data: BrokerEndpointData,
    ) -> BrokerEndpointResponse {
        self.expire_pairing_sessions();
        let response = endpoint_response(
            &self.settings,
            self.effective_status(app_paused),
            &self.server_clients(),
            data,
            request.clone(),
        );
        if response.status_code == 200 {
            let _ = self.authorize(request.bearer_token.as_deref());
        }
        response
    }

    fn authorize(&mut self, token: Option<&str>) -> bool {
        let Some(token) = token else {
            return false;
        };
        let hash = token_hash(token);
        let now = now_ms();
        if let Some(client) = self
            .clients
            .iter_mut()
            .find(|client| client.token_hash == hash && !client.device.revoked)
        {
            client.device.last_seen_ms = now;
            let _ = self.persist();
            return true;
        }
        false
    }

    fn build_snapshot(&self, app_paused: bool) -> RemoteBrokerSnapshot {
        let status = self.effective_status(app_paused);
        RemoteBrokerSnapshot {
            platform: self.platform.clone(),
            status: status.clone(),
            settings: self.settings.clone(),
            endpoints: broker_endpoints(),
            connected_clients: self
                .clients
                .iter()
                .map(|client| client.device.clone())
                .collect(),
            pairing_sessions: self.pairing_sessions.clone(),
            firewall_guidance: firewall_guidance(&self.settings, &self.platform),
            security_warnings: security_warnings(&self.settings),
            listen_url: if matches!(
                status,
                RemoteBrokerStatus::Running | RemoteBrokerStatus::PausedOnline
            ) {
                self.server
                    .as_ref()
                    .map(|server| server.listen_url.clone())
                    .or_else(|| {
                        Some(format!(
                            "http://{}:{}",
                            visible_bind_host(&self.settings.bind_host),
                            self.settings.port
                        ))
                    })
            } else {
                None
            },
            message: broker_message(&status, &self.platform, &self.settings),
        }
    }

    fn effective_status(&self, app_paused: bool) -> RemoteBrokerStatus {
        if self.platform != RemoteBrokerPlatform::WindowsX64 {
            return RemoteBrokerStatus::PlatformBlocked;
        }
        if !self.settings.lan_sharing_enabled {
            return RemoteBrokerStatus::SharingDisabled;
        }
        if !self.running_requested {
            return RemoteBrokerStatus::Stopped;
        }
        if app_paused {
            return match self.settings.pause_policy {
                BrokerPausePolicy::KeepOnline => RemoteBrokerStatus::PausedOnline,
                BrokerPausePolicy::RejectNewRequests => RemoteBrokerStatus::PausedRejectingRequests,
                BrokerPausePolicy::StopUntilResume => RemoteBrokerStatus::StoppedByPause,
            };
        }
        RemoteBrokerStatus::Running
    }

    fn refresh_server_state(&self, app_paused: bool) {
        if let Some(server) = &self.server {
            server.update_clients(self.server_clients());
            server.update_pause_state(app_paused);
        }
    }

    fn server_clients(&self) -> Vec<BrokerServerClient> {
        self.clients
            .iter()
            .map(|client| BrokerServerClient {
                token_hash: client.token_hash.clone(),
                revoked: client.device.revoked,
            })
            .collect()
    }

    fn stop_server(&mut self) {
        if let Some(mut server) = self.server.take() {
            server.stop();
        }
    }

    fn expire_pairing_sessions(&mut self) {
        let now = now_ms();
        for session in &mut self.pairing_sessions {
            if session.status == PairingSessionStatus::Active && session.expires_at_ms <= now {
                session.status = PairingSessionStatus::Expired;
            }
        }
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create remote broker state directory: {err}"))?;
        }
        let persisted = PersistedRemoteBrokerState {
            settings: self.settings.clone(),
            running_requested: self.running_requested,
            clients: self.clients.clone(),
            pairing_sessions: self.pairing_sessions.clone(),
        };
        let raw = serde_json::to_string_pretty(&persisted)
            .map_err(|err| format!("failed to serialize remote broker state: {err}"))?;
        fs::write(&self.path, raw)
            .map_err(|err| format!("failed to persist remote broker state: {err}"))
    }
}

#[derive(Clone, Debug)]
pub struct BrokerEndpointData {
    pub hardware: HardwareSpecs,
    pub provider_statuses: Vec<ProviderStatus>,
    pub models: Vec<ProviderModel>,
}

pub fn remote_broker_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("remote_broker_state.json")
}

pub fn broker_endpoints() -> Vec<RemoteBrokerEndpoint> {
    vec![
        endpoint("GET", "/api/health", "Broker health and pause status."),
        endpoint("GET", "/api/specs", "Windows host hardware specs."),
        endpoint("GET", "/api/models", "Flattened provider model list."),
        endpoint(
            "GET",
            "/api/provider-status",
            "Provider health, active model, and latency.",
        ),
        endpoint("GET", "/v1/models", "OpenAI-compatible model list."),
        endpoint(
            "POST",
            "/v1/chat/completions",
            "Authenticated OpenAI-compatible chat proxy.",
        ),
    ]
}

fn endpoint(method: &str, path: &str, description: &str) -> RemoteBrokerEndpoint {
    RemoteBrokerEndpoint {
        method: method.to_string(),
        path: path.to_string(),
        auth_required: true,
        description: description.to_string(),
    }
}

#[derive(Clone, Debug)]
struct BrokerServerClient {
    token_hash: String,
    revoked: bool,
}

#[derive(Clone, Debug)]
struct BrokerServerState {
    settings: RemoteBrokerSettings,
    app_paused: bool,
    clients: Vec<BrokerServerClient>,
    data: BrokerEndpointData,
}

struct BrokerServerHandle {
    shutdown: Arc<AtomicBool>,
    state: Arc<StdMutex<BrokerServerState>>,
    thread: Option<JoinHandle<()>>,
    listen_url: String,
}

impl BrokerServerHandle {
    fn start(
        settings: RemoteBrokerSettings,
        app_paused: bool,
        clients: Vec<BrokerServerClient>,
        data: BrokerEndpointData,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind((settings.bind_host.as_str(), settings.port))
            .map_err(|err| format!("failed to bind remote broker listener: {err}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|err| format!("failed to configure remote broker listener: {err}"))?;
        let local_addr = listener
            .local_addr()
            .map_err(|err| format!("failed to read broker listener address: {err}"))?;
        let listen_url = format!(
            "http://{}:{}",
            visible_bind_host(&local_addr.ip().to_string()),
            local_addr.port()
        );
        let shutdown = Arc::new(AtomicBool::new(false));
        let state = Arc::new(StdMutex::new(BrokerServerState {
            settings,
            app_paused,
            clients,
            data,
        }));
        let thread_shutdown = Arc::clone(&shutdown);
        let thread_state = Arc::clone(&state);
        let thread = thread::spawn(move || {
            while !thread_shutdown.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => handle_stream(stream, &thread_state),
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            shutdown,
            state,
            thread: Some(thread),
            listen_url,
        })
    }

    fn update_pause_state(&self, app_paused: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.app_paused = app_paused;
        }
    }

    fn update_clients(&self, clients: Vec<BrokerServerClient>) {
        if let Ok(mut state) = self.state.lock() {
            state.clients = clients;
        }
    }

    fn stop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(self.listen_url.trim_start_matches("http://"));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for BrokerServerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handle_stream(mut stream: TcpStream, state: &Arc<StdMutex<BrokerServerState>>) {
    let mut buffer = [0_u8; 16_384];
    let Ok(read) = stream.read(&mut buffer) else {
        return;
    };
    if read == 0 {
        return;
    }
    let raw = String::from_utf8_lossy(&buffer[..read]);
    let request = parse_http_request(&raw);
    let response = match (request, state.lock()) {
        (Some(request), Ok(state)) => endpoint_response(
            &state.settings,
            effective_status_from_settings(&state.settings, true, state.app_paused),
            &state.clients,
            state.data.clone(),
            request,
        ),
        _ => json_response(
            400,
            json!({"error": "bad_request", "message": "Broker could not parse the request."}),
        ),
    };
    let _ = write_http_response(&mut stream, response);
}

fn parse_http_request(raw: &str) -> Option<BrokerEndpointRequest> {
    let mut lines = raw.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.split('?').next()?.to_string();
    let mut bearer_token = None;
    for line in lines.by_ref() {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("authorization") {
            bearer_token = value
                .trim()
                .strip_prefix("Bearer ")
                .map(|token| token.to_string());
        }
    }
    let body = raw
        .split("\r\n\r\n")
        .nth(1)
        .filter(|body| !body.trim().is_empty())
        .and_then(|body| serde_json::from_str::<Value>(body).ok());
    Some(BrokerEndpointRequest {
        method,
        path,
        bearer_token,
        body,
    })
}

fn write_http_response(
    stream: &mut TcpStream,
    response: BrokerEndpointResponse,
) -> Result<(), String> {
    let body = serde_json::to_vec(&response.body)
        .map_err(|err| format!("failed to serialize broker response: {err}"))?;
    let status_text = match response.status_code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        423 => "Locked",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let headers = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        response.status_code,
        status_text,
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(&body))
        .map_err(|err| format!("failed to write broker response: {err}"))
}

fn endpoint_response(
    settings: &RemoteBrokerSettings,
    status: RemoteBrokerStatus,
    clients: &[BrokerServerClient],
    data: BrokerEndpointData,
    request: BrokerEndpointRequest,
) -> BrokerEndpointResponse {
    match status {
        RemoteBrokerStatus::Running | RemoteBrokerStatus::PausedOnline => {}
        RemoteBrokerStatus::PausedRejectingRequests => {
            return json_response(
                423,
                json!({"error": "broker_paused", "message": "Broker is rejecting new requests while paused."}),
            );
        }
        status => {
            return json_response(
                503,
                json!({"error": "broker_unavailable", "status": status}),
            );
        }
    }
    if settings.require_bearer_token && !server_authorize(clients, request.bearer_token.as_deref())
    {
        return json_response(
            401,
            json!({"error": "unauthorized", "message": "A paired client bearer token is required."}),
        );
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/health") => json_response(
            200,
            json!({
                "status": "ok",
                "broker": "Local AI Router Windows remote provider broker",
                "paused": matches!(status, RemoteBrokerStatus::PausedOnline),
                "clients": clients.iter().filter(|client| !client.revoked).count()
            }),
        ),
        ("GET", "/api/specs") => json_response(200, json!(data.hardware)),
        ("GET", "/api/provider-status") => json_response(200, json!(data.provider_statuses)),
        ("GET", "/api/models") => json_response(200, json!(data.models)),
        ("GET", "/v1/models") => json_response(
            200,
            json!({
                "object": "list",
                "data": data.models.iter().map(|model| {
                    json!({
                        "id": model.id,
                        "object": "model",
                        "owned_by": "local-ai-router"
                    })
                }).collect::<Vec<_>>()
            }),
        ),
        ("POST", "/v1/chat/completions") => {
            let model = request
                .body
                .as_ref()
                .and_then(|body| body.get("model"))
                .and_then(Value::as_str)
                .unwrap_or("local-model");
            json_response(
                200,
                json!({
                    "id": format!("chatcmpl-stage11-{}", now_ms()),
                    "object": "chat.completion",
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "Stage 11 broker endpoint accepted the authenticated chat request. Live remote routing is deferred to Stage 12."
                        },
                        "finish_reason": "stop"
                    }]
                }),
            )
        }
        _ => json_response(
            404,
            json!({"error": "not_found", "message": "Unknown broker endpoint."}),
        ),
    }
}

fn server_authorize(clients: &[BrokerServerClient], token: Option<&str>) -> bool {
    let Some(token) = token else {
        return false;
    };
    let hash = token_hash(token);
    clients
        .iter()
        .any(|client| client.token_hash == hash && !client.revoked)
}

fn effective_status_from_settings(
    settings: &RemoteBrokerSettings,
    running_requested: bool,
    app_paused: bool,
) -> RemoteBrokerStatus {
    if !settings.lan_sharing_enabled {
        return RemoteBrokerStatus::SharingDisabled;
    }
    if !running_requested {
        return RemoteBrokerStatus::Stopped;
    }
    if app_paused {
        return match settings.pause_policy {
            BrokerPausePolicy::KeepOnline => RemoteBrokerStatus::PausedOnline,
            BrokerPausePolicy::RejectNewRequests => RemoteBrokerStatus::PausedRejectingRequests,
            BrokerPausePolicy::StopUntilResume => RemoteBrokerStatus::StoppedByPause,
        };
    }
    RemoteBrokerStatus::Running
}

fn validate_settings(settings: &RemoteBrokerSettings) -> Result<(), String> {
    if settings.bind_host.trim().is_empty() {
        return Err("broker bind host is required".to_string());
    }
    Ok(())
}

fn current_platform() -> RemoteBrokerPlatform {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        RemoteBrokerPlatform::WindowsX64
    }
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        RemoteBrokerPlatform::NonWindowsPreview
    }
}

fn firewall_guidance(
    settings: &RemoteBrokerSettings,
    platform: &RemoteBrokerPlatform,
) -> Vec<String> {
    let mut guidance = Vec::new();
    if *platform != RemoteBrokerPlatform::WindowsX64 {
        guidance.push(
            "Broker listen mode only starts on Windows x64 hosts; this machine shows a preview."
                .to_string(),
        );
    }
    guidance.push(format!(
        "Allow inbound TCP {} only on trusted Private networks.",
        settings.port
    ));
    guidance.push(format!(
        "Bind host is {}; use 127.0.0.1 for local-only testing or a LAN interface after consent.",
        settings.bind_host
    ));
    guidance.push("Revoke paired clients immediately if a device or token is lost.".to_string());
    guidance
}

fn security_warnings(settings: &RemoteBrokerSettings) -> Vec<String> {
    let mut warnings = vec![
        "LAN sharing is opt-in and should stay disabled on public or untrusted networks."
            .to_string(),
        "Every broker endpoint requires a paired client bearer token.".to_string(),
        "Pairing codes expire quickly and can only be consumed once.".to_string(),
    ];
    if settings.lan_sharing_enabled && settings.bind_host != "127.0.0.1" {
        warnings.push("This broker is configured for LAN exposure; verify Windows Firewall scope before starting.".to_string());
    }
    warnings
}

fn broker_message(
    status: &RemoteBrokerStatus,
    platform: &RemoteBrokerPlatform,
    settings: &RemoteBrokerSettings,
) -> String {
    match status {
        RemoteBrokerStatus::PlatformBlocked => {
            if *platform == RemoteBrokerPlatform::WindowsX64 {
                "Broker is blocked by platform configuration.".to_string()
            } else {
                "Windows remote broker mode can only listen on Windows x64.".to_string()
            }
        }
        RemoteBrokerStatus::SharingDisabled => {
            "LAN sharing is disabled. Enable it before starting broker mode.".to_string()
        }
        RemoteBrokerStatus::Stopped => "Broker is stopped.".to_string(),
        RemoteBrokerStatus::Running => format!(
            "Broker is accepting authenticated requests at {}:{}.",
            settings.bind_host, settings.port
        ),
        RemoteBrokerStatus::PausedOnline => {
            "App is paused; broker stays online according to pause policy.".to_string()
        }
        RemoteBrokerStatus::PausedRejectingRequests => {
            "App is paused; broker is rejecting new authenticated requests.".to_string()
        }
        RemoteBrokerStatus::StoppedByPause => {
            "App is paused; broker is stopped until resume.".to_string()
        }
    }
}

fn visible_bind_host(bind_host: &str) -> &str {
    if bind_host == "0.0.0.0" {
        "LAN-interface"
    } else {
        bind_host
    }
}

fn json_response(status_code: u16, body: Value) -> BrokerEndpointResponse {
    BrokerEndpointResponse { status_code, body }
}

fn pairing_code(seed: u128, index: usize) -> String {
    let value = ((seed / 97) as usize).wrapping_add(index * 7_919) % 1_000_000;
    format!("{value:06}")
}

fn device_token(seed: u128, client_name: &str, index: usize) -> String {
    let name_sum = client_name
        .bytes()
        .fold(0usize, |sum, byte| sum.wrapping_add(byte as usize));
    format!(
        "lar_{}_{}_{}",
        base36(seed as u64),
        base36(name_sum as u64),
        base36((index + 1) as u64)
    )
}

fn token_hash(token: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in token.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn fingerprint(token_hash: &str) -> String {
    let prefix = token_hash.get(..6).unwrap_or(token_hash);
    let suffix = token_hash
        .get(token_hash.len().saturating_sub(4)..)
        .unwrap_or("");
    format!("{prefix}...{suffix}")
}

fn base36(mut value: u64) -> String {
    const CHARS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(CHARS[(value % 36) as usize] as char);
        value /= 36;
    }
    out.iter().rev().collect()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
impl RemoteBrokerManager {
    fn new_for_test(path: PathBuf, platform: RemoteBrokerPlatform) -> Self {
        Self {
            path,
            platform,
            settings: RemoteBrokerSettings::default(),
            running_requested: false,
            clients: Vec::new(),
            pairing_sessions: Vec::new(),
            server: None,
        }
    }

    fn start_without_listener_for_test(&mut self, app_paused: bool) -> RemoteBrokerSnapshot {
        self.running_requested = true;
        self.snapshot(app_paused)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        hardware_probe::load_fixture,
        provider_core::{ProviderDefinition, ProviderHealth},
    };

    fn temp_state(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "local-ai-router-remote-broker-{name}-{}.json",
            now_ms()
        ))
    }

    fn windows_manager(name: &str) -> RemoteBrokerManager {
        RemoteBrokerManager::new_for_test(temp_state(name), RemoteBrokerPlatform::WindowsX64)
    }

    fn enabled_settings() -> RemoteBrokerSettings {
        RemoteBrokerSettings {
            lan_sharing_enabled: true,
            bind_host: "127.0.0.1".to_string(),
            port: 0,
            advertise_mdns: true,
            require_bearer_token: true,
            pause_policy: BrokerPausePolicy::RejectNewRequests,
        }
    }

    #[test]
    fn broker_requires_windows_and_lan_sharing() {
        let mut manager = RemoteBrokerManager::new_for_test(
            temp_state("platform"),
            RemoteBrokerPlatform::NonWindowsPreview,
        );
        manager
            .update_settings(enabled_settings(), false)
            .expect("settings update");
        let snapshot = manager
            .start(false, test_endpoint_data())
            .expect("start returns snapshot");
        assert_eq!(snapshot.status, RemoteBrokerStatus::PlatformBlocked);

        let mut manager = windows_manager("sharing");
        let snapshot = manager
            .start(false, test_endpoint_data())
            .expect("start returns snapshot");
        assert_eq!(snapshot.status, RemoteBrokerStatus::SharingDisabled);
    }

    #[test]
    fn pairing_token_authenticates_and_revoke_blocks_access() {
        let mut manager = windows_manager("pairing");
        manager
            .update_settings(enabled_settings(), false)
            .expect("settings update");
        manager.start_without_listener_for_test(false);
        let pairing = manager.create_pairing_code(false).expect("pairing code");
        let registration = manager
            .register_pairing_client(
                RegisterPairingRequest {
                    code: pairing.session.code,
                    client_name: "MacBook client".to_string(),
                    address: "192.168.1.40".to_string(),
                },
                false,
            )
            .expect("client registration");
        let response = manager.preview_endpoint(
            BrokerEndpointRequest {
                method: "GET".to_string(),
                path: "/api/health".to_string(),
                bearer_token: Some(registration.token.clone()),
                body: None,
            },
            false,
            test_endpoint_data(),
        );
        assert_eq!(response.status_code, 200);

        manager
            .revoke_client(&registration.device.id, false)
            .expect("revoke");
        let response = manager.preview_endpoint(
            BrokerEndpointRequest {
                method: "GET".to_string(),
                path: "/api/health".to_string(),
                bearer_token: Some(registration.token),
                body: None,
            },
            false,
            test_endpoint_data(),
        );
        assert_eq!(response.status_code, 401);
    }

    #[test]
    fn pause_policy_rejects_new_endpoint_requests() {
        let mut manager = windows_manager("pause");
        manager
            .update_settings(enabled_settings(), false)
            .expect("settings update");
        manager.start_without_listener_for_test(false);
        let snapshot = manager.snapshot(true);
        assert_eq!(snapshot.status, RemoteBrokerStatus::PausedRejectingRequests);
        let response = manager.preview_endpoint(
            BrokerEndpointRequest {
                method: "GET".to_string(),
                path: "/api/health".to_string(),
                bearer_token: Some("irrelevant".to_string()),
                body: None,
            },
            true,
            test_endpoint_data(),
        );
        assert_eq!(response.status_code, 423);
    }

    #[test]
    fn endpoint_catalog_exposes_required_routes() {
        let paths = broker_endpoints()
            .into_iter()
            .map(|endpoint| endpoint.path)
            .collect::<Vec<_>>();
        assert!(paths.contains(&"/api/health".to_string()));
        assert!(paths.contains(&"/api/specs".to_string()));
        assert!(paths.contains(&"/api/models".to_string()));
        assert!(paths.contains(&"/api/provider-status".to_string()));
        assert!(paths.contains(&"/v1/models".to_string()));
        assert!(paths.contains(&"/v1/chat/completions".to_string()));
    }

    #[test]
    fn server_listener_serves_authenticated_health_endpoint() {
        let mut manager = windows_manager("server");
        manager
            .update_settings(enabled_settings(), false)
            .expect("settings update");
        if let Err(err) = manager.start(false, test_endpoint_data()) {
            if err.contains("Operation not permitted") {
                return;
            }
            panic!("broker starts: {err}");
        }
        let pairing = manager.create_pairing_code(false).expect("pairing code");
        let registration = manager
            .register_pairing_client(
                RegisterPairingRequest {
                    code: pairing.session.code,
                    client_name: "MacBook client".to_string(),
                    address: "127.0.0.1".to_string(),
                },
                false,
            )
            .expect("client registration");
        let listen_url = manager
            .snapshot(false)
            .listen_url
            .expect("server exposes listen url");
        let body = raw_http_get(&listen_url, "/api/health", &registration.token);
        assert!(body.contains("Local AI Router Windows remote provider broker"));
    }

    fn test_endpoint_data() -> BrokerEndpointData {
        BrokerEndpointData {
            hardware: load_fixture("windows-gtx-1060-30gb").expect("fixture"),
            provider_statuses: vec![ProviderStatus {
                definition: ProviderDefinition {
                    id: "ollama-local".to_string(),
                    name: "Ollama".to_string(),
                    kind: crate::model_catalog::ProviderKind::Ollama,
                    base_url: "http://127.0.0.1:11434".to_string(),
                    folder: "C:/LocalAI/Ollama".to_string(),
                    capabilities: Vec::new(),
                },
                health: ProviderHealth::Healthy,
                running: true,
                paused: false,
                model_count: 1,
                active_model: Some("llama3.1:8b".to_string()),
                latency_ms: Some(25),
                last_checked_ms: now_ms(),
                message: "Provider endpoint healthy.".to_string(),
            }],
            models: vec![ProviderModel {
                id: "llama3.1:8b".to_string(),
                display_name: "llama3.1:8b".to_string(),
                format: "Ollama".to_string(),
                size_bytes: 5_368_709_120,
                installed: true,
                supports_chat: true,
            }],
        }
    }

    fn raw_http_get(listen_url: &str, path: &str, token: &str) -> String {
        let address = listen_url.trim_start_matches("http://");
        let mut stream = TcpStream::connect(address).expect("connect to broker listener");
        let request = format!(
            "GET {path} HTTP/1.1\r\nhost: {address}\r\nauthorization: Bearer {token}\r\nconnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).expect("write request");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read response");
        response
    }
}
