use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Build-time defaults injected by CI (GitHub repo variables). All of them can
/// be overridden at runtime from the Settings screen, so local builds work too.
const DEFAULT_API_BASE: &str = match option_env!("YF_API_BASE") {
    Some(v) => v,
    None => "",
};
const DEFAULT_AUTH0_DOMAIN: &str = match option_env!("YF_AUTH0_DOMAIN") {
    Some(v) => v,
    None => "",
};
const DEFAULT_AUTH0_CLIENT_ID: &str = match option_env!("YF_AUTH0_CLIENT_ID") {
    Some(v) => v,
    None => "",
};
const DEFAULT_AUTH0_AUDIENCE: &str = match option_env!("YF_AUTH0_AUDIENCE") {
    Some(v) => v,
    None => "",
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub api_base_url: String,
    pub auth0_domain: String,
    pub auth0_client_id: String,
    pub auth0_audience: String,
    pub device_id: Option<String>,
    pub device_name: String,
    pub launch_at_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let host = hostname();
        Self {
            api_base_url: DEFAULT_API_BASE.to_string(),
            auth0_domain: DEFAULT_AUTH0_DOMAIN.to_string(),
            auth0_client_id: DEFAULT_AUTH0_CLIENT_ID.to_string(),
            auth0_audience: DEFAULT_AUTH0_AUDIENCE.to_string(),
            device_id: None,
            device_name: host,
            launch_at_login: true,
        }
    }
}

impl Settings {
    pub fn is_configured(&self) -> bool {
        !self.api_base_url.is_empty()
            && !self.auth0_domain.is_empty()
            && !self.auth0_client_id.is_empty()
            && !self.auth0_audience.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix seconds when the access token expires.
    pub expires_at: i64,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub user_sub: Option<String>,
}

impl Tokens {
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() >= self.expires_at - 60
    }
}

/// Built-in blocklist for the one-click offline "working session".
/// No account needed - this is the app's default mode.
pub const DEFAULT_SESSION_DOMAINS: &[&str] = &[
    "linkedin.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "tiktok.com",
    "facebook.com",
    "reddit.com",
    "youtube.com",
    "twitch.tv",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalSession {
    pub active: bool,
    /// RFC3339 end time; None while active means "until I stop it".
    pub until: Option<String>,
    /// Extra domains/apps; the defaults above are always included.
    pub domains: Vec<String>,
    pub apps: Vec<String>,
}

impl LocalSession {
    /// True if active and not past its end time.
    pub fn is_running(&self) -> bool {
        if !self.active {
            return false;
        }
        match &self.until {
            None => true,
            Some(t) => chrono::DateTime::parse_from_rfc3339(t)
                .map(|end| chrono::Utc::now() < end)
                .unwrap_or(false),
        }
    }
}

pub fn load_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

pub fn hostname() -> String {
    #[cfg(target_os = "windows")]
    let var = std::env::var("COMPUTERNAME");
    #[cfg(not(target_os = "windows"))]
    let var = std::env::var("HOSTNAME");

    var.ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My computer".to_string())
}

pub fn platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "mac"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        "linux"
    }
}
