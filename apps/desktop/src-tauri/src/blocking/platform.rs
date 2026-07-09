//! One-time privileged setup for website blocking (one admin prompt, then
//! silent forever):
//!
//!   macOS   — installs a root-owned applier script plus a LaunchDaemon that
//!             watches the user spool file and applies it instantly.
//!   Windows — installs an applier PowerShell script in ProgramData plus a
//!             SYSTEM scheduled task that runs it every minute.
//!
//! The applier scripts are installed root/admin-owned and re-validate every
//! domain, so the user-writable spool can only ever *block* domains
//! (entries are always 0.0.0.0), never remap them.

use super::hosts::spool_path;

#[cfg(target_os = "macos")]
pub const MAC_DAEMON_LABEL: &str = "org.yawningface.block.hostsd";

pub fn helper_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new(&format!("/Library/LaunchDaemons/{MAC_DAEMON_LABEL}.plist")).exists()
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("schtasks")
            .args(["/Query", "/TN", "YawningFaceBlockHosts"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        false
    }
}

/// Installs the privileged applier. Triggers exactly one OS admin prompt.
pub fn install_helper() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        install_helper_macos()
    }
    #[cfg(target_os = "windows")]
    {
        install_helper_windows()
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Err("Website blocking helper is not supported on this platform yet.".into())
    }
}

#[cfg(target_os = "macos")]
fn install_helper_macos() -> Result<(), String> {
    use std::fmt::Write as _;

    let spool = spool_path();
    let spool_str = spool.to_string_lossy().to_string();

    let script = r##"#!/bin/bash
# YawningFace Block — hosts applier. Runs as root via LaunchDaemon.
# Reads the user spool file, validates every domain, and rewrites only the
# managed section of /etc/hosts. Entries always point to 0.0.0.0.
SPOOL="$1"
HOSTS="/etc/hosts"
BEGIN="# >>> YAWNINGFACE BLOCK BEGIN >>> (managed section, do not edit)"
END="# <<< YAWNINGFACE BLOCK END <<<"

SECTION="$BEGIN"$'\n'
if [ -f "$SPOOL" ]; then
  while IFS= read -r line; do
    d=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
    case "$d" in
      *.*) ;;
      *) continue ;;
    esac
    if printf '%s' "$d" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9.-]*$'; then
      SECTION+="0.0.0.0 $d"$'\n'
      case "$d" in
        www.*) ;;
        *) SECTION+="0.0.0.0 www.$d"$'\n' ;;
      esac
    fi
  done < "$SPOOL"
fi
SECTION+="$END"

TMP=$(mktemp)
awk -v begin="$BEGIN" -v end="$END" '
  $0 == begin {inblock=1; next}
  $0 == end {inblock=0; next}
  !inblock {print}
