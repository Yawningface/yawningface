pub mod auth;
pub mod blocking;
pub mod schedule;
pub mod settings;
pub mod state;
pub mod sync;

use serde_json::json;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};
use tauri_plugin_autostart::MacosLauncher;

use crate::auth::DeviceCodeInfo;
use crate::settings::{load_json, save_json, LocalSession, Settings, Tokens};
use crate::state::AppState;
use crate::sync::EngineStatus;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FullState {
    settings: Settings,
    status: EngineStatus,
}

#[tauri::command]
fn get_state(app: AppHandle) -> FullState {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let status = state.status.lock().unwrap().clone();
    FullState { settings, status }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    save_json(&sync::settings_path(&app), &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    let _ = set_autostart(&app, settings.launch_at_login);
    Ok(())
}

#[tauri::command]
async fn login_start(app: AppHandle) -> Result<DeviceCodeInfo, String> {
    let (http, settings) = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap().clone();
        (state.http.clone(), settings)
    };
    if !settings.is_configured() {
        return Err("Fill in the server settings first.".into());
    }
    auth::start_device_flow(&http, &settings).await
}

#[tauri::command]
async fn login_poll(app: AppHandle, info: DeviceCodeInfo) -> Result<(), String> {
    let (http, settings) = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap().clone();
        (state.http.clone(), settings)
    };
    let tokens = auth::poll_device_flow(&http, &settings, &info).await?;

    save_json(&sync::tokens_path(&app), &tokens)?;
    {
        let state = app.state::<AppState>();
        *state.tokens.lock().unwrap() = Some(tokens.clone());
    }

    // Register this device with the backend (best effort — retried on demand).
    if let Ok(device_id) = sync::register_device(&app, &settings, &tokens).await {
        let state = app.state::<AppState>();
        let mut settings_now = state.settings.lock().unwrap();
        settings_now.device_id = Some(device_id);
        let _ = save_json(&sync::settings_path(&app), &*settings_now);
    }

    sync::push_event(&app.state::<AppState>(), "session_start", json!({}));
    let _ = sync_now(app).await;
    Ok(())
}

#[tauri::command]
fn logout(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.tokens.lock().unwrap() = None;
    let _ = std::fs::remove_file(sync::tokens_path(&app));
    let mut status = state.status.lock().unwrap();
    status.authenticated = false;
    status.user_name = None;
    status.user_email = None;
    let _ = app.emit("yf://status", status.clone());
    Ok(())
}

#[tauri::command]
async fn sync_now(app: AppHandle) -> Result<EngineStatus, String> {
    let result = sync::tick(&app).await;
    let state = app.state::<AppState>();
    let mut status = state.status.lock().unwrap();
    match result {
        Ok(()) => {
            status.last_sync = Some(chrono::Utc::now().to_rfc3339());
            status.last_sync_error = None;
        }
        Err(ref e) => status.last_sync_error = Some(e.clone()),
    }
    let _ = app.emit("yf://status", status.clone());
    let result = status.clone();
    drop(status);
    update_tray(&app);
    Ok(result)
}

/// One-click offline working session. `minutes: None` = until stopped.
#[tauri::command]
async fn start_session(app: AppHandle, minutes: Option<u64>) -> Result<EngineStatus, String> {
    {
        let state = app.state::<AppState>();
        let mut session = state.local_session.lock().unwrap();
        session.active = true;
        session.until = minutes.map(|m| {
            (chrono::Utc::now() + chrono::Duration::minutes(m as i64)).to_rfc3339()
        });
        save_json(&sync::session_path(&app), &*session)?;
        sync::push_event(&state, "session_start", json!({ "minutes": minutes, "local": true }));
    }
    sync_now(app).await
}

#[tauri::command]
async fn stop_session(app: AppHandle) -> Result<EngineStatus, String> {
    {
        let state = app.state::<AppState>();
        let mut session = state.local_session.lock().unwrap();
        session.active = false;
        session.until = None;
        save_json(&sync::session_path(&app), &*session)?;
        sync::push_event(&state, "session_stop", json!({ "local": true }));
    }
    sync_now(app).await
}

#[tauri::command]
async fn setup_hosts_helper(app: AppHandle) -> Result<(), String> {
    // Blocking admin-prompt call; run it off the async runtime.
    tauri::async_runtime::spawn_blocking(blocking::platform::install_helper)
        .await
        .map_err(|e| e.to_string())??;
    // Re-write the spool so the fresh daemon applies the current state.
    let domains = {
        let state = app.state::<AppState>();
        let d = state.last_domains.lock().unwrap().clone().unwrap_or_default();
        d
    };
    blocking::hosts::write_spool(&domains)?;
    blocking::platform::trigger_apply();
    let _ = sync_now(app).await;
    Ok(())
}

fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Handle to the tray's session menu item so its label can follow the
/// session state ("Start working session" <-> "End working session").
pub struct TrayUi {
    pub session_item: MenuItem<Wry>,
}

/// Keeps the tray menu label in sync with the running session.
pub fn update_tray(app: &AppHandle) {
    let running = {
        let state = app.state::<AppState>();
        let session = state.local_session.lock().unwrap();
        session.is_running()
    };
    if let Some(tray_ui) = app.try_state::<TrayUi>() {
        let label = if running {
            "End working session"
        } else {
            "Start working session (1 h)"
        };
        let _ = tray_ui.session_item.set_text(label);
    }
}

fn toggle_session_from_tray(app: &AppHandle) {
    let running = {
        let state = app.state::<AppState>();
        let session = state.local_session.lock().unwrap();
        session.is_running()
    };
    // Starting a session before the hosts helper exists would silently not
    // block websites — surface the one-time setup card instead of failing.
    if !running && !blocking::platform::helper_installed() {
        show_main_window(app);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = if running {
            stop_session(app.clone()).await
        } else {
            start_session(app.clone(), Some(60)).await
        };
        update_tray(&app);
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_settings,
            login_start,
            login_poll,
            logout,
            sync_now,
            start_session,
            stop_session,
            setup_hosts_helper
        ])
        .setup(|app| {
            // Load persisted state.
            let handle = app.handle().clone();
            let settings: Settings = load_json(&sync::settings_path(&handle));
            let tokens_file: Tokens = load_json(&sync::tokens_path(&handle));
            let tokens = (!tokens_file.access_token.is_empty()).then_some(tokens_file);
            let local_session: LocalSession = load_json(&sync::session_path(&handle));
            app.manage(AppState::new(settings.clone(), tokens, local_session));

            // Default-enable launch at login on first run.
            let _ = set_autostart(&handle, settings.launch_at_login);

            // macOS: menu-bar app feel (no Dock icon).
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Tray icon + menu. Clicking the tray icon opens this menu (both
            // buttons, macOS and Windows) — the window only opens on request.
            let session_item =
                MenuItemBuilder::with_id("session", "Start working session (1 h)").build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "Open YawningFace Block").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&session_item)
                .item(&open_item)
                .separator()
                .item(&quit_item)
                .build()?;
            app.manage(TrayUi { session_item });

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("YawningFace Block")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "session" => toggle_session_from_tray(app),
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            update_tray(&handle);

            // Show the window unless started hidden (autostart).
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden {
                show_main_window(&handle);
            }

            // Background engine.
            tauri::async_runtime::spawn(sync::run_sync_loop(handle.clone()));
            tauri::async_runtime::spawn(sync::run_killer_loop(handle.clone()));

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to tray; the app keeps blocking.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running YawningFace Block");
}
