//! Auth0 Device Authorization Flow (RFC 8628) - the "TV app" login.
//! The app shows a short code, the user confirms it in their browser, and we
//! poll Auth0 until tokens arrive. Requires a Native application in Auth0 with
//! the Device Code and Refresh Token grants enabled, and an API (audience)
//! with "Allow Offline Access".

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::settings::{Settings, Tokens};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

pub async fn start_device_flow(
    http: &reqwest::Client,
    settings: &Settings,
) -> Result<DeviceCodeInfo, String> {
    let url = format!("https://{}/oauth/device/code", settings.auth0_domain);
    let resp = http
        .post(&url)
        .form(&[
            ("client_id", settings.auth0_client_id.as_str()),
            ("scope", "openid profile email offline_access"),
            ("audience", settings.auth0_audience.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach Auth0: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Auth0 rejected the device-code request: {body}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(DeviceCodeInfo {
        device_code: str_field(&v, "device_code")?,
        user_code: str_field(&v, "user_code")?,
        verification_uri: str_field(&v, "verification_uri")?,
        verification_uri_complete: str_field(&v, "verification_uri_complete")
            .or_else(|_| str_field(&v, "verification_uri"))?,
        expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
        interval: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5),
    })
}

/// Polls until the user approves, denies, or the code expires.
pub async fn poll_device_flow(
    http: &reqwest::Client,
    settings: &Settings,
    info: &DeviceCodeInfo,
) -> Result<Tokens, String> {
    let url = format!("https://{}/oauth/token", settings.auth0_domain);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(info.expires_in);
    let mut interval = info.interval.max(1);

    loop {
        if std::time::Instant::now() > deadline {
            return Err("The sign-in code expired. Please try again.".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let resp = http
            .post(&url)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", info.device_code.as_str()),
                ("client_id", settings.auth0_client_id.as_str()),
            ])
            .send()
            .await
            .map_err(|e| format!("Could not reach Auth0: {e}"))?;

        let v: Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
            match err {
                "authorization_pending" => continue,
                "slow_down" => {
                    interval += 5;
                    continue;
                }
                "expired_token" => return Err("The sign-in code expired. Please try again.".into()),
                "access_denied" => return Err("Sign-in was denied in the browser.".into()),
                other => {
                    let desc = v
                        .get("error_description")
                        .and_then(|x| x.as_str())
                        .unwrap_or(other);
                    return Err(format!("Auth0 error: {desc}"));
                }
            }
        }
        return tokens_from_response(&v);
    }
}

pub async fn refresh(
    http: &reqwest::Client,
    settings: &Settings,
    tokens: &Tokens,
) -> Result<Tokens, String> {
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or("No refresh token stored; please sign in again.")?;
    let url = format!("https://{}/oauth/token", settings.auth0_domain);
    let resp = http
        .post(&url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", settings.auth0_client_id.as_str()),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach Auth0: {e}"))?;

    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if v.get("error").is_some() {
        return Err("Session expired; please sign in again.".into());
    }
    let mut new_tokens = tokens_from_response(&v)?;
    // Auth0 may not rotate the refresh token; keep the old one then.
    if new_tokens.refresh_token.is_none() {
        new_tokens.refresh_token = Some(refresh_token);
    }
    // Preserve profile info if the refresh response had no id_token.
    if new_tokens.user_sub.is_none() {
        new_tokens.user_sub = tokens.user_sub.clone();
        new_tokens.user_name = tokens.user_name.clone();
        new_tokens.user_email = tokens.user_email.clone();
    }
    Ok(new_tokens)
}

fn tokens_from_response(v: &Value) -> Result<Tokens, String> {
    let access_token = str_field(v, "access_token")?;
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    let mut tokens = Tokens {
        access_token,
        refresh_token: v
            .get("refresh_token")
            .and_then(|x| x.as_str())
            .map(String::from),
        expires_at: chrono::Utc::now().timestamp() + expires_in,
        user_name: None,
        user_email: None,
        user_sub: None,
    };
    if let Some(id_token) = v.get("id_token").and_then(|x| x.as_str()) {
        if let Some(claims) = decode_jwt_payload(id_token) {
            tokens.user_sub = claims.get("sub").and_then(|x| x.as_str()).map(String::from);
            tokens.user_name = claims
                .get("name")
                .or_else(|| claims.get("nickname"))
                .and_then(|x| x.as_str())
                .map(String::from);
            tokens.user_email = claims
                .get("email")
                .and_then(|x| x.as_str())
                .map(String::from);
        }
    }
    Ok(tokens)
}

/// Decodes (without verifying) a JWT payload. Fine here: the token came to us
/// directly from Auth0 over TLS; the backend does the real verification.
fn decode_jwt_payload(jwt: &str) -> Option<Value> {
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn str_field(v: &Value, key: &str) -> Result<String, String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(String::from)
        .ok_or_else(|| format!("Missing field '{key}' in Auth0 response"))
}
