---
name: esp32-cam
description: Use when connecting to, flashing, or debugging the AI-Thinker ESP32-CAM over USB from the Windows box - finding its COM port, compiling and uploading Arduino sketches, backing up or restoring flash, or reading its serial output.
---

# ESP32-CAM - connect and flash (Windows)

**AI-Thinker ESP32-CAM** on its MB programmer shield (CH340 USB-serial). Every command
below was run against the real board on 2026-07-17: `ESP32-D0WDQ6 rev v1.0`, MAC
`f0:08:d1:c6:e9:f0`, 4MB flash.

The shield's **auto-reset (DTR/RTS) works**, so no GPIO0 jumper and no button presses
are needed to flash.

## Setup - paths and the PATH bug

Both tools are installed but **not on PATH**:

```powershell
$esptool = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\5.3.0\esptool.exe"
$acli    = "$env:LOCALAPPDATA\arduino-cli\arduino-cli.exe"   # v1.5.1
```

The agent shell starts with `PATH = C:\Program Files\GitHub CLI;${PATH}` - that
`${PATH}` is never expanded, so System32 is missing and `arduino-cli compile` dies with
`exec: "cmd": executable file not found in %PATH%`. **Repair PATH before any compile or
upload:**

```powershell
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path','User')
```

## Find the port

`Get-CimInstance Win32_SerialPort` does **not** list the CH340 - it only shows COM1. Use:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_1A86' }
```

CH340 is `VID_1A86&PID_7523`. **The number moves between sessions** (COM4 once, COM7
later) - never hardcode it.

If no port appears at all, it is **not** a driver issue: a driverless device would still
show as "Unknown device" with a VID/PID, because enumeration precedes drivers. It is the
cable (charge-only micro-USB is the usual culprit - the power LED still lights), the USB
socket, or the board.

## Identify the chip

```powershell
& $esptool --port COM7 flash-id
```

## Back up flash before overwriting - always

```powershell
& $esptool --port COM7 --baud 921600 read-flash 0 0x400000 backup.bin   # ~90s
& $esptool --port COM7 --baud 460800 write-flash 0 backup.bin           # restore, ~35s
```

Both end in `Hash of data verified.` A full-image restore puts the board back byte-exact.

## Compile and upload a sketch

FQBN is **`esp32:esp32:esp32cam`** (core `esp32:esp32` 3.3.10). Sketch folder name must
equal the `.ino` filename.

```powershell
& $acli compile --fqbn esp32:esp32:esp32cam <sketchdir>
& $acli upload -p COM7 --fqbn esp32:esp32:esp32cam <sketchdir>
```

**Upload fails intermittently** with `Unable to verify flash chip connection (Failed to
read target memory. Only got 1 byte status response.)` at its fixed 460800 baud.
**Just run it again** - the retry succeeds. `esp32cam` exposes no `UploadSpeed` option to
lower it.

## Read serial (115200) and reset

```powershell
$sp = New-Object System.IO.Ports.SerialPort 'COM7',115200,'None',8,'One'
$sp.DtrEnable = $false; $sp.RtsEnable = $false
$sp.Open()
$sp.RtsEnable = $true; Start-Sleep -Milliseconds 150; $sp.RtsEnable = $false  # reset
Start-Sleep -Seconds 5
$sp.ReadExisting()
$sp.Close(); $sp.Dispose()
```

RTS drives EN (reset), DTR drives GPIO0. Leave **DTR `$false`** or the chip boots into the
bootloader instead of running the sketch. **Close the port before flashing** - esptool
cannot open it while a monitor holds it.

## What is on the board right now

`LibreFOMO on-device` - a TFLite Micro **strawberry** detector, 192x192x3 in → 24x24x2 out,
603308-byte arena. Serves `/fomo` (JSON) and `/jpg` (frame) once WiFi joins, else prints
`WiFi failed - running serial-only` (its current state - it is not joining the network).

Source: `~\LibreFOMO-experimenting\firmware_fomo\` (private repo
`LibreYOLO/LibreFOMO-experimenting`), mirrored in the worktree
`~\Documents\GitHub\libreyolo-librefomo-edge-parity\esp32_fomo\firmware_fomo\`. A flash
backup of the exact running image is at `~\esp32-cam-backup\firmware-f008d1c6e9f0-*.bin`.
