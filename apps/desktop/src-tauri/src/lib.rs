mod app_state;
mod background_core;
mod hardware_probe;
mod installer_core;
mod model_catalog;
mod provider_core;
mod router_core;
mod updater_core;

use app_state::{
    state_file_path, AppStateSnapshot, AppStateStore, PauseHistoryEntry, PauseRequest,
    PauseSettings, PauseSource,
};
use background_core::{
    background_file_path, BackgroundManager, BackgroundSettings, BackgroundSnapshot,
    NotificationEvent, NotificationKind, NotificationSeverity,
};
use hardware_probe::{
    export_specs, list_fixtures, load_fixture, probe_live_specs, HardwareExportFormat,
    HardwareFixtureSummary, HardwareSpecs,
};
use installer_core::{InstallPlan, InstallRunState, InstallerManager, StartInstallRequest};
use model_catalog::{
    load_model_catalog, score_model_catalog, CompatibilityResult, ModelEntry,
    ScoreModelCatalogRequest,
};
use provider_core::{
    ProviderChatRequest, ProviderChatResponse, ProviderInstallPlan, ProviderLogEntry,
    ProviderManager, ProviderModel, ProviderSettings, ProviderSettingsPatch, ProviderStatus,
};
use router_core::{
    decide_route, run_router_test, RouterDecision, RouterDecisionRequest, RouterTestRequest,
    RouterTestResult,
};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use updater_core::{
    updater_file_path, CheckUpdatesRequest, UpdateActionRequest, UpdateCandidate, UpdaterManager,
    UpdaterSettings, UpdaterSnapshot,
};

type SharedAppState = Mutex<AppStateStore>;
type SharedBackgroundState = Mutex<BackgroundManager>;
type SharedInstallerState = Mutex<InstallerManager>;
type SharedProviderState = Mutex<ProviderManager>;
type SharedUpdaterState = Mutex<UpdaterManager>;

#[tauri::command]
fn get_app_state(app_state: State<'_, SharedAppState>) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    store.snapshot()
}

#[tauri::command]
fn pause_app(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
    provider_state: State<'_, SharedProviderState>,
    request: PauseRequest,
) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.pause(request)?;
    pause_providers(&app, &provider_state, "App paused")?;
    emit_app_state(&app, &snapshot);
    record_notification(
        &app,
        &background_state,
        NotificationKind::AppPaused,
        "Local AI Router paused",
        snapshot
            .pause_reason
            .clone()
            .unwrap_or_else(|| "Automation is suspended.".to_string()),
        NotificationSeverity::Info,
        &snapshot,
    )?;
    Ok(snapshot)
}

#[tauri::command]
fn resume_app(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
    provider_state: State<'_, SharedProviderState>,
    source: PauseSource,
) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.resume(source)?;
    resume_providers(&app, &provider_state)?;
    emit_app_state(&app, &snapshot);
    record_notification(
        &app,
        &background_state,
        NotificationKind::AppResumed,
        "Local AI Router resumed",
        "Background automation can run again.",
        NotificationSeverity::Info,
        &snapshot,
    )?;
    Ok(snapshot)
}

#[tauri::command]
fn update_pause_settings(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    settings: PauseSettings,
) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.update_settings(settings)?;
    emit_app_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn get_pause_history(
    app_state: State<'_, SharedAppState>,
) -> Result<Vec<PauseHistoryEntry>, String> {
    let store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    Ok(store.history())
}

#[tauri::command]
fn refresh_hardware_specs() -> Result<HardwareSpecs, String> {
    probe_live_specs()
}

#[tauri::command]
fn list_hardware_fixtures() -> Result<Vec<HardwareFixtureSummary>, String> {
    list_fixtures()
}

#[tauri::command]
fn load_hardware_fixture(id: String) -> Result<HardwareSpecs, String> {
    load_fixture(&id)
}

