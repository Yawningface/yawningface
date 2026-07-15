use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

pub const EXTENSION_ID: &str = crate::native_messaging::GITHUB_EXTENSION_ID;
pub const EXTENSION_IDS: [&str; 2] = crate::native_messaging::EXTENSION_IDS;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExtensionStatus {
    pub id: String,
    pub name: String,
    pub profiles: usize,
    pub installed_profiles: usize,
    pub enabled_profiles: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExtensionScan {
    pub extension_id: String,
    pub browsers: Vec<BrowserExtensionStatus>,
}

struct BrowserSpec {
    id: &'static str,
    name: &'static str,
    data_root: PathBuf,
    executables: Vec<PathBuf>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProfileState {
    Missing,
    Disabled,
    Enabled,
}

/// Inspect browser-owned profile metadata, like established desktop blockers
/// do. This is deliberately read-only: browsers remain in charge of installing
/// and enabling their extensions.
pub fn scan() -> BrowserExtensionScan {
    let browsers = browser_specs()
        .into_iter()
        .filter(|spec| browser_is_present(spec))
        .map(scan_browser)
        .collect();

    BrowserExtensionScan {
        extension_id: EXTENSION_ID.to_string(),
        browsers,
    }
}

fn scan_browser(spec: BrowserSpec) -> BrowserExtensionStatus {
    let profiles = profile_dirs(&spec.data_root);
    let states: Vec<_> = profiles
        .iter()
        .map(|profile| scan_profile(profile))
        .collect();

    BrowserExtensionStatus {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        profiles: states.len(),
        installed_profiles: states
            .iter()
            .filter(|state| **state != ProfileState::Missing)
            .count(),
        enabled_profiles: states
            .iter()
            .filter(|state| **state == ProfileState::Enabled)
            .count(),
    }
}

fn browser_is_present(spec: &BrowserSpec) -> bool {
    spec.executables.iter().any(|path| path.exists())
        || spec.data_root.join("Local State").is_file()
        || spec.data_root.join("Preferences").is_file()
}

fn profile_dirs(root: &Path) -> Vec<PathBuf> {
    let mut profiles = BTreeSet::new();

    // Opera-family profiles keep Preferences directly in their data folder.
    if root.join("Preferences").is_file() || root.join("Secure Preferences").is_file() {
        profiles.insert(root.to_path_buf());
    }

    if let Some(local_state) = read_json(&root.join("Local State")) {
        if let Some(cache) = local_state
            .get("profile")
            .and_then(|profile| profile.get("info_cache"))
            .and_then(Value::as_object)
        {
            for profile in cache.keys() {
                profiles.insert(root.join(profile));
            }
        }
    }

    // Keep working when Local State is absent, stale, or from a newer schema.
    // Do not add Chromium's System/Guest profiles when info_cache succeeded.
    if profiles.is_empty() {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir()
                    && (path.join("Preferences").is_file()
                        || path.join("Secure Preferences").is_file())
                {
                    profiles.insert(path);
                }
            }
        }
    }

    profiles.into_iter().collect()
}

fn scan_profile(profile: &Path) -> ProfileState {
    let states: Vec<_> = EXTENSION_IDS
        .iter()
        .map(|extension_id| scan_profile_id(profile, extension_id))
        .collect();
    if states.contains(&ProfileState::Enabled) {
        ProfileState::Enabled
    } else if states.contains(&ProfileState::Disabled) {
        ProfileState::Disabled
    } else {
        ProfileState::Missing
    }
}

fn scan_profile_id(profile: &Path, extension_id: &str) -> ProfileState {
    let mut found = false;
    for name in ["Secure Preferences", "Preferences"] {
        let Some(json) = read_json(&profile.join(name)) else {
            continue;
        };
        let Some(extension) = json
            .get("extensions")
            .and_then(|extensions| extensions.get("settings"))
            .and_then(|settings| settings.get(extension_id))
        else {
            continue;
        };

        found = true;
        if extension_is_enabled(extension) {
            return ProfileState::Enabled;
        }
    }

    if found {
        ProfileState::Disabled
    } else {
        ProfileState::Missing
    }
}

