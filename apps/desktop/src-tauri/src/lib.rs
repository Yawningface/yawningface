pub mod auth;
pub mod blocking;
pub mod browser_extensions;
pub mod native_messaging;
pub mod schedule;
pub mod settings;
pub mod state;
pub mod stats;
pub mod sync;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};
use tauri_plugin_autostart::MacosLauncher;

use crate::auth::DeviceCodeInfo;
use crate::settings::{load_json, save_json, Appearance, LocalSession, Settings, Tokens};
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
    native_messaging::write_bridge_appearance(settings.appearance.clone())?;
    let _ = set_autostart(&app, settings.launch_at_login);
    Ok(())
}

/// Appearance is an immediate preference. Updating only this field avoids an
/// in-progress Settings form overwriting fresher account/device fields.
#[tauri::command]
fn save_appearance(app: AppHandle, appearance: Appearance) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let settings = {
        let current = state.settings.lock().unwrap();
        let mut next = current.clone();
        next.appearance = appearance;
        next
    };
    save_json(&sync::settings_path(&app), &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    native_messaging::write_bridge_appearance(settings.appearance.clone())?;
    Ok(settings)
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

    // Register this device with the backend (best effort - retried on demand).
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
        let started_at = chrono::Utc::now();
        session.active = true;
        session.started_at = Some(started_at.to_rfc3339());
        session.until =
            minutes.map(|m| (started_at + chrono::Duration::minutes(m as i64)).to_rfc3339());
        save_json(&sync::session_path(&app), &*session)?;
        sync::push_event(
            &state,
            "session_start",
            json!({ "minutes": minutes, "local": true }),
        );
    }
    sync::record_stats(&app, |s| s.record_session_start());
    sync_now(app).await
}

/// The on-device history behind the Insights page.
#[tauri::command]
fn get_stats(app: AppHandle) -> stats::Stats {
    let _ = native_messaging::drain_events(&app);
    let state = app.state::<AppState>();
    let stats = state.stats.lock().unwrap();
    stats.clone()
}

/// Browser/profile-level installation status for the Chrome extension.
#[tauri::command]
fn get_browser_extensions() -> browser_extensions::BrowserExtensionScan {
    browser_extensions::scan()
}