#[tauri::command]
fn export_hardware_specs(
    specs: HardwareSpecs,
    format: HardwareExportFormat,
) -> Result<String, String> {
    export_specs(&specs, format)
}

#[tauri::command]
fn get_model_catalog() -> Result<Vec<ModelEntry>, String> {
    load_model_catalog()
}

#[tauri::command]
fn score_models(request: ScoreModelCatalogRequest) -> Result<Vec<CompatibilityResult>, String> {
    score_model_catalog(request)
}

#[tauri::command]
fn decide_router_route(request: RouterDecisionRequest) -> Result<RouterDecision, String> {
    decide_route(request)
}

#[tauri::command]
fn decide_router_route_with_background(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
    request: RouterDecisionRequest,
) -> Result<RouterDecision, String> {
    let decision = decide_route(request.clone())?;
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.snapshot()?;
    if request.mode == router_core::RouterMode::Forced
        && request.hardware.load.memory_percent > f32::from(request.thresholds.max_memory_percent)
    {
        record_notification(
            &app,
            &background_state,
            NotificationKind::ForcedModelMemoryPressure,
            "Forced model memory pressure",
            "The forced route is above the configured memory threshold.",
            NotificationSeverity::Warning,
            &snapshot,
        )?;
    } else if decision.can_execute {
        let score = decision
            .selected
            .as_ref()
            .map(|candidate| candidate.score)
            .unwrap_or_default();
        if score < request.thresholds.min_score.saturating_add(5) {
            record_notification(
                &app,
                &background_state,
                NotificationKind::RouterDegraded,
                "Router route degraded",
                "The selected route is close to the minimum compatibility threshold.",
                NotificationSeverity::Warning,
                &snapshot,
            )?;
        } else if score
            >= request
                .thresholds
                .min_score
                .saturating_add(request.thresholds.upgrade_score_margin)
        {
            record_notification(
                &app,
                &background_state,
                NotificationKind::RouterUpgraded,
                "Router route upgraded",
                "The selected route clears the configured upgrade margin.",
                NotificationSeverity::Info,
                &snapshot,
            )?;
        }
    }
    Ok(decision)
}

#[tauri::command]
fn run_router_test_prompt(
    provider_state: State<'_, SharedProviderState>,
    request: RouterTestRequest,
) -> Result<RouterTestResult, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    Ok(run_router_test(request, |chat_request| {
        providers.chat(chat_request)
    }))
}

#[tauri::command]
fn list_install_plans(
    installer_state: State<'_, SharedInstallerState>,
) -> Result<Vec<InstallPlan>, String> {
    let installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    Ok(installer.plans())
}

#[tauri::command]
fn get_install_state(
    installer_state: State<'_, SharedInstallerState>,
) -> Result<InstallRunState, String> {
    let installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    Ok(installer.state())
}

