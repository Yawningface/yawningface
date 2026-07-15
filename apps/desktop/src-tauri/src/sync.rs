//! Background engine: keeps tokens fresh, pulls config from block_cloud,
//! evaluates schedules, applies blocking, and ships usage events upstream.
//! Works offline from the last cached config.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use tauri::{AppHandle, Emitter, Manager};

use crate::blocking::{apps, hosts, platform};
use crate::schedule::{self, BlockSet};
use crate::settings::{load_json, save_json, Settings, Tokens};
use crate::state::AppState;

pub const SYNC_INTERVAL_SECS: u64 = 30;
pub const KILL_INTERVAL_SECS: u64 = 5;
const HEARTBEAT_EVERY_TICKS: u64 = 10; // 10 * 30s = every 5 minutes

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub configured: bool,
    pub authenticated: bool,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub device_name: String,
    pub last_sync: Option<String>,
    pub last_sync_error: Option<String>,
    pub active_lists: Vec<String>,
    pub blocked_domains: usize,
    pub blocked_apps: usize,
    pub hosts_helper_installed: bool,
    pub hosts_in_sync: bool,
    pub session_active: bool,
    pub session_started_at: Option<String>,
    pub session_until: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutEvent {
    pub r#type: String,
    pub occurred_at: String,
    pub payload: Value,
}

pub fn push_event(state: &AppState, r#type: &str, payload: Value) {
    let mut q = state.event_queue.lock().unwrap();
    if q.len() < 1000 {
        q.push(OutEvent {
            r#type: r#type.to_string(),
            occurred_at: chrono::Utc::now().to_rfc3339(),
            payload,
        });
    }
}

/// Main loop: token refresh + config pull + blocking apply + event flush.
pub async fn run_sync_loop(app: AppHandle) {
    let mut ticks: u64 = 0;
    loop {
        let _ = crate::native_messaging::drain_events(&app);
        let result = tick(&app).await;
        {
            let state = app.state::<AppState>();
            let mut status = state.status.lock().unwrap();
            match result {
                Ok(()) => {
                    status.last_sync = Some(chrono::Utc::now().to_rfc3339());
                    status.last_sync_error = None;
                }
                Err(e) => status.last_sync_error = Some(e),
            }
            let _ = app.emit("yf://status", status.clone());
        }
        crate::update_tray(&app);

        ticks += 1;
        if ticks % HEARTBEAT_EVERY_TICKS == 1 {
            let state = app.state::<AppState>();
            push_event(&state, "heartbeat", json!({}));
        }

        // Focused time is measured, not estimated: one interval of blocking is
        // credited only after that interval has actually elapsed.
        tokio::time::sleep(std::time::Duration::from_secs(SYNC_INTERVAL_SECS)).await;
        // Read the state again after the interval. A user may have ended a
        // session while we slept; in that case the red deactivation marker
        // must be followed by grey rather than a span extending past it.
        let (working, scheduled) = {
            let state = app.state::<AppState>();
            let status = state.status.lock().unwrap();
            (
                status.session_active,
                status
                    .active_lists
                    .iter()
                    .any(|name| name != "Working session"),
            )
        };
        record_stats(&app, |s| {
            s.record_tick(working, scheduled, SYNC_INTERVAL_SECS)
        });
    }
}

/// Mutates the on-device history and persists it.
pub fn record_stats(app: &AppHandle, f: impl FnOnce(&mut crate::stats::Stats)) {
    let state = app.state::<AppState>();
    let snapshot = {
        let mut stats = state.stats.lock().unwrap();
        f(&mut stats);
        stats.clone()
    };
    let _ = save_json(&stats_path(app), &snapshot);
}

