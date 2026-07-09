//! Evaluates the canonical blocklist config against local time and produces
//! the set of domains/apps that must be blocked right now on this device.
//!
//! Schema (shared with block_cloud / block_chromium / block_iphone):
//! {
//!   "version": 1,
//!   "blocklists": [{
//!     "id", "name",
//!     "metadata": { "enabled", "devices": ["desktop",...],
//!                   "timePeriods": [{ "startTime": "09:00", "endTime": "13:00",
//!                                     "schedule": ["mon","tue",...] }] },
//!     "targets": { "websites": [...], "apps": [...] }
//!   }]
//! }

use chrono::{Datelike, Local, Timelike};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BlockSet {
    pub domains: BTreeSet<String>,
    pub apps: BTreeSet<String>,
    pub active_lists: Vec<String>,
}

pub fn evaluate(config: &Value) -> BlockSet {
    let now = Local::now();
    let minutes_now = (now.hour() * 60 + now.minute()) as i32;
    let day = day_key(now.weekday().num_days_from_monday());
    evaluate_at(config, minutes_now, day)
}

fn day_key(days_from_monday: u32) -> &'static str {
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][days_from_monday as usize % 7]
}

fn evaluate_at(config: &Value, minutes_now: i32, day: &str) -> BlockSet {
    let mut out = BlockSet::default();
    let Some(lists) = config.get("blocklists").and_then(|v| v.as_array()) else {
        return out;
    };

    for list in lists {
        let meta = list.get("metadata").cloned().unwrap_or(Value::Null);
        if !meta.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        if !applies_to_desktop(&meta) {
            continue;
        }
        if !is_active_now(&meta, minutes_now, day) {
            continue;
        }

        let name = list
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unnamed")
            .to_string();
        out.active_lists.push(name);

        if let Some(targets) = list.get("targets") {
            for d in str_array(targets, "websites") {
                let d = normalize_domain(&d);
                if !d.is_empty() {
                    out.domains.insert(d);
                }
            }
            for a in str_array(targets, "apps") {
                let a = a.trim().to_string();
                if !a.is_empty() {
                    out.apps.insert(a);
                }
            }
        }
    }
    out
}

fn applies_to_desktop(meta: &Value) -> bool {
    match meta.get("devices").and_then(|v| v.as_array()) {
        None => true, // no device filter -> applies everywhere
        Some(devices) => devices
            .iter()
            .filter_map(|d| d.as_str())
            .any(|d| d.eq_ignore_ascii_case("desktop")),
    }
}

fn is_active_now(meta: &Value, minutes_now: i32, day: &str) -> bool {
    let Some(periods) = meta.get("timePeriods").and_then(|v| v.as_array()) else {
        return true; // no schedule -> always active while enabled
    };
    if periods.is_empty() {
        return true;
    }
    periods
        .iter()
        .any(|p| period_active(p, minutes_now, day))
}

fn period_active(period: &Value, minutes_now: i32, day: &str) -> bool {
    // Day filter: accept "mon" / "monday" / "Mon" ...
    if let Some(days) = period.get("schedule").and_then(|v| v.as_array()) {
        if !days.is_empty() {
            let matches_day = days
                .iter()
                .filter_map(|d| d.as_str())
                .any(|d| d.to_ascii_lowercase().starts_with(day));
            if !matches_day {
                return false;
            }
        }
    }

    let start = parse_hhmm(period.get("startTime"));
    let end = parse_hhmm(period.get("endTime"));
    match (start, end) {
        (Some(s), Some(e)) if s == e => true, // degenerate: whole day
        (Some(s), Some(e)) if s < e => minutes_now >= s && minutes_now < e,
        // crosses midnight, e.g. 22:00 -> 07:00
        (Some(s), Some(e)) => minutes_now >= s || minutes_now < e,
        _ => true, // malformed times -> fail closed towards blocking
    }
}

fn parse_hhmm(v: Option<&Value>) -> Option<i32> {
    let s = v?.as_str()?;
    let (h, m) = s.split_once(':')?;
    let h: i32 = h.trim().parse().ok()?;
    let m: i32 = m.trim().parse().ok()?;
    if (0..24).contains(&h) && (0..60).contains(&m) {
        Some(h * 60 + m)
    } else {
        None
    }
}

fn str_array(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Normalize "https://www.twitter.com/foo" or "Twitter.com" to "twitter.com".
pub fn normalize_domain(raw: &str) -> String {
    let mut s = raw.trim().to_ascii_lowercase();
    for prefix in ["https://", "http://"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
        }
    }
    if let Some((host, _)) = s.split_once('/') {
        s = host.to_string();
    }
    let s = s.strip_prefix("www.").unwrap_or(&s).to_string();
    if s.is_empty()
        || !s.contains('.')
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return String::new();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config() -> Value {
        json!({
            "version": 1,
            "blocklists": [{
                "id": "focus",
                "name": "Focus",
                "metadata": {
                    "enabled": true,
                    "devices": ["desktop"],
                    "timePeriods": [
                        { "startTime": "09:00", "endTime": "13:00", "schedule": ["mon","tue","wed","thu","fri"] }
                    ]
                },
                "targets": { "websites": ["https://www.Twitter.com/home"], "apps": ["Discord"] }
            }]
        })
    }

    #[test]
    fn active_inside_period() {
        let set = evaluate_at(&config(), 10 * 60, "mon");
        assert!(set.domains.contains("twitter.com"));
        assert!(set.apps.contains("Discord"));
    }

    #[test]
    fn inactive_outside_period_and_day() {
        assert!(evaluate_at(&config(), 14 * 60, "mon").domains.is_empty());
        assert!(evaluate_at(&config(), 10 * 60, "sat").domains.is_empty());
    }

    #[test]
    fn midnight_crossing() {
        let cfg = json!({ "blocklists": [{ "name": "Night", "metadata": {
            "enabled": true,
            "timePeriods": [{ "startTime": "22:00", "endTime": "07:00" }]
        }, "targets": { "websites": ["youtube.com"] } }] });
        assert!(!evaluate_at(&cfg, 23 * 60, "mon").domains.is_empty());
        assert!(!evaluate_at(&cfg, 6 * 60, "tue").domains.is_empty());
        assert!(evaluate_at(&cfg, 12 * 60, "mon").domains.is_empty());
    }

    #[test]
    fn full_day_days_accept_long_names() {
        let cfg = json!({ "blocklists": [{ "name": "L", "metadata": {
            "enabled": true,
            "timePeriods": [{ "startTime": "00:00", "endTime": "23:59", "schedule": ["Monday"] }]
        }, "targets": { "websites": ["reddit.com"] } }] });
        assert!(!evaluate_at(&cfg, 100, "mon").domains.is_empty());
        assert!(evaluate_at(&cfg, 100, "tue").domains.is_empty());
    }

    #[test]
    fn disabled_and_wrong_device_skipped() {
        let cfg = json!({ "blocklists": [
            { "name": "A", "metadata": { "enabled": false }, "targets": { "websites": ["a.com"] } },
            { "name": "B", "metadata": { "enabled": true, "devices": ["mobile"] }, "targets": { "websites": ["b.com"] } }
        ]});
        assert!(evaluate_at(&cfg, 100, "mon").domains.is_empty());
    }

    #[test]
    fn domain_normalization_rejects_garbage() {
        assert_eq!(normalize_domain("  https://www.LinkedIn.com/feed/ "), "linkedin.com");
        assert_eq!(normalize_domain("0.0.0.0 evil.com # inject"), "");
        assert_eq!(normalize_domain("no-dot"), "");
    }
}