' "$HOSTS" > "$TMP"
printf '%s\n' "$SECTION" >> "$TMP"
cat "$TMP" > "$HOSTS"
rm -f "$TMP"
dscacheutil -flushcache 2>/dev/null
killall -HUP mDNSResponder 2>/dev/null
exit 0
"##;

    let mut plist = String::new();
    write!(
        plist,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Library/Application Support/YawningFaceBlock/apply-hosts.sh</string>
    <string>{spool}</string>
  </array>
  <key>WatchPaths</key>
  <array><string>{spool}</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"#,
        label = MAC_DAEMON_LABEL,
        spool = spool_str
    )
    .map_err(|e| e.to_string())?;

    // Stage files in a temp dir, then move them into place as root.
    let tmp = std::env::temp_dir().join("yfblock-setup");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let tmp_script = tmp.join("apply-hosts.sh");
    let tmp_plist = tmp.join(format!("{MAC_DAEMON_LABEL}.plist"));
    std::fs::write(&tmp_script, script).map_err(|e| e.to_string())?;
    std::fs::write(&tmp_plist, plist).map_err(|e| e.to_string())?;

    let shell_cmd = format!(
        "mkdir -p '/Library/Application Support/YawningFaceBlock' && \
         cp '{script}' '/Library/Application Support/YawningFaceBlock/apply-hosts.sh' && \
         chown root:wheel '/Library/Application Support/YawningFaceBlock/apply-hosts.sh' && \
         chmod 755 '/Library/Application Support/YawningFaceBlock/apply-hosts.sh' && \
         cp '{plist}' '/Library/LaunchDaemons/{label}.plist' && \
         chown root:wheel '/Library/LaunchDaemons/{label}.plist' && \
         chmod 644 '/Library/LaunchDaemons/{label}.plist' && \
         (launchctl bootout system/{label} 2>/dev/null; true) && \
         launchctl bootstrap system '/Library/LaunchDaemons/{label}.plist'",
        script = tmp_script.to_string_lossy(),
        plist = tmp_plist.to_string_lossy(),
        label = MAC_DAEMON_LABEL
    );

    // AppleScript string escaping: backslashes and double quotes.
    let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let osa = format!("do shell script \"{escaped}\" with administrator privileges");

    let output = std::process::Command::new("osascript")
        .args(["-e", &osa])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("User canceled") || err.contains("-128") {
            return Err("Setup was cancelled at the password prompt.".into());
        }
        return Err(format!("Helper install failed: {err}"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_helper_windows() -> Result<(), String> {
    let spool = spool_path();
    let spool_str = spool.to_string_lossy().to_string();

    let applier = r#"param([string]$Spool)
# YawningFace Block - hosts applier. Runs as SYSTEM via scheduled task.
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$begin = '# >>> YAWNINGFACE BLOCK BEGIN >>> (managed section, do not edit)'
$end = '# <<< YAWNINGFACE BLOCK END <<<'

$domains = @()
if (Test-Path $Spool) {
  foreach ($line in Get-Content $Spool) {
    $d = $line.Trim().ToLower()
    if ($d -match '^[a-z0-9][a-z0-9.-]*$' -and $d.Contains('.')) { $domains += $d }
  }
}

$section = @($begin)
foreach ($d in $domains) {
  $section += "0.0.0.0 $d"
  if (-not $d.StartsWith('www.')) { $section += "0.0.0.0 www.$d" }
}
$section += $end

$existing = @()
if (Test-Path $hostsPath) { $existing = @(Get-Content $hostsPath) }
$kept = @()
$inside = $false
foreach ($line in $existing) {
  if ($line -eq $begin) { $inside = $true; continue }
  if ($line -eq $end) { $inside = $false; continue }
  if (-not $inside) { $kept += $line }
}
$new = $kept + $section
if (($existing -join "`n") -ne ($new -join "`n")) {
  Set-Content -Path $hostsPath -Value $new -Encoding ascii
  ipconfig /flushdns | Out-Null
}
"#;

    let tmp = std::env::temp_dir().join("yfblock-setup");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let tmp_applier = tmp.join("apply-hosts.ps1");
    std::fs::write(&tmp_applier, applier).map_err(|e| e.to_string())?;

    // Setup script (runs elevated): copy applier into ProgramData (admin-owned)
    // and register the SYSTEM task.
    let setup = format!(
        r#"$dir = 'C:\ProgramData\YawningFaceBlock'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Force '{applier}' (Join-Path $dir 'apply-hosts.ps1')
$action = 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\YawningFaceBlock\apply-hosts.ps1" "{spool}"'
schtasks /Create /F /TN 'YawningFaceBlockHosts' /SC MINUTE /MO 1 /RL HIGHEST /RU SYSTEM /TR $action | Out-Null
schtasks /Run /TN 'YawningFaceBlockHosts' | Out-Null
"#,
        applier = tmp_applier.to_string_lossy(),
        spool = spool_str
    );
    let tmp_setup = tmp.join("setup.ps1");
    std::fs::write(&tmp_setup, setup).map_err(|e| e.to_string())?;

    // Elevate: Start-Process -Verb RunAs triggers the UAC prompt.
    let elevate = format!(
        "Start-Process -FilePath 'powershell' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{}'",
        tmp_setup.to_string_lossy()
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &elevate])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("canceled") || err.contains("cancelled") {
            return Err("Setup was cancelled at the UAC prompt.".into());
        }
        return Err(format!("Helper install failed: {err}"));
    }
    if !helper_installed() {
        return Err("The scheduled task was not created. Please try again.".into());
    }
    Ok(())
}

/// Nudges the privileged applier to run now (macOS applies via WatchPaths
/// automatically; Windows task also fires every minute on its own).
pub fn trigger_apply() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("schtasks")
            .args(["/Run", "/TN", "YawningFaceBlockHosts"])
            .output();
    }
}