/// Fast loop: kill blocked apps.
pub async fn run_killer_loop(app: AppHandle) {
    let mut system = sysinfo::System::new();
    loop {
        let blocked: BTreeSet<String> = {
            let state = app.state::<AppState>();
            let set = state.blocked_apps.lock().unwrap();
            set.clone()
        };
        let killed = apps::kill_blocked(&mut system, &blocked);
        if !killed.is_empty() {
            for name in killed {
                {
                    let state = app.state::<AppState>();
                    push_event(&state, "app_blocked", json!({ "app": name.clone() }));
                }
                record_stats(&app, |s| s.record_app_blocked(&name));
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(KILL_INTERVAL_SECS)).await;
    }
}

pub async fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();

    {
        let mut status = state.status.lock().unwrap();
        status.configured = settings.is_configured();
        status.device_name = settings.device_name.clone();
        status.hosts_helper_installed = platform::helper_installed();
    }

    // 1. Fresh token (when signed in).
    let tokens = ensure_fresh_token(app, &settings).await;

    // 2. Pull config (or fall back to cache when offline/signed out).
    let config = match &tokens {
        Some(t) if settings.is_configured() => {
            match fetch_config(&state.http, &settings, t).await {
                Ok(cfg) => {
                    let _ = save_json(&config_cache_path(app), &cfg);
                    Some(cfg)
                }
                Err(e) => {
                    // Offline or server trouble: keep enforcing the cached config.
                    let cached: Value = load_json(&config_cache_path(app));
                    if cached.is_null() {
                        return Err(e);
                    }
                    Some(cached)
                }
            }
        }
        _ => {
            let cached: Value = load_json(&config_cache_path(app));
            (!cached.is_null()).then_some(cached)
        }
    };

    // 3. Evaluate schedules -> desired block set.
    let mut block_set = config
        .as_ref()
        .map(schedule::evaluate)
        .unwrap_or_default();

    // 3a. Local scheduled sessions: same canonical schema, no account needed.
    // This is the file the yf CLI reads and edits (point YF_CONFIG at it).
    let local_config: Value = load_json(&local_config_path(app));
    if !local_config.is_null() {
        let local_set = schedule::evaluate(&local_config);
        block_set.domains.extend(local_set.domains);
        block_set.apps.extend(local_set.apps);
        for name in local_set.active_lists {
            if !block_set.active_lists.contains(&name) {
                block_set.active_lists.push(name);
            }
        }
    }

    // 3b. Merge the local one-click working session (works with no account).
    let session = {
        let mut session = state.local_session.lock().unwrap();
        // Auto-expire a session whose end time passed.
        if session.active && !session.is_running() {
            session.active = false;
            session.started_at = None;
            session.until = None;
            let _ = save_json(&session_path(app), &*session);
        } else if session.is_running() && session.started_at.is_none() {
            // Older local-session files predate progress tracking. Starting
            // their bar at upgrade time preserves an honest countdown without
            // pretending we know when that already-running session began.
            session.started_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = save_json(&session_path(app), &*session);
        }
        session.clone()
    };
    if session.is_running() {
        block_set
            .active_lists
            .push("Working session".to_string());
        for d in crate::settings::DEFAULT_SESSION_DOMAINS {
            block_set.domains.insert(d.to_string());
        }
        for d in &session.domains {
            let d = schedule::normalize_domain(d);
            if !d.is_empty() {
                block_set.domains.insert(d);
            }
        }
        for a in &session.apps {
            if !a.trim().is_empty() {
                block_set.apps.insert(a.trim().to_string());
            }
        }
    }

    // Browser exceptions are desktop-owned receipts created only after the
    // extension submits a written reason. They bend this one domain for ten
    // minutes without weakening the schedule or working session itself.
    let browser_exemptions = crate::native_messaging::active_exemptions();
    block_set
        .domains
        .retain(|domain| !browser_exemptions.contains(domain));

    // 4. Apply blocking.
    apply_block_set(app, &block_set)?;
    crate::native_messaging::write_bridge_state(
        app,
        &block_set.domains,
        &block_set.active_lists,
        if session.is_running() {
            session.until.clone()
        } else {
            None
        },
    )?;

    // 5. Flush events + update device heartbeat.
    if let Some(t) = &tokens {
        if settings.is_configured() {
            let _ = flush_events(app, &settings, t).await;
        }
    }

    // 6. Publish status.
    {
        let mut status = state.status.lock().unwrap();
        status.authenticated = tokens.is_some();
        if let Some(t) = &tokens {
            status.user_name = t.user_name.clone();
            status.user_email = t.user_email.clone();
        } else {
            status.user_name = None;
            status.user_email = None;
        }
        status.active_lists = block_set.active_lists.clone();
        status.blocked_domains = block_set.domains.len();
        status.blocked_apps = block_set.apps.len();
        status.hosts_in_sync = hosts::hosts_section_matches(&block_set.domains);
        status.session_active = session.is_running();
        status.session_started_at = if session.is_running() {
            session.started_at.clone()
        } else {
            None
        };
        status.session_until = if session.is_running() {
            session.until.clone()
        } else {
            None
        };
    }
    Ok(())
}

pub fn session_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("local_session.json")
}

