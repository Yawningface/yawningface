# yawningface desktop dev loop.
#
#   .\dev.ps1          hot-reload dev app (edits to src/ appear instantly,
#                      Rust changes rebuild + relaunch). Ctrl+C to stop.
#   .\dev.ps1 -Once    build a standalone release exe of the current code
#                      and launch it (no installer, no dev server).
#   .\dev.ps1 -Restore quit whatever is running and relaunch the installed app.
#
# The installed app and the dev app are single-instance over the same
# identifier, so this stops the installed copy first and restarts it when
# the dev session ends. Blocking keeps working throughout: both builds
# share the same spool, scheduled task, and config.

param([switch]$Once, [switch]$Restore)

$ErrorActionPreference = 'Stop'
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.cargo\bin;$env:Path"
Set-Location $PSScriptRoot

function Find-InstalledApp {
    $candidates = @(
        "$env:LOCALAPPDATA\yawningface\yawningface.exe",
        "$env:LOCALAPPDATA\YawningFace Block\yfblock.exe"
    )
    return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Stop-RunningApp {
    foreach ($name in 'yawningface', 'yfblock') {
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
    }
}

$installed = Find-InstalledApp

if ($Restore) {
    Stop-RunningApp
    if ($installed) {
        Start-Process $installed -ArgumentList '--hidden'
        Write-Host "Restarted installed app: $installed"
    } else {
        Write-Host "No installed copy found."
    }
    return
}

Stop-RunningApp

try {
    if ($Once) {
        npx tauri build --no-bundle
        $exe = @(
            "src-tauri\target\release\yawningface.exe",
            "src-tauri\target\release\yfblock.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $exe) { throw "release exe not found under src-tauri\target\release" }
        Write-Host "`nLaunching $exe - close its window (it hides to tray: quit from the tray) when done." -ForegroundColor Yellow
        Start-Process (Resolve-Path $exe)
        Write-Host "Note: the installed copy was stopped. Run .\dev.ps1 -Restore (or reboot) to bring it back."
    }
    else {
        # Blocks here until Ctrl+C; the finally below restores the installed app.
        npx tauri dev
    }
}
finally {
    if (-not $Once) {
        Stop-RunningApp
        if ($installed) {
            Start-Process $installed -ArgumentList '--hidden'
            Write-Host "Restarted installed app: $installed"
        }
    }
}
