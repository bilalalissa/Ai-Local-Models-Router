use crate::{
    hardware_probe::HardwareSpecs,
    model_catalog::{
        score_model_catalog, CompatibilityLabel, CompatibilityResult, PreferenceTag, ProviderKind,
        ScoreModelCatalogRequest, UseCase,
    },
    provider_core::{ProviderChatRequest, ProviderChatResponse, ProviderHealth, ProviderStatus},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RouterMode {
    Auto,
    Manual,
    Forced,
    LocalOnly,
    RemotePreferred,
    RemoteOnly,
    Paused,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouterThresholds {
    pub min_score: u8,
    pub max_cpu_percent: u8,
    pub max_memory_percent: u8,
    pub max_gpu_percent: u8,
    pub max_latency_ms: u32,
    pub upgrade_score_margin: u8,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RouterDecisionRequest {
    pub hardware: HardwareSpecs,
    pub provider_statuses: Vec<ProviderStatus>,
    pub mode: RouterMode,
    pub use_case: UseCase,
    pub preference_tags: Vec<PreferenceTag>,
    pub manual_model_id: Option<String>,
    pub forced_model_id: Option<String>,
    pub installed_only: bool,
    pub app_paused: bool,
    pub thresholds: RouterThresholds,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteCandidate {
    pub model_id: String,
    pub model_name: String,
    pub provider: ProviderKind,
    pub provider_id: String,
    pub provider_name: String,
    pub score: u8,
    pub label: CompatibilityLabel,
    pub latency_ms: Option<u32>,
    pub installed: bool,
    pub reasons: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouterDecision {
    pub mode: RouterMode,
    pub selected: Option<RouteCandidate>,
    pub fallback_chain: Vec<RouteCandidate>,
    pub rejected: Vec<RouteCandidate>,
    pub reasons: Vec<String>,
    pub suspended: bool,
    pub can_execute: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RouterTestRequest {
    pub decision: RouterDecision,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RouterTestResult {
    pub decision: RouterDecision,
    pub response: Option<ProviderChatResponse>,
    pub message: String,
}

impl Default for RouterThresholds {
    fn default() -> Self {
        Self {
            min_score: 70,
            max_cpu_percent: 80,
            max_memory_percent: 85,
            max_gpu_percent: 90,
            max_latency_ms: 1_500,
            upgrade_score_margin: 8,
        }
    }
}

pub fn decide_route(request: RouterDecisionRequest) -> Result<RouterDecision, String> {
    let mut reasons = Vec::new();
    let suspended = request.app_paused || request.mode == RouterMode::Paused;
    if suspended {
        reasons.push("Router is paused; no executable routing change will be made.".to_string());
    }
    match request.mode {
        RouterMode::RemotePreferred => {
            reasons.push(
                "Remote preferred is a Stage 8 placeholder until remote broker stages.".to_string(),
            );
        }
        RouterMode::RemoteOnly => {
            return Ok(RouterDecision {
                mode: request.mode,
                selected: None,
                fallback_chain: Vec::new(),
                rejected: Vec::new(),
                reasons: vec![
                    "Remote only is unavailable until the remote broker/client stages.".to_string(),
                ],
                suspended,
                can_execute: false,
            });
        }
        _ => {}
    }

    let preferred_provider = match request.mode {
        RouterMode::Manual | RouterMode::Forced => None,
        _ => healthy_provider_kinds(&request.provider_statuses)
            .first()
            .cloned(),
    };
    let scored = score_model_catalog(ScoreModelCatalogRequest {
        hardware: request.hardware.clone(),
        use_case: request.use_case.clone(),
        preferred_provider,
        preference_tags: request.preference_tags.clone(),
        installed_only: request.installed_only,
        app_paused: suspended,
    })?;
    let mut candidates = build_candidates(&scored, &request.provider_statuses);

    if request.mode == RouterMode::LocalOnly {
        reasons.push("Local only mode excludes remote candidates.".to_string());
    }
    if request.mode == RouterMode::RemotePreferred {
        reasons.push(
            "Falling back to local candidates because no remote broker is available.".to_string(),
        );
    }

    let mut rejected = Vec::new();
    candidates.retain(|candidate| {
        let keep = candidate.score >= request.thresholds.min_score
            && !matches!(candidate.label, CompatibilityLabel::Avoid)
            && candidate
                .latency_ms
                .map(|latency| latency <= request.thresholds.max_latency_ms)
                .unwrap_or(true)
            && candidate.blockers.is_empty();
        if !keep {
            rejected.push(candidate.clone());
        }
        keep
    });

    apply_load_thresholds(&request, &mut reasons);

    let selected = match request.mode {
        RouterMode::Manual => select_by_model(&candidates, request.manual_model_id.as_deref())
            .or_else(|| candidates.first().cloned()),
        RouterMode::Forced => {
            let forced = select_forced(
                &scored,
                &request.provider_statuses,
                request.forced_model_id.as_deref(),
            );
            if forced.is_none() {
                reasons.push(
                    "Forced model is unavailable; no automatic fallback selected.".to_string(),
                );
            }
            forced
        }
        RouterMode::Paused => None,
        _ => candidates.first().cloned(),
    };

    if let Some(selected) = &selected {
        reasons.push(format!(
            "Selected {} on {} with score {}.",
            selected.model_name, selected.provider_name, selected.score
        ));
        if selected.score
            >= request
                .thresholds
                .min_score
                .saturating_add(request.thresholds.upgrade_score_margin)
        {
            reasons.push("Candidate clears upgrade margin.".to_string());
        }
    } else if !suspended && request.mode != RouterMode::RemoteOnly {
        reasons.push("No executable local candidate met routing thresholds.".to_string());
    }

    let fallback_chain = candidates
        .into_iter()
        .filter(|candidate| {
            selected
                .as_ref()
                .map(|selected| {
                    selected.model_id != candidate.model_id
                        || selected.provider_id != candidate.provider_id
                })
                .unwrap_or(true)
        })
        .take(5)
        .collect::<Vec<_>>();
    let can_execute =
        selected.is_some() && !suspended && request.mode != RouterMode::RemotePreferred;

    Ok(RouterDecision {
        mode: request.mode,
        selected,
        fallback_chain,
        rejected,
        reasons,
        suspended,
        can_execute,
    })
}

pub fn run_router_test(
    request: RouterTestRequest,
    chat: impl FnOnce(ProviderChatRequest) -> Result<ProviderChatResponse, String>,
) -> RouterTestResult {
    let Some(selected) = request.decision.selected.clone() else {
        return RouterTestResult {
            decision: request.decision,
            response: None,
            message: "No selected route to test.".to_string(),
        };
    };
    if !request.decision.can_execute {
        return RouterTestResult {
            decision: request.decision,
            response: None,
            message: "Router decision is not executable in the current mode.".to_string(),
        };
    }
    match chat(ProviderChatRequest {
        provider_id: selected.provider_id,
        model_id: Some(selected.model_id),
        prompt: request.prompt,
    }) {
        Ok(response) => RouterTestResult {
            decision: request.decision,
            response: Some(response),
            message: "Router test prompt completed.".to_string(),
        },
        Err(err) => RouterTestResult {
            decision: request.decision,
            response: None,
            message: format!("Router test prompt failed: {err}"),
        },
    }
}

fn build_candidates(
    scored: &[CompatibilityResult],
    provider_statuses: &[ProviderStatus],
) -> Vec<RouteCandidate> {
    let mut candidates = Vec::new();
    for result in scored {
        for provider_kind in &result.model.providers {
            if let Some(provider) = best_provider_for(provider_statuses, provider_kind) {
                candidates.push(RouteCandidate {
                    model_id: result.model.id.clone(),
                    model_name: result.model.display_name.clone(),
                    provider: provider_kind.clone(),
                    provider_id: provider.definition.id.clone(),
                    provider_name: provider.definition.name.clone(),
                    score: result.score,
                    label: result.label.clone(),
                    latency_ms: provider.latency_ms,
                    installed: result.model.installed,
                    reasons: result.reasons.clone(),
                    blockers: result.blockers.clone(),
                });
            }
        }
    }
    candidates.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| candidate_health_rank(a).cmp(&candidate_health_rank(b)))
            .then_with(|| {
                a.latency_ms
                    .unwrap_or(u32::MAX)
                    .cmp(&b.latency_ms.unwrap_or(u32::MAX))
            })
            .then_with(|| a.model_name.cmp(&b.model_name))
    });
    candidates
}

fn best_provider_for<'a>(
    provider_statuses: &'a [ProviderStatus],
    provider_kind: &ProviderKind,
) -> Option<&'a ProviderStatus> {
    provider_statuses
        .iter()
        .filter(|status| &status.definition.kind == provider_kind)
        .filter(|status| {
            status.running
                && !status.paused
                && matches!(
                    status.health,
                    ProviderHealth::Healthy | ProviderHealth::Degraded
                )
        })
        .min_by_key(|status| status.latency_ms.unwrap_or(u32::MAX))
}

fn healthy_provider_kinds(provider_statuses: &[ProviderStatus]) -> Vec<ProviderKind> {
    provider_statuses
        .iter()
        .filter(|status| status.running && !status.paused)
        .map(|status| status.definition.kind.clone())
        .collect()
}

fn select_by_model(
    candidates: &[RouteCandidate],
    model_id: Option<&str>,
) -> Option<RouteCandidate> {
    model_id
        .and_then(|id| candidates.iter().find(|candidate| candidate.model_id == id))
        .cloned()
}

fn select_forced(
    scored: &[CompatibilityResult],
    provider_statuses: &[ProviderStatus],
    model_id: Option<&str>,
) -> Option<RouteCandidate> {
    let model_id = model_id?;
    let result = scored.iter().find(|result| result.model.id == model_id)?;
    result
        .model
        .providers
        .iter()
        .find_map(|provider_kind| {
            best_provider_for(provider_statuses, provider_kind)
                .map(|provider| (provider_kind, provider))
        })
        .map(|(provider_kind, provider)| RouteCandidate {
            model_id: result.model.id.clone(),
            model_name: result.model.display_name.clone(),
            provider: provider_kind.clone(),
            provider_id: provider.definition.id.clone(),
            provider_name: provider.definition.name.clone(),
            score: result.score,
            label: result.label.clone(),
            latency_ms: provider.latency_ms,
            installed: result.model.installed,
            reasons: result.reasons.clone(),
            blockers: result.blockers.clone(),
        })
}

fn apply_load_thresholds(request: &RouterDecisionRequest, reasons: &mut Vec<String>) {
    if request.hardware.load.cpu_percent > f32::from(request.thresholds.max_cpu_percent) {
        reasons.push(
            "CPU load exceeds router threshold; downgrade/fallback is preferred.".to_string(),
        );
    }
    if request.hardware.load.memory_percent > f32::from(request.thresholds.max_memory_percent) {
        reasons.push(
            "Memory load exceeds router threshold; low-memory fallback is preferred.".to_string(),
        );
    }
    if request
        .hardware
        .load
        .gpu_percent
        .map(|load| load > f32::from(request.thresholds.max_gpu_percent))
        .unwrap_or(false)
    {
        reasons.push(
            "GPU load exceeds router threshold; CPU-friendly fallback is preferred.".to_string(),
        );
    }
}

fn candidate_health_rank(candidate: &RouteCandidate) -> u8 {
    match candidate.label {
        CompatibilityLabel::Smooth => 0,
        CompatibilityLabel::Good => 1,
        CompatibilityLabel::Tight => 2,
        CompatibilityLabel::Avoid => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        hardware_probe::load_fixture,
        provider_core::{ProviderDefinition, ProviderStatus},
    };

    fn providers() -> Vec<ProviderStatus> {
        vec![
            provider("ollama-local", "Ollama", ProviderKind::Ollama, 42, true),
            provider(
                "mlx-lm-local",
                "MLX-LM Server",
                ProviderKind::MlxLm,
                36,
                true,
            ),
            provider(
                "llama-cpp-local",
                "llama.cpp Server",
                ProviderKind::LlamaCpp,
                72,
                true,
            ),
        ]
    }

    fn provider(
        id: &str,
        name: &str,
        kind: ProviderKind,
        latency_ms: u32,
        running: bool,
    ) -> ProviderStatus {
        ProviderStatus {
            definition: ProviderDefinition {
                id: id.to_string(),
                name: name.to_string(),
                kind,
                base_url: "http://127.0.0.1".to_string(),
                folder: "/tmp/provider".to_string(),
                capabilities: Vec::new(),
            },
            health: if running {
                ProviderHealth::Healthy
            } else {
                ProviderHealth::Stopped
            },
            running,
            paused: false,
            model_count: 2,
            active_model: None,
            latency_ms: Some(latency_ms),
            last_checked_ms: 1,
            message: "test".to_string(),
        }
    }

    fn request(mode: RouterMode) -> RouterDecisionRequest {
        RouterDecisionRequest {
            hardware: load_fixture("apple-silicon-m3-pro-18gb").expect("fixture"),
            provider_statuses: providers(),
            mode,
            use_case: UseCase::Coding,
            preference_tags: vec![PreferenceTag::Balanced],
            manual_model_id: Some("phi-3-5-mini-q4".to_string()),
            forced_model_id: Some("qwen2-5-coder-7b-mlx".to_string()),
            installed_only: false,
            app_paused: false,
            thresholds: RouterThresholds::default(),
        }
    }

    #[test]
    fn auto_selects_best_executable_local_candidate() {
        let decision = decide_route(request(RouterMode::Auto)).expect("decision");

        assert!(decision.selected.is_some());
        assert!(decision.can_execute);
        assert!(!decision.fallback_chain.is_empty());
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("Selected")));
    }

    #[test]
    fn manual_prefers_requested_model_when_available() {
        let decision = decide_route(request(RouterMode::Manual)).expect("decision");

        assert_eq!(
            decision
                .selected
                .as_ref()
                .map(|candidate| candidate.model_id.as_str()),
            Some("phi-3-5-mini-q4")
        );
    }

    #[test]
    fn forced_uses_requested_model_without_threshold_fallback() {
        let mut request = request(RouterMode::Forced);
        request.thresholds.min_score = 99;
        let decision = decide_route(request).expect("decision");

        assert_eq!(
            decision
                .selected
                .as_ref()
                .map(|candidate| candidate.model_id.as_str()),
            Some("qwen2-5-coder-7b-mlx")
        );
    }

    #[test]
    fn remote_only_is_placeholder_without_execution() {
        let decision = decide_route(request(RouterMode::RemoteOnly)).expect("decision");

        assert!(decision.selected.is_none());
        assert!(!decision.can_execute);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("remote broker")));
    }

    #[test]
    fn latency_threshold_rejects_candidates() {
        let mut request = request(RouterMode::Auto);
        request.thresholds.max_latency_ms = 1;
        let decision = decide_route(request).expect("decision");

        assert!(decision.selected.is_none());
        assert!(!decision.can_execute);
        assert!(!decision.rejected.is_empty());
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("No executable local candidate")));
    }

    #[test]
    fn fallback_chain_excludes_stopped_providers() {
        let mut request = request(RouterMode::Auto);
        let stopped_id = "mlx-lm-local";
        if let Some(status) = request
            .provider_statuses
            .iter_mut()
            .find(|status| status.definition.id == stopped_id)
        {
            status.running = false;
            status.health = ProviderHealth::Stopped;
        }
        let decision = decide_route(request).expect("decision");

        let all_candidates = decision
            .selected
            .iter()
            .chain(decision.fallback_chain.iter())
            .collect::<Vec<_>>();
        assert!(!all_candidates.is_empty());
        assert!(all_candidates
            .iter()
            .all(|candidate| candidate.provider_id != stopped_id));
    }

    #[test]
    fn paused_mode_suspends_execution() {
        let mut request = request(RouterMode::Auto);
        request.app_paused = true;
        let decision = decide_route(request).expect("decision");

        assert!(decision.suspended);
        assert!(!decision.can_execute);
    }

    #[test]
    fn test_prompt_invokes_selected_provider_when_executable() {
        let decision = decide_route(request(RouterMode::Auto)).expect("decision");
        let result = run_router_test(
            RouterTestRequest {
                decision,
                prompt: "hello".to_string(),
            },
            |request| {
                Ok(ProviderChatResponse {
                    provider_id: request.provider_id,
                    model_id: request.model_id.unwrap_or_default(),
                    response: "ok".to_string(),
                    tokens_in: 1,
                    tokens_out: 1,
                    latency_ms: 12,
                })
            },
        );

        assert_eq!(result.message, "Router test prompt completed.");
        assert_eq!(
            result
                .response
                .as_ref()
                .map(|response| response.response.as_str()),
            Some("ok")
        );
    }
}
