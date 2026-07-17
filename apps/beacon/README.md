# YawningFace beacon puck

The hardware half of the proximity blocker: a puck that makes the phone block
apps when it is in the room. Product and iOS design live in
[product/documentation/beacon.md](../../product/documentation/beacon.md); this
README covers the firmware and how to verify it.

The puck is deliberately dumb. It advertises an iBeacon packet forever and never
talks to the phone, so there is no pairing, no MFi, and no connection to keep
alive. iOS matches the fleet UUID, wakes the app, and the app shields.

## Layout

| Path | What |
| --- | --- |
| `yf_beacon/yf_beacon.ino` | The firmware |
| `tools/scan_ibeacon.py` | Decodes the advert off the air, to verify a puck without an iPhone |

## Identity

One fleet UUID for every puck, `major` = zone, `minor` = the individual puck:

```
088FD0AC-A9B1-407B-A9F1-84BA43FCF681
```

The UUID is a **public identifier, not a secret**. It is broadcast in the clear
and can be sniffed or cloned, so it says which puck is nearby but never proves
it. Nothing that needs a security boundary can rest on beacon identity alone.

iOS monitors one condition per zone with an explicit major, so `minor` is not
monitored: two pucks in one bedroom both mean "bedroom".

## Build and flash

Toolchain paths and the COM-port/PATH gotchas are in the
[`esp32-cam` skill](../../.claude/skills/esp32-cam/SKILL.md).

```powershell
$acli = "$env:LOCALAPPDATA\arduino-cli\arduino-cli.exe"
& $acli compile --fqbn esp32:esp32:esp32cam apps/beacon/yf_beacon
& $acli upload -p COM7 --fqbn esp32:esp32:esp32cam apps/beacon/yf_beacon
```

Builds to 1101223 bytes, 35% of the partition, so BLE fits an ESP32-CAM fine.

**If `upload` fails with "The chip stopped responding"**, arduino-cli's fixed
460800 baud is the problem, not the board (`esptool flash-id` will still answer
at 115200). The FQBN exposes no `UploadSpeed` option, so flash out-of-band:

```powershell
$acli compile --fqbn esp32:esp32:esp32cam --output-dir build apps/beacon/yf_beacon
$esptool = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\5.3.0\esptool.exe"
& $esptool --port COM7 --baud 115200 write-flash `
  0x1000 build/yf_beacon.ino.bootloader.bin `
  0x8000 build/yf_beacon.ino.partitions.bin `
  0xe000 "$env:LOCALAPPDATA\Arduino15\packages\esp32\hardware\esp32\3.3.10\tools\partitions\boot_app0.bin" `
  0x10000 build/yf_beacon.ino.bin
```

## Provisioning

Zone and radio settings live in NVS, so one build serves every puck. Over serial
at 115200:

```
major 2      zone id, what iOS monitors
minor 7      which puck within the zone
power -59    the measured-power byte, see calibration
tx 0         radio power in dBm, snapped to the ESP32 ladder (-12..+9)
show         print current config
```

Each command saves, restarts advertising, and reprints the config.

## Verify

Reads the advert with any BLE radio and decodes what iOS would see:

```powershell
uv run --with bleak python apps/beacon/tools/scan_ibeacon.py --seconds 10
```

```
iBeacon 088FD0AC-A9B1-407B-A9F1-84BA43FCF681
  major 1  minor 1  measured power -59 dBm
  mac F0:08:D1:C6:E9:F2
  14 adverts in 10s, rssi avg -84.9 dBm (min -88, max -83)
```

The BLE MAC is the board's base MAC + 2, so an ESP32-CAM whose USB MAC is
`f0:08:d1:c6:e9:f0` advertises from `f0:08:d1:c6:e9:f2`.

## What was measured on real hardware

Checked on 2026-07-17 against an AI-Thinker ESP32-CAM, decoded over the air by a
separate BLE radio rather than trusted from the board's own logs:

- The advert decodes as a spec-correct iBeacon: exact UUID, major, minor and
  measured-power byte, with major/minor big-endian on the wire.
- It advertises as `NON_CONNECTABLE_UNDIRECTED`, `is_connectable=False`, with no
  scan response. A puck has nothing to serve, so nothing can try to connect.
- Serial provisioning survives reboot and changes what is on the air.
- `tx 0` -> `tx 9` moved observed RSSI from -84.9 to -74.8 dBm, a +10.1 dB shift
  for a requested +9. **TX power is a working physical-radius knob**, which is
  the one lever the OS boundary does not give you.

Advert rate is not verified: Windows coalesces duplicate adverts, so the 14
adverts/10 s above is a floor, not the configured 100 ms interval.

## Calibration is still open

`measuredPower` is the RSSI a phone sees **at exactly 1 m**, and it is what iOS
divides by to estimate distance. The `-59` in the firmware is the generic
placeholder off Apple's example, **not a measurement of this board**, so any
distance iOS reports today is wrong by however far off that guess is.

To calibrate: put a phone exactly 1 m from the puck, take a median RSSI over
~30 s, and set that value with `power <n>`.

It is a per-antenna constant, so it must be redone whenever `tx` changes: drop
TX by 9 dB and the RSSI at 1 m drops ~9 dB too, so `measuredPower` must follow or
every distance estimate is wrong by that offset.

## Notes for a real product

- **ESP32 is a prototype radio, not a puck radio.** It cannot deep-sleep here,
  because a beacon has to advertise continuously to be detectable, so it draws
  tens of mA and eats a coin cell. Shipping hardware wants an nRF52-class part
  that idles in the tens of µA between adverts.
- **Antenna.** ESP32-CAM boards carry a solder jumper selecting the PCB trace
  antenna or the u.FL socket. Set to external with nothing attached, range
  collapses. Worth confirming before reading anything into weak RSSI.
- **The iBeacon format is Apple-licensed for commercial hardware.** Irrelevant
  for prototypes; relevant the day we sell a puck. iOS detects a correctly
  formatted beacon regardless of who made it.
