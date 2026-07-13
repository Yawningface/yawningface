//! One-time privileged setup for website blocking (one admin prompt, then
//! silent forever):
//!
//!   macOS   - installs a root-owned applier script plus a LaunchDaemon that
//!             watches the user spool file and applies it instantly.
//!   Windows - installs an applier PowerShell script in ProgramData plus a
//!             SYSTEM scheduled task that runs it every minute.
//!
//! The applier scripts are installed root/admin-owned and re-validate every
//! domain, so the user-writable spool can only ever *block* domains
//! (entries are always 0.0.0.0), never remap them.

use super::hosts::spool_path;

#[cfg(target_os = "macos")]
pub const MAC_DAEMON_LABEL: &str = "org.yawningface.block.hostsd";

/// Absolute paths for System32 tools. Privileged plumbing must never depend
/// on PATH: a stripped or broken PATH otherwise turns setup into a cryptic
/// "program not found" - and the elevated child inherits that same PATH.
#[cfg(target_os = "windows")]
fn windir() -> String {
    std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into())
}

#[cfg(target_os = "windows")]
fn powershell_exe() -> String {
    format!(r"{}\System32\WindowsPowerShell\v1.0\powershell.exe", windir())
}

#[cfg(target_os = "windows")]
fn schtasks_exe() -> String {
    format!(r"{}\System32\schtasks.exe", windir())
}

pub fn helper_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new(&format!("/Library/LaunchDaemons/{MAC_DAEMON_LABEL}.plist")).exists()
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(schtasks_exe())
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
# yawningface - hosts applier. Runs as root via LaunchDaemon.
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
# yawningface - hosts applier. Runs as SYSTEM via scheduled task.
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
  & (Join-Path $env:WINDIR 'System32\ipconfig.exe') /flushdns | Out-Null
}
"#;

    let tmp = std::env::temp_dir().join("yfblock-setup");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let tmp_applier = tmp.join("apply-hosts.ps1");
    std::fs::write(&tmp_applier, applier).map_err(|e| e.to_string())?;

    // Setup script (runs elevated): copy applier into ProgramData (admin-owned)
    // and register the SYSTEM task.
    // ScheduledTasks module instead of schtasks.exe /TR: executable and
    // arguments stay separate parameters, so there is no quoting hell (the
    // old schtasks path failed exactly there). Absolute tool paths
    // throughout: the elevated child inherits this process's PATH, which may
    // not include System32. A transcript lands next to the applier so a
    // failed setup is never invisible again.
    let setup = format!(
        r#"$ErrorActionPreference = 'Stop'
$dir = 'C:\ProgramData\YawningFaceBlock'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'setup.log'
"setup started $(Get-Date -Format o)" | Set-Content $log
try {{
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Copy-Item -Force '{applier}' (Join-Path $dir 'apply-hosts.ps1')

  $action = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{{0}}" "{{1}}"' -f (Join-Path $dir 'apply-hosts.ps1'), '{spool}')
  $minutely = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  $atBoot = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  # A blocker that pauses on battery would be a broken product.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -Force -TaskName 'YawningFaceBlockHosts' -Action $action -Trigger @($minutely, $atBoot) -Principal $principal -Settings $settings | Out-Null
  # Tasks registered for SYSTEM are unreadable to normal processes by default,
  # which made the app's own "is it installed?" check fail with access denied.
  # Grant Authenticated Users read+execute: the app can verify the task exists
  # and nudge it with schtasks /Run, but not modify or delete it.
  $svc = New-Object -ComObject 'Schedule.Service'
  $svc.Connect()
  $svc.GetFolder('\').GetTask('YawningFaceBlockHosts').SetSecurityDescriptor('D:AI(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)', 0)
  Start-ScheduledTask -TaskName 'YawningFaceBlockHosts'
  "setup ok $(Get-Date -Format o)" | Add-Content $log
}}
catch {{
  "SETUP FAILED: $($_.Exception.Message)" | Add-Content $log
  "AT: $($_.InvocationInfo.PositionMessage)" | Add-Content $log
  exit 1
}}
"#,
        applier = tmp_applier.to_string_lossy(),
        spool = spool_str
    );
    let tmp_setup = tmp.join("setup.ps1");
    std::fs::write(&tmp_setup, setup).map_err(|e| e.to_string())?;

    // Elevate: Start-Process -Verb RunAs triggers the UAC prompt. A declined
    // prompt throws Win32 error 1223 (ERROR_CANCELLED) - detect it by code,
    // not by message text, so it works on every Windows language.
    let elevate = format!(
        "try {{ $p = Start-Process -FilePath '{}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{}'; if ($p.ExitCode -ne 0) {{ Write-Error 'YF_SETUP_FAIL'; exit 1 }} }} catch {{ $native = $_.Exception.InnerException; if ($native -and $native.NativeErrorCode -eq 1223) {{ Write-Error 'YF_UAC_CANCELLED' }} else {{ Write-Error ('YF_ELEVATE_FAIL: ' + $_.Exception.Message) }}; exit 1 }}",
        powershell_exe(),
        tmp_setup.to_string_lossy()
    );
    let output = std::process::Command::new(powershell_exe())
        .args(["-NoProfile", "-Command", &elevate])
        .output()
        .map_err(|e| format!("could not launch PowerShell for setup: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("YF_UAC_CANCELLED") {
            return Err("Setup was cancelled at the permission prompt. Nothing was changed; click again whenever you're ready.".into());
        }
        if err.contains("YF_SETUP_FAIL") {
            return Err(format!("Setup failed: {}", setup_log_error()));
        }
        let short: String = err.chars().take(200).collect();
        return Err(format!("Helper install failed: {short}"));
    }
    if !helper_installed() {
        return Err(format!(
            "Setup finished but the task can't be verified: {}",
            setup_log_error()
        ));
    }
    Ok(())
}

/// Last error line from the elevated setup's log, for actionable messages.
#[cfg(target_os = "windows")]
fn setup_log_error() -> String {
    // Set-Content in Windows PowerShell writes ANSI, not UTF-8: decode lossily.
    std::fs::read(r"C:\ProgramData\YawningFaceBlock\setup.log")
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .and_then(|log| {
            log.lines()
                .rev()
                .find(|l| l.starts_with("SETUP FAILED:"))
                .map(|l| l.trim_start_matches("SETUP FAILED:").trim().to_string())
        })
        .unwrap_or_else(|| "no details in C:\\ProgramData\\YawningFaceBlock\\setup.log".into())
}

/// Nudges the privileged applier to run now (macOS applies via WatchPaths
/// automatically; Windows task also fires every minute on its own).
pub fn trigger_apply() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new(schtasks_exe())
            .args(["/Run", "/TN", "YawningFaceBlockHosts"])
            .output();
    }
}
