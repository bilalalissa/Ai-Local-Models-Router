use crate::hardware_probe::{HardwareSpecs, PlatformFamily};
use serde::{Deserialize, Serialize};

const SEED_CATALOG: &str = include_str!("../../../../fixtures/model_catalog/seed_models.json");

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ProviderKind {
    Ollama,
    LmStudio,
    MlxLm,
    LlamaCpp,
    OpenAiCompatible,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum UseCase {
    GeneralChat,
    Coding,
    Summarization,
    Reasoning,
    Embeddings,
    Multimodal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PreferenceTag {
    Fast,
    Balanced,
    Quality,
    LowMemory,
    LocalOnly,
    Code,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CompatibilityLabel {
    Smooth,
    Good,
    Tight,
    Avoid,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub display_name: String,
    pub family: String,
    pub parameters_b: f32,
    pub quantization: String,
    pub format: String,
    pub size_bytes: u64,
    pub min_ram_bytes: u64,
    pub recommended_ram_bytes: u64,
    pub min_vram_bytes: Option<u64>,
    pub recommended_vram_bytes: Option<u64>,
    pub supported_platforms: Vec<PlatformFamily>,
    pub providers: Vec<ProviderKind>,
    pub use_cases: Vec<UseCase>,
    pub preference_tags: Vec<PreferenceTag>,
    pub installed: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ScoreInputs {
    pub ram: u8,
    pub vram: u8,
    pub cpu_load: u8,
    pub gpu_load: u8,
    pub provider_support: u8,
    pub disk: u8,
    pub platform: u8,
    pub use_case: u8,
    pub preference: u8,
    pub installed_status: u8,
    pub pause_state: u8,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CompatibilityResult {
    pub model: ModelEntry,
    pub label: CompatibilityLabel,
    pub score: u8,
    pub inputs: ScoreInputs,
    pub reasons: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ScoreModelCatalogRequest {
    pub hardware: HardwareSpecs,
    pub use_case: UseCase,
    pub preferred_provider: Option<ProviderKind>,
    pub preference_tags: Vec<PreferenceTag>,
    pub installed_only: bool,
    pub app_paused: bool,
}

pub fn load_model_catalog() -> Result<Vec<ModelEntry>, String> {
    serde_json::from_str::<Vec<ModelEntry>>(SEED_CATALOG)
        .map_err(|err| format!("invalid model catalog seed data: {err}"))
}

pub fn score_model_catalog(
    request: ScoreModelCatalogRequest,
) -> Result<Vec<CompatibilityResult>, String> {
    let mut results = load_model_catalog()?
        .into_iter()
        .map(|model| score_model(&request, model))
        .filter(|result| !request.installed_only || result.model.installed)
        .collect::<Vec<_>>();

    results.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| label_rank(&b.label).cmp(&label_rank(&a.label)))
            .then_with(|| a.model.display_name.cmp(&b.model.display_name))
    });
    Ok(results)
}

fn score_model(request: &ScoreModelCatalogRequest, model: ModelEntry) -> CompatibilityResult {
    let mut reasons = Vec::new();
    let mut blockers = Vec::new();
    let platform = score_platform(request, &model, &mut reasons, &mut blockers);
    let ram = score_ram(request, &model, &mut reasons, &mut blockers);
    let vram = score_vram(request, &model, &mut reasons, &mut blockers);
    let cpu_load = score_load(request.hardware.load.cpu_percent, "CPU", &mut reasons);
    let gpu_load = score_optional_load(request.hardware.load.gpu_percent, "GPU", &mut reasons);
    let provider_support = score_provider(request, &model, &mut reasons, &mut blockers);
    let disk = score_disk(request, &model, &mut reasons, &mut blockers);
    let use_case = score_use_case(request, &model, &mut reasons);
    let preference = score_preference(request, &model, &mut reasons);
    let installed_status = score_installed(request, &model, &mut reasons);
    let pause_state = score_pause(request.app_paused, &mut reasons);

    let inputs = ScoreInputs {
        ram,
        vram,
        cpu_load,
        gpu_load,
        provider_support,
        disk,
        platform,
        use_case,
        preference,
        installed_status,
        pause_state,
    };
    let base_score = weighted_score(&inputs);
    let score = if has_critical_blocker(&blockers) {
        base_score.min(44)
    } else {
        base_score
    };
    let label = compatibility_label(score, &blockers);

    CompatibilityResult {
        model,
        label,
        score,
        inputs,
        reasons,
        blockers,
    }
}

fn score_platform(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
    blockers: &mut Vec<String>,
) -> u8 {
    if model
        .supported_platforms
        .contains(&request.hardware.platform.family)
    {
        reasons.push(format!(
            "Platform supported: {:?}",
            request.hardware.platform.family
        ));
        100
    } else {
        blockers.push(format!(
            "Platform unsupported: {:?}",
            request.hardware.platform.family
        ));
        0
    }
}

fn score_ram(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
    blockers: &mut Vec<String>,
) -> u8 {
    let total = request.hardware.memory.total_bytes;
    if total >= model.recommended_ram_bytes {
        reasons.push("RAM meets recommended target.".to_string());
        100
    } else if total >= model.min_ram_bytes {
        reasons.push("RAM meets minimum target but not recommended target.".to_string());
        70
    } else {
        blockers.push("RAM is below model minimum.".to_string());
        15
    }
}

fn score_vram(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
    blockers: &mut Vec<String>,
) -> u8 {
    let Some(min_vram) = model.min_vram_bytes else {
        reasons.push("Model does not require dedicated VRAM.".to_string());
        return 100;
    };

    let available = available_vram_bytes(&request.hardware);
    if available >= model.recommended_vram_bytes.unwrap_or(min_vram) {
        reasons.push("VRAM/unified memory meets recommended target.".to_string());
        100
    } else if available >= min_vram {
        reasons.push("VRAM/unified memory meets minimum target.".to_string());
        70
    } else {
        blockers.push("VRAM/unified memory is below model minimum.".to_string());
        20
    }
}

fn score_load(load: f32, label: &str, reasons: &mut Vec<String>) -> u8 {
    if load <= 45.0 {
        reasons.push(format!("{label} load has comfortable headroom."));
        100
    } else if load <= 70.0 {
        reasons.push(format!("{label} load is moderate."));
        78
    } else if load <= 85.0 {
        reasons.push(format!("{label} load is high."));
        52
    } else {
        reasons.push(format!("{label} load is near saturation."));
        25
    }
}

fn score_optional_load(load: Option<f32>, label: &str, reasons: &mut Vec<String>) -> u8 {
    match load {
        Some(value) => score_load(value, label, reasons),
        None => {
            reasons.push(format!("{label} load is not reported."));
            75
        }
    }
}

fn score_provider(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
    blockers: &mut Vec<String>,
) -> u8 {
    if let Some(provider) = &request.preferred_provider {
        if model.providers.contains(provider) {
            reasons.push(format!("Preferred provider supported: {provider:?}."));
            100
        } else {
            blockers.push(format!("Preferred provider unsupported: {provider:?}."));
            25
        }
    } else if model.providers.is_empty() {
        blockers.push("No provider support listed.".to_string());
        0
    } else {
        reasons.push("At least one planned local provider supports this model.".to_string());
        90
    }
}

fn score_disk(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
    blockers: &mut Vec<String>,
) -> u8 {
    let available = request
        .hardware
        .storage
        .iter()
        .map(|volume| volume.available_bytes)
        .max()
        .unwrap_or_default();
    if available >= model.size_bytes.saturating_mul(2) {
        reasons.push("Disk space can hold model plus working margin.".to_string());
        100
    } else if available >= model.size_bytes {
        reasons.push("Disk space can hold model but margin is limited.".to_string());
        70
    } else {
        blockers.push("Disk space is below model artifact size.".to_string());
        20
    }
}

fn score_use_case(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
) -> u8 {
    if model.use_cases.contains(&request.use_case) {
        reasons.push(format!("Use case matched: {:?}.", request.use_case));
        100
    } else {
        reasons.push(format!(
            "Use case {:?} is not a primary catalog tag.",
            request.use_case
        ));
        55
    }
}

fn score_preference(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
) -> u8 {
    if request.preference_tags.is_empty() {
        reasons.push("No preference tag selected.".to_string());
        return 80;
    }

    let matches = request
        .preference_tags
        .iter()
        .filter(|tag| model.preference_tags.contains(tag))
        .count();
    if matches == request.preference_tags.len() {
        reasons.push("All selected preference tags matched.".to_string());
        100
    } else if matches > 0 {
        reasons.push("Some selected preference tags matched.".to_string());
        75
    } else {
        reasons.push("Selected preference tags did not match.".to_string());
        45
    }
}

fn score_installed(
    request: &ScoreModelCatalogRequest,
    model: &ModelEntry,
    reasons: &mut Vec<String>,
) -> u8 {
    if model.installed {
        reasons.push("Model is marked installed in the seed catalog.".to_string());
        100
    } else if request.installed_only {
        0
    } else {
        reasons.push("Model is not installed yet.".to_string());
        65
    }
}

fn score_pause(app_paused: bool, reasons: &mut Vec<String>) -> u8 {
    if app_paused {
        reasons.push(
            "App is paused; recommendations remain visible but install/switch actions are gated."
                .to_string(),
        );
        70
    } else {
        reasons.push("App is running; model actions are not pause-gated.".to_string());
        100
    }
}

fn weighted_score(inputs: &ScoreInputs) -> u8 {
    let weighted = f32::from(inputs.platform) * 2.0
        + f32::from(inputs.ram) * 2.0
        + f32::from(inputs.vram) * 1.5
        + f32::from(inputs.cpu_load)
        + f32::from(inputs.gpu_load) * 0.75
        + f32::from(inputs.provider_support) * 1.25
        + f32::from(inputs.disk) * 0.75
        + f32::from(inputs.use_case) * 0.75
        + f32::from(inputs.preference) * 0.5
        + f32::from(inputs.installed_status) * 0.5
        + f32::from(inputs.pause_state) * 0.25;
    (weighted / 11.25).round().clamp(0.0, 100.0) as u8
}

fn compatibility_label(score: u8, blockers: &[String]) -> CompatibilityLabel {
    if has_critical_blocker(blockers) || score < 45 {
        CompatibilityLabel::Avoid
    } else if score >= 86 {
        CompatibilityLabel::Smooth
    } else if score >= 70 {
        CompatibilityLabel::Good
    } else {
        CompatibilityLabel::Tight
    }
}

fn has_critical_blocker(blockers: &[String]) -> bool {
    blockers
        .iter()
        .any(|blocker| blocker.contains("unsupported") || blocker.contains("below model minimum"))
}

fn available_vram_bytes(hardware: &HardwareSpecs) -> u64 {
    if hardware.memory.unified_memory {
        return hardware.memory.total_bytes;
    }

    hardware
        .gpus
        .iter()
        .filter_map(|gpu| gpu.memory_bytes)
        .max()
        .unwrap_or_default()
}

fn label_rank(label: &CompatibilityLabel) -> u8 {
    match label {
        CompatibilityLabel::Smooth => 4,
        CompatibilityLabel::Good => 3,
        CompatibilityLabel::Tight => 2,
        CompatibilityLabel::Avoid => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware_probe::load_fixture;

    fn request_for_fixture(
        fixture_id: &str,
        use_case: UseCase,
        provider: Option<ProviderKind>,
    ) -> ScoreModelCatalogRequest {
        ScoreModelCatalogRequest {
            hardware: load_fixture(fixture_id).expect("fixture loads"),
            use_case,
            preferred_provider: provider,
            preference_tags: vec![PreferenceTag::Balanced],
            installed_only: false,
            app_paused: false,
        }
    }

    #[test]
    fn parses_seed_catalog_for_all_target_platforms() {
        let catalog = load_model_catalog().expect("catalog parses");

        assert!(catalog.len() >= 8);
        assert!(catalog.iter().any(|model| model
            .supported_platforms
            .contains(&PlatformFamily::MacAppleSilicon)));
        assert!(catalog.iter().any(|model| model
            .supported_platforms
            .contains(&PlatformFamily::MacIntel)));
        assert!(catalog.iter().any(|model| model
            .supported_platforms
            .contains(&PlatformFamily::WindowsX64)));
    }

    #[test]
    fn apple_silicon_scores_mlx_coding_model_highly() {
        let request = request_for_fixture(
            "apple-silicon-m3-pro-18gb",
            UseCase::Coding,
            Some(ProviderKind::MlxLm),
        );
        let results = score_model_catalog(request).expect("scores catalog");
        let qwen_mlx = results
            .iter()
            .find(|result| result.model.id == "qwen2-5-coder-7b-mlx")
            .expect("mlx model exists");

        assert!(matches!(
            qwen_mlx.label,
            CompatibilityLabel::Smooth | CompatibilityLabel::Good
        ));
        assert!(qwen_mlx.score >= 80);
    }

    #[test]
    fn intel_mac_8gb_marks_large_models_avoid_and_small_model_viable() {
        let request = request_for_fixture("intel-mac-8gb", UseCase::GeneralChat, None);
        let results = score_model_catalog(request).expect("scores catalog");
        let small = results
            .iter()
            .find(|result| result.model.id == "phi-3-5-mini-q4")
            .expect("small model exists");
        let large = results
            .iter()
            .find(|result| result.model.id == "llama-3-1-70b-q4")
            .expect("large model exists");

        assert!(matches!(
            small.label,
            CompatibilityLabel::Smooth | CompatibilityLabel::Good
        ));
        assert_eq!(large.label, CompatibilityLabel::Avoid);
    }

    #[test]
    fn windows_gtx_1060_scores_8b_models_and_checks_vram() {
        let request = request_for_fixture(
            "windows-gtx-1060-30gb",
            UseCase::GeneralChat,
            Some(ProviderKind::Ollama),
        );
        let results = score_model_catalog(request).expect("scores catalog");
        let llama = results
            .iter()
            .find(|result| result.model.id == "llama-3-1-8b-q4")
            .expect("llama model exists");
        let qwen_14b = results
            .iter()
            .find(|result| result.model.id == "qwen2-5-14b-q4")
            .expect("qwen 14b exists");

        assert!(matches!(
            llama.label,
            CompatibilityLabel::Smooth | CompatibilityLabel::Good
        ));
        assert!(qwen_14b.inputs.vram < llama.inputs.vram);
    }

    #[test]
    fn pause_state_lowers_pause_component_without_hiding_scores() {
        let mut request = request_for_fixture("intel-mac-16gb", UseCase::GeneralChat, None);
        request.app_paused = true;
        let results = score_model_catalog(request).expect("scores catalog");

        assert!(!results.is_empty());
        assert!(results.iter().all(|result| result.inputs.pause_state == 70));
    }

    #[test]
    fn installed_only_filter_returns_installed_models() {
        let mut request =
            request_for_fixture("apple-silicon-m3-pro-18gb", UseCase::GeneralChat, None);
        request.installed_only = true;
        let results = score_model_catalog(request).expect("scores catalog");

        assert!(!results.is_empty());
        assert!(results.iter().all(|result| result.model.installed));
    }
}
