//! App blocking: a lightweight watcher that terminates blocked processes.
//! No privileges needed — we only kill processes owned by the current user.

use std::collections::BTreeSet;
use sysinfo::{ProcessesToUpdate, System};

/// Kills every running process whose name matches one of `blocked` (case-
/// insensitive exact or prefix match, so "Discord" catches "Discord Helper").
/// Returns the names that were killed this pass.
pub fn kill_blocked(system: &mut System, blocked: &BTreeSet<String>) -> Vec<String> {
    if blocked.is_empty() {
        return Vec::new();
    }
    system.refresh_processes(ProcessesToUpdate::All, true);

    let needles: Vec<String> = blocked.iter().map(|b| b.trim().to_lowercase()).collect();
    let mut killed = Vec::new();

    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_lowercase();
        let matches = needles.iter().any(|n| {
            !n.is_empty() && (name == *n || name.starts_with(n.as_str()))
        });
        if matches && process.kill() {
            killed.push(process.name().to_string_lossy().to_string());
        }
    }
    killed
}
