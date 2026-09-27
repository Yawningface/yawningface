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

use chrono::{Datelike, Duration, Local, NaiveDateTime, TimeZone, Timelike};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BlockSet {
    pub domains: BTreeSet<String>,
    pub apps: BTreeSet<String>,
    pub active_lists: Vec<String>,
    /// Unix time at which each time-boxed domain stops being blocked. Domains
    /// missing here have no end in sight (an always-on list, an open-ended
    /// session). The root helper uses it to lift a block that ends while the
    /// app is not running.
    pub domain_until: BTreeMap<String, i64>,
}

impl BlockSet {
    /// Blocks `domain` until `until` (`None`: no end in sight). A domain
    /// blocked for several reasons stays blocked until the last one ends.
    pub fn block_domain(&mut self, domain: String, until: Option<i64>) {
        let newly_blocked = self.domains.insert(domain.clone());
        match until {
            None => {
                self.domain_until.remove(&domain);
            }
            Some(end) if newly_blocked => {
                self.domain_until.insert(domain, end);
            }
            Some(end) => {
                // Already blocked with no end: that reason still holds.
                if let Some(current) = self.domain_until.get_mut(&domain) {
                    *current = (*current).max(end);
                }
            }
        }
    }

    pub fn merge(&mut self, other: BlockSet) {
        for domain in other.domains {
            let until = other.domain_until.get(&domain).copied();
            self.block_domain(domain, until);
        }
        self.apps.extend(other.apps);
        for name in other.active_lists {
            if !self.active_lists.contains(&name) {
                self.active_lists.push(name);
            }
        }
    }
}

pub fn evaluate(config: &Value) -> BlockSet {
    evaluate_local(config, Local::now().naive_local())
}

fn day_key(days_from_monday: u32) -> &'static str {
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][days_from_monday as usize % 7]
}

fn minutes_of(t: NaiveDateTime) -> i32 {
    (t.hour() * 60 + t.minute()) as i32
}

fn day_of(t: NaiveDateTime) -> &'static str {
    day_key(t.weekday().num_days_from_monday())
}

/// The contract's `evaluateAt(config, minutes, day)`, on a reference week.
#[cfg(test)]
fn evaluate_at(config: &Value, minutes_now: i32, day: &str) -> BlockSet {
    let days_from_monday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        .iter()
        .position(|d| *d == day)
        .expect("day key") as i64;
    // 1 January 2024 was a Monday.
    let monday = chrono::NaiveDate::from_ymd_opt(2024, 1, 1)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .expect("reference Monday");
    let now = monday + Duration::days(days_from_monday) + Duration::minutes(minutes_now as i64);
    evaluate_local(config, now)
}

