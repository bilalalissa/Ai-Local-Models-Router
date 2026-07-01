use crate::provider_core::{ProviderChatRequest, ProviderManager};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const LOCAL_API_HOST: &str = "127.0.0.1";
const LOCAL_API_PORT: u16 = 17640;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const PROVIDER_ORDER: [&str; 5] = [
    "ollama-local",
    "lm-studio-local",
    "mlx-lm-local",
    "llama-cpp-local",
    "openai-compatible-local",
];

#[derive(Clone, Debug)]
struct LocalApiRequest {
    method: String,
    path: String,
    body: Option<Value>,
}

#[derive(Clone, Debug)]
struct LocalApiResponse {
    status_code: u16,
    body: Value,
}

pub fn spawn_local_integration_api(provider_state: Arc<Mutex<ProviderManager>>) {
    if cfg!(target_os = "windows") {
        return;
    }

    thread::spawn(move || {
        let listener = match TcpListener::bind((LOCAL_API_HOST, LOCAL_API_PORT)) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("Local AI Router integration API could not bind {LOCAL_API_HOST}:{LOCAL_API_PORT}: {err}");
                return;
            }
        };
        if let Err(err) = listener.set_nonblocking(true) {
            eprintln!("Local AI Router integration API could not become nonblocking: {err}");
            return;
        }

        loop {
            match listener.accept() {
                Ok((stream, _)) => handle_stream(stream, &provider_state),
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(err) => {
                    eprintln!(
                        "Local AI Router integration API stopped accepting connections: {err}"
                    );
                    break;
                }
            }
        }
    });
}

fn handle_stream(mut stream: TcpStream, provider_state: &Arc<Mutex<ProviderManager>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let response = match read_http_request(&mut stream).and_then(|raw| parse_http_request(&raw)) {
        Some(request) => endpoint_response(provider_state, request),
        None => json_response(
            400,
            json!({
                "error": {
                    "message": "Local AI Router could not parse the request.",
                    "type": "bad_request",
                    "code": "bad_request"
                }
            }),
        ),
    };
    let _ = write_http_response(&mut stream, response);
}

fn read_http_request(stream: &mut TcpStream) -> Option<String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > MAX_REQUEST_BYTES {
            return None;
        }
        if request_complete(&bytes) {
            break;
        }
    }
    String::from_utf8(bytes).ok()
}

