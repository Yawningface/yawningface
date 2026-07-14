//! Local, on-device history: the raw material for the Insights page.
//!
//! Focused time is accumulated by the sync loop while blocking is in force.
//! The activity spans retain when working and scheduled sessions were active,
//! while cancellations and app kills are counted as they happen.

use std::collections::BTreeMap;

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActivitySpan {
    /// RFC 3339 timestamps. UTC keeps persisted data independent of later
    /// timezone changes; the UI lays it out using the machine's local day.
    pub start: String,
    pub end: String,
    pub working: bool,
    pub scheduled: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cancellation {
    pub occurred_at: String,
    /// "working" or "scheduled".
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DayStat {
    /// Seconds during which something was actually blocked.
    pub focus_seconds: u64,
    /// Working sessions started by hand (tray or app).
    pub sessions: u32,
    /// Times a blocked app was closed for you.
    pub apps_blocked: u32,
    /// Times the user manually deactivated blocking before it ended itself.
    pub cancellations: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stats {
    /// Keyed by local date, "YYYY-MM-DD".
    pub days: BTreeMap<String, DayStat>,
    /// How often each app was closed, all time.
    pub blocked_apps: BTreeMap<String, u32>,
    /// The longest single stretch of blocking, in seconds.
    pub longest_focus_seconds: u64,
    /// Seconds in the current uninterrupted stretch (reset when blocking ends).
    pub current_focus_seconds: u64,
    /// Exact recent activity used by the 24-hour Insights columns.
    pub activity: Vec<ActivitySpan>,
    /// Exact manual deactivation markers used by Insights.
    pub cancellations: Vec<Cancellation>,
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

impl Stats {
    fn today_mut(&mut self) -> &mut DayStat {
        self.days.entry(today()).or_default()
    }

    /// One sync tick. A span records which kind of protection was active. When
    /// both kinds overlap, both flags are true and the UI can render the layers.
    pub fn record_tick(&mut self, working: bool, scheduled: bool, seconds: u64) {
        let blocking = working || scheduled;
        if blocking {
            self.today_mut().focus_seconds += seconds;
            self.current_focus_seconds += seconds;
            self.longest_focus_seconds = self.longest_focus_seconds.max(self.current_focus_seconds);

            let end = Utc::now();
            let start = end - chrono::Duration::seconds(seconds as i64);
            let can_extend = self.activity.last().is_some_and(|last| {
                if last.working != working || last.scheduled != scheduled {
                    return false;
                }
                DateTime::parse_from_rfc3339(&last.end)
                    .map(|previous_end| {
                        (start.signed_duration_since(previous_end.with_timezone(&Utc)))
                            .num_seconds()
                            .abs()
                            <= 2
                    })
                    .unwrap_or(false)
            });
            if can_extend {
                if let Some(last) = self.activity.last_mut() {
                    last.end = end.to_rfc3339();
                }
            } else {
                self.activity.push(ActivitySpan {
                    start: start.to_rfc3339(),
                    end: end.to_rfc3339(),
                    working,
                    scheduled,
                });
            }

            // Insights only draws 14 days, but keep a comfortable margin for
            // timezone changes and future UI work without growing forever.
            let cutoff = end - chrono::Duration::days(120);
            self.activity.retain(|span| {
                DateTime::parse_from_rfc3339(&span.end)
                    .map(|t| t.with_timezone(&Utc) >= cutoff)
                    .unwrap_or(false)
            });
        } else {
            self.current_focus_seconds = 0;
        }
    }

    pub fn record_session_start(&mut self) {
        self.today_mut().sessions += 1;
    }

    pub fn record_app_blocked(&mut self, app: &str) {
        self.today_mut().apps_blocked += 1;
        *self.blocked_apps.entry(app.to_string()).or_default() += 1;
    }

    pub fn record_cancellation(&mut self, source: &str) {
        self.today_mut().cancellations += 1;
        self.cancellations.push(Cancellation {
            occurred_at: Utc::now().to_rfc3339(),
            source: source.to_string(),
        });

        let cutoff = Utc::now() - chrono::Duration::days(120);
        self.cancellations.retain(|event| {
            DateTime::parse_from_rfc3339(&event.occurred_at)
                .map(|t| t.with_timezone(&Utc) >= cutoff)
                .unwrap_or(false)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_records_the_kind_of_blocking() {
        let mut stats = Stats::default();
        stats.record_tick(true, false, 30);
        assert_eq!(stats.activity.len(), 1);
        assert!(stats.activity[0].working);
        assert!(!stats.activity[0].scheduled);
        assert_eq!(stats.current_focus_seconds, 30);
    }

    #[test]
    fn cancellation_is_counted_and_timestamped() {
        let mut stats = Stats::default();
        stats.record_cancellation("scheduled");
        assert_eq!(stats.today_mut().cancellations, 1);
        assert_eq!(stats.cancellations.len(), 1);
        assert_eq!(stats.cancellations[0].source, "scheduled");
    }
}