#[tauri::command]
async fn stop_session(app: AppHandle) -> Result<EngineStatus, String> {
    let cancelled = {
        let state = app.state::<AppState>();
        let session = state.local_session.lock().unwrap();
        session.is_running()
    };
    {
        let state = app.state::<AppState>();
        let mut session = state.local_session.lock().unwrap();
        session.active = false;
        session.started_at = None;
        session.until = None;
        save_json(&sync::session_path(&app), &*session)?;
        sync::push_event(
            &state,
            "session_stop",
            json!({ "local": true, "cancelled": cancelled }),
        );
    }
    if cancelled {
        sync::record_stats(&app, |s| s.record_cancellation("working"));
    }
    sync_now(app).await
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LocalConfigInfo {
    path: String,
    config: serde_json::Value,
}

/// The local scheduled-sessions config (canonical schema, shared with `yf`).
#[tauri::command]
fn get_local_config(app: AppHandle) -> LocalConfigInfo {
    let path = sync::local_config_path(&app);
    let mut config: serde_json::Value = load_json(&path);
    if !config.is_object() {
        config = json!({ "version": 1, "blocklists": [] });
    }
    LocalConfigInfo {
        path: path.to_string_lossy().into_owned(),
        config,
    }
}

#[tauri::command]
async fn save_local_config(
    app: AppHandle,
    config: serde_json::Value,
) -> Result<EngineStatus, String> {
    if !config
        .get("blocklists")
        .map(|b| b.is_array())
        .unwrap_or(false)
    {
        return Err("Config must contain a blocklists array.".into());
    }
    let previous: serde_json::Value = load_json(&sync::local_config_path(&app));
    let before = schedule::evaluate(&previous);
    let after = schedule::evaluate(&config);
    let cancelled_active_schedule = before.active_lists.len() > after.active_lists.len();

    save_json(&sync::local_config_path(&app), &config)?;
    if cancelled_active_schedule {
        {
            let state = app.state::<AppState>();
            sync::push_event(
                &state,
                "blocker_deactivated",
                json!({ "source": "scheduled", "local": true }),
            );
        }
        sync::record_stats(&app, |s| s.record_cancellation("scheduled"));
    }
    sync_now(app).await
}

/// Tough Mode (macOS): asks the root helper to lock the current block set
/// (plus the default session list) at the hosts level for `minutes`.
/// Deliberately, there is no command to end it early - not here, not in the
/// helper. Quitting or uninstalling the app does not lift the lock.
#[tauri::command]
async fn start_tough_mode(app: AppHandle, minutes: u64) -> Result<EngineStatus, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, minutes);
        Err("Tough Mode is only available on macOS for now.".into())
    }
    #[cfg(target_os = "macos")]
    {
        if !blocking::platform::helper_installed() {
            return Err("Enable website blocking first (the one-time setup).".into());
        }
        let minutes = minutes.clamp(1, 7 * 24 * 60);
        let domains = {
            let state = app.state::<AppState>();
            let mut d = state
                .last_domains
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_default();
            for dd in crate::settings::DEFAULT_SESSION_DOMAINS {
                d.insert(dd.to_string());
            }
            d
        };
        let until = chrono::Utc::now().timestamp() + minutes as i64 * 60;
        blocking::lock::write_lock_request(until, &domains)?;
        blocking::platform::trigger_apply();

        // Do not tell the UI this irreversible action succeeded until the
        // root-owned state proves the helper consumed the complete request.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if blocking::lock::read_active_lock()
                .as_ref()
                .is_some_and(|lock| blocking::lock::satisfies_request(lock, until, &domains))
            {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(
                    "Tough Mode was requested, but the system helper did not confirm it within 10 seconds. Check the status before assuming websites are locked."
                        .into(),
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        {
            let state = app.state::<AppState>();
            sync::push_event(
                &state,
                "tough_mode_started",
                json!({ "minutes": minutes, "domains": domains.len() }),
            );
        }
        sync_now(app).await
    }
}

#[tauri::command]
async fn setup_hosts_helper(app: AppHandle) -> Result<(), String> {
    // Blocking admin-prompt call; run it off the async runtime.
    tauri::async_runtime::spawn_blocking(blocking::platform::install_helper)
        .await
        .map_err(|e| e.to_string())??;

    // Re-write the spool so the fresh helper applies the current state.
    let domains = {
        let state = app.state::<AppState>();
        let d = state
            .last_domains
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default();
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

/// A dev build says so in the titlebar and the taskbar, so it is never
/// mistaken for the installed app while both are around.
fn mark_dev_window(app: &AppHandle) {
    if !IS_DEV_BUILD {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title("DEV · yawningface");
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub const TRAY_ID: &str = "main-tray";

/// A `tauri dev` build. Shipped installers are release builds, so this is
/// false for every user. Used to keep the dev app visibly distinct.
pub const IS_DEV_BUILD: bool = cfg!(debug_assertions);

fn tray_tooltip(running: bool) -> String {
    let base = if running {
        "yawningface: blocking. Open the app to end the session."
    } else {
        "yawningface: off. Click to block for 1 h."
    };
    if IS_DEV_BUILD {
        format!("DEV · {base}")
    } else {
        base.to_string()
    }
}

/// Tray state: the menu item whose label follows the session, and the active
/// and idle icons. The tray starts sessions; ending one belongs to the app.
pub struct TrayUi {
    pub session_item: MenuItem<Wry>,
    pub icon_active: Image<'static>,
    pub icon_idle: Image<'static>,
    /// A toggle already in flight.
    pub toggling: AtomicBool,
    /// When the last toggle was accepted. The Windows shell can deliver the
    /// same tray click more than once (and adds a DoubleClick on top), so a
    /// single physical click would otherwise toggle twice and land back where
    /// it started - the "I clicked it and nothing happened" bug.
    pub last_toggle: Mutex<Instant>,
}

/// Clicks closer together than this are the same physical click.
const TOGGLE_DEBOUNCE: Duration = Duration::from_millis(600);

/// Keeps the tray icon, tooltip and menu label in sync with the session.
///
/// The tray handle is main-thread-only on Windows: touching it from the sync
/// loop's thread silently corrupts the icon (it disappears from the tray and
/// stops delivering clicks). Everything below is therefore marshalled onto the
/// main thread, no matter which thread asked for the update.
pub fn update_tray(app: &AppHandle) {
    let running = {
        let state = app.state::<AppState>();
        let session = state.local_session.lock().unwrap();
        session.is_running()
    };

    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(tray_ui) = app.try_state::<TrayUi>() else {
            return;
        };

        let _ = tray_ui.session_item.set_text(if running {
            "Working session active - open app to end"
        } else {
            "Start working session (1 h)"
        });

        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let icon = if running {
                tray_ui.icon_active.clone()
            } else {
                tray_ui.icon_idle.clone()
            };
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_tooltip(Some(tray_tooltip(running)));
        }
    });
}

fn start_session_from_tray(app: &AppHandle) {
    let running = {
        let state = app.state::<AppState>();
        let session = state.local_session.lock().unwrap();
        session.is_running()
    };

    // A tray click must never deactivate protection. If a session is already
    // running, take the user to the only place where it can be ended.
    if running {
        show_main_window(app);
        return;
    }

    if let Some(tray_ui) = app.try_state::<TrayUi>() {
        // Collapse the shell's repeated clicks into one, then ignore anything
        // that arrives while the previous toggle is still applying.
        {
            let mut last = tray_ui.last_toggle.lock().unwrap();
            if last.elapsed() < TOGGLE_DEBOUNCE {
                return;
            }
            *last = Instant::now();
        }
        if tray_ui
            .toggling
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
    }

    // Starting a session before the hosts helper exists would silently not
    // block websites - surface the one-time setup card instead of failing.
    if !running && !blocking::platform::helper_installed() {
        show_main_window(app);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = start_session(app.clone(), Some(60)).await;
        update_tray(&app);
        if let Some(tray_ui) = app.try_state::<TrayUi>() {
            tray_ui.toggling.store(false, Ordering::SeqCst);
        }
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
            save_appearance,
            login_start,
            login_poll,
            logout,
            sync_now,
            start_session,
            stop_session,
            get_local_config,
            save_local_config,
            get_stats,
            get_browser_extensions,
            start_tough_mode,
            setup_hosts_helper
        ])
        .setup(|app| {
            // Load persisted state.
            let handle = app.handle().clone();
            let settings: Settings = load_json(&sync::settings_path(&handle));
            let tokens_file: Tokens = load_json(&sync::tokens_path(&handle));
            let tokens = (!tokens_file.access_token.is_empty()).then_some(tokens_file);
            let local_session: LocalSession = load_json(&sync::session_path(&handle));
            let stats: stats::Stats = load_json(&sync::stats_path(&handle));
            app.manage(AppState::new(
                settings.clone(),
                tokens,
                local_session,
                stats,
            ));

            // Per-user registration needs no elevation. Repeating it repairs
            // the executable path after an update, and the initial drain makes
            // attempts recorded while the app was closed visible immediately.
            let _ = native_messaging::install_host();
            let _ = native_messaging::drain_events(&handle);

            // Default-enable launch at login on first run.
            let _ = set_autostart(&handle, settings.launch_at_login);

            // macOS: menu-bar app feel (no Dock icon).
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // A left-click starts a 1 h working session. Once active, the same
            // click opens the app; it never ends protection from the tray.
            // Right-click opens the menu for everything else.
            let session_item =
                MenuItemBuilder::with_id("session", "Start working session (1 h)").build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "Open yawningface").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&session_item)
                .item(&open_item)
                .separator()
                .item(&quit_item)
                .build()?;
            app.manage(TrayUi {
                session_item,
                icon_active: Image::from_bytes(include_bytes!("../icons/tray-active.png"))?,
                icon_idle: Image::from_bytes(include_bytes!("../icons/tray-idle.png"))?,
                toggling: AtomicBool::new(false),
                last_toggle: Mutex::new(Instant::now() - TOGGLE_DEBOUNCE),
            });

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    // Toggle on button-up so a click that started elsewhere
                    // (a drag onto the icon) does not fire it.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        start_session_from_tray(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "session" => start_session_from_tray(app),
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            update_tray(&handle);
            mark_dev_window(&handle);

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
        .expect("error while running yawningface");
}