fn request_complete(bytes: &[u8]) -> bool {
    let Some(header_end) = find_header_end(bytes) else {
        return false;
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    bytes.len() >= header_end + 4 + content_length
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_http_request(raw: &str) -> Option<LocalApiRequest> {
    let (head, body_text) = raw.split_once("\r\n\r\n").unwrap_or((raw, ""));
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.split('?').next()?.to_string();
    let body = if body_text.trim().is_empty() {
        None
    } else {
        serde_json::from_str::<Value>(body_text).ok()
    };
    Some(LocalApiRequest { method, path, body })
}

fn endpoint_response(
    provider_state: &Arc<Mutex<ProviderManager>>,
    request: LocalApiRequest,
) -> LocalApiResponse {
    if request.method == "OPTIONS" {
        return json_response(200, json!({}));
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/health") => health_response(),
        ("GET", "/api/integration/manifest") => manifest_response(),
        ("GET", "/api/integration/config") => config_response(provider_state),
        ("POST", "/api/integration/recommend") => recommendation_response(request.body),
        ("POST", "/api/integration/select-model") => {
            select_model_response(provider_state, request.body)
        }
        ("POST", "/api/integration/select-runtime") => {
            select_model_response(provider_state, request.body)
        }
        ("GET", "/api/integration/providers") => providers_response(),
        ("POST", "/api/integration/providers/local-ai-router-broker/start") => json_response(
            200,
            json!({
                "ok": true,
                "provider_id": "local-ai-router-broker",
                "detail": "Local AI Router localhost broker is already running."
            }),
        ),
        ("GET", "/v1/models") => models_response(),
        ("POST", "/v1/chat/completions") => chat_response(provider_state, request.body),
        _ => json_response(
            404,
            json!({
                "error": {
                    "message": "Unknown Local AI Router integration endpoint.",
                    "type": "not_found",
                    "code": "not_found"
                }
            }),
        ),
    }
}

fn health_response() -> LocalApiResponse {
    json_response(
        200,
        json!({
            "status": "ok",
            "service": "Local AI Router localhost integration API",
            "base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}"),
            "openai_compatible_base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
            "auth_required": false,
            "scope": "localhost-only"
        }),
    )
}

fn manifest_response() -> LocalApiResponse {
    json_response(
        200,
        json!({
            "name": "Local AI Router",
            "version": 1,
            "auth_required": false,
            "scope": "localhost-only",
            "endpoints": {
                "health": "/api/health",
                "config": "/api/integration/config",
                "recommend": "/api/integration/recommend",
                "providers": "/api/integration/providers",
                "select_model": "/api/integration/select-model",
                "select_runtime": "/api/integration/select-runtime",
                "models": "/v1/models",
                "chat_completions": "/v1/chat/completions"
            },
            "capabilities": {
                "model_switching": true,
                "task_aware_model_selection": true,
                "provider_autostart": true,
                "automatic_live_install": true,
                "unload_model_from_memory": true,
                "remove_model_weights": true,
                "remove_model_weights_supported_providers": ["ollama-local"],
                "streaming_chat": false
            }
        }),
    )
}

fn config_response(provider_state: &Arc<Mutex<ProviderManager>>) -> LocalApiResponse {
    let statuses = match provider_state.lock() {
        Ok(mut providers) => providers.statuses(),
        Err(_) => {
            return openai_error(
                503,
                "provider_state_unavailable",
                "server_error",
                "Local AI Router provider state is unavailable.",
            );
        }
    };
    let selected = statuses
        .iter()
        .find(|status| {
            status.running
                && !status.paused
                && matches!(
                    status.health,
                    crate::provider_core::ProviderHealth::Healthy
                        | crate::provider_core::ProviderHealth::Degraded
                )
        })
        .map(|status| {
            json!({
                "provider_id": status.definition.id,
                "provider_name": status.definition.name,
                "provider_kind": status.definition.kind,
                "provider_base_url": status.definition.base_url,
                "model": status.active_model.as_deref().unwrap_or("local-model"),
                "health": status.health,
                "model_count": status.model_count,
                "latency_ms": status.latency_ms
            })
        });
    let ready = selected.is_some();

    json_response(
        200,
        json!({
            "app": "Local AI Router",
            "status": if ready { "ready" } else { "waiting_for_provider" },
            "generated_at_ms": now_ms(),
            "local_integration": {
                "base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}"),
                "openai_compatible_base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
                "health_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/api/health"),
                "models_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1/models"),
                "auth_method": "none",
                "scope": "localhost-only"
            },
            "learning_boost_env": {
                "DEFAULT_AI_PROVIDER": "openai_compat",
                "DEFAULT_AI_MODEL": "local-model",
                "OPENAI_COMPAT_BASE_URL": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
                "OPENAI_COMPAT_AUTH_METHOD": "none",
                "LOCAL_AI_ROUTER_BASE_URL": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}"),
                "LOCAL_AI_ROUTER_AUTOSTART": "true",
                "LOCAL_AI_ROUTER_AUTO_APPLY": "true",
                "LOCAL_AI_ROUTER_AUTO_START_PROVIDER": "true",
                "LOCAL_AI_ROUTER_AUTO_INSTALL": "true"
            },
            "installer_capabilities": {
                "automatic_live_install": true,
                "requires_user_consent": true,
                "supported_live_plans": ["apple-silicon-recommended", "intel-mac-recommended"],
                "dry_run_default": true
            },
            "memory_capabilities": {
                "unload_model_from_memory": true,
                "remove_model_weights": true,
                "remove_model_weights_supported_providers": ["ollama-local"],
                "requires_confirmation_for_disk_removal": true,
                "remove_weights_note": "Removing model weights frees disk space but requires downloading the model again before reuse."
            },
            "selected_runtime": selected,
            "provider_statuses": statuses,
            "note": if ready {
                "A local provider is reachable. Companion apps can use the OpenAI-compatible router URL."
            } else {
                "The router API is running, but no local model provider is reachable yet. Install/start Ollama, LM Studio, MLX-LM, llama.cpp, or a custom OpenAI-compatible server."
            }
        }),
    )
}

