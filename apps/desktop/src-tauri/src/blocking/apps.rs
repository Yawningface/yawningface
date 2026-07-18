//! App blocking: a lightweight watcher that terminates blocked processes.
//! No privileges needed - we only kill processes owned by the current user.
//!
//! Each blocked-app entry in the config is a plain string, classified once per
//! pass so the toughest users can defeat the rename / copy / move bypass with no
//! schema change:
//!
//!   * a bare hex digest (32/40/64 chars) -> match by SHA-256 of the exe file,
//!     so copying and renaming the binary does not escape the block. SHA-256 is
//!     what `Get-FileHash` (Windows) and `shasum -a 256` (macOS) produce, so a
//!     user can generate a matching hash with built-in tools.
//!   * anything containing a path separator -> match by exe path, or by parent
//!     folder (a folder entry catches every binary launched from inside it,
//!     including `.app` bundles on macOS).
//!   * otherwise -> match by process name, exact or prefix, as before ("Discord"
//!     still catches "Discord Helper").
//!
//! Hashing only runs when a hash rule is present, and each binary is read at
//! most once per change: results are cached by (path, mtime, len).

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Executables larger than this are never hashed: a real program binary is far
/// smaller, and this caps pathological I/O if a rule ever matches something huge.
const MAX_HASH_BYTES: u64 = 512 * 1024 * 1024;

/// One blocked-app rule, parsed from a raw config entry.
#[derive(Debug, PartialEq, Eq)]
enum Rule {
    /// Process name, lowercased: matches exactly or as a prefix.
    Name(String),
    /// Normalized exe path or parent folder, lowercased with `/` separators.
    Path(String),
    /// SHA-256 of the exe file contents, lowercase hex.
    Hash(String),
}