fn evaluate_local(config: &Value, now: NaiveDateTime) -> BlockSet {
    let minutes_now = minutes_of(now);
    let day = day_of(now);
    let mut out = BlockSet::default();
    let Some(lists) = config.get("blocklists").and_then(|v| v.as_array()) else {
        return out;
    };

    for list in lists {
        let meta = list.get("metadata").cloned().unwrap_or(Value::Null);
        if !meta
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
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
            let until = active_until(&meta, now).and_then(local_epoch);
            for d in str_array(targets, "websites") {
                let d = normalize_domain(&d);
                if !d.is_empty() {
                    out.block_domain(d, until);
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
    periods.iter().any(|p| period_active(p, minutes_now, day))
}

fn period_active(period: &Value, minutes_now: i32, day: &str) -> bool {
    let matches_day = |candidate: &str| {
        // Accept "mon" / "monday" / "Mon" ... Empty = every day.
        period
            .get("schedule")
            .and_then(|v| v.as_array())
            .is_none_or(|days| {
                days.is_empty()
                    || days
                        .iter()
                        .filter_map(|d| d.as_str())
                        .any(|d| d.to_ascii_lowercase().starts_with(candidate))
            })
    };

    let start = parse_hhmm(period.get("startTime"));
    let end = parse_hhmm(period.get("endTime"));
    match (start, end) {
        (Some(s), Some(e)) if s == e => matches_day(day), // equal times = whole selected day
        (Some(s), Some(e)) if s < e => matches_day(day) && minutes_now >= s && minutes_now < e,
        (Some(s), Some(_)) if minutes_now >= s => matches_day(day),
        // After midnight, the period still belongs to the day on which it began.
        (Some(_), Some(e)) if minutes_now < e => matches_day(previous_day(day)),
        (Some(_), Some(_)) => false,
        _ => matches_day(day), // malformed times -> fail closed towards blocking
    }
}

/// When a list that is active at `now` stops blocking, following back-to-back
/// periods to the end. `None`: no end in sight (no time periods, or still
/// active eight days from now).
fn active_until(meta: &Value, now: NaiveDateTime) -> Option<NaiveDateTime> {
    let periods = meta
        .get("timePeriods")
        .and_then(|v| v.as_array())
        .filter(|periods| !periods.is_empty())?;
    let horizon = now + Duration::days(8);
    let mut until = now;
    while until < horizon {
        let (minutes, day) = (minutes_of(until), day_of(until));
        // Every active period ends strictly after `until`, so this advances.
        let Some(end) = periods
            .iter()
            .filter(|p| period_active(p, minutes, day))
            .map(|p| period_end(p, until))
            .max()
        else {
            return Some(until);
        };
        until = end;
    }
    None
}

/// When `period`, active at `at`, ends.
fn period_end(period: &Value, at: NaiveDateTime) -> NaiveDateTime {
    let midnight = at.date().and_hms_opt(0, 0, 0).expect("midnight");
    let minutes_after_midnight = |m: i32| midnight + Duration::minutes(m as i64);
    let start = parse_hhmm(period.get("startTime"));
    let end = parse_hhmm(period.get("endTime"));
    match (start, end) {
        (Some(s), Some(e)) if s < e => minutes_after_midnight(e),
        (Some(s), Some(e)) if s > e && minutes_of(at) >= s => minutes_after_midnight(e + 24 * 60),
        (Some(s), Some(e)) if s > e => minutes_after_midnight(e),
        // Equal or malformed times block the whole day.
        _ => minutes_after_midnight(24 * 60),
    }
}

/// Unix time of a local wall-clock time. When clocks fall back, the later of
/// the two readings wins; a time skipped when clocks spring forward has no
/// answer, so the block keeps no end rather than lifting early.
fn local_epoch(t: NaiveDateTime) -> Option<i64> {
    Local
        .from_local_datetime(&t)
        .latest()
        .map(|t| t.timestamp())
}

fn previous_day(day: &str) -> &'static str {
    match day {
        "mon" => "sun",
        "tue" => "mon",
        "wed" => "tue",
        "thu" => "wed",
        "fri" => "thu",
        "sat" => "fri",
        _ => "sat",
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
    fn midnight_crossing_is_anchored_to_its_start_day() {
        let cfg = json!({ "blocklists": [{ "name": "Friday night", "metadata": {
            "enabled": true,
            "timePeriods": [{ "startTime": "23:00", "endTime": "09:00", "schedule": ["fri"] }]
        }, "targets": { "websites": ["youtube.com"] } }] });
        assert!(!evaluate_at(&cfg, 23 * 60 + 30, "fri").domains.is_empty());
        assert!(!evaluate_at(&cfg, 8 * 60, "sat").domains.is_empty());
        assert!(evaluate_at(&cfg, 8 * 60, "fri").domains.is_empty());
        assert!(evaluate_at(&cfg, 10 * 60, "sat").domains.is_empty());
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

    fn at(day: u32, hhmm: &str) -> NaiveDateTime {
        // January 2024: the 1st was a Monday.
        let (h, m) = hhmm.split_once(':').unwrap();
        chrono::NaiveDate::from_ymd_opt(2024, 1, day)
            .and_then(|d| d.and_hms_opt(h.parse().unwrap(), m.parse().unwrap(), 0))
            .unwrap()
    }

    fn periods(periods: Value) -> Value {
        json!({ "enabled": true, "timePeriods": periods })
    }

    #[test]
    fn window_ends_at_its_end_time() {
        let meta = config()["blocklists"][0]["metadata"].clone();
        assert_eq!(active_until(&meta, at(1, "10:15")), Some(at(1, "13:00")));
    }

    #[test]
    fn back_to_back_periods_end_together() {
        let meta = periods(json!([
            { "startTime": "09:00", "endTime": "12:00" },
            { "startTime": "12:00", "endTime": "14:30" }
        ]));
        assert_eq!(active_until(&meta, at(1, "10:00")), Some(at(1, "14:30")));
    }

    #[test]
    fn overnight_window_ends_the_next_morning() {
        let meta =
            periods(json!([{ "startTime": "22:00", "endTime": "07:00", "schedule": ["mon"] }]));
        assert_eq!(active_until(&meta, at(1, "23:00")), Some(at(2, "07:00")));
        assert_eq!(active_until(&meta, at(2, "06:00")), Some(at(2, "07:00")));
    }

    #[test]
    fn whole_days_run_until_the_last_selected_day_ends() {
        let meta = periods(
            json!([{ "startTime": "00:00", "endTime": "00:00", "schedule": ["sat", "sun"] }]),
        );
        assert_eq!(active_until(&meta, at(6, "15:00")), Some(at(8, "00:00")));
    }

    #[test]
    fn lists_with_no_end_in_sight_have_none() {
        assert_eq!(
            active_until(&json!({ "enabled": true }), at(1, "10:00")),
            None
        );
        let every_day = periods(json!([{ "startTime": "00:00", "endTime": "00:00" }]));
        assert_eq!(active_until(&every_day, at(1, "10:00")), None);

        let cfg = json!({ "blocklists": [{ "name": "Always", "metadata": { "enabled": true },
            "targets": { "websites": ["reddit.com"] } }] });
        let set = evaluate_at(&cfg, 10 * 60, "mon");
        assert!(set.domains.contains("reddit.com"));
        assert!(set.domain_until.is_empty());
    }

    #[test]
    fn evaluation_records_when_windowed_domains_end() {
        let set = evaluate_at(&config(), 10 * 60, "mon");
        assert_eq!(
            set.domain_until.get("twitter.com").copied(),
            local_epoch(at(1, "13:00"))
        );
    }

    #[test]
    fn a_domain_stays_blocked_until_its_last_reason_ends() {
        let mut set = BlockSet::default();
        set.block_domain("reddit.com".into(), Some(100));
        set.block_domain("reddit.com".into(), Some(50));
        assert_eq!(set.domain_until.get("reddit.com"), Some(&100));
        set.block_domain("reddit.com".into(), None);
        set.block_domain("reddit.com".into(), Some(300));
        assert!(set.domains.contains("reddit.com"));
        assert!(set.domain_until.is_empty());

        let mut other = BlockSet::default();
        other.block_domain("x.com".into(), Some(200));
        other.block_domain("reddit.com".into(), Some(400));
        set.merge(other);
        assert_eq!(set.domain_until.get("x.com"), Some(&200));
        assert!(!set.domain_until.contains_key("reddit.com"));
    }

    #[test]
    fn domain_normalization_rejects_garbage() {
        assert_eq!(
            normalize_domain("  https://www.LinkedIn.com/feed/ "),
            "linkedin.com"
        );
        assert_eq!(normalize_domain("0.0.0.0 evil.com # inject"), "");
        assert_eq!(normalize_domain("no-dot"), "");
    }
}
