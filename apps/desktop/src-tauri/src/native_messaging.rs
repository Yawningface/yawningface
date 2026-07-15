//! Local bridge between the Chromium extension and desktop Insights.
//!
//! Chrome launches this same executable as a Native Messaging host. The host
//! validates one small event, writes it atomically to a per-user spool, replies
//! to Chrome, and exits. The normal desktop process drains that spool into its
//! on-device stats. Keeping the hand-off file-based means attempts survive when
//! the desktop window (or the whole desktop process) is closed.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::settings::save_json;
use crate::state::AppState;

pub const HOST_NAME: &str = "com.yawningface.desktop";
pub const STORE_EXTENSION_ID: &str = "kfnhibndbkdjcplihjhbhdhclpbiocen";
pub const GITHUB_EXTENSION_ID: &str = "pbpgbdnamekjeifocnifopkecnphchjb";
pub const EXTENSION_IDS: [&str; 2] = [GITHUB_EXTENSION_ID, STORE_EXTENSION_ID];

const PROTOCOL_VERSION: u32 = 1;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_IMPORTED_DOMAINS: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEvent {
    pub protocol_version: u32,
    pub event_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub counts: BTreeMap<String, u32>,
    pub occurred_at: String,
    pub extension_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingEvent {
    protocol_version: u32,
    event_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    counts: BTreeMap<String, u32>,
    #[serde(default)]
    occurred_at: Option<String>,
}

/// Chrome supplies the calling extension origin as an argument when it starts
/// a native host. A normal app launch has no such argument and continues into
/// Tauri. An unrecognised origin is deliberately rejected before the UI starts.
pub fn run_if_requested(args: &[String]) -> Option<i32> {
    let origin = args
        .iter()
        .skip(1)
        .find(|arg| arg.starts_with("chrome-extension://"))?;

    let extension_id = match extension_id_from_origin(origin) {
        Some(id) => id,
        None => {
            let _ = write_native_message(&json!({
                "ok": false,
                "error": "This extension is not allowed to use the yawningface bridge."
            }));
            return Some(1);
        }
    };

    let result = read_native_message()
        .and_then(|incoming| validate_event(incoming, extension_id))
        .and_then(|event| {
            let event_id = event.event_id.clone();
            persist_event(&event)?;
            Ok(event_id)
        });

    match result {
        Ok(event_id) => {
            let _ = write_native_message(&json!({ "ok": true, "eventId": event_id }));
            Some(0)
        }
        Err(error) => {
            let _ = write_native_message(&json!({ "ok": false, "error": error }));
            Some(1)
        }
    }
}

fn extension_id_from_origin(origin: &str) -> Option<&'static str> {
    EXTENSION_IDS.iter().copied().find(|id| {
        origin == format!("chrome-extension://{id}")
            || origin == format!("chrome-extension://{id}/")
    })
}

fn read_native_message() -> Result<IncomingEvent, String> {
    let mut length = [0_u8; 4];
    std::io::stdin()
        .read_exact(&mut length)
        .map_err(|e| format!("Could not read message length: {e}"))?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_MESSAGE_BYTES {
        return Err("Native message has an invalid size.".into());
    }

    let mut body = vec![0_u8; length];
    std::io::stdin()
        .read_exact(&mut body)
        .map_err(|e| format!("Could not read native message: {e}"))?;
    serde_json::from_slice(&body).map_err(|e| format!("Invalid native message JSON: {e}"))
}

fn write_native_message(value: &serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let length = u32::try_from(body.len()).map_err(|_| "Native response is too large.")?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&length.to_le_bytes())
        .and_then(|_| stdout.write_all(&body))
        .and_then(|_| stdout.flush())
        .map_err(|e| format!("Could not write native response: {e}"))
}

