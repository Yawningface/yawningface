//! Website blocking via a managed section in the OS hosts file.
//!
//! The unprivileged app writes the desired domain list to a user-writable
//! "spool" file. A privileged applier — installed once with a single admin
//! prompt (see `platform.rs`) — reads the spool, validates every line, and
//! rewrites only the marked section of the hosts file:
//!
//!   macOS:   root LaunchDaemon with WatchPaths on the spool (applies instantly)
//!   Windows: SYSTEM scheduled task running every minute
//!
//! Defense in depth: the applier re-validates each domain against a strict
//! charset, so a tampered spool can at worst block domains, never remap them
//! (entries always point to 0.0.0.0).

use std::collections::BTreeSet;
use std::path::PathBuf;

pub const MARKER_BEGIN: &str = "# >>> YAWNINGFACE BLOCK BEGIN >>> (managed section, do not edit)";
pub const MARKER_END: &str = "# <<< YAWNINGFACE BLOCK END <<<";

pub fn hosts_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        PathBuf::from(windir).join("System32\\drivers\\etc\\hosts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}

/// User-writable spool file read by the privileged applier.
pub fn spool_path() -> PathBuf {
    data_dir().join("spool_domains.txt")
}

/// App data dir that works both in the GUI app and in the headless applier.
pub fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| "C:\\ProgramData".into());
        PathBuf::from(base).join("org.yawningface.block.desktop")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home).join("Library/Application Support/org.yawningface.block.desktop")
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home).join(".local/share/org.yawningface.block.desktop")
    }
}

pub fn is_valid_domain(d: &str) -> bool {
    !d.is_empty()
        && d.len() <= 253
        && d.contains('.')
        && d.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !d.starts_with('-')
        && !d.starts_with('.')
}

/// Writes the desired blocked-domain set to the spool file.
pub fn write_spool(domains: &BTreeSet<String>) -> Result<(), String> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content: String = domains
        .iter()
        .filter(|d| is_valid_domain(d))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(spool_path(), content + "\n").map_err(|e| e.to_string())
}

fn render_section(domains: &[String]) -> String {
    let mut lines = vec![MARKER_BEGIN.to_string()];
    for d in domains {
        lines.push(format!("0.0.0.0 {d}"));
        if !d.starts_with("www.") {
            lines.push(format!("0.0.0.0 www.{d}"));
        }
    }
    lines.push(MARKER_END.to_string());
    lines.join("\n")
}

/// Replaces (or appends) the managed section inside the hosts file content.
pub fn merge_into_hosts(existing: &str, domains: &[String]) -> String {
    let section = render_section(domains);
    let begin = existing.find(MARKER_BEGIN);
    let end = existing.find(MARKER_END);

    match (begin, end) {
        (Some(b), Some(e)) if e >= b => {
            let after = &existing[e + MARKER_END.len()..];
            format!("{}{}{}", &existing[..b], section, after)
        }
        _ => {
            let sep = if existing.ends_with('\n') { "" } else { "\n" };
            format!("{existing}{sep}\n{section}\n")
        }
    }
}

/// Tries to apply the domain set directly (works when we already have
/// privileges, e.g. running as admin). Returns Err on permission failure.
pub fn apply_direct(domains: &BTreeSet<String>) -> Result<(), String> {
    let valid: Vec<String> = domains
        .iter()
        .filter(|d| is_valid_domain(d))
        .cloned()
        .collect();
    let path = hosts_path();
    let existing = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let merged = merge_into_hosts(&existing, &valid);
    if merged != existing {
        std::fs::write(&path, merged).map_err(|e| e.to_string())?;
        flush_dns();
    }
    Ok(())
}

/// Headless entrypoint for `yfblock --apply-hosts` (run privileged by the
/// LaunchDaemon / scheduled task). Reads the spool and applies it.
pub fn apply_from_spool_cli() -> i32 {
    let spool = match std::env::args().skip_while(|a| a != "--apply-hosts").nth(1) {
        Some(p) => PathBuf::from(p),
        None => spool_path(),
    };
    let content = std::fs::read_to_string(&spool).unwrap_or_default();
    let domains: BTreeSet<String> = content
        .lines()
        .map(|l| l.trim().to_ascii_lowercase())
        .filter(|l| is_valid_domain(l))
        .collect();
    match apply_direct(&domains) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("apply-hosts failed: {e}");
            1
        }
    }
}

pub fn flush_dns() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("dscacheutil")
            .arg("-flushcache")
            .status();
        let _ = std::process::Command::new("killall")
            .args(["-HUP", "mDNSResponder"])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        // Absolute path: never depend on PATH containing System32.
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        let _ = std::process::Command::new(format!(r"{windir}\System32\ipconfig.exe"))
            .arg("/flushdns")
            .status();
    }
}

/// True if the managed hosts section currently matches the desired set —
/// how the UI knows whether the privileged applier is working.
pub fn hosts_section_matches(domains: &BTreeSet<String>) -> bool {
    let valid: Vec<String> = domains
        .iter()
        .filter(|d| is_valid_domain(d))
        .cloned()
        .collect();
    match std::fs::read_to_string(hosts_path()) {
        Ok(existing) => {
            let desired = merge_into_hosts(&existing, &valid);
            desired == existing
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_appends_then_replaces() {
        let base = "127.0.0.1 localhost\n";
        let v1 = merge_into_hosts(base, &["twitter.com".into()]);
        assert!(v1.contains("0.0.0.0 twitter.com"));
        assert!(v1.contains("0.0.0.0 www.twitter.com"));
        assert!(v1.starts_with(base));

        let v2 = merge_into_hosts(&v1, &["reddit.com".into()]);
        assert!(!v2.contains("twitter.com"));
        assert!(v2.contains("0.0.0.0 reddit.com"));
        assert_eq!(v2.matches(MARKER_BEGIN).count(), 1);
    }

    #[test]
    fn empty_set_leaves_empty_section() {
        let base = "127.0.0.1 localhost\n";
        let v1 = merge_into_hosts(base, &["a.com".into()]);
        let v2 = merge_into_hosts(&v1, &[]);
        assert!(!v2.contains("a.com"));
        assert!(v2.contains(MARKER_BEGIN));
    }

    #[test]
    fn domain_validation() {
        assert!(is_valid_domain("news.ycombinator.com"));
        assert!(!is_valid_domain("evil.com 0.0.0.0 bank.com"));
        assert!(!is_valid_domain("no_dot"));
        assert!(!is_valid_domain(""));
    }
}