#[tauri::command]
fn start_install_run(
    app: tauri::AppHandle,
    installer_state: State<'_, SharedInstallerState>,
    request: StartInstallRequest,
) -> Result<InstallRunState, String> {
    let mut installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    let state = installer.start(request)?;
    emit_install_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn advance_install_run(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
    installer_state: State<'_, SharedInstallerState>,
) -> Result<InstallRunState, String> {
    let mut installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    let state = installer.advance()?;
    emit_install_state(&app, &state);
    if matches!(state.status, installer_core::InstallRunStatus::Completed) {
        let mut store = app_state
            .lock()
            .map_err(|_| "app state lock poisoned".to_string())?;
        let snapshot = store.snapshot()?;
        record_notification(
            &app,
            &background_state,
            NotificationKind::ModelInstallComplete,
            "Installer dry-run completed",
            state
                .selected_plan_id
                .clone()
                .unwrap_or_else(|| "Recommended setup".to_string()),
            NotificationSeverity::Info,
            &snapshot,
        )?;
    }
    Ok(state)
}

#[tauri::command]
fn pause_install_run(
    app: tauri::AppHandle,
    installer_state: State<'_, SharedInstallerState>,
) -> Result<InstallRunState, String> {
    let mut installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    let state = installer.pause()?;
    emit_install_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn resume_install_run(
    app: tauri::AppHandle,
    installer_state: State<'_, SharedInstallerState>,
) -> Result<InstallRunState, String> {
    let mut installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    let state = installer.resume()?;
    emit_install_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn cancel_install_run(
    app: tauri::AppHandle,
    installer_state: State<'_, SharedInstallerState>,
) -> Result<InstallRunState, String> {
    let mut installer = installer_state
        .lock()
        .map_err(|_| "installer state lock poisoned".to_string())?;
    let state = installer.cancel()?;
    emit_install_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn list_provider_statuses(
    provider_state: State<'_, SharedProviderState>,
) -> Result<Vec<ProviderStatus>, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    Ok(providers.statuses())
}

#[tauri::command]
fn refresh_provider_health(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
    provider_state: State<'_, SharedProviderState>,
) -> Result<Vec<ProviderStatus>, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let statuses = providers.statuses();
    emit_provider_statuses(&app, &statuses);
    if let Some(status) = statuses
        .iter()
        .find(|status| matches!(status.health, provider_core::ProviderHealth::Error))
    {
        let mut store = app_state
            .lock()
            .map_err(|_| "app state lock poisoned".to_string())?;
        let snapshot = store.snapshot()?;
        record_notification(
            &app,
            &background_state,
            NotificationKind::ProviderCrash,
            format!("{} provider crashed", status.definition.name),
            status.message.clone(),
            NotificationSeverity::Critical,
            &snapshot,
        )?;
    }
    Ok(statuses)
}

#[tauri::command]
fn get_background_snapshot(
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
) -> Result<BackgroundSnapshot, String> {
    let mut app_store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = app_store.snapshot()?;
    let mut background = background_state
        .lock()
        .map_err(|_| "background state lock poisoned".to_string())?;
    Ok(background.snapshot(snapshot.lifecycle_state == app_state::LifecycleState::Paused))
}

#[tauri::command]
fn update_background_settings(
    app: tauri::AppHandle,
    background_state: State<'_, SharedBackgroundState>,
    settings: BackgroundSettings,
) -> Result<BackgroundSnapshot, String> {
    let mut background = background_state
        .lock()
        .map_err(|_| "background state lock poisoned".to_string())?;
    let executable_path = std::env::current_exe().ok();
    let snapshot = background.update_settings(settings, executable_path)?;
    let _ = app.emit("settings-changed", &snapshot.settings);
    let _ = app.emit("background-snapshot-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn run_background_tick(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
) -> Result<BackgroundSnapshot, String> {
    let mut app_store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let app_snapshot = app_store.snapshot()?;
    let app_paused = app_snapshot.lifecycle_state == app_state::LifecycleState::Paused;
    let mut background = background_state
        .lock()
        .map_err(|_| "background state lock poisoned".to_string())?;
    let snapshot = background.run_tick(app_paused)?;
    if app_paused {
        let event = background.record_notification(
            NotificationKind::BackgroundTaskSuspended,
            "Background tasks suspended",
            "Global pause is preventing scheduled background work.",
            NotificationSeverity::Info,
            true,
            app_snapshot
                .settings
                .allow_critical_health_security_notifications_while_paused,
        )?;
        emit_notification_event(&app, &event);
    }
    let _ = app.emit("background-snapshot-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn send_test_notification(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    background_state: State<'_, SharedBackgroundState>,
) -> Result<NotificationEvent, String> {
    let mut app_store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = app_store.snapshot()?;
    let event = record_notification(
        &app,
        &background_state,
        NotificationKind::Test,
        "Local AI Router notification test",
        "Native notification bridge is connected.",
        NotificationSeverity::Info,
        &snapshot,
    )?;
    Ok(event)
}

#[tauri::command]
fn start_provider(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<ProviderStatus, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let status = providers.start(&provider_id)?;
    emit_provider_status(&app, &status);
    Ok(status)
}

#[tauri::command]
fn stop_provider(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<ProviderStatus, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let status = providers.stop(&provider_id)?;
    emit_provider_status(&app, &status);
    Ok(status)
}

#[tauri::command]
fn pause_provider_tasks(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
    reason: String,
) -> Result<ProviderStatus, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let status = providers.pause(&provider_id, &reason)?;
    emit_provider_status(&app, &status);
    Ok(status)
}

#[tauri::command]
fn resume_provider_tasks(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<ProviderStatus, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let status = providers.resume(&provider_id)?;
    emit_provider_status(&app, &status);
    Ok(status)
}

#[tauri::command]
fn list_provider_models(
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<Vec<ProviderModel>, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    providers.list_models(&provider_id)
}

#[tauri::command]
fn send_provider_test_chat(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    request: ProviderChatRequest,
) -> Result<ProviderChatResponse, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let response = providers.chat(request)?;
    let logs = providers.logs(Some(&response.provider_id));
    let _ = app.emit("log-appended", logs.first());
    Ok(response)
}

#[tauri::command]
fn get_provider_logs(
    provider_state: State<'_, SharedProviderState>,
    provider_id: Option<String>,
) -> Result<Vec<ProviderLogEntry>, String> {
    let providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    Ok(providers.logs(provider_id.as_deref()))
}

#[tauri::command]
fn get_provider_folder(
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<String, String> {
    let providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    providers.folder(&provider_id)
}

#[tauri::command]
fn get_provider_settings(
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<ProviderSettings, String> {
    let providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    providers.settings(&provider_id)
}

#[tauri::command]
fn update_provider_settings(
    app: tauri::AppHandle,
    provider_state: State<'_, SharedProviderState>,
    patch: ProviderSettingsPatch,
) -> Result<ProviderStatus, String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let status = providers.update_settings(patch)?;
    emit_provider_status(&app, &status);
    Ok(status)
}

#[tauri::command]
fn preview_provider_install_plan(
    provider_state: State<'_, SharedProviderState>,
    provider_id: String,
) -> Result<ProviderInstallPlan, String> {
    let providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    providers.install_plan(&provider_id)
}

#[tauri::command]
fn get_updater_snapshot(
    updater_state: State<'_, SharedUpdaterState>,
) -> Result<UpdaterSnapshot, String> {
    let updater = updater_state
        .lock()
        .map_err(|_| "updater state lock poisoned".to_string())?;
    Ok(updater.snapshot())
}

#[tauri::command]
fn update_updater_settings(
    app: tauri::AppHandle,
    updater_state: State<'_, SharedUpdaterState>,
    settings: UpdaterSettings,
) -> Result<UpdaterSnapshot, String> {
    let mut updater = updater_state
        .lock()
        .map_err(|_| "updater state lock poisoned".to_string())?;
    let snapshot = updater.update_settings(settings)?;
    let _ = app.emit("settings-changed", &snapshot.settings);
    let _ = app.emit("updater-snapshot-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn check_updates_now(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    updater_state: State<'_, SharedUpdaterState>,
    mut request: CheckUpdatesRequest,
) -> Result<UpdaterSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let app_snapshot = store.snapshot()?;
    request.app_paused = app_snapshot.lifecycle_state == app_state::LifecycleState::Paused;
    let mut updater = updater_state
        .lock()
        .map_err(|_| "updater state lock poisoned".to_string())?;
    let snapshot = updater.check_updates(request)?;
    emit_updater_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn apply_update_action(
    app: tauri::AppHandle,
    updater_state: State<'_, SharedUpdaterState>,
    request: UpdateActionRequest,
) -> Result<UpdaterSnapshot, String> {
    let mut updater = updater_state
        .lock()
        .map_err(|_| "updater state lock poisoned".to_string())?;
    let snapshot = updater.apply_action(request)?;
    emit_updater_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
            let store = AppStateStore::load(state_file_path(&app_data_dir))?;
            let background = BackgroundManager::load(background_file_path(&app_data_dir))?;
            let updater = UpdaterManager::load(updater_file_path(&app_data_dir))?;
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(background));
            app.manage(Mutex::new(InstallerManager::seeded(app_data_dir)));
            app.manage(Mutex::new(ProviderManager::seeded()));
            app.manage(Mutex::new(updater));
            install_pause_menu_and_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            pause_app,
            resume_app,
            update_pause_settings,
            get_pause_history,
            refresh_hardware_specs,
            list_hardware_fixtures,
            load_hardware_fixture,
            export_hardware_specs,
            get_model_catalog,
            score_models,
            decide_router_route,
            decide_router_route_with_background,
            run_router_test_prompt,
            list_install_plans,
            get_install_state,
            start_install_run,
            advance_install_run,
            pause_install_run,
            resume_install_run,
            cancel_install_run,
            list_provider_statuses,
            refresh_provider_health,
            start_provider,
            stop_provider,
            pause_provider_tasks,
            resume_provider_tasks,
            list_provider_models,
            send_provider_test_chat,
            get_provider_logs,
            get_provider_folder,
            get_provider_settings,
            update_provider_settings,
            preview_provider_install_plan,
            get_background_snapshot,
            update_background_settings,
            run_background_tick,
            send_test_notification,
            get_updater_snapshot,
            update_updater_settings,
            check_updates_now,
            apply_update_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local AI Router desktop shell");
}

fn emit_app_state(app: &tauri::AppHandle, snapshot: &AppStateSnapshot) {
    let _ = app.emit("app-state-changed", snapshot);
    let _ = app.emit("log-appended", snapshot.pause_history.last());
}

fn emit_provider_status(app: &tauri::AppHandle, status: &ProviderStatus) {
    let _ = app.emit("provider-health-changed", status);
}

fn emit_provider_statuses(app: &tauri::AppHandle, statuses: &[ProviderStatus]) {
    for status in statuses {
        emit_provider_status(app, status);
    }
}

fn emit_install_state(app: &tauri::AppHandle, state: &InstallRunState) {
    let _ = app.emit("install-progress-changed", state);
    let _ = app.emit("log-appended", state.logs.first());
}

fn emit_notification_event(app: &tauri::AppHandle, event: &NotificationEvent) {
    let _ = app.emit("notification-event", event);
    let _ = app.emit("log-appended", event);
}

fn emit_updater_snapshot(app: &tauri::AppHandle, snapshot: &UpdaterSnapshot) {
    let _ = app.emit("updater-snapshot-changed", snapshot);
    for candidate in &snapshot.candidates {
        emit_update_candidate(app, candidate);
    }
}

fn emit_update_candidate(app: &tauri::AppHandle, candidate: &UpdateCandidate) {
    let _ = app.emit("update-found", candidate);
}

fn record_notification(
    app: &tauri::AppHandle,
    background_state: &State<'_, SharedBackgroundState>,
    kind: NotificationKind,
    title: impl Into<String>,
    body: impl Into<String>,
    severity: NotificationSeverity,
    snapshot: &AppStateSnapshot,
) -> Result<NotificationEvent, String> {
    let mut background = background_state
        .lock()
        .map_err(|_| "background state lock poisoned".to_string())?;
    let event = background.record_notification(
        kind,
        title,
        body,
        severity,
        snapshot.lifecycle_state == app_state::LifecycleState::Paused,
        snapshot
            .settings
            .allow_critical_health_security_notifications_while_paused,
    )?;
    emit_notification_event(app, &event);
    Ok(event)
}

fn pause_providers(
    app: &tauri::AppHandle,
    provider_state: &State<'_, SharedProviderState>,
    reason: &str,
) -> Result<(), String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let statuses = providers.pause_all(reason);
    emit_provider_statuses(app, &statuses);
    Ok(())
}

fn resume_providers(
    app: &tauri::AppHandle,
    provider_state: &State<'_, SharedProviderState>,
) -> Result<(), String> {
    let mut providers = provider_state
        .lock()
        .map_err(|_| "provider state lock poisoned".to_string())?;
    let statuses = providers.resume_all();
    emit_provider_statuses(app, &statuses);
    Ok(())
}

fn install_pause_menu_and_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let pause_now = MenuItem::with_id(
        app,
        "pause_now",
        "Pause Local AI Router",
        true,
        None::<&str>,
    )?;
    let resume_now = MenuItem::with_id(
        app,
        "resume_now",
        "Resume Local AI Router",
        true,
        None::<&str>,
    )?;
    let submenu = Submenu::with_items(app, "Local AI Router", true, &[&pause_now, &resume_now])?;
    let menu = Menu::with_items(app, &[&submenu])?;
    app.set_menu(menu)?;
    let tray_pause = MenuItem::with_id(
        app,
        "tray_pause_now",
        "Pause Local AI Router",
        true,
        None::<&str>,
    )?;
    let tray_resume = MenuItem::with_id(
        app,
        "tray_resume_now",
        "Resume Local AI Router",
        true,
        None::<&str>,
    )?;
    let tray_menu = Menu::with_items(app, &[&tray_pause, &tray_resume])?;
    let mut tray_available = false;
    if let Some(icon) = app.default_window_icon().cloned() {
        if TrayIconBuilder::with_id("local-ai-router")
            .tooltip("Local AI Router")
            .icon(icon)
            .menu(&tray_menu)
            .show_menu_on_left_click(true)
            .build(app)
            .is_ok()
        {
            tray_available = true;
        }
    }
    if let Some(background_state) = app.try_state::<SharedBackgroundState>() {
        if let Ok(mut background) = background_state.lock() {
            if let Ok(snapshot) = background.mark_tray_available(tray_available) {
                let _ = app.emit("background-snapshot-changed", &snapshot);
            }
        }
    }
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "pause_now" | "tray_pause_now" => {
            if let Some(state) = app.try_state::<SharedAppState>() {
                if let Ok(mut store) = state.lock() {
                    if let Ok(snapshot) = store.pause(PauseRequest {
                        source: PauseSource::Tray,
                        duration: app_state::PauseDuration::UntilManualResume,
                        reason: "Native menu pause".to_string(),
                    }) {
                        emit_app_state(app, &snapshot);
                        if let Some(background_state) = app.try_state::<SharedBackgroundState>() {
                            let _ = record_notification(
                                app,
                                &background_state,
                                NotificationKind::AppPaused,
                                "Local AI Router paused",
                                "Native menu pause",
                                NotificationSeverity::Info,
                                &snapshot,
                            );
                        }
                    }
                }
            }
            if let Some(provider_state) = app.try_state::<SharedProviderState>() {
                if let Ok(mut providers) = provider_state.lock() {
                    let statuses = providers.pause_all("Native menu pause");
                    emit_provider_statuses(app, &statuses);
                }
            }
        }
        "resume_now" | "tray_resume_now" => {
            if let Some(state) = app.try_state::<SharedAppState>() {
                if let Ok(mut store) = state.lock() {
                    if let Ok(snapshot) = store.resume(PauseSource::Tray) {
                        emit_app_state(app, &snapshot);
                        if let Some(background_state) = app.try_state::<SharedBackgroundState>() {
                            let _ = record_notification(
                                app,
                                &background_state,
                                NotificationKind::AppResumed,
                                "Local AI Router resumed",
                                "Native menu resume",
                                NotificationSeverity::Info,
                                &snapshot,
                            );
                        }
                    }
                }
            }
            if let Some(provider_state) = app.try_state::<SharedProviderState>() {
                if let Ok(mut providers) = provider_state.lock() {
                    let statuses = providers.resume_all();
                    emit_provider_statuses(app, &statuses);
                }
            }
        }
        _ => {}
    });
    Ok(())
}