fn validate_event(raw: IncomingEvent, extension_id: &str) -> Result<BrowserEvent, String> {
    if raw.protocol_version != PROTOCOL_VERSION {
        return Err("Unsupported yawningface bridge protocol.".into());
    }
    if raw.event_id.is_empty()
        || raw.event_id.len() > 100
        || !raw
            .event_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid browser event identifier.".into());
    }

    let occurred_at = raw.occurred_at.unwrap_or_else(|| Utc::now().to_rfc3339());
    if DateTime::parse_from_rfc3339(&occurred_at).is_err() {
        return Err("Invalid browser event timestamp.".into());
    }

    let (domain, counts) = match raw.event_type.as_str() {
        "site_blocked" => {
            let domain = normalize_domain(raw.domain.as_deref().unwrap_or_default())
                .ok_or("Invalid blocked domain.")?;
            (Some(domain), BTreeMap::new())
        }
        "site_counts" => {
            if raw.counts.len() > MAX_IMPORTED_DOMAINS {
                return Err("Too many domains in the attempt-count import.".into());
            }
            let mut counts = BTreeMap::new();
            for (domain, count) in raw.counts {
                if count == 0 {
                    continue;
                }
                let domain = normalize_domain(&domain).ok_or("Invalid imported domain.")?;
                *counts.entry(domain).or_default() += count.min(1_000_000);
            }
            (None, counts)
        }
        _ => return Err("Unsupported browser event type.".into()),
    };

    Ok(BrowserEvent {
        protocol_version: PROTOCOL_VERSION,
        event_id: raw.event_id,
        event_type: raw.event_type,
        domain,
        counts,
        occurred_at,
        extension_id: extension_id.to_string(),
    })
}

fn normalize_domain(value: &str) -> Option<String> {
    let domain = value.trim().trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() || domain.len() > 253 || domain.contains("..") {
        return None;
    }
    if domain.split('.').any(|label| {
        label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }) {
        return None;
    }
    Some(domain)
}

fn config_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default())
            .join("org.yawningface.block.desktop");
    }
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join("Library/Application Support/org.yawningface.block.desktop");
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Some(root) = std::env::var_os("XDG_CONFIG_HOME") {
            PathBuf::from(root).join("org.yawningface.block.desktop")
        } else {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join(".config/org.yawningface.block.desktop")
        }
    }
}

fn events_dir() -> PathBuf {
    config_root().join("browser-events")
}

fn persist_event(event: &BrowserEvent) -> Result<(), String> {
    persist_event_in(&events_dir(), event)
}

fn persist_event_in(dir: &Path, event: &BrowserEvent) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = format!("{}-{}.json", event.extension_id, event.event_id);
    let destination = dir.join(&name);
    if destination.is_file() {
        return Ok(());
    }

    let temporary = dir.join(format!("{name}.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(event).map_err(|e| e.to_string())?;
    {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())
}

/// Import every complete spool file into local Insights. Files are removed
/// only after the updated stats document has been saved successfully.
pub fn drain_events(app: &AppHandle) -> Result<usize, String> {
    let dir = events_dir();
    if !dir.is_dir() {
        return Ok(0);
    }

    let mut pending = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let event = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| {
                serde_json::from_slice::<BrowserEvent>(&bytes).map_err(|e| e.to_string())
            });
        match event {
            Ok(event) => pending.push((path, event)),
            Err(_) => {
                let _ = std::fs::rename(&path, path.with_extension("invalid"));
            }
        }
    }
    pending.sort_by(|a, b| a.0.cmp(&b.0));
    if pending.is_empty() {
        return Ok(0);
    }

    let state = app.state::<AppState>();
    let snapshot = {
        let mut stats = state.stats.lock().unwrap();
        for (_, event) in &pending {
            match event.event_type.as_str() {
                "site_blocked" => {
                    if let Some(domain) = &event.domain {
                        stats.record_site_blocked(&event.event_id, domain, &event.occurred_at);
                    }
                }
                "site_counts" => {
                    stats.import_site_counts(&event.event_id, &event.counts, &event.occurred_at);
                }
                _ => {}
            }
        }
        stats.clone()
    };

    save_json(&crate::sync::stats_path(app), &snapshot)?;
    for (path, _) in &pending {
        let _ = std::fs::remove_file(path);
    }
    Ok(pending.len())
}