fn apply_block_set(app: &AppHandle, block_set: &BlockSet) -> Result<(), String> {
    let state = app.state::<AppState>();

    // Apps: hand the set to the killer loop.
    {
        let mut blocked_apps = state.blocked_apps.lock().unwrap();
        *blocked_apps = block_set.apps.clone();
    }

    // Domains: only touch the spool/hosts when the set changed. `None` means
    // first tick after launch - always write, to clean up any stale state a
    // previous run left behind.
    let changed = {
        let mut last = state.last_domains.lock().unwrap();
        if last.as_ref() != Some(&block_set.domains) {
            *last = Some(block_set.domains.clone());
            true
        } else {
            false
        }
    };
    if changed {
        // Direct write works if we happen to be elevated; otherwise the spool
        // is picked up by the privileged applier.
        if hosts::apply_direct(&block_set.domains).is_err() {
            hosts::write_spool(&block_set.domains)?;
            platform::trigger_apply();
        }
        push_event(
            &state,
            "blocking_applied",
            json!({
                "domains": block_set.domains.len(),
                "apps": block_set.apps.len(),
                "lists": block_set.active_lists,
            }),
        );
    }
    Ok(())
}

async fn ensure_fresh_token(app: &AppHandle, settings: &Settings) -> Option<Tokens> {
    let state = app.state::<AppState>();
    let current = state.tokens.lock().unwrap().clone();
    let tokens = current?;
    if !tokens.is_expired() {
        return Some(tokens);
    }
    match crate::auth::refresh(&state.http, settings, &tokens).await {
        Ok(new_tokens) => {
            let _ = save_json(&tokens_path(app), &new_tokens);
            *state.tokens.lock().unwrap() = Some(new_tokens.clone());
            Some(new_tokens)
        }
        Err(_) => None, // stay signed-out-ish until the user logs in again
    }
}

async fn fetch_config(
    http: &reqwest::Client,
    settings: &Settings,
    tokens: &Tokens,
) -> Result<Value, String> {
    let url = format!("{}/api/v1/config", settings.api_base_url.trim_end_matches('/'));
    let resp = http
        .get(&url)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server returned {} for /config", resp.status()));
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body.get("config").cloned().unwrap_or(body))
}

pub async fn register_device(
    app: &AppHandle,
    settings: &Settings,
    tokens: &Tokens,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let url = format!("{}/api/v1/devices", settings.api_base_url.trim_end_matches('/'));
    let resp = state
        .http
        .post(&url)
        .bearer_auth(&tokens.access_token)
        .json(&json!({
            "deviceId": settings.device_id,
            "name": settings.device_name,
            "platform": crate::settings::platform(),
            "appVersion": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Device registration failed: {}", resp.status()));
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    body.get("deviceId")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "Server response missing deviceId".into())
}

async fn flush_events(
    app: &AppHandle,
    settings: &Settings,
    tokens: &Tokens,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (device_id, batch) = {
        let settings_now = state.settings.lock().unwrap();
        let Some(device_id) = settings_now.device_id.clone() else {
            return Ok(()); // not registered yet; keep queueing
        };
        let mut q = state.event_queue.lock().unwrap();
        if q.is_empty() {
            return Ok(());
        }
        let batch: Vec<OutEvent> = q.drain(..).collect();
        (device_id, batch)
    };

    let url = format!("{}/api/v1/events", settings.api_base_url.trim_end_matches('/'));
    let resp = state
        .http
        .post(&url)
        .bearer_auth(&tokens.access_token)
        .json(&json!({ "deviceId": device_id, "events": batch }))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => Ok(()),
        _ => {
            // Put the batch back so nothing is lost.
            let mut q = state.event_queue.lock().unwrap();
            let mut restored = batch;
            restored.extend(q.drain(..));
            *q = restored;
            q.truncate(1000);
            Err("Could not deliver events; will retry.".into())
        }
    }
}

pub fn config_cache_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("config_cache.json")
}

/// On-device history for Insights. Never uploaded.
pub fn stats_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("stats.json")
}

/// Local scheduled sessions, in the canonical schema. Named yawningface.json
/// on purpose: it is a valid config for the yf CLI, so the app and the CLI
/// edit the same document.
pub fn local_config_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("yawningface.json")
}

pub fn tokens_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("auth.json")
}

pub fn settings_path(app: &AppHandle) -> std::path::PathBuf {
    app_config_dir(app).join("settings.json")
}

fn app_config_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| hosts::data_dir())
}
