mod app_state;
mod hardware_probe;

use app_state::{
    state_file_path, AppStateSnapshot, AppStateStore, PauseHistoryEntry, PauseRequest,
    PauseSettings, PauseSource,
};
use hardware_probe::{
    export_specs, list_fixtures, load_fixture, probe_live_specs, HardwareExportFormat,
    HardwareFixtureSummary, HardwareSpecs,
};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Emitter, Manager, State,
};

type SharedAppState = Mutex<AppStateStore>;

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
    request: PauseRequest,
) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.pause(request)?;
    emit_app_state(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn resume_app(
    app: tauri::AppHandle,
    app_state: State<'_, SharedAppState>,
    source: PauseSource,
) -> Result<AppStateSnapshot, String> {
    let mut store = app_state
        .lock()
        .map_err(|_| "app state lock poisoned".to_string())?;
    let snapshot = store.resume(source)?;
    emit_app_state(&app, &snapshot);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
            let store = AppStateStore::load(state_file_path(&app_data_dir))?;
            app.manage(Mutex::new(store));
            install_pause_menu(app.handle())?;
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
            export_hardware_specs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local AI Router desktop shell");
}

fn emit_app_state(app: &tauri::AppHandle, snapshot: &AppStateSnapshot) {
    let _ = app.emit("app-state-changed", snapshot);
    let _ = app.emit("log-appended", snapshot.pause_history.last());
}

fn install_pause_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
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
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "pause_now" => {
            if let Some(state) = app.try_state::<SharedAppState>() {
                if let Ok(mut store) = state.lock() {
                    if let Ok(snapshot) = store.pause(PauseRequest {
                        source: PauseSource::Tray,
                        duration: app_state::PauseDuration::UntilManualResume,
                        reason: "Native menu pause".to_string(),
                    }) {
                        emit_app_state(app, &snapshot);
                    }
                }
            }
        }
        "resume_now" => {
            if let Some(state) = app.try_state::<SharedAppState>() {
                if let Ok(mut store) = state.lock() {
                    if let Ok(snapshot) = store.resume(PauseSource::Tray) {
                        emit_app_state(app, &snapshot);
                    }
                }
            }
        }
        _ => {}
    });
    Ok(())
}