fn manifest_value(executable: &Path) -> serde_json::Value {
    json!({
        "name": HOST_NAME,
        "description": "Local yawningface browser-to-desktop bridge",
        "path": executable.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": EXTENSION_IDS
            .iter()
            .map(|id| format!("chrome-extension://{id}/"))
            .collect::<Vec<_>>()
    })
}

fn write_manifest(path: &Path, executable: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_vec_pretty(&manifest_value(executable)).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

/// Register the per-user native host. This does not require elevation and is
/// safe to repeat on every desktop start, which also repairs paths after an
/// application update or move.
pub fn install_host() -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let manifest = config_root()
            .join("native-messaging")
            .join(format!("{HOST_NAME}.json"));
        write_manifest(&manifest, &executable)?;
        let manifest = manifest.to_string_lossy().to_string();
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        let reg = PathBuf::from(windir).join("System32/reg.exe");
        for vendor in [
            r"Google\Chrome",
            r"Microsoft\Edge",
            r"BraveSoftware\Brave-Browser",
            r"Vivaldi",
        ] {
            let key = format!(r"HKCU\Software\{vendor}\NativeMessagingHosts\{HOST_NAME}");
            let output = crate::blocking::platform::quiet_command(&reg)
                .args(["add", &key, "/ve", "/t", "REG_SZ", "/d", &manifest, "/f"])
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!("Could not register browser bridge for {vendor}."));
            }
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        for relative in [
            "Library/Application Support/Google/Chrome/NativeMessagingHosts",
            "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
            "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
            "Library/Application Support/Vivaldi/NativeMessagingHosts",
        ] {
            write_manifest(
                &home.join(relative).join(format!("{HOST_NAME}.json")),
                &executable,
            )?;
        }
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        for relative in [
            ".config/google-chrome/NativeMessagingHosts",
            ".config/chromium/NativeMessagingHosts",
            ".config/microsoft-edge/NativeMessagingHosts",
            ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        ] {
            write_manifest(
                &home.join(relative).join(format!("{HOST_NAME}.json")),
                &executable,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn incoming(event_type: &str) -> IncomingEvent {
        IncomingEvent {
            protocol_version: PROTOCOL_VERSION,
            event_id: "event-123".into(),
            event_type: event_type.into(),
            domain: Some("Twitter.COM.".into()),
            counts: BTreeMap::new(),
            occurred_at: Some("2026-07-15T16:00:00Z".into()),
        }
    }

    #[test]
    fn accepts_only_known_extension_origins() {
        assert_eq!(
            extension_id_from_origin(&format!("chrome-extension://{GITHUB_EXTENSION_ID}/")),
            Some(GITHUB_EXTENSION_ID)
        );
        assert_eq!(
            extension_id_from_origin("chrome-extension://aaaaaaaa/"),
            None
        );
    }

    #[test]
    fn normalizes_site_attempts() {
        let event = validate_event(incoming("site_blocked"), GITHUB_EXTENSION_ID).unwrap();
        assert_eq!(event.domain.as_deref(), Some("twitter.com"));
        assert_eq!(event.extension_id, GITHUB_EXTENSION_ID);
    }

    #[test]
    fn writes_complete_spool_file() {
        let root = std::env::temp_dir().join(format!(
            "yawningface-native-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let event = validate_event(incoming("site_blocked"), GITHUB_EXTENSION_ID).unwrap();
        persist_event_in(&root, &event).unwrap();
        let files: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
        let stored: BrowserEvent =
            serde_json::from_slice(&std::fs::read(files[0].path()).unwrap()).unwrap();
        assert_eq!(stored.event_id, event.event_id);
        let _ = std::fs::remove_dir_all(root);
    }
}