fn is_hex_digest(s: &str) -> bool {
    matches!(s.len(), 32 | 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Lowercases, converts `\` to `/`, and trims a trailing slash.
fn normalize_path(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn classify(raw: &str) -> Option<Rule> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    if is_hex_digest(&lower) {
        return Some(Rule::Hash(lower));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Some(Rule::Path(normalize_path(trimmed)));
    }
    Some(Rule::Name(lower))
}

fn name_matches(needle: &str, name: &str) -> bool {
    !needle.is_empty() && (name == needle || name.starts_with(needle))
}

/// True when `exe_path` is the rule's file, or sits inside the rule's folder.
fn path_matches(needle: &str, exe_path: &str) -> bool {
    !needle.is_empty()
        && (exe_path == needle || exe_path.starts_with(&format!("{needle}/")))
}

struct CachedHash {
    mtime: u64,
    len: u64,
    hash: String,
}

/// SHA-256 of a file's contents as lowercase hex, streamed so large binaries do
/// not have to fit in memory. `None` if the file cannot be read.
fn file_sha256(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).ok()?;
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Some(hex)
}

/// Owns the process view and a hash cache that persists across kill passes.
pub struct AppKiller {
    system: System,
    hash_cache: HashMap<String, CachedHash>,
}

impl Default for AppKiller {
    fn default() -> Self {
        Self::new()
    }
}

impl AppKiller {
    pub fn new() -> Self {
        Self {
            system: System::new(),
            hash_cache: HashMap::new(),
        }
    }

    /// Kills every running process matching one of `blocked` (name, path/folder,
    /// or content hash). Returns the names killed this pass.
    pub fn kill_blocked(&mut self, blocked: &BTreeSet<String>) -> Vec<String> {
        let rules: Vec<Rule> = blocked.iter().filter_map(|b| classify(b)).collect();
        if rules.is_empty() {
            return Vec::new();
        }
        let has_hash = rules.iter().any(|r| matches!(r, Rule::Hash(_)));

        self.system.refresh_processes(ProcessesToUpdate::All, true);

        // Phase 1: cheap name/path match; collect candidates so the process
        // borrow is released before we touch the (mutable) hash cache.
        struct Candidate {
            pid: Pid,
            exe: Option<PathBuf>,
            matched: bool,
        }
        let mut candidates: Vec<Candidate> = Vec::new();
        for (pid, process) in self.system.processes() {
            let name = process.name().to_string_lossy().to_lowercase();
            let exe = process.exe().map(|p| p.to_path_buf());
            let exe_norm = exe.as_ref().map(|p| normalize_path(&p.to_string_lossy()));
            let matched = rules.iter().any(|rule| match rule {
                Rule::Name(n) => name_matches(n, &name),
                Rule::Path(p) => exe_norm.as_deref().is_some_and(|ep| path_matches(p, ep)),
                Rule::Hash(_) => false,
            });
            candidates.push(Candidate {
                pid: *pid,
                exe,
                matched,
            });
        }

        // Phase 2: hash the still-unmatched exes, only when a hash rule exists.
        if has_hash {
            for candidate in candidates.iter_mut().filter(|c| !c.matched) {
                let Some(path) = &candidate.exe else { continue };
                let Some(hash) = self.hash_for(path) else {
                    continue;
                };
                if rules.iter().any(|r| matches!(r, Rule::Hash(h) if *h == hash)) {
                    candidate.matched = true;
                }
            }
        }

        // Phase 3: kill everything matched.
        let mut killed = Vec::new();
        for candidate in candidates.iter().filter(|c| c.matched) {
            if let Some(process) = self.system.process(candidate.pid) {
                if process.kill() {
                    killed.push(process.name().to_string_lossy().to_string());
                }
            }
        }
        killed
    }

    /// SHA-256 for `path`, cached by (mtime, len) so an unchanged binary is read
    /// once. Files above `MAX_HASH_BYTES`, or unreadable ones, return `None`.
    fn hash_for(&mut self, path: &Path) -> Option<String> {
        let meta = std::fs::metadata(path).ok()?;
        let len = meta.len();
        if len > MAX_HASH_BYTES {
            return None;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let key = path.to_string_lossy().to_string();
        if let Some(cached) = self.hash_cache.get(&key) {
            if cached.mtime == mtime && cached.len == len {
                return Some(cached.hash.clone());
            }
        }
        let hash = file_sha256(path)?;
        self.hash_cache.insert(
            key,
            CachedHash {
                mtime,
                len,
                hash: hash.clone(),
            },
        );
        Some(hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_name_path_and_hash() {
        assert_eq!(classify("Discord"), Some(Rule::Name("discord".into())));
        assert_eq!(classify("   "), None);
        assert_eq!(
            classify("C:\\Games\\Steam\\steam.exe"),
            Some(Rule::Path("c:/games/steam/steam.exe".into()))
        );
        assert_eq!(
            classify("/Applications/Discord.app/"),
            Some(Rule::Path("/applications/discord.app".into()))
        );
        let sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert_eq!(classify(sha), Some(Rule::Hash(sha.into())));
        // A hex string of the wrong length is treated as a name, not a digest.
        assert!(matches!(
            classify("abcdef0123456789abcdef012345678"),
            Some(Rule::Name(_))
        ));
    }

    #[test]
    fn name_prefix_matching() {
        assert!(name_matches("discord", "discord"));
        assert!(name_matches("discord", "discord helper"));
        assert!(!name_matches("discord", "disc"));
        assert!(!name_matches("", "anything"));
    }

    #[test]
    fn path_and_folder_matching() {
        assert!(path_matches("c:/games/steam.exe", "c:/games/steam.exe"));
        // Folder entry catches a binary launched from inside it.
        assert!(path_matches("c:/games", "c:/games/steam/steam.exe"));
        // A shared prefix that is not a folder boundary must not match.
        assert!(!path_matches("c:/games", "c:/gamesx/steam.exe"));
        assert!(!path_matches("c:/games/steam.exe", "c:/games/other.exe"));
    }

    #[test]
    fn hash_computes_and_caches() {
        let dir = std::env::temp_dir().join(format!("yf-apphash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("bin");

        std::fs::write(&file, b"hello").unwrap();
        // Known: SHA-256("hello").
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert_eq!(file_sha256(&file).unwrap(), expected);

        let mut killer = AppKiller::new();
        assert_eq!(killer.hash_for(&file).unwrap(), expected);
        assert!(killer
            .hash_cache
            .contains_key(&file.to_string_lossy().to_string()));

        // Changing the contents (new length) invalidates the cached hash.
        std::fs::write(&file, b"hello world").unwrap();
        assert_ne!(killer.hash_for(&file).unwrap(), expected);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
