//! Local, on-device history: the raw material for the Insights page.
//!
//! Nothing here is estimated or invented. Focused time is accumulated by the
//! sync loop, which ticks on a known interval and adds that interval to today
//! whenever blocking is actually in force. Sessions and app kills are counted
//! as they happen. The file never leaves this machine.

use std::collections::BTreeMap;

use chrono::Local;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DayStat {
    /// Seconds during which something was actually blocked.
    pub focus_seconds: u64,
    /// Working sessions started by hand (tray or app).
    pub sessions: u32,
    /// Times a blocked app was closed for you.
    pub apps_blocked: u32,
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
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

impl Stats {
    fn today_mut(&mut self) -> &mut DayStat {
        self.days.entry(today()).or_default()
    }

    /// One sync tick. `blocking` is whether anything was blocked during it.
    pub fn record_tick(&mut self, blocking: bool, seconds: u64) {
        if blocking {
            self.today_mut().focus_seconds += seconds;
            self.current_focus_seconds += seconds;
            self.longest_focus_seconds = self.longest_focus_seconds.max(self.current_focus_seconds);
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
}