fn recommendation_response(body: Option<Value>) -> LocalApiResponse {
    let allow_install = body
        .as_ref()
        .and_then(|value| value.get("allow_install"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    json_response(
        200,
        json!({
            "ok": true,
            "provider": "local_ai_router_broker",
            "provider_id": "local-ai-router-broker",
            "protocol": "openai_compatible",
            "base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
            "model": "local-model",
            "installed": true,
            "running": true,
            "startable": false,
            "installable": allow_install,
            "requires_user_consent": allow_install,
            "install_flow": if allow_install { "open Local AI Router > Models > Live install and run > Auto install and run" } else { "disabled by request" },
            "status": "reachable",
            "detail": if allow_install {
                "Use Local AI Router's localhost OpenAI-compatible endpoint. Automatic model setup is available from the desktop app after explicit live-install consent."
            } else {
                "Use Local AI Router's localhost OpenAI-compatible endpoint."
            }
        }),
    )
}

fn providers_response() -> LocalApiResponse {
    json_response(
        200,
        json!({
            "providers": [{
                "provider": "local_ai_router_broker",
                "provider_id": "local-ai-router-broker",
                "name": "Local AI Router localhost broker",
                "protocol": "openai_compatible",
                "base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
                "model": "local-model",
                "installed": true,
                "running": true,
                "startable": false,
                "status": "reachable"
            }]
        }),
    )
}

fn select_model_response(
    provider_state: &Arc<Mutex<ProviderManager>>,
    body: Option<Value>,
) -> LocalApiResponse {
    let body = body.unwrap_or_else(|| json!({}));
    let requested_provider = body
        .get("provider_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let model_candidates = model_candidates_for_selection(&body);
    let mut errors = Vec::new();
    let mut providers = match provider_state.lock() {
        Ok(providers) => providers,
        Err(_) => {
            return openai_error(
                503,
                "provider_state_unavailable",
                "server_error",
                "Local AI Router provider state is unavailable.",
            );
        }
    };
    let provider_order = requested_provider
        .as_deref()
        .map(|provider_id| vec![provider_id.to_string()])
        .unwrap_or_else(|| {
            PROVIDER_ORDER
                .iter()
                .map(|provider_id| (*provider_id).to_string())
                .collect()
        });

    for provider_id in &provider_order {
        match providers.start(provider_id) {
            Ok(_) => {}
            Err(err) => errors.push(format!("{provider_id} start: {err}")),
        }
        for model_id in &model_candidates {
            match providers.select_model(provider_id, model_id) {
                Ok(status) => {
                    let runtime_model = status
                        .active_model
                        .clone()
                        .unwrap_or_else(|| model_id.clone());
                    return json_response(
                        200,
                        json!({
                            "ok": true,
                            "provider_id": status.definition.id,
                            "provider_name": status.definition.name,
                            "provider_kind": status.definition.kind,
                            "provider_base_url": status.definition.base_url,
                            "requested_model": model_id,
                            "runtime_model": runtime_model,
                            "chat_model": "local-model",
                            "openai_compatible_base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
                            "task": body.get("task").cloned().unwrap_or(Value::Null),
                            "needs": body.get("needs").cloned().unwrap_or_else(|| json!([])),
                            "detail": "Selected model for future local-model chat requests."
                        }),
                    );
                }
                Err(err) => errors.push(format!("{provider_id} {model_id}: {err}")),
            }
        }

        match providers.list_models(provider_id) {
            Ok(models) => {
                if let Some(model) = models.into_iter().find(|model| model.supports_chat) {
                    let model_id = model.id.clone();
                    match providers.select_model(provider_id, &model_id) {
                        Ok(status) => {
                            let runtime_model = status.active_model.unwrap_or(model.id);
                            return json_response(
                                200,
                                json!({
                                    "ok": true,
                                    "provider_id": status.definition.id,
                                    "provider_name": status.definition.name,
                                    "provider_kind": status.definition.kind,
                                    "provider_base_url": status.definition.base_url,
                                    "requested_model": model_id,
                                    "runtime_model": runtime_model,
                                    "chat_model": "local-model",
                                    "openai_compatible_base_url": format!("http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/v1"),
                                    "task": body.get("task").cloned().unwrap_or(Value::Null),
                                    "needs": body.get("needs").cloned().unwrap_or_else(|| json!([])),
                                    "detail": "Selected the first available provider chat model because preferred task models were not installed."
                                }),
                            );
                        }
                        Err(err) => errors.push(format!("{provider_id} fallback select: {err}")),
                    }
                }
            }
            Err(err) => errors.push(format!("{provider_id} list models: {err}")),
        }
    }

    openai_error(
        503,
        "model_switch_unavailable",
        "provider_unavailable",
        &format!(
            "Local AI Router could not select a model. Install/start a provider or run the automatic setup. Attempts: {}",
            errors.join("; ")
        ),
    )
}

fn model_candidates_for_selection(body: &Value) -> Vec<String> {
    if let Some(model) = body
        .get("model")
        .or_else(|| body.get("model_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        return vec![model.to_string()];
    }

    let task = body
        .get("task")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let context_size = body
        .get("context_size")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let needs = body
        .get("needs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_ascii_lowercase)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let has_need = |needle: &str| needs.iter().any(|need| need.contains(needle));

    if task.contains("code") || task.contains("card") || has_need("code") {
        return vec![
            "qwen2-5-coder-7b-q4".to_string(),
            "llama-3-1-8b-q4".to_string(),
            "phi-3-5-mini-q4".to_string(),
        ];
    }
    if has_need("reasoning") || task.contains("plan") || task.contains("reason") {
        return vec![
            "llama-3-1-8b-q4".to_string(),
            "qwen2-5-14b-q4".to_string(),
            "qwen2-5-coder-7b-q4".to_string(),
        ];
    }
    if has_need("arabic") || task.contains("arabic") {
        return vec![
            "llama-3-1-8b-q4".to_string(),
            "qwen2-5-14b-q4".to_string(),
            "qwen2-5-coder-7b-q4".to_string(),
        ];
    }
    if task.contains("summar")
        || task.contains("ingest")
        || task.contains("transcript")
        || context_size == "large"
        || has_need("long")
    {
        return vec![
            "llama-3-1-8b-q4".to_string(),
            "qwen2-5-14b-q4".to_string(),
            "phi-3-5-mini-q4".to_string(),
        ];
    }
    if has_need("low_latency")
        || has_need("fast")
        || task.contains("quick")
        || task.contains("chat")
    {
        return vec![
            "phi-3-5-mini-q4".to_string(),
            "llama-3-1-8b-q4".to_string(),
            "qwen2-5-coder-7b-q4".to_string(),
        ];
    }

    vec![
        "llama-3-1-8b-q4".to_string(),
        "phi-3-5-mini-q4".to_string(),
        "qwen2-5-coder-7b-q4".to_string(),
    ]
}

fn models_response() -> LocalApiResponse {
    json_response(
        200,
        json!({
            "object": "list",
            "data": [{
                "id": "local-model",
                "object": "model",
                "created": now_seconds(),
                "owned_by": "local-ai-router"
            }]
        }),
    )
}

fn chat_response(
    provider_state: &Arc<Mutex<ProviderManager>>,
    body: Option<Value>,
) -> LocalApiResponse {
    let Some(body) = body else {
        return openai_error(
            400,
            "bad_request",
            "invalid_request_error",
            "Missing JSON request body.",
        );
    };
    if body.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        return openai_error(
            400,
            "streaming_not_supported",
            "invalid_request_error",
            "Local AI Router's localhost integration API currently supports non-streaming chat requests only.",
        );
    }

    let requested_model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("local-model")
        .to_string();
    let prompt = prompt_from_messages(&body).unwrap_or_else(|| "Say ready.".to_string());
    let provider_model = (requested_model != "local-model").then(|| requested_model.clone());
    let mut errors = Vec::new();
    let mut providers = match provider_state.lock() {
        Ok(providers) => providers,
        Err(_) => {
            return openai_error(
                503,
                "provider_state_unavailable",
                "server_error",
                "Local AI Router provider state is unavailable.",
            );
        }
    };

    for provider_id in PROVIDER_ORDER {
        match providers.start(provider_id) {
            Ok(status) if !status.running => {
                errors.push(format!("{provider_id} start: {}", status.message));
            }
            Ok(_) => {}
            Err(err) => errors.push(format!("{provider_id} start: {err}")),
        }
        let request = ProviderChatRequest {
            provider_id: provider_id.to_string(),
            model_id: provider_model.clone(),
            prompt: prompt.clone(),
        };
        match providers.chat(request) {
            Ok(response) => {
                return json_response(
                    200,
                    json!({
                        "id": format!("chatcmpl-local-{}", now_ms()),
                        "object": "chat.completion",
                        "created": now_seconds(),
                        "model": response.model_id,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": response.response
                            },
                            "finish_reason": "stop"
                        }],
                        "usage": {
                            "prompt_tokens": response.tokens_in,
                            "completion_tokens": response.tokens_out,
                            "total_tokens": response.tokens_in + response.tokens_out
                        },
                        "local_ai_router": {
                            "provider_id": response.provider_id,
                            "latency_ms": response.latency_ms
                        }
                    }),
                );
            }
            Err(err) => errors.push(format!("{provider_id}: {err}")),
        }
    }

    openai_error(
        503,
        "no_local_provider",
        "provider_unavailable",
        &format!(
            "Local AI Router is reachable, but no local model provider answered. Start Ollama, LM Studio, MLX-LM, llama.cpp, or another configured local provider. Attempts: {}",
            errors.join("; ")
        ),
    )
}

fn prompt_from_messages(body: &Value) -> Option<String> {
    let messages = body.get("messages")?.as_array()?;
    let prompt = messages
        .iter()
        .filter_map(|message| {
            let role = message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user");
            let content = message_content_text(message.get("content")?)?;
            Some(format!("{role}: {content}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    (!prompt.trim().is_empty()).then_some(prompt)
}

fn message_content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.trim().is_empty()).then_some(text)
}

fn openai_error(status_code: u16, code: &str, error_type: &str, message: &str) -> LocalApiResponse {
    json_response(
        status_code,
        json!({
            "error": {
                "message": message,
                "type": error_type,
                "code": code
            }
        }),
    )
}

fn json_response(status_code: u16, body: Value) -> LocalApiResponse {
    LocalApiResponse { status_code, body }
}

fn write_http_response(stream: &mut TcpStream, response: LocalApiResponse) -> Result<(), String> {
    let body = serde_json::to_vec(&response.body)
        .map_err(|err| format!("failed to serialize integration response: {err}"))?;
    let status_text = match response.status_code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let headers = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\naccess-control-allow-origin: http://localhost\r\naccess-control-allow-methods: GET, POST, OPTIONS\r\naccess-control-allow-headers: authorization, content-type\r\nconnection: close\r\n\r\n",
        response.status_code,
        status_text,
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(&body))
        .map_err(|err| format!("failed to write integration response: {err}"))
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
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
    fn parses_openai_compatible_chat_prompt() {
        let body = json!({
            "model": "local-model",
            "messages": [
                {"role": "system", "content": "Be concise."},
                {"role": "user", "content": "Say ready."}
            ]
        });

        assert_eq!(
            prompt_from_messages(&body),
            Some("system: Be concise.\nuser: Say ready.".to_string())
        );
    }

    #[test]
    fn manifest_declares_learning_boost_endpoints() {
        let response = manifest_response();

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body["auth_required"], false);
        assert_eq!(response.body["capabilities"]["model_switching"], true);
        assert_eq!(response.body["capabilities"]["remove_model_weights"], true);
        assert_eq!(
            response.body["endpoints"]["recommend"],
            "/api/integration/recommend"
        );
        assert_eq!(
            response.body["endpoints"]["select_model"],
            "/api/integration/select-model"
        );
        assert_eq!(
            response.body["endpoints"]["chat_completions"],
            "/v1/chat/completions"
        );
    }

    #[test]
    fn task_selection_prefers_fast_models_for_quick_chat() {
        let candidates = model_candidates_for_selection(&json!({
            "task": "quick_chat",
            "needs": ["low_latency"]
        }));

        assert_eq!(candidates[0], "phi-3-5-mini-q4");
        assert!(candidates.contains(&"llama-3-1-8b-q4".to_string()));
    }

    #[test]
    fn task_selection_prefers_balanced_models_for_large_source_work() {
        let candidates = model_candidates_for_selection(&json!({
            "task": "summarize_sources",
            "context_size": "large"
        }));

        assert_eq!(candidates[0], "llama-3-1-8b-q4");
    }

    #[test]
    fn task_selection_prefers_reasoning_models_for_arabic_planning() {
        let candidates = model_candidates_for_selection(&json!({
            "task": "plan_drafting",
            "needs": ["arabic", "reasoning"]
        }));

        assert_eq!(candidates[0], "llama-3-1-8b-q4");
        assert!(candidates.contains(&"qwen2-5-14b-q4".to_string()));
    }

    #[test]
    fn task_selection_honors_explicit_model_override() {
        let candidates = model_candidates_for_selection(&json!({
            "task": "quick_chat",
            "model": "qwen2-5-coder-7b-q4"
        }));

        assert_eq!(candidates, vec!["qwen2-5-coder-7b-q4"]);
    }

    #[test]
    fn models_response_includes_learning_boost_default_model() {
        let response = models_response();

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body["object"], "list");
        assert_eq!(response.body["data"][0]["id"], "local-model");
    }

    #[test]
    fn streaming_requests_return_clear_error() {
        let provider_state = Arc::new(Mutex::new(ProviderManager::seeded()));
        let response = chat_response(
            &provider_state,
            Some(json!({
                "model": "local-model",
                "stream": true,
                "messages": [{"role": "user", "content": "hi"}]
            })),
        );

        assert_eq!(response.status_code, 400);
        assert_eq!(response.body["error"]["code"], "streaming_not_supported");
    }
}
