use std::collections::BTreeSet;
use std::sync::Mutex;

use crate::settings::{LocalSession, Settings, Tokens};
use crate::stats::Stats;
use crate::sync::{EngineStatus, OutEvent};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub tokens: Mutex<Option<Tokens>>,
    pub local_session: Mutex<LocalSession>,
    /// On-device history behind the Insights page.
    pub stats: Mutex<Stats>,
    pub status: Mutex<EngineStatus>,
    pub event_queue: Mutex<Vec<OutEvent>>,
    /// App names the killer loop must terminate right now.
    pub blocked_apps: Mutex<BTreeSet<String>>,
    /// Last domain set written to the spool (change detection). `None` until
    /// the first tick so startup always reconciles the spool/hosts with the
    /// real desired state - a stale spool from a previous run must be fixed.
    pub last_domains: Mutex<Option<BTreeSet<String>>>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(
        settings: Settings,
        tokens: Option<Tokens>,
        local_session: LocalSession,
        stats: Stats,
    ) -> Self {
        Self {
            settings: Mutex::new(settings),
            tokens: Mutex::new(tokens),
            local_session: Mutex::new(local_session),
            stats: Mutex::new(stats),
            status: Mutex::new(EngineStatus::default()),
            event_queue: Mutex::new(Vec::new()),
            blocked_apps: Mutex::new(BTreeSet::new()),
            last_domains: Mutex::new(None),
            http: reqwest::Client::builder()
                .user_agent(concat!("yfblock-desktop/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest client"),
        }
    }
}