fn extension_is_enabled(extension: &Value) -> bool {
    if extension.get("state").and_then(Value::as_i64) == Some(0) {
        return false;
    }

    match extension.get("disable_reasons") {
        Some(Value::Array(reasons)) if !reasons.is_empty() => false,
        Some(Value::Object(reasons)) if !reasons.is_empty() => false,
        Some(Value::Number(reasons)) if reasons.as_u64().unwrap_or(0) != 0 => false,
        _ => true,
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(target_os = "windows")]
fn browser_specs() -> Vec<BrowserSpec> {
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default());
    let roaming = PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default());
    let program_files = PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_default());
    let program_files_x86 =
        PathBuf::from(std::env::var_os("ProgramFiles(x86)").unwrap_or_default());

    vec![
        BrowserSpec {
            id: "chrome",
            name: "Chrome",
            data_root: local.join("Google/Chrome/User Data"),
            executables: vec![
                program_files.join("Google/Chrome/Application/chrome.exe"),
                program_files_x86.join("Google/Chrome/Application/chrome.exe"),
                local.join("Google/Chrome/Application/chrome.exe"),
            ],
        },
        BrowserSpec {
            id: "edge",
            name: "Edge",
            data_root: local.join("Microsoft/Edge/User Data"),
            executables: vec![
                program_files.join("Microsoft/Edge/Application/msedge.exe"),
                program_files_x86.join("Microsoft/Edge/Application/msedge.exe"),
            ],
        },
        BrowserSpec {
            id: "brave",
            name: "Brave",
            data_root: local.join("BraveSoftware/Brave-Browser/User Data"),
            executables: vec![
                program_files.join("BraveSoftware/Brave-Browser/Application/brave.exe"),
                program_files_x86.join("BraveSoftware/Brave-Browser/Application/brave.exe"),
                local.join("BraveSoftware/Brave-Browser/Application/brave.exe"),
            ],
        },
        BrowserSpec {
            id: "vivaldi",
            name: "Vivaldi",
            data_root: local.join("Vivaldi/User Data"),
            executables: vec![
                program_files.join("Vivaldi/Application/vivaldi.exe"),
                local.join("Vivaldi/Application/vivaldi.exe"),
            ],
        },
        BrowserSpec {
            id: "opera",
            name: "Opera",
            data_root: roaming.join("Opera Software/Opera Stable"),
            executables: vec![
                program_files.join("Opera/launcher.exe"),
                local.join("Programs/Opera/launcher.exe"),
            ],
        },
    ]
}

#[cfg(target_os = "macos")]
fn browser_specs() -> Vec<BrowserSpec> {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let support = home.join("Library/Application Support");
    let applications = PathBuf::from("/Applications");

    vec![
        BrowserSpec {
            id: "chrome",
            name: "Chrome",
            data_root: support.join("Google/Chrome"),
            executables: vec![applications.join("Google Chrome.app")],
        },
        BrowserSpec {
            id: "edge",
            name: "Edge",
            data_root: support.join("Microsoft Edge"),
            executables: vec![applications.join("Microsoft Edge.app")],
        },
        BrowserSpec {
            id: "brave",
            name: "Brave",
            data_root: support.join("BraveSoftware/Brave-Browser"),
            executables: vec![applications.join("Brave Browser.app")],
        },
        BrowserSpec {
            id: "vivaldi",
            name: "Vivaldi",
            data_root: support.join("Vivaldi"),
            executables: vec![applications.join("Vivaldi.app")],
        },
        BrowserSpec {
            id: "opera",
            name: "Opera",
            data_root: support.join("com.operasoftware.Opera"),
            executables: vec![applications.join("Opera.app")],
        },
    ]
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn browser_specs() -> Vec<BrowserSpec> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_state_matches_chromium_preferences() {
        let enabled = serde_json::json!({ "disable_reasons": [], "state": 1 });
        let disabled_by_state = serde_json::json!({ "disable_reasons": [], "state": 0 });
        let disabled_for_reason = serde_json::json!({ "disable_reasons": [1] });

        assert!(extension_is_enabled(&enabled));
        assert!(!extension_is_enabled(&disabled_by_state));
        assert!(!extension_is_enabled(&disabled_for_reason));
    }

    #[test]
    fn current_machine_scan_is_well_formed() {
        let result = scan();
        println!("{result:?}");
        assert_eq!(result.extension_id, EXTENSION_ID);
        assert!(result
            .browsers
            .iter()
            .all(
                |browser| browser.enabled_profiles <= browser.installed_profiles
                    && browser.installed_profiles <= browser.profiles
            ));
    }
}
