//! Tough Mode (macOS): a root-held lock that user space cannot weaken.
//!
//! The app writes a *request* (end time + domains) to a user-writable file.
//! The privileged applier (see `platform.rs`) merges requests monotonically
//! into a root-owned lock file: the end time can only move later (capped at
//! 7 days ahead) and domains can only be added. While the lock is active the
//! applier keeps the locked domains in the hosts file no matter what the
//! spool says, and re-asserts them if /etc/hosts is edited by hand.
//!
//! There is deliberately no function here - and no code path in the applier -
//! that ends a lock early. It expires when the clock passes its end time.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::hosts;

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
pub struct LockState {
    /// Unix seconds when the lock expires.
    pub until_epoch: i64,
    pub domains: BTreeSet<String>,
}

/// Root-owned lock state file, written only by the privileged applier.
/// World-readable so the app can show lock status.
pub fn lock_state_path() -> PathBuf {
    PathBuf::from("/Library/Application Support/YawningFaceBlock/lock.txt")
}

/// Parses the lock file format: first line `UNTIL <unix_epoch>`, one domain
/// per line after that.
pub fn parse_lock(content: &str) -> Option<LockState> {
    let mut lines = content.lines();
    let until_epoch: i64 = lines.next()?.strip_prefix("UNTIL ")?.trim().parse().ok()?;
    let domains = lines
        .map(|l| l.trim().to_ascii_lowercase())
        .filter(|l| hosts::is_valid_domain(l))
        .collect();
    Some(LockState {
        until_epoch,
        domains,
    })
}

/// Currently active Tough Mode lock, if any. Always `None` off macOS.
pub fn read_active_lock() -> Option<LockState> {
    #[cfg(target_os = "macos")]
    {
        let content = std::fs::read_to_string(lock_state_path()).ok()?;
        let state = parse_lock(&content)?;
        (state.until_epoch > chrono::Utc::now().timestamp()).then_some(state)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Whether root committed at least the lock that was requested. Existing
/// locks may legitimately have a later expiry or additional domains because
/// the privileged helper merges requests monotonically.
pub fn satisfies_request(
    state: &LockState,
    requested_until: i64,
    requested_domains: &BTreeSet<String>,
) -> bool {
    state.until_epoch >= requested_until && requested_domains.is_subset(&state.domains)
}

/// Queues a lock request for the privileged applier to pick up.
pub fn write_lock_request(until_epoch: i64, domains: &BTreeSet<String>) -> Result<(), String> {
    let dir = hosts::data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut content = format!("UNTIL {until_epoch}\n");
    for d in domains.iter().filter(|d| hosts::is_valid_domain(d)) {
        content.push_str(d);
        content.push('\n');
    }
    atomic_write(&hosts::lock_request_path(), content.as_bytes())
}

/// Writes a complete request before publishing it with an atomic rename. The
/// launchd helper watches the destination path, so a truncate-then-write could
/// otherwise wake it on a partial first line and lose the irreversible action.
fn atomic_write(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Lock request path has no parent directory.".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Lock request path has no valid file name.".to_string())?;
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        sequence
    ));

    let result = (|| -> Result<(), std::io::Error> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();

    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Could not queue Tough Mode: {error}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_lock() {
        let state = parse_lock("UNTIL 1900000000\nreddit.com\nYouTube.com\n").unwrap();
        assert_eq!(state.until_epoch, 1_900_000_000);
        assert!(state.domains.contains("reddit.com"));
        assert!(state.domains.contains("youtube.com"));
        assert_eq!(state.domains.len(), 2);
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_lock("").is_none());
        assert!(parse_lock("nonsense\nreddit.com").is_none());
        assert!(parse_lock("UNTIL notanumber\nreddit.com").is_none());
        // Invalid domains are dropped, not fatal.
        let state = parse_lock("UNTIL 5\nevil.com 0.0.0.0 bank.com\nok.com").unwrap();
        assert_eq!(state.domains.len(), 1);
        assert!(state.domains.contains("ok.com"));
    }

    #[test]
    fn request_confirmation_is_monotonic() {
        let requested = BTreeSet::from(["reddit.com".to_string()]);
        let committed = LockState {
            until_epoch: 200,
            domains: BTreeSet::from(["reddit.com".to_string(), "youtube.com".to_string()]),
        };
        assert!(satisfies_request(&committed, 150, &requested));
        assert!(!satisfies_request(&committed, 250, &requested));
        assert!(!satisfies_request(
            &committed,
            150,
            &BTreeSet::from(["example.com".to_string()])
        ));
    }

    #[test]
    fn atomic_write_publishes_only_the_complete_file() {
        let dir = std::env::temp_dir().join(format!(
            "yfblock-lock-test-{}-{}",
            std::process::id(),
            NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("request.txt");

        atomic_write(&path, b"UNTIL 123\nreddit.com\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "UNTIL 123\nreddit.com\n"
        );

        // Tough Mode currently publishes requests only on macOS, where rename
        // atomically replaces an older unconsumed request.
        #[cfg(unix)]
        {
            atomic_write(&path, b"UNTIL 456\nyoutube.com\n").unwrap();
            assert_eq!(
                std::fs::read_to_string(&path).unwrap(),
                "UNTIL 456\nyoutube.com\n"
            );
        }

        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
